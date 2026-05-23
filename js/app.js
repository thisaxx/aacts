function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate(8);
}

async function addComment(parentType, parentId, text) {
  if (!text.trim()) return;
  const user = localStorage.getItem('aac_user') || 'Unknown';
  const comment = {
    id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    parentType,
    parentId,
    author: user,
    authorRole: localStorage.getItem('aac_user_role') || '',
    text: text.trim(),
    createdAt: new Date().toISOString()
  };
  await DB.put('comments', comment);
  await queueSync('comments', 'create', comment);
  // Check for @mentions
  const mentions = text.match(/@(\w[\w\s]*\w|\w)/g);
  if (mentions) {
    mentions.forEach(m => {
      const mentionedName = m.slice(1).trim();
      createNotification('mention', `You were mentioned by ${user}`, `In ${parentType}: ${text.slice(0, 100)}`, parentType === 'task' ? 'maintenance' : 'defects');
    });
  }
  logActivity('comment', `${user} commented on ${parentType}`, parentId);
  return comment;
}

async function getComments(parentType, parentId) {
  const all = await DB.getAll('comments');
  return all.filter(c => c.parentType === parentType && c.parentId === parentId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function renderComments(parentType, parentId, containerEl) {
  getComments(parentType, parentId).then(comments => {
    containerEl.innerHTML = comments.map(c => `
      <div style="padding:8px 0;border-bottom:1px solid var(--glass-border)">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)">
          <strong>${escHtml(c.author)}</strong>
          <span>${new Date(c.createdAt).toLocaleString()}</span>
        </div>
        <div style="font-size:13px;margin-top:2px">${escHtml(c.text)}</div>
      </div>
    `).join('') || '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">No comments yet</div>';
  });
}

function commentInputHTML() {
  return `
    <div style="display:flex;gap:6px;margin-top:8px">
      <input type="text" class="comment-input form-input" placeholder="Add a comment... @mention a colleague" style="flex:1;font-size:13px">
      <button class="btn btn-sm btn-primary comment-submit-btn" style="padding:4px 10px">Post</button>
    </div>
  `;
}

function attachCommentHandler(parentType, parentId, containerEl) {
  const input = containerEl.querySelector('.comment-input');
  const btn = containerEl.querySelector('.comment-submit-btn');
  if (!input || !btn) return;
  const post = async () => {
    if (!input.value.trim()) return;
    await addComment(parentType, parentId, input.value);
    input.value = '';
    renderComments(parentType, parentId, containerEl);
  };
  btn.addEventListener('click', post);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') post(); });
}

async function logActivity(type, description, relatedId) {
  const entry = {
    id: 'act_' + Date.now(),
    type,
    description,
    relatedId: relatedId || '',
    performedBy: localStorage.getItem('aac_user') || 'Unknown',
    createdAt: new Date().toISOString()
  };
  await DB.put('flights', entry);
}

async function getActivityFeed(limit = 50) {
  const all = await DB.getAll('flights');
  return all.filter(e => e.id && e.id.startsWith('act_'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

function activityFeedView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Activity Feed</h2>
        <div class="subtitle">Real-time crew activity</div>
      </div>
      <div id="activity-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
    </div>
  `;
  renderActivityFeed();
}

async function renderActivityFeed() {
  const el = document.getElementById('activity-list');
  const entries = await getActivityFeed();
  if (entries.length === 0) {
    el.innerHTML = emptyState('&#128197;', 'No activity recorded yet');
    return;
  }
  el.innerHTML = entries.map(e => `
    <div class="flight-row">
      <div style="flex:1;min-width:0">
        <div class="flight-pilot">${escHtml(e.description)}</div>
        <div class="flight-date">${escHtml(e.performedBy)} &middot; ${new Date(e.createdAt).toLocaleString()}</div>
      </div>
    </div>
  `).join('');
}

async function getCrewStatusBoard() {
  const users = await DB.getAll('users');
  const attendance = await DB.getAll('attendance');
  const tasks = await DB.getAll('maintenance_tasks');
  const today = new Date().toISOString().slice(0, 10);
  const activeAttendance = attendance.filter(a => a.date === today && (a.status === 'approved' || a.status === 'pending'));
  return users.map(u => {
    const att = activeAttendance.find(a => a.userName === u.name);
    const assignedTasks = tasks.filter(t => t.assignedTo === u.name && t.status === 'open');
    return { user: u, attendance: att || null, tasks: assignedTasks };
  });
}

function compressImage(dataUrl, maxW = 800, maxH = 600, quality = 0.7) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h *= maxW / w; w = maxW; }
      if (h > maxH) { w *= maxH / h; h = maxH; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function emptyState(icon, msg) {
  return `<div style="text-align:center;padding:24px 12px;font-family:var(--mono)">
    <div style="font-size:28px;margin-bottom:8px;opacity:0.4">${icon}</div>
    <div style="font-size:12px;color:var(--text-muted);letter-spacing:0.3px">${msg}</div>
  </div>`;
}

function showConfirmDialog(title, message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <h3>${escHtml(title)}</h3>
        <p>${escHtml(message)}</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary" id="dialog-no">No</button>
          <button class="btn btn-primary" id="dialog-yes">Yes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.getElementById('dialog-yes').onclick = () => {
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); resolve(true); }, 300);
    };
    document.getElementById('dialog-no').onclick = () => {
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); resolve(false); }, 300);
    };
  });
}

function showPromptDialog(title, message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <h3>${escHtml(title)}</h3>
        <p>${escHtml(message)}</p>
        <textarea id="dialog-input" rows="4" style="width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.4);color:#fff;font-size:15px;font-family:inherit;margin:12px 0;outline:none"></textarea>
        <div class="dialog-actions">
          <button class="btn btn-secondary" id="dialog-cancel">Cancel</button>
          <button class="btn btn-primary" id="dialog-ok">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.getElementById('dialog-ok').onclick = () => {
      const val = document.getElementById('dialog-input').value;
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); resolve(val); }, 300);
    };
    document.getElementById('dialog-cancel').onclick = () => {
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); resolve(null); }, 300);
    };
  });
}

function showBottomSheet(html) {
  return new Promise(resolve => {
    const existing = document.querySelector('.sheet-overlay');
    if (existing) existing.remove();
    const existingSheet = document.querySelector('.sheet');
    if (existingSheet) existingSheet.remove();

    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    overlay.innerHTML = `<div class="sheet"><div class="sheet-inner"><div class="sheet-handle"></div>${html}</div></div>`;
    document.body.appendChild(overlay);
    const sheet = overlay.querySelector('.sheet');

    requestAnimationFrame(() => {
      overlay.classList.add('open');
      sheet.classList.add('open');
    });

    let resolved = false;
    const close = (result) => {
      if (resolved) return;
      resolved = true;
      overlay.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => { overlay.remove(); resolve(result); }, 400);
    };

    overlay.addEventListener('click', e => {
      if (e.target === overlay) close(null);
    });

    window.__sheetClose = close;
  });
}

function stepperHTML(id, value, min = 0, max = 999, step = 1, mini = false) {
  const cls = mini ? 'form-input input-sm' : 'form-input';
  return `<input type="number" id="${id}" class="${cls}" value="${value}" min="${min}" max="${max}" step="${step}">`;
}

function initSteppers() {
  // steppers replaced with plain number inputs
}

function toggleSwitchHTML(id, label, on = false) {
  return `<div class="toggle-wrap" data-toggle-id="${id}">
    <div class="toggle-track ${on ? 'on' : ''}">
      <div class="toggle-thumb"></div>
    </div>
    <span class="toggle-label">${escHtml(label)}</span>
  </div>`;
}

function initToggles() {
  document.querySelectorAll('.toggle-wrap').forEach(el => {
    const track = el.querySelector('.toggle-track');
    el.addEventListener('click', () => {
      track.classList.toggle('on');
      const ev = new Event('change', { bubbles: true });
      ev.checked = track.classList.contains('on');
      el.dispatchEvent(ev);
    });
  });
}

async function dashboardView() {
  const app = document.getElementById('app');
  const ac = await getAircraft();
  if (!ac) {
    app.innerHTML = `
      <div class="page">
        <div class="page-header">
          <h2>Dashboard</h2>
          <div class="subtitle">No aircraft found</div>
        </div>
        <div class="card" style="text-align:center;padding:40px 20px">
          <div style="font-size:48px;margin-bottom:16px">&#9992;</div>
          <p class="text-muted">Add your first aircraft to get started.</p>
          <button class="btn btn-primary btn-block" id="goto-fleet-btn" style="margin-top:16px">+ Add Aircraft</button>
        </div>
      </div>`;
    document.getElementById('goto-fleet-btn').addEventListener('click', () => showAircraftSheet());
    return;
  }
  const flights = await getFlights();
  const tasks = await getMaintenanceTasks();
  const parts = await getParts();
  const defects = await getDefects();
  const fuelStocks = await getFuelStock();
  const userRole = localStorage.getItem('aac_user_role');

  const tach = ac.totalTachTime;
  const hoursSinceOil = tach - ac.lastOilChangeTach;
  const hoursSince100hr = tach - ac.last100hrTach;
  const oilRemaining = Math.max(0, ac.oilInterval - hoursSinceOil);
  const structRemaining = Math.max(0, ac.structInterval - hoursSince100hr);
  const minRemaining = Math.min(oilRemaining, structRemaining);
  const openTasks = tasks.filter(t => t.status === 'open').length;
  const lowParts = parts.filter(p => p.quantityOnHand <= p.minSafeStock).length;
  const totalHours = flights.reduce((s, f) => s + f.flownHours, 0);
  const groundingDefects = defects.filter(d => d.urgency === 'grounding' && d.status === 'open').length;
  const lowFuels = fuelStocks.filter(fs => fs.quantityLiters <= fs.minSafeLevel).length;
  let mixLow = false;
  let mixQty = 0;
  try {
    const mixStock = await DB.get('fuel_stock', 'mix');
    if (mixStock) { mixQty = mixStock.quantityLiters; mixLow = mixQty < 50; }
  } catch(e) {}

  // Month stats
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthFlights = flights.filter(f => f.flightDate >= monthStart);
  const monthHours = monthFlights.reduce((s, f) => s + f.flownHours, 0);
  const openDefects = defects.filter(d => d.status === 'open').length;

  // After-flight inspection pending
  const afterFlightPending = tasks.filter(t => t.type === 'after-flight' && t.status === 'open').length > 0;
  // Daily CRS check
  const today = new Date().toISOString().slice(0, 10);
  const crsIssuedToday = ac.dailyCrsDate === today;

  // Check if aircraft is airborne (departed but no arrival)
  const isAirborne = flights.some(f => f.aircraftId === ac.tailNumber && f.status === 'departed');

  let statusClass, statusLabel;
  const reasons = [];
  if (groundingDefects > 0) { reasons.push(`${groundingDefects} grounding squawk(s)`); }
  if (minRemaining <= 0) { reasons.push('Inspection overdue'); }
  if (ac.groundedAfterInspection) { reasons.push('After-flight inspection — CRS required'); }
  if (!crsIssuedToday) { reasons.push('No daily CRS issued'); }

  if (isAirborne) {
    statusClass = 'blue'; statusLabel = 'Airborne';
  } else if (reasons.length > 0) {
    statusClass = 'red'; statusLabel = 'Grounded';
  } else if (minRemaining <= 5) {
    statusClass = 'orange'; statusLabel = 'Caution';
  } else {
    statusClass = 'green'; statusLabel = 'Airworthy';
  }

  // Build alerts list
  const alerts = [];
  if (!crsIssuedToday && (userRole === 'engineer' || userRole === 'production_planner' || userRole === 'admin')) alerts.push('No daily CRS issued');
  if (afterFlightPending) alerts.push('After-flight inspection pending');
  if (lowFuels > 0 || mixLow) alerts.push(`Fuel low: ${lowFuels} stock${mixLow ? ', Mix below 50L' : ''}`);
  const inspectionOverdue = minRemaining <= 0;
  if (inspectionOverdue) alerts.push('Inspection overdue — perform sign-off to clear');

  app.innerHTML = `
    <div class="page">
      <div class="dashboard-hero" id="dashboard-hero" style="cursor:pointer">
        <div class="hero-image-wrap">
          <img src="${ac.photoData || 'img/aircraft.jpg'}" alt="${escHtml(ac.tailNumber)}" class="aircraft-image">
          <div class="hero-overlay"></div>
          <div class="hero-info">
            <span class="hero-tail">${escHtml(ac.tailNumber)}</span>
            <span class="hero-type">${escHtml(ac.type || 'Aircraft')}</span>
          </div>
          <div class="hero-status ${statusClass}">
            <span class="hero-status-dot"></span>
            ${statusLabel}
          </div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="stat-card">
          <div class="stat-value">${flights.length}</div>
          <div class="stat-label">Flights</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalHours.toFixed(1)}</div>
          <div class="stat-label">Total Hours</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${monthFlights.length}</div>
          <div class="stat-label">This Month</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${openDefects > 0 ? 'text-red' : 'text-green'}">${openDefects}</div>
          <div class="stat-label">Open Squawks</div>
        </div>
      </div>

      ${alerts.length > 0 || ac.groundedAfterInspection ? `
      <div class="dash-alerts">
        ${alerts.map(a => `<div class="dash-alert">&#9888; ${a}</div>`).join('')}
        ${ac.groundedAfterInspection ? `<div class="dash-alert" style="border-color:var(--danger)">&#128308; Aircraft grounded — daily CRS required before next flight</div>` : ''}
        ${(!crsIssuedToday || ac.groundedAfterInspection) && (userRole === 'engineer' || userRole === 'production_planner' || userRole === 'admin') ? `
        <button class="btn btn-primary btn-block" id="issue-daily-crs-btn" style="margin-top:8px">${ac.groundedAfterInspection ? '&#9989; Issue Daily CRS to Clear Grounding' : 'Issue Daily CRS'}</button>` : ''}
        ${inspectionOverdue ? `<button class="btn btn-primary btn-block" id="perform-inspection-btn" style="margin-top:8px">&#9881; Perform Inspection Sign-off</button>` : ''}
      </div>` : ''}



      <div class="quick-actions">
        <a href="#" class="quick-action" data-view="flight-ops">
          <div class="qa-icon">&#9992;</div>
          <div class="qa-label">Log Flight</div>
        </a>
        <a href="#" class="quick-action" data-view="defects">
          <div class="qa-icon">&#9888;</div>
          <div class="qa-label">Squawks</div>
        </a>
        <a href="#" class="quick-action" data-view="maintenance">
          <div class="qa-icon">&#9881;</div>
          <div class="qa-label">Sign-offs</div>
        </a>
        <a href="#" class="quick-action" data-view="fuel">
          <div class="qa-icon">&#9981;</div>
          <div class="qa-label">Fuel</div>
        </a>
        <a href="#" class="quick-action" data-view="inventory">
          <div class="qa-icon">&#128230;</div>
          <div class="qa-label">Parts</div>
        </a>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Maintenance</h3>
        </div>
        <div id="dash-intervals">
          <div class="interval-item">
            <div class="interval-label">
              <span class="label">50hr Inspection</span>
              <span class="interval-value ${hoursSinceOil >= ac.oilInterval ? 'text-red' : hoursSinceOil >= ac.oilInterval - 5 ? 'text-orange' : 'text-green'}">
                ${oilRemaining.toFixed(1)}h left
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${hoursSinceOil >= ac.oilInterval ? 'fill-red' : hoursSinceOil >= ac.oilInterval - 5 ? 'fill-orange' : 'fill-green'}"
                   style="width:${Math.min(100, (hoursSinceOil / ac.oilInterval) * 100)}%"></div>
            </div>
          </div>
          <div class="interval-item">
            <div class="interval-label">
              <span class="label">100hr Inspection</span>
              <span class="interval-value ${hoursSince100hr >= ac.structInterval ? 'text-red' : hoursSince100hr >= ac.structInterval - 5 ? 'text-orange' : 'text-green'}">
                ${structRemaining.toFixed(1)}h left
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${hoursSince100hr >= ac.structInterval ? 'fill-red' : hoursSince100hr >= ac.structInterval - 5 ? 'fill-orange' : 'fill-green'}"
                   style="width:${Math.min(100, (hoursSince100hr / ac.structInterval) * 100)}%"></div>
            </div>
          </div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--glass-border)">
            ${(() => {
              const etso = ac.engineETSO || 0;
              const ptso = ac.propellerPTSO || 0;
              const eTBO = ac.engineTBO || 2000;
              const pTBO = ac.propellerTBO || 2000;
              const ePct = Math.min(100, (etso / eTBO) * 100);
              const pPct = Math.min(100, (ptso / pTBO) * 100);
              return `
              <div class="interval-item">
                <div class="interval-label">
                  <span class="label">Engine TSO</span>
                  <span class="interval-value ${etso >= eTBO ? 'text-red' : etso >= eTBO - 50 ? 'text-orange' : 'text-green'}">${etso.toFixed(1)}h / ${eTBO}h</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill ${etso >= eTBO ? 'fill-red' : etso >= eTBO - 50 ? 'fill-orange' : 'fill-green'}" style="width:${ePct}%"></div>
                </div>
              </div>
              <div class="interval-item">
                <div class="interval-label">
                  <span class="label">Propeller TSO</span>
                  <span class="interval-value ${ptso >= pTBO ? 'text-red' : ptso >= pTBO - 50 ? 'text-orange' : 'text-green'}">${ptso.toFixed(1)}h / ${pTBO}h</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill ${ptso >= pTBO ? 'fill-red' : ptso >= pTBO - 50 ? 'fill-orange' : 'fill-green'}" style="width:${pPct}%"></div>
                </div>
              </div>`;
            })()}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Recent Flights</h3>
        </div>
        <div id="dash-flights">
          ${flights.length === 0 ? emptyState('&#9992;', 'No flights recorded yet') :
            flights.slice(0, 5).map(f => `
              <div class="flight-row">
                <div style="flex:1;min-width:0">
                  <div class="flight-pilot">${escHtml(f.pilotName)}${f.status === 'departed' ? ' <span class="badge badge-rectified" style="font-size:9px">DEP</span>' : ''}</div>
                  <div class="flight-date">${f.flightDate}${f.takeoffTime ? ` &middot; ${f.takeoffTime}${f.landingTime ? '-' + f.landingTime : '...'}` : ''}</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                  ${f.status !== 'departed' ? `<div class="flight-hours">${(f.flownHours * 60).toFixed(0)}m</div>` : '<div class="flight-hours" style="opacity:0.4">—</div>'}
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>
  `;

  document.getElementById('dashboard-hero').addEventListener('click', () => showAircraftSheet());

  // Quick-action navigation
  document.querySelectorAll('.quick-action[data-view]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigate(a.dataset.view);
    });
  });

  const inspBtn = document.getElementById('perform-inspection-btn');
  if (inspBtn) {
    inspBtn.addEventListener('click', () => navigate('maintenance'));
  }
  const crsBtn = document.getElementById('issue-daily-crs-btn');
  if (crsBtn) {
  crsBtn.addEventListener('click', async () => {
      const ac = await getAircraft();
      const hoursSinceOil = (ac.totalTachTime || 0) - (ac.lastOilChangeTach || 0);
      const oilDue = hoursSinceOil >= (ac.oilInterval || 50);

      // Oil check step before issuing CRS
      const oilCheckConfirm = await new Promise(resolve => {
        showBottomSheet(`
          <div class="card-header"><h3>&#128167; Pre-Flight Oil Check — ${escHtml(ac.tailNumber)}</h3></div>
          <p class="text-muted small" style="margin-bottom:12px">Oil change due every ${ac.oilInterval || 50} tach hrs. Current: ${hoursSinceOil.toFixed(1)} hrs since last change.${oilDue ? ' <strong class="text-red">Oil change overdue.</strong>' : ''}</p>
          <div class="form-group">
            <label>Oil Level</label>
            <select id="oil-level" class="form-input">
              <option value="ok">OK — within limits</option>
              <option value="low">Low — needs topping up</option>
            </select>
          </div>
          <div class="form-group" id="oil-qty-group" style="display:none">
            <label>Oil added (ml)</label>
            ${stepperHTML('oil-qty', 0, 0, 5000, 100)}
          </div>
          <div class="form-group">
            <label>Remarks (optional)</label>
            <input type="text" id="oil-remarks" class="form-input" placeholder="e.g. Topped up">
          </div>
          <button class="btn btn-primary btn-block" id="oil-check-ok-btn">Record &amp; Continue to CRS</button>
          <button class="btn btn-secondary btn-block" id="oil-check-skip-btn" style="margin-top:8px">Skip — Issue CRS Without Oil Check</button>
        `);
        initSteppers();
        document.getElementById('oil-level').addEventListener('change', function() {
          document.getElementById('oil-qty-group').style.display = this.value === 'low' ? 'block' : 'none';
        });
        document.getElementById('oil-check-ok-btn').addEventListener('click', async () => {
          const level = document.getElementById('oil-level').value;
          const qty = level === 'low' ? (parseFloat(document.getElementById('oil-qty').value) || 0) : 0;
          const remarks = document.getElementById('oil-remarks').value.trim();
          const user = localStorage.getItem('aac_user') || 'Unknown';
          if (qty > 0) {
            const oilPart = await DB.get('parts', 'AV-OIL-20W50');
            if (oilPart) {
              if (oilPart.quantityOnHand >= qty) {
                oilPart.quantityOnHand -= qty;
                await DB.put('parts', oilPart);
                await queueSync('parts', 'update', oilPart);
              } else {
                showToast('Not enough oil in stock!', 'error');
              }
            }
          }
          window.__sheetClose(true);
          logActivity('oil_check', `${user} pre-flight oil check on ${ac.tailNumber}: ${level === 'ok' ? 'OK' : 'Added ' + qty + 'ml'}${remarks ? ' — ' + remarks : ''}`, ac.tailNumber);
          resolve(true);
        });
        document.getElementById('oil-check-skip-btn').addEventListener('click', () => {
          window.__sheetClose(true);
          resolve(true);
        });
      });
      if (!oilCheckConfirm) return;

      const confirmed = await showConfirmDialog('Issue Daily CRS', 'Confirm you are authorized to issue the Certificate of Release to Service for today?');
      if (!confirmed) return;
      ac.dailyCrsDate = new Date().toISOString().slice(0, 10);
      ac.dailyCrsBy = localStorage.getItem('aac_user') || 'Engineer';
      ac.groundedAfterInspection = false;
      ac.groundedAfterInspAt = '';
      await DB.put('aircraft', ac);
      await queueSync('aircraft', 'update', ac);
      showToast('Daily CRS issued — aircraft is flightworthy');
      const user = localStorage.getItem('aac_user') || 'Unknown';
      createNotification('crs', 'Daily CRS Issued', `${user} issued daily CRS for ${ac.tailNumber}`, 'dashboard');
      notifyDataChange();
    });
  }
}

function navigate(view) {
  _currentView = view;
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  const link = document.querySelector(`.nav-link[data-view="${view}"]`);
  if (link) link.classList.add('active');
  closeSidebar();

  switch (view) {
    case 'dashboard': dashboardView(); break;
    case 'flight-ops': flightOpsView(); break;
    case 'defects': defectsView(); break;
    case 'maintenance': maintenanceView(); break;
    case 'inventory': inventoryView(); break;
    case 'fuel': fuelView(); break;
    case 'calendar': calendarView(); break;
    case 'attendance': attendanceView(); break;
    case 'profile': profileView(); break;
    case 'notifications': notificationsView(); break;
    case 'activity': activityFeedView(); break;
  }
  return false;
}

let _refreshTimer = null;
let _currentView = null;
function onRemoteUpdate() {
  updateNotifBadge();
  if (_refreshTimer) return;
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    if (_currentView) refreshView(_currentView);
  }, 300);
}

// Lightweight view refresh without full page rebuild
const _viewRefreshers = {};
function registerRefresh(view, fn) { _viewRefreshers[view] = fn; }
function refreshView(view) {
  const fn = _viewRefreshers[view];
  if (fn) { fn(); return; }
  navigate(view);
}

// Call after any local write to trigger instant refresh (debounced)
let _notifyTimer = null;
function notifyDataChange() {
  updateSidebarInspections();
  if (_notifyTimer) return;
  _notifyTimer = setTimeout(() => {
    _notifyTimer = null;
    if (_currentView) refreshView(_currentView);
  }, 50);
}

/* ── Sidebar ── */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
}

function applyRoleVisibility() {
  const role = localStorage.getItem('aac_user_role') || '';
  document.querySelectorAll('[data-role]').forEach(el => {
    const allowed = el.dataset.role.split(',').map(r => r.trim());
    el.style.display = allowed.includes(role) ? '' : 'none';
  });
}

function updateSidebarUser() {
  const name = localStorage.getItem('aac_user');
  const role = localStorage.getItem('aac_user_role');
  const photo = localStorage.getItem('aac_user_photo');
  document.getElementById('sidebar-name').textContent = name || 'No User';
  document.getElementById('sidebar-role').textContent = role ? role.replace(/_/g, ' ') : '—';
  const avatar = document.getElementById('sidebar-avatar');
  if (photo) {
    avatar.innerHTML = `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    avatar.style.background = 'none';
  } else {
    avatar.textContent = name ? name[0].toUpperCase() : '?';
    avatar.style.background = '';
  }
  // Role-based sidebar visibility
  const isPrivileged = role === 'engineer' || role === 'admin' || role === 'production_planner';
  document.querySelectorAll('#sidebar-pincode, #sidebar-reset').forEach(el => {
    el.style.display = isPrivileged ? '' : 'none';
  });
  applyRoleVisibility();
}

async function updateSidebarInspections() {
  try {
    const ac = await getAircraft();
    const el = document.getElementById('sidebar-insp-list');
    if (!el) return;
    if (!ac) { el.innerHTML = '<div class="sidebar-insp-item"><span class="text-muted small">No aircraft</span></div>'; return; }
    const insp = getInspectionStatus(ac);
    el.innerHTML = `
      <div class="sidebar-insp-item"><span>50hr Inspection</span><span class="${insp.oilClass}">${insp.oilRemaining.toFixed(1)}h</span></div>
      <div class="sidebar-insp-item"><span>100hr Inspection</span><span class="${insp.structClass}">${insp.structRemaining.toFixed(1)}h</span></div>
    `;
  } catch (e) {}
}

/* ── Profile View ── */
function profileView() {
  const app = document.getElementById('app');
  const name = localStorage.getItem('aac_user') || '';
  const role = localStorage.getItem('aac_user_role') || '';
  const photo = localStorage.getItem('aac_user_photo') || '';
  const roles = [
    { value: 'technician', label: 'Technician', desc: 'Can record sorties, report squawks, view data' },
    { value: 'senior_technician', label: 'Senior Technician', desc: 'Above + can approve sign-ins' },
    { value: 'production_planner', label: 'Production Planner', desc: 'Above + can end flying, issue CRS, manage fleet' },
    { value: 'engineer', label: 'Engineer', desc: 'Above + can approve CRS (Release to Service)' },
    { value: 'admin', label: 'Admin', desc: 'Full access to all features' }
  ];
  app.innerHTML = `
    <div class="page">
      <div class="page-header"><h2>Crew Profile</h2></div>
      <div class="card">
        <div style="text-align:center;margin-bottom:16px">
          <div id="profile-photo-preview" style="width:80px;height:80px;border-radius:50%;margin:0 auto 10px;overflow:hidden;border:1px solid var(--border);background:var(--glass);display:flex;align-items:center;justify-content:center;font-size:32px">
            ${photo ? `<img src="${photo}" style="width:100%;height:100%;object-fit:cover">` : '?'}
          </div>
          <button class="btn btn-sm btn-secondary" id="profile-photo-btn">Change Photo</button>
          ${photo ? `<button class="btn btn-sm btn-ghost" id="profile-photo-remove" style="margin-left:6px">Remove</button>` : ''}
        </div>
        <div class="form-group">
          <label>Your Name</label>
          <input type="text" id="profile-name" value="${escHtml(name)}" placeholder="e.g. John Smith">
        </div>
        <div class="form-group">
          <label>Your Role</label>
          <select id="profile-role" class="form-input">
            ${roles.map(r => `<option value="${r.value}" ${role === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
          </select>
          <div id="profile-role-desc" class="text-muted small" style="margin-top:6px">${roles.find(r => r.value === role)?.desc || roles[0].desc}</div>
        </div>
        <button class="btn btn-primary btn-block" id="profile-save-btn">Save Profile</button>
        <button class="btn btn-secondary btn-block" id="profile-logout-btn" style="margin-top:8px;border-color:var(--danger);color:var(--danger)">Sign Out</button>
      </div>
    </div>
  `;

  // Photo upload
  document.getElementById('profile-photo-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async e => {
        const dataUrl = await compressImage(e.target.result, 400, 400, 0.6);
        const preview = document.getElementById('profile-photo-preview');
        preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover">`;
        preview.dataset.photo = dataUrl;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
  const removeBtn = document.getElementById('profile-photo-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      const preview = document.getElementById('profile-photo-preview');
      preview.innerHTML = '?';
      delete preview.dataset.photo;
      localStorage.removeItem('aac_user_photo');
      updateSidebarUser();
    });
  }

  document.getElementById('profile-role').addEventListener('change', function() {
    const sel = roles.find(r => r.value === this.value);
    const desc = document.getElementById('profile-role-desc');
    if (sel && desc) desc.textContent = sel.desc;
  });
  document.getElementById('profile-save-btn').addEventListener('click', async () => {
    const n = document.getElementById('profile-name').value.trim();
    const r = document.getElementById('profile-role').value;
    if (!n) { showToast('Enter your name', 'error'); return; }
    if (!r) { showToast('Select your role', 'error'); return; }

    if (r === 'admin' || r === 'engineer' || r === 'production_planner' || r === 'senior_technician') {
      const pin = localStorage.getItem('aac_pin') || '1234';
      const entered = await showPromptDialog('PIN Required', `Enter admin PIN to set role as ${r.replace(/_/g, ' ')}:`);
      if (entered === null) { showToast('Profile save cancelled', 'warning'); return; }
      if (entered.trim() !== pin) { showToast('Incorrect PIN', 'error'); return; }
    }

    const preview = document.getElementById('profile-photo-preview');
    const newPhoto = preview.dataset.photo || localStorage.getItem('aac_user_photo') || '';
    if (preview.dataset.photo) {
      localStorage.setItem('aac_user_photo', preview.dataset.photo);
    }

    localStorage.setItem('aac_user', escHtml(n));
    localStorage.setItem('aac_user_role', r);
    const uid = localStorage.getItem('aac_user_id');
    if (uid) {
      const existing = await DB.get('users', uid);
      if (existing) {
        existing.name = n;
        existing.role = r;
        existing.photo = newPhoto;
        await DB.put('users', existing);
        await queueSync('users', 'update', existing);
      }
    } else {
      const id = 'user_' + Date.now();
      localStorage.setItem('aac_user_id', id);
      const u = { id, name: n, role: r, photo: newPhoto, createdAt: new Date().toISOString() };
      await DB.put('users', u);
      await queueSync('users', 'create', u);
    }
    updateSidebarUser();
    showToast('Profile saved');
    navigate('dashboard');
  });
  document.getElementById('profile-logout-btn').addEventListener('click', () => {
    localStorage.removeItem('aac_user');
    localStorage.removeItem('aac_user_role');
    localStorage.removeItem('aac_user_photo');
    localStorage.removeItem('aac_user_id');
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('sidebar-overlay').style.display = 'none';
    document.getElementById('hamburger-btn').style.display = 'none';
    showLoginGate();
  });
}

function showAircraftSheet() {
  const role = localStorage.getItem('aac_user_role');
  const canEdit = role === 'engineer' || role === 'production_planner' || role === 'admin';
  showBottomSheet(`
    <div class="card-header"><h3>Fleet Manager</h3></div>
    <div id="ac-list-sheet"></div>
    ${canEdit ? `
    <hr>
    <button class="btn btn-primary btn-block" id="toggle-add-ac-btn">+ Add New Aircraft</button>
    <div id="add-ac-form" style="display:none;margin-top:12px">
      <div class="form-group">
        <label for="new-ac-tail">Tail Number</label>
        <input type="text" id="new-ac-tail" placeholder="e.g. C-152-002">
      </div>
      <div class="form-group">
        <label for="new-ac-type">Aircraft Type</label>
        <input type="text" id="new-ac-type" placeholder="e.g. Cessna 152">
      </div>
      <div class="row">
        <div class="form-group">
          <label>Engine TBO (hrs)</label>
          ${stepperHTML('new-ac-etbo', 2000, 100, 99999, 100)}
        </div>
        <div class="form-group">
          <label>Prop TBO (hrs)</label>
          ${stepperHTML('new-ac-ptbo', 2000, 100, 99999, 100)}
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="add-ac-btn">Create Aircraft</button>
    </div>
    <button class="btn btn-secondary btn-block" id="close-ac-btn" style="margin-top:8px">Close</button>
    ` : `<button class="btn btn-secondary btn-block" id="close-ac-btn" style="margin-top:8px">Close</button>`}
  `);

  if (canEdit) {
    initSteppers();
  }
  renderACListSheet();

  document.getElementById('toggle-add-ac-btn')?.addEventListener('click', () => {
    const form = document.getElementById('add-ac-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('add-ac-btn')?.addEventListener('click', async () => {
    const tail = document.getElementById('new-ac-tail').value.trim().toUpperCase();
    const type = document.getElementById('new-ac-type').value.trim() || 'Aircraft';
    if (!tail) { showToast('Enter a tail number', 'error'); return; }
    const existing = await DB.get('aircraft', tail);
    if (existing) { showToast('Aircraft already exists', 'error'); return; }
    const etbo = parseFloat(document.getElementById('new-ac-etbo').value) || 2000;
    const ptbo = parseFloat(document.getElementById('new-ac-ptbo').value) || 2000;
    const ac = {
      tailNumber: tail,
      type,
      totalTachTime: 0,
      lastOilChangeTach: 0,
      last100hrTach: 0,
      oilInterval: 50,
      structInterval: 100,
      engineETSO: 0,
      propellerPTSO: 0,
      engineTBO: etbo,
      propellerTBO: ptbo,
      photoData: null
    };
    await DB.put('aircraft', ac);
    await queueSync('aircraft', 'create', ac);
    showToast(`Added ${tail}`);
    setCurrentAircraftKey(tail);
    document.getElementById('new-ac-tail').value = '';
    document.getElementById('new-ac-type').value = '';
    renderACListSheet();
    populateACSelector();
  });

  document.getElementById('close-ac-btn').addEventListener('click', () => {
    window.__sheetClose(null);
  });
}

async function renderACListSheet() {
  const all = await getAllAircraft();
  const current = getCurrentAircraftKey();
  const role = localStorage.getItem('aac_user_role');
  const canEdit = role === 'engineer' || role === 'production_planner' || role === 'admin';
  const el = document.getElementById('ac-list-sheet');
  if (!el) return;
  if (all.length === 0) {
    el.innerHTML = emptyState('&#128641;', 'No aircraft added yet');
    return;
  }
  const defaultKey = getDefaultAircraftKey();

  el.innerHTML = all.map(ac => {
    const isDefault = ac.tailNumber === defaultKey;
    return `
    <div class="ac-list-item ${ac.tailNumber === current ? 'ac-current' : ''}"
         data-tail="${ac.tailNumber}">
      <div class="ac-list-info">
        ${ac.photoData ? `<img src="${ac.photoData}" alt="" class="ac-thumb">` : ''}
        <div style="display:flex;align-items:center;gap:6px">
          <strong>${escHtml(ac.tailNumber)}</strong>
          ${isDefault ? '<span class="badge badge-released" style="font-size:9px">Default</span>' : ''}
        </div>
        <div class="text-muted small">${escHtml(ac.type || 'Aircraft')}</div>
        ${ac.tailNumber === current ? `      <div class="ac-list-tso">
          <span>Engine TSO: ${(ac.engineETSO || 0).toFixed(1)}h</span>
          <span>Prop TSO: ${(ac.propellerPTSO || 0).toFixed(1)}h</span>
        </div>` : ''}
        ${canEdit ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-ghost edit-ac-btn" data-tail="${ac.tailNumber}" style="font-size:9px;padding:4px 8px">Edit</button>
          <button class="btn btn-ghost change-photo-btn" data-tail="${ac.tailNumber}" style="font-size:9px;padding:4px 8px">Photo</button>
          ${!isDefault ? `<button class="btn btn-ghost set-default-ac-btn" data-tail="${ac.tailNumber}" style="font-size:9px;padding:4px 8px">&#9733; Set Default</button>` : ''}
        </div>` : ''}
      </div>
      <div class="ac-list-actions">
        ${ac.tailNumber !== current ? `<button class="btn btn-sm btn-primary switch-ac-btn" data-tail="${ac.tailNumber}">Select</button>` : `
          ${canEdit ? `<button class="btn btn-sm btn-ghost reset-etso-btn" data-tail="${ac.tailNumber}" title="Reset Engine TSO">E</button>
          <button class="btn btn-sm btn-ghost reset-ptso-btn" data-tail="${ac.tailNumber}" title="Reset Prop TSO">P</button>` : ''}
          <span class="badge badge-released">Current</span>
        `}
        ${canEdit ? `<button class="btn btn-sm btn-danger del-ac-btn" data-tail="${ac.tailNumber}" ${all.length <= 1 ? 'disabled' : ''}>&times;</button>` : ''}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.reset-etso-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog('Reset Engine TSO', 'Confirm engine overhaul? This resets Engine TSO to 0.');
      if (!confirmed) return;
      const ac = await DB.get('aircraft', btn.dataset.tail);
      if (!ac) return;
      ac.engineETSO = 0;
      await DB.put('aircraft', ac);
      await queueSync('aircraft', 'update', ac);
      showToast('Engine TSO reset to 0');
      renderACListSheet();
    });
  });
  el.querySelectorAll('.reset-ptso-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog('Reset Prop TSO', 'Confirm propeller overhaul? This resets Prop TSO to 0.');
      if (!confirmed) return;
      const ac = await DB.get('aircraft', btn.dataset.tail);
      if (!ac) return;
      ac.propellerPTSO = 0;
      await DB.put('aircraft', ac);
      await queueSync('aircraft', 'update', ac);
      showToast('Propeller TSO reset to 0');
      renderACListSheet();
    });
  });
  el.querySelectorAll('.change-photo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('ac-photo-input').dataset.targetTail = btn.dataset.tail;
      document.getElementById('ac-photo-input').click();
    });
  });
  el.querySelectorAll('.edit-ac-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ac = await DB.get('aircraft', btn.dataset.tail);
      if (!ac) return;
      showEditAircraftForm(ac);
    });
  });
  el.querySelectorAll('.switch-ac-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tail = btn.dataset.tail;
      await switchAircraft(tail);
      populateACSelector();
      window.__sheetClose(true);
      navigate(document.querySelector('.nav-link.active')?.dataset?.view || 'dashboard');
    });
  });
  el.querySelectorAll('.set-default-ac-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tail = btn.dataset.tail;
      setDefaultAircraftKey(tail);
      showToast(`${tail} set as default aircraft`);
      renderACListSheet();
    });
  });
  el.querySelectorAll('.del-ac-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tail = btn.dataset.tail;
      const all = await getAllAircraft();
      if (all.length <= 1) return;
      const confirmed = await showConfirmDialog('Delete Aircraft', `Delete ${tail}? This cannot be undone.`);
      if (!confirmed) return;
      await DB.del('aircraft', tail);
      await queueSync('aircraft', 'delete', { tailNumber: tail });
      if (getCurrentAircraftKey() === tail) {
        const remaining = await getAllAircraft();
        if (remaining.length > 0) await switchAircraft(remaining[0].tailNumber);
      }
      showToast(`Deleted ${tail}`);
      populateACSelector();
      renderACListSheet();
    });
  });
}

function showEditAircraftForm(ac) {
  const sheetInner = document.querySelector('.sheet-inner');
  if (sheetInner) {
    sheetInner.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="card-header"><h3>Edit Aircraft</h3></div>
      <p class="text-muted small" style="margin-bottom:14px">${escHtml(ac.tailNumber)}</p>
      <div class="form-group">
        <label>Tail Number</label>
        <input type="text" id="edit-ac-tail" value="${escHtml(ac.tailNumber)}" class="form-input">
      </div>
      <div class="form-group">
        <label>Aircraft Type</label>
        <input type="text" id="edit-ac-type" value="${escHtml(ac.type || '')}" class="form-input">
      </div>
      <div class="form-group">
        <label>Total Tach Time (hrs)</label>
        ${stepperHTML('edit-ac-tach', ac.totalTachTime || 0, 0, 99999, 0.1)}
      </div>
      <div class="row">
        <div class="form-group">
          <label>Last 50hr Insp (tach hrs)</label>
          ${stepperHTML('edit-ac-oil', ac.lastOilChangeTach || 0, 0, 99999, 0.1)}
        </div>
        <div class="form-group">
          <label>Last 100hr Insp (tach hrs)</label>
          ${stepperHTML('edit-ac-100hr', ac.last100hrTach || 0, 0, 99999, 0.1)}
        </div>
      </div>
      <div class="row">
        <div class="form-group">
          <label>50hr Interval (hrs)</label>
          ${stepperHTML('edit-ac-oil-int', ac.oilInterval || 50, 1, 999, 1)}
        </div>
        <div class="form-group">
          <label>100hr Interval (hrs)</label>
          ${stepperHTML('edit-ac-struct-int', ac.structInterval || 100, 1, 999, 1)}
        </div>
      </div>
      <div class="row">
        <div class="form-group">
          <label>Engine TSO (hrs)</label>
          ${stepperHTML('edit-ac-etso', ac.engineETSO || 0, 0, 99999, 0.1)}
        </div>
        <div class="form-group">
          <label>Prop TSO (hrs)</label>
          ${stepperHTML('edit-ac-ptso', ac.propellerPTSO || 0, 0, 99999, 0.1)}
        </div>
      </div>
      <div class="row">
        <div class="form-group">
          <label>Engine TBO (hrs)</label>
          ${stepperHTML('edit-ac-etbo', ac.engineTBO || 2000, 100, 99999, 100)}
        </div>
        <div class="form-group">
          <label>Prop TBO (hrs)</label>
          ${stepperHTML('edit-ac-ptbo', ac.propellerTBO || 2000, 100, 99999, 100)}
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="save-edit-ac-btn">Save Changes</button>
      <button class="btn btn-secondary btn-block" id="cancel-edit-ac-btn" style="margin-top:8px">Cancel</button>
    `;
    initSteppers();
    document.getElementById('save-edit-ac-btn').addEventListener('click', async () => {
      const tail = document.getElementById('edit-ac-tail').value.trim().toUpperCase();
      if (!tail) { showToast('Tail number required', 'error'); return; }
      const updated = {
        ...ac,
        tailNumber: tail,
        type: document.getElementById('edit-ac-type').value.trim() || ac.type,
        totalTachTime: parseFloat(document.getElementById('edit-ac-tach').value) || 0,
        lastOilChangeTach: parseFloat(document.getElementById('edit-ac-oil').value) || 0,
        last100hrTach: parseFloat(document.getElementById('edit-ac-100hr').value) || 0,
        oilInterval: parseInt(document.getElementById('edit-ac-oil-int').value) || 50,
        structInterval: parseInt(document.getElementById('edit-ac-struct-int').value) || 100,
        engineETSO: parseFloat(document.getElementById('edit-ac-etso').value) || 0,
        propellerPTSO: parseFloat(document.getElementById('edit-ac-ptso').value) || 0,
        engineTBO: parseInt(document.getElementById('edit-ac-etbo').value) || 2000,
        propellerTBO: parseInt(document.getElementById('edit-ac-ptbo').value) || 2000
      };
      if (tail !== ac.tailNumber) {
        const existing = await DB.get('aircraft', tail);
        if (existing) { showToast('Tail number already exists', 'error'); return; }
        await DB.del('aircraft', ac.tailNumber);
        await queueSync('aircraft', 'delete', { tailNumber: ac.tailNumber });
        // Update all flights/defects/tasks referencing old tail
        for (const store of ['flights', 'defects', 'maintenance_tasks', 'fuel_logs']) {
          const items = await DB.getAll(store);
          for (const item of items.filter(i => i.aircraftId === ac.tailNumber)) {
            item.aircraftId = tail;
            await DB.put(store, item);
            await queueSync(store, 'update', item);
          }
        }
      }
      await DB.put('aircraft', updated);
      await queueSync('aircraft', 'update', updated);
      if (getCurrentAircraftKey() === ac.tailNumber && tail !== ac.tailNumber) {
        setCurrentAircraftKey(tail);
      }
      populateACSelector();
      showToast('Aircraft updated');
      window.__sheetClose(true);
      showAircraftSheet();
    });
    document.getElementById('cancel-edit-ac-btn').addEventListener('click', () => {
      window.__sheetClose(true);
      showAircraftSheet();
    });
  }
}

async function clearAllData() {
  const stores = ['flights','aircraft','defects','fuel_logs','fuel_stock','maintenance_tasks','parts','sync_queue','users','attendance','notifications'];
  const db = await openDB();
  for (const s of stores) {
    await new Promise((res, rej) => {
      const tx = db.transaction(s, 'readwrite');
      tx.objectStore(s).clear();
      tx.oncomplete = res;
      tx.onerror = rej;
    });
  }
  db.close();
  localStorage.removeItem('aac_current_aircraft');
  // Also clear Firestore
  if (db_firestore) {
    const cols = stores.filter(s => s !== 'sync_queue');
    for (const c of cols) {
      try {
        const snap = await db_firestore.collection(c).get();
        const batch = db_firestore.batch();
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
      } catch (e) { /* ignore */ }
    }
  }
  showToast('All data cleared — reloading');
  setTimeout(() => location.reload(), 800);
}
window.clearAllData = clearAllData;

async function populateACSelector() {
  const sel = document.getElementById('ac-selector');
  if (!sel) return;
  const all = await getAllAircraft();
  const current = getCurrentAircraftKey();
  sel.innerHTML = all.map(ac =>
    `<option value="${escHtml(ac.tailNumber)}" ${ac.tailNumber === current ? 'selected' : ''}>${escHtml(ac.tailNumber)}</option>`
  ).join('');
}

function showLoginGate() {
  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  document.getElementById('hamburger-btn').style.display = 'none';

  let users = [];
  try { users = JSON.parse(localStorage.getItem('aac_users')) || []; } catch(e) {}
  const privilegedRoles = ['admin', 'engineer', 'production_planner', 'senior_technician'];

  app.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;background:var(--bg)">
      <div style="max-width:400px;width:100%">
        <div style="text-align:center;margin-bottom:24px">
          <img src="img/aircraft.jpg" alt="Aircraft" style="width:100%;max-width:280px;border-radius:12px;margin-bottom:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3)">
          <h1 style="font-size:22px;margin:0">AAC Technical Services</h1>
          <p class="text-muted" style="margin-top:4px">Select your name to sign in</p>
        </div>
        <div class="card" style="padding:20px">
          <div class="form-group">
            <label>Select User</label>
            <select id="login-user" class="form-input">
              <option value="">— Select user —</option>
              ${users.map(u => `<option value="${escHtml(u.name)}" data-role="${u.role}">${escHtml(u.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="login-pin-group" style="display:none">
            <label>PIN</label>
            <input type="password" id="login-pin" class="form-input" placeholder="Enter PIN" inputmode="numeric" maxlength="10">
          </div>
          <div id="login-error" class="text-red small" style="display:none;margin-bottom:8px"></div>
          <button class="btn btn-primary btn-block" id="login-btn">Sign In</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('login-user').addEventListener('change', function() {
    const opt = this.options[this.selectedIndex];
    const role = opt?.dataset?.role || '';
    const pinGroup = document.getElementById('login-pin-group');
    const error = document.getElementById('login-error');
    error.style.display = 'none';
    if (privilegedRoles.includes(role)) {
      pinGroup.style.display = '';
    } else {
      pinGroup.style.display = 'none';
    }
  });

  document.getElementById('login-btn').addEventListener('click', () => {
    const sel = document.getElementById('login-user');
    const name = sel.value;
    const role = sel.options[sel.selectedIndex]?.dataset?.role || '';
    const error = document.getElementById('login-error');
    error.style.display = 'none';
    if (!name) { showToast('Select a user', 'error'); return; }
    if (privilegedRoles.includes(role)) {
      const pin = document.getElementById('login-pin').value.trim();
      const storedPin = localStorage.getItem('aac_pin') || '1234';
      if (!pin) { error.textContent = 'PIN required for this role'; error.style.display = ''; return; }
      if (pin !== storedPin) { error.textContent = 'Incorrect PIN'; error.style.display = ''; return; }
    }
    localStorage.setItem('aac_user', escHtml(name));
    localStorage.setItem('aac_user_role', role);
    if (sidebar) sidebar.style.display = '';
    if (overlay) overlay.style.display = '';
    document.getElementById('hamburger-btn').style.display = '';
    updateSidebarUser();
    navigate('dashboard');
    checkInspectionNotifications();
    scheduleEndOfDayCheck();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Apply saved theme
  const savedTheme = localStorage.getItem('aac_theme');
  const isLight = savedTheme === 'light';
  if (isLight) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  // Set sidebar theme toggle icon
  const themeToggle = document.getElementById('sidebar-theme-toggle');
  if (themeToggle) themeToggle.innerHTML = isLight ? '&#127774;' : '&#127769;';

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  await initFirebase();

  window.addEventListener('online', () => {
    document.getElementById('offline-banner')?.classList.add('hidden');
  });
  window.addEventListener('offline', () => {
    document.getElementById('offline-banner')?.classList.remove('hidden');
  });
  if (!navigator.onLine) {
    document.getElementById('offline-banner')?.classList.remove('hidden');
  }

  await populateACSelector();

  // Seed user database if not yet set
  if (!localStorage.getItem('aac_users')) {
    const defaultUsers = [
      { name: 'Pasan Anishka', role: 'admin' },
      { name: 'Buddika Chandrarathna', role: 'engineer' },
      { name: 'Thisanga', role: 'production_planner' },
      { name: 'Chandrakeerthi', role: 'senior_technician' },
      { name: 'Deshan', role: 'technician' },
      { name: 'Shalana', role: 'technician' },
      { name: 'Rehan', role: 'technician' },
      { name: 'Binada', role: 'technician' },
      { name: 'Bihandu', role: 'technician' },
      { name: 'Ginod', role: 'technician' },
      { name: 'Kalum', role: 'technician' },
      { name: 'Rajapaksha', role: 'technician' }
    ];
    localStorage.setItem('aac_users', JSON.stringify(defaultUsers));
  }

  // Login gate: require name & role before using the app
  const needsLogin = !localStorage.getItem('aac_user') || !localStorage.getItem('aac_user_role');

  document.getElementById('ac-photo-input').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    const tail = this.dataset.targetTail;
    if (!tail) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
      const ac = await DB.get('aircraft', tail);
      if (!ac) return;
      ac.photoData = await compressImage(e.target.result, 800, 600, 0.7);
      await DB.put('aircraft', ac);
      await queueSync('aircraft', 'update', ac);
      showToast('Photo updated');
      const active = document.querySelector('.nav-link.active')?.dataset?.view;
      if (active === 'dashboard') navigate('dashboard');
    };
    reader.readAsDataURL(file);
    this.value = '';
  });

  document.getElementById('ac-selector').addEventListener('change', async function() {
    await switchAircraft(this.value);
    navigate(document.querySelector('.nav-link.active')?.dataset?.view || 'dashboard');
  });

  document.getElementById('hamburger-btn').addEventListener('click', openSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
  document.querySelectorAll('.sidebar-link[data-view]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigate(a.dataset.view);
    });
  });
  document.getElementById('sidebar-manage-ac').addEventListener('click', e => {
    e.preventDefault();
    closeSidebar();
    showAircraftSheet();
  });
  document.getElementById('sidebar-reset').addEventListener('click', async e => {
    e.preventDefault();
    closeSidebar();
    const role = localStorage.getItem('aac_user_role');
    if (role !== 'admin') { showToast('Only Admin can reset all data', 'error'); return; }
    const confirmed = await showConfirmDialog('Factory Reset', 'This will delete ALL data including aircraft, sorties, defects, parts, and fuel. Are you sure?');
    if (confirmed) await clearAllData();
  });
  function toggleTheme() {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    if (isLight) {
      html.removeAttribute('data-theme');
      localStorage.setItem('aac_theme', 'dark');
      document.getElementById('sidebar-theme-toggle').innerHTML = '&#127769;';
    } else {
      html.setAttribute('data-theme', 'light');
      localStorage.setItem('aac_theme', 'light');
      document.getElementById('sidebar-theme-toggle').innerHTML = '&#127774;';
    }
    showToast(isLight ? 'Dark mode' : 'Light mode');
  }
  document.getElementById('sidebar-theme-toggle').addEventListener('click', e => {
    toggleTheme();
  });
  document.getElementById('sidebar-user').addEventListener('click', e => {
    e.preventDefault();
    closeSidebar();
    navigate('profile');
  });
  document.getElementById('sidebar-pincode').addEventListener('click', async e => {
    e.preventDefault();
    closeSidebar();
    const current = localStorage.getItem('aac_pin') || '1234';
    const old = await showPromptDialog('Change PIN', 'Enter current PIN:');
    if (old === null) return;
    if (old.trim() !== current) { showToast('Incorrect PIN', 'error'); return; }
    const newPin = await showPromptDialog('Change PIN', 'Enter new PIN:');
    if (newPin === null) return;
    if (!newPin.trim()) { showToast('PIN cannot be empty', 'error'); return; }
    const confirmPin = await showPromptDialog('Change PIN', 'Confirm new PIN:');
    if (confirmPin === null || confirmPin.trim() !== newPin.trim()) { showToast('PINs do not match', 'error'); return; }
    localStorage.setItem('aac_pin', newPin.trim());
    showToast('PIN changed successfully');
  });
  document.getElementById('sidebar-export').addEventListener('click', async e => {
    e.preventDefault();
    closeSidebar();
    showExportSheet();
  });

  updateSidebarUser();
  updateSidebarInspections();

  document.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      haptic();
      navigate(a.dataset.view);
    });
  });

  // Global haptic on actionable elements
  document.addEventListener('click', e => {
    const t = e.target.closest('.btn, .quick-action, .sidebar-link, .header-btn, .hamburger-btn');
    if (t) haptic();
  });

  if (needsLogin) {
    showLoginGate();
  } else {
    navigate('dashboard');
    checkInspectionNotifications();
    scheduleEndOfDayCheck();
  }
});

async function checkEndOfDayData() {
  const today = new Date().toISOString().slice(0, 10);
  const ac = await getAircraft();
  if (!ac) return;
  const flights = await getFlights();
  const allAttendance = await DB.getAll('attendance');
  const allTasks = await DB.getAll('maintenance_tasks');
  const allDefects = await DB.getAll('defects');

  const missing = [];
  const todaysFlights = flights.filter(f => f.flightDate === today);
  if (todaysFlights.length === 0) missing.push('No sorties recorded today');

  const departedNoArrival = flights.filter(f => f.flightDate === today && f.status === 'departed');
  if (departedNoArrival.length > 0) missing.push(`${departedNoArrival.length} departure(s) awaiting arrival data`);

  const todaysAttendance = allAttendance.filter(a => a.date === today);
  if (todaysAttendance.length === 0) missing.push('No sign-in recorded today');

  if (ac.dailyCrsDate !== today) missing.push('Daily CRS not issued');

  const openDefects = allDefects.filter(d => d.status === 'open');
  if (openDefects.length > 0) missing.push(`${openDefects.length} open squawk(s) unresolved`);

  return missing;
}

function scheduleEndOfDayCheck() {
  const now = new Date();
  const endHour = 19;
  const target = new Date(now);
  target.setHours(endHour, 0, 0, 0);
  if (now >= target) { target.setDate(target.getDate() + 1); }
  const ms = target - now;

  setTimeout(async () => {
    const missing = await checkEndOfDayData();
    if (missing.length > 0) {
      const body = missing.join('\n');
      if ('Notification' in window && Notification.permission === 'granted') {
        const notifIcon = window.location.origin + (window.location.pathname.includes('/aacts/') ? '/aacts/img/icon-192.png' : '/img/icon-192.png');
        new Notification('AAC — End of Day Reminder', { body, icon: notifIcon });
      }
      showNotification('End of Day Reminder', missing.join(' · '));
      createNotification('system', 'End of Day Reminder', missing.join(' · '), 'dashboard');
    }
    scheduleEndOfDayCheck();
  }, ms);
}

async function showExportSheet() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(); firstOfMonth.setDate(1);
  const fromDefault = firstOfMonth.toISOString().slice(0, 10);

  const storeDefs = [
    { key: 'aircraft', label: 'Aircraft', hasDate: false },
    { key: 'flights', label: 'Sorties', hasDate: true, dateField: 'flightDate' },
    { key: 'defects', label: 'Squawks', hasDate: true, dateField: 'createdAt' },
    { key: 'maintenance_tasks', label: 'Work Orders', hasDate: true, dateField: 'createdAt' },
    { key: 'fuel_stock', label: 'Fuel Stock', hasDate: false },
    { key: 'fuel_logs', label: 'Fuel Logs', hasDate: true, dateField: 'createdAt' },
    { key: 'parts', label: 'Components', hasDate: false },
    { key: 'users', label: 'Crew', hasDate: false },
    { key: 'attendance', label: 'Crew Log', hasDate: true, dateField: 'date' }
  ];

  showBottomSheet(`
    <div class="card-header"><h3>Export Records</h3></div>
    <div style="margin-bottom:14px">
      <div class="form-group">
        <label>Aircraft</label>
        <select id="export-aircraft" class="form-input">
          <option value="">All Aircraft</option>
        </select>
      </div>
      <div class="row">
        <div class="form-group">
          <label>From Date</label>
          <input type="date" id="export-from" class="form-input" value="${fromDefault}">
        </div>
        <div class="form-group">
          <label>To Date</label>
          <input type="date" id="export-to" class="form-input" value="${today}">
        </div>
      </div>
    </div>
    <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;display:block;margin-bottom:6px">Include:</label>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
      ${storeDefs.map(s => `
        <label style="flex:0 0 auto;display:flex;align-items:center;gap:6px;background:var(--glass-bg);padding:4px 10px;border-radius:8px;font-size:13px">
          <input type="checkbox" class="export-store-cb" data-key="${s.key}" checked> ${s.label}
        </label>
      `).join('')}
    </div>
    <button class="btn btn-primary btn-block" id="export-all-btn">Generate PDF Report</button>
    <button class="btn btn-secondary btn-block" id="close-export-btn" style="margin-top:8px">Close</button>
  `);

  getAllAircraft().then(all => {
    const sel = document.getElementById('export-aircraft');
    if (sel) {
      all.forEach(ac => {
        const opt = document.createElement('option');
        opt.value = ac.tailNumber;
        opt.textContent = ac.tailNumber;
        sel.appendChild(opt);
      });
    }
  });

  document.getElementById('export-all-btn').addEventListener('click', async () => {
    const fromVal = document.getElementById('export-from').value;
    const toVal = document.getElementById('export-to').value;
    const acFilter = document.getElementById('export-aircraft').value;
    if (!fromVal || !toVal) { showToast('Select from and to dates', 'error'); return; }
    const from = new Date(fromVal);
    const to = new Date(toVal + 'T23:59:59');

    const selected = [...document.querySelectorAll('.export-store-cb:checked')].map(cb => cb.dataset.key);
    if (selected.length === 0) { showToast('Select at least one data type', 'error'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const data = {};
    for (const name of selected) {
      data[name] = await DB.getAll(name);
    }

    // Filter by date range
    const defsMap = Object.fromEntries(storeDefs.map(s => [s.key, s]));
    for (const name of selected) {
      const def = defsMap[name];
      if (def && def.hasDate && data[name].length > 0) {
        data[name] = data[name].filter(item => {
          const raw = item[def.dateField];
          if (!raw) return false;
          const d = new Date(raw.slice(0, 10));
          return d >= from && d <= to;
        });
      }
      // Filter by aircraft
      if (acFilter && data[name].length > 0) {
        data[name] = data[name].filter(item => item.aircraftId === acFilter || item.tailNumber === acFilter);
      }
    }

    doc.setFontSize(18);
    doc.text('AAC — Data Export', 14, 20);
    doc.setFontSize(10);
    doc.text(`Period: ${fromVal} to ${toVal}`, 14, 28);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 34);
    doc.line(14, 38, 196, 38);

    let y = 44;

    for (const name of selected) {
      const items = data[name] || [];
      if (items.length === 0) continue;

      if (y > 250) { doc.addPage(); y = 20; }

      doc.setFontSize(14);
      doc.text(name.replace(/_/g, ' ').toUpperCase(), 14, y);
      y += 6;

      const sorted = [...items].sort((a, b) => {
        const ka = a.tailNumber || a.partNumber || a.id || a.name || '';
        const kb = b.tailNumber || b.partNumber || b.id || b.name || '';
        return ka.toString().localeCompare(kb.toString());
      });

      const keys = Object.keys(sorted[0]).filter(k => !k.startsWith('_'));
      const headers = keys.map(k => k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()));
      const rows = sorted.map(item => keys.map(k => {
        const v = item[k];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      }));

      doc.autoTable({
        startY: y,
        head: [headers],
        body: rows,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [10, 132, 255], fontSize: 7 },
        margin: { left: 14, right: 14 },
        tableWidth: 'auto'
      });

      y = doc.lastAutoTable.finalY + 8;
    }

    doc.save(`aac-report-${fromVal}_to_${toVal}.pdf`);
    showToast('PDF report downloaded');
    window.__sheetClose(true);
  });
  document.getElementById('close-export-btn').addEventListener('click', () => window.__sheetClose(null));
}

function showNotification(title, body) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = `${title}: ${body}`;
    toast.className = 'toast show';
    setTimeout(() => { toast.className = 'toast'; }, 4000);
  }
}
