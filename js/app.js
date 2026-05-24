function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

function denyGuest() {
  if (localStorage.getItem('aac_user_role') === 'guest') {
    showToast('Guests are view-only', 'error');
    return true;
  }
  return false;
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

const INSPECTION_TEMPLATES = [
  { type: 'inspection_50hr', label: '50-hour inspection due', interval: (ac) => ac.oilInterval || 50, getElapsed: (ac) => (ac.totalTachTime || 0) - (ac.lastOilChangeTach || 0) },
  { type: 'inspection_100hr', label: '100-hour inspection due', interval: (ac) => ac.structInterval || 100, getElapsed: (ac) => (ac.totalTachTime || 0) - (ac.last100hrTach || 0) },
  { type: 'inspection_engine_TBO', label: 'Engine TBO due', interval: (ac) => ac.engineTBO || 2000, getElapsed: (ac) => ac.engineETSO || 0 },
  { type: 'inspection_prop_TBO', label: 'Propeller TBO due', interval: (ac) => ac.propellerTBO || 2000, getElapsed: (ac) => ac.propellerPTSO || 0 },
];

async function checkAndCreateInspectionTasks(ac) {
  if (!ac) return;
  const tasks = await DB.getAll('maintenance_tasks');
  const acTasks = tasks.filter(t => t.aircraftId === ac.tailNumber);

  for (const tmpl of INSPECTION_TEMPLATES) {
    const elapsed = tmpl.getElapsed(ac);
    const interval = tmpl.interval(ac);
    if (elapsed >= interval) {
      const hasOpen = acTasks.some(t => t.type === tmpl.type && t.status === 'open');
      if (!hasOpen) {
        const task = {
          id: 'mnt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          aircraftId: ac.tailNumber,
          description: tmpl.label,
          type: tmpl.type,
          priority: 'high',
          assignedTo: [],
          status: 'open',
          technicianNotes: '',
          rectifiedBy: '',
          rectifiedAt: '',
          releasedBy: '',
          releasedAt: '',
          createdAt: new Date().toISOString()
        };
        await DB.put('maintenance_tasks', task);
        await queueSync('maintenance_tasks', 'create', task);
        showToast('⚠ ' + tmpl.label.replace(' due', '') + ' task auto-created');
      }
    }
  }
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
      <div class="card" style="margin-bottom:14px">
        <div class="row" style="gap:6px">
          <div class="form-group" style="flex:2">
            <input type="text" id="activity-search" class="form-input" placeholder="Search activity..." style="font-size:12px">
          </div>
          <div class="form-group" style="flex:1">
            <input type="date" id="activity-from" class="form-input" style="font-size:11px">
          </div>
          <div class="form-group" style="flex:1">
            <input type="date" id="activity-to" class="form-input" style="font-size:11px">
          </div>
        </div>
      </div>
      <div id="activity-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
    </div>
  `;
  renderActivityFeed();
  document.getElementById('activity-search').addEventListener('input', renderActivityFeed);
  document.getElementById('activity-from').addEventListener('change', renderActivityFeed);
  document.getElementById('activity-to').addEventListener('change', renderActivityFeed);
}

async function renderActivityFeed() {
  const el = document.getElementById('activity-list');
  const entries = await getActivityFeed(500);
  const q = (document.getElementById('activity-search')?.value || '').toLowerCase();
  const from = document.getElementById('activity-from')?.value;
  const to = document.getElementById('activity-to')?.value;
  const filtered = entries.filter(e => {
    if (q && !e.description?.toLowerCase().includes(q) && !e.performedBy?.toLowerCase().includes(q)) return false;
    if (from && e.createdAt && e.createdAt.slice(0, 10) < from) return false;
    if (to && e.createdAt && e.createdAt.slice(0, 10) > to) return false;
    return true;
  });
  if (filtered.length === 0) {
    el.innerHTML = emptyState('&#128197;', 'No activity recorded yet');
    return;
  }
  el.innerHTML = filtered.map(e => `
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
  // Deduplicate by canonical name (merge e.g. "Pasan" → "Pasan Anishka")
  const canon = new Map();
  for (const u of users) {
    const similar = users.find(other =>
      other.name !== u.name && (other.name.includes(u.name) || u.name.includes(other.name))
    );
    const canonicalName = similar ? (u.name.length >= similar.name.length ? u.name : similar.name) : u.name;
    const existing = canon.get(canonicalName);
    if (!existing || (u.photo && !existing.photo)) {
      u.name = canonicalName;
      canon.set(canonicalName, u);
    }
  }
  const unique = [...canon.values()];
  const attendance = await DB.getAll('attendance');
  const today = new Date().toISOString().slice(0, 10);
  const activeAttendance = attendance.filter(a => a.date === today && (a.status === 'approved' || a.status === 'pending'));
  return unique.map(u => {
    const att = activeAttendance.find(a => a.userName === u.name);
    return { user: u, attendance: att || null };
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

function startFlightBarProgress(flight) {
  if (!flight.eta || !flight.takeoffTime) return;
  const fillEl = document.getElementById(`fsb-fill-${flight.id}`);
  const planeEl = document.getElementById(`fsb-plane-${flight.id}`);
  if (!fillEl) return;
  const [dh, dm] = flight.takeoffTime.split(':').map(Number);
  const [eh, em] = flight.eta.split(':').map(Number);
  const depMs = (dh * 60 + dm) * 60 * 1000;
  const etaMs = (eh * 60 + em) * 60 * 1000;
  let totalDuration = etaMs - depMs;
  if (totalDuration <= 0) totalDuration += 24 * 60 * 60 * 1000;
  function tick() {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const nowMs = now.getTime() - todayMidnight;
    let elapsed = nowMs - depMs;
    if (elapsed < 0) elapsed += 24 * 60 * 60 * 1000;
    const pct = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
    fillEl.style.width = pct + '%';
    fillEl.style.background = '#6b7280';
    if (planeEl) {
      planeEl.style.left = `calc(${pct}% - 10px)`;
      planeEl.style.opacity = '1';
    }
  }
  tick();
  const interval = setInterval(tick, 2000);
  const key = `fsb_${flight.id}`;
  if (window[key]) clearInterval(window[key]);
  window[key] = interval;
}

function renderFlightStatusBar(flight) {
  const etaDisplay = flight.eta ? `&middot; ETA <strong>${escHtml(flight.eta)}</strong>` : '';
  const hasProgress = flight.eta && flight.takeoffTime;
  const progressHtml = hasProgress
    ? `<div class="flight-status-bar-progress">
         <div class="flight-status-bar-track">
           <div class="fsb-dot-grid"></div>
         </div>
         <div class="flight-status-bar-fill" id="fsb-fill-${escHtml(flight.id)}"></div>
         <div class="fsb-plane" id="fsb-plane-${escHtml(flight.id)}">&#9992;</div>
       </div>`
    : `<div class="flight-status-bar-progress">
         <div class="flight-status-bar-track">
           <div class="fsb-dot-grid"></div>
         </div>
       </div>`;
  return `
    <div class="flight-status-bar" id="fsb-${escHtml(flight.id)}">
      <div class="flight-status-bar-glow"></div>
      <div class="flight-status-bar-inner">
        <div class="flight-status-bar-row">
          <span class="flight-status-bar-icon">&#9992;</span>
          <span class="flight-status-bar-text">Airborne &middot; ${escHtml(flight.pilotName)} &middot; Dep ${escHtml(flight.takeoffTime)} ${etaDisplay}</span>
        </div>
        ${progressHtml}
      </div>
    </div>`;
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

      ${isAirborne ? renderFlightStatusBar(flights.find(f => f.aircraftId === ac.tailNumber && f.status === 'departed')) : ''}

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
            <div class="stat-label">Open Defects</div>
        </div>
      </div>

      ${alerts.length > 0 || ac.groundedAfterInspection ? `
      <div class="dash-alerts">
        ${alerts.map(a => `<div class="dash-alert">&#9888; ${a}</div>`).join('')}
        ${ac.groundedAfterInspection ? `<div class="dash-alert" style="border-color:var(--danger)">&#128308; Aircraft grounded — daily CRS required before next flight</div>` : ''}
        ${(!crsIssuedToday || ac.groundedAfterInspection) && (userRole === 'engineer' || userRole === 'admin') ? `
        <button class="btn btn-primary btn-block" id="issue-daily-crs-btn" style="margin-top:8px">${ac.groundedAfterInspection ? '&#9989; Issue Daily CRS for Airworthiness' : 'Issue Daily CRS'}</button>` : ''}
        ${inspectionOverdue ? `<button class="btn btn-primary btn-block" id="perform-inspection-btn" style="margin-top:8px">&#9881; Perform Inspection Sign-off</button>` : ''}
      </div>` : ''}

      <div class="dashboard-widgets">
        <div class="dash-widget">
          <div class="dw-icon">&#128197;</div>
          <div class="dw-info">
            <div class="dw-value ${inspectionOverdue ? 'text-red' : oilRemaining <= 5 ? 'text-orange' : 'text-green'}">${oilRemaining.toFixed(1)}h</div>
            <div class="dw-label">50hr Inspection Left</div>
          </div>
        </div>
        <div class="dash-widget">
          <div class="dw-icon">&#128197;</div>
          <div class="dw-info">
            <div class="dw-value ${structRemaining <= 0 ? 'text-red' : structRemaining <= 5 ? 'text-orange' : 'text-green'}">${structRemaining.toFixed(1)}h</div>
            <div class="dw-label">100hr Inspection Left</div>
          </div>
        </div>
        ${(userRole !== 'pilot' && userRole !== 'maintenance') ? `
        <div class="dash-widget" style="cursor:pointer" onclick="navigate('maintenance')">
          <div class="dw-icon">&#9881;</div>
          <div class="dw-info">
            <div class="dw-value ${openTasks > 0 ? 'text-orange' : 'text-green'}">${openTasks}</div>
            <div class="dw-label">Open Tasks</div>
          </div>
        </div>` : ''}
        ${(userRole !== 'pilot' && userRole !== 'maintenance') ? `
        <div class="dash-widget" style="cursor:pointer" onclick="navigate('inventory')">
          <div class="dw-icon">&#128230;</div>
          <div class="dw-info">
            <div class="dw-value ${lowParts > 0 ? 'text-red' : 'text-green'}">${lowParts}</div>
            <div class="dw-label">Low Stock Parts</div>
          </div>
        </div>` : ''}
        <div class="dash-widget">
          <div class="dw-icon">&#9981;</div>
          <div class="dw-info">
            <div class="dw-value ${mixLow || lowFuels > 0 ? 'text-red' : 'text-green'}">${lowFuels > 0 || mixLow ? 'Low' : 'OK'}</div>
            <div class="dw-label">Fuel Status</div>
          </div>
        </div>
        <div class="dash-widget">
          <div class="dw-icon">&#9888;</div>
          <div class="dw-info">
            <div class="dw-value ${groundingDefects > 0 ? 'text-red' : openDefects > 0 ? 'text-orange' : 'text-green'}">${openDefects}</div>
            <div class="dw-label">Open Defects</div>
          </div>
        </div>
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

  if (isAirborne) {
    const departedFlight = flights.find(f => f.aircraftId === ac.tailNumber && f.status === 'departed');
    if (departedFlight) startFlightBarProgress(departedFlight);
  }

  checkAndCreateInspectionTasks(ac);

  const inspBtn = document.getElementById('perform-inspection-btn');
  if (inspBtn) {
    inspBtn.addEventListener('click', () => navigate('maintenance'));
  }
  const crsBtn = document.getElementById('issue-daily-crs-btn');
  if (crsBtn) {
  crsBtn.addEventListener('click', async () => {
      if (typeof denyGuest === 'function' && denyGuest()) return;
      const role = localStorage.getItem('aac_user_role');
      if (role !== 'engineer' && role !== 'admin') { showToast('Only Engineer or Admin can issue CRS', 'error'); return; }
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
  // Clear live feed timer when navigating away
  if (window._liveFeedTimer && view !== 'live-feed') {
    clearInterval(window._liveFeedTimer);
    window._liveFeedTimer = null;
  }

  switch (view) {
    case 'dashboard': dashboardView(); break;
    case 'live-feed': liveFeedView(); break;
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
    { value: 'guest', label: 'Guest', desc: 'View-only access to all data' },
    { value: 'technician', label: 'Technician', desc: 'Can record sorties, report squawks, view data' },
    { value: 'senior_technician', label: 'Senior Technician', desc: 'Above + can approve sign-ins' },
    { value: 'production_planner', label: 'Production Planner', desc: 'Above + can end flying, view CRS, manage fleet' },
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
    if (typeof denyGuest === 'function' && denyGuest()) return;
    const n = document.getElementById('profile-name').value.trim();
    const r = document.getElementById('profile-role').value;
    if (!n) { showToast('Enter your name', 'error'); return; }
    if (!r) { showToast('Select your role', 'error'); return; }

    if (r === 'admin' || r === 'engineer' || r === 'production_planner' || r === 'senior_technician') {
      const userPins = JSON.parse(localStorage.getItem('aac_user_pins') || '{}');
      const currentUser = localStorage.getItem('aac_user') || n;
      const pin = userPins[currentUser] || '1234';
      const entered = await showPromptDialog('PIN Required', `Enter your PIN to set role as ${r.replace(/_/g, ' ')}:`);
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
      // Find existing user by name to avoid duplicates
      const all = await DB.getAll('users');
      const match = all.find(u => u.name === n);
      if (match) {
        localStorage.setItem('aac_user_id', match.id);
        match.role = r;
        match.photo = newPhoto;
        await DB.put('users', match);
        await queueSync('users', 'update', match);
      } else {
        const id = 'user_' + Date.now();
        localStorage.setItem('aac_user_id', id);
        const u = { id, name: n, role: r, photo: newPhoto, createdAt: new Date().toISOString() };
        await DB.put('users', u);
        await queueSync('users', 'create', u);
      }
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

/* ── Live Feed ── */
function liveFeedView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Live Feed</h2>
        <div class="subtitle">Real-time crew &amp; fleet status</div>
      </div>
      <div id="live-feed-content">
        <div class="skeleton skeleton-block"></div>
        <div class="skeleton skeleton-block"></div>
      </div>
    </div>
  `;
  renderLiveFeed();
  if (window._liveFeedTimer) clearInterval(window._liveFeedTimer);
  window._liveFeedTimer = setInterval(renderLiveFeed, 15000);
}

async function renderLiveFeed() {
  const el = document.getElementById('live-feed-content');
  if (!el) return;
  const flights = await DB.getAll('flights');
  const attendance = await DB.getAll('attendance');
  const users = await DB.getAll('users');
  const defects = await DB.getAll('defects');
  const tasks = await DB.getAll('maintenance_tasks');
  const today = new Date().toISOString().slice(0, 10);

  // Airborne
  const airborne = flights.filter(f => f.status === 'departed');
  // Crew on duty (approved sign-ins today)
  const todayAttendance = attendance.filter(a => a.date === today && a.status === 'approved');
  const onDuty = todayAttendance.map(a => {
    const u = users.find(u => u.name === a.userName);
    return { ...a, photo: u?.photo || '' };
  });
  // Recent activity
  const allActs = [];
  flights.filter(f => f.status === 'completed' && f.flightDate === today).forEach(f => {
    allActs.push({ time: f.landingTime || f.createdAt, icon: '&#9992;', text: `${f.pilotName} landed (${(f.flownHours*60).toFixed(0)}m)`, type: 'flight' });
  });
  defects.filter(d => (d.createdAt || '').slice(0,10) === today).forEach(d => {
    allActs.push({ time: d.createdAt, icon: d.urgency === 'grounding' ? '&#9888;' : '&#9888;', text: `${d.description} [${d.urgency}]`, type: 'defect' });
  });
  tasks.filter(t => (t.createdAt || '').slice(0,10) === today && t.status === 'released').forEach(t => {
    allActs.push({ time: t.releasedAt || t.createdAt, icon: '&#9989;', text: `CRS: ${t.description}`, type: 'crs' });
  });
  allActs.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const recent = allActs.slice(0, 20);

  let html = '';

  // Airborne section
  if (airborne.length > 0) {
    html += `<div class="card" style="border-color:rgba(59,130,246,0.3)">
      <div class="card-header"><h3>&#9992; Airborne</h3></div>`;
    for (const f of airborne) {
      const ac = await DB.get('aircraft', f.aircraftId);
      const etaStr = f.eta ? `ETA ${f.eta}` : '';
      html += `<div class="flight-row">
        <div style="flex:1;min-width:0">
          <div class="flight-pilot" style="color:#3b82f6">${escHtml(f.aircraftId)} &middot; ${escHtml(f.pilotName)}</div>
          <div class="flight-date">Dep ${f.takeoffTime} ${etaStr}</div>
        </div>
        <span style="width:8px;height:8px;border-radius:50%;background:#3b82f6;animation:dotPulse 1s infinite"></span>
      </div>`;
    }
    html += `</div>`;
  }

  // Crew on duty
  html += `<div class="card">
    <div class="card-header"><h3>&#10003; On Duty (${onDuty.length})</h3></div>`;
  if (onDuty.length === 0) {
    html += `<p class="text-muted small">No crew signed in today</p>`;
  } else {
    for (const c of onDuty) {
      html += `<div class="crew-row" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:50%;overflow:hidden;background:var(--surface);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid var(--text)">
          ${c.photo ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover">` : c.userName[0].toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--mono);font-size:12px;font-weight:600">${escHtml(c.userName)}</div>
          <div style="font-family:var(--mono);font-size:9px;color:var(--text-muted)">In: ${c.checkinTime || '—'}</div>
        </div>
      </div>`;
    }
  }
  html += `</div>`;

  // Recent activity
  html += `<div class="card">
    <div class="card-header"><h3>&#128197; Today's Activity</h3></div>`;
  if (recent.length === 0) {
    html += `<p class="text-muted small">No activity today</p>`;
  } else {
    for (const a of recent) {
      const color = a.type === 'flight' ? 'var(--text)' : a.type === 'defect' ? 'var(--red)' : 'var(--gold)';
      html += `<div class="flight-row">
        <div style="flex:1;min-width:0">
          <div class="flight-pilot" style="font-size:11px"><span style="color:${color}">${a.icon}</span> ${escHtml(a.text)}</div>
          <div class="flight-date">${a.time ? new Date(a.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : ''}</div>
        </div>
      </div>`;
    }
  }
  html += `</div>`;

  el.innerHTML = html;
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
    if (typeof denyGuest === 'function' && denyGuest()) return;
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
  });

  document.getElementById('close-ac-btn').addEventListener('click', () => window.__sheetClose(null));
}

async function generateDailyTechLog() {
  const today = new Date().toISOString().slice(0, 10);
  const ac = await getAircraft();
  if (!ac) { showToast('No aircraft selected', 'error'); return; }
  const flights = await DB.getAll('flights');
  const tasks = await DB.getAll('maintenance_tasks');
  const defects = await DB.getAll('defects');
  const allHistory = await getAllHistory();

  const todayFlights = flights.filter(f => f.flightDate === today && f.aircraftId === ac.tailNumber);
  const todayTasks = tasks.filter(t => t.createdAt?.slice(0, 10) === today && t.aircraftId === ac.tailNumber);
  const todayDefects = defects.filter(d => d.createdAt?.slice(0, 10) === today && d.aircraftId === ac.tailNumber);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFontSize(18);
  doc.text('Daily Tech Log', 14, 20);
  doc.setFontSize(10);
  doc.text(`Aircraft: ${ac.tailNumber} (${ac.type || 'Cessna 152'})`, 14, 28);
  doc.text(`Date: ${today}`, 14, 34);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 40);
  doc.setDrawColor(150);
  doc.line(14, 44, 196, 44);

  let y = 50;
  doc.setFontSize(12);
  doc.text('Flight Summary', 14, y); y += 8;
  doc.setFontSize(9);
  if (todayFlights.length === 0) {
    doc.text('No flights recorded today.', 14, y); y += 6;
  } else {
    for (const f of todayFlights) {
      doc.text(`${f.pilotName || 'Unknown'} | ${f.takeoffTime || '--'} - ${f.landingTime || '--'} | ${(f.flownHours || 0).toFixed(2)} hrs`, 14, y);
      y += 5;
      if (f.route) { doc.text(`  Route: ${f.route}`, 14, y); y += 5; }
      if (f.remarks) { doc.text(`  Remarks: ${f.remarks}`, 14, y); y += 5; }
    }
  }

  y += 4;
  doc.setFontSize(12);
  doc.text('Maintenance / Work Orders', 14, y); y += 8;
  doc.setFontSize(9);
  if (todayTasks.length === 0) {
    doc.text('No work orders today.', 14, y); y += 6;
  } else {
    for (const t of todayTasks) {
      doc.text(`[${t.status}] ${t.description}`, 14, y); y += 5;
      if (t.rectifiedBy) doc.text(`  Rectified by: ${t.rectifiedBy}`, 14, y); y += 5;
      if (t.releasedBy) doc.text(`  Released by: ${t.releasedBy}`, 14, y); y += 5;
    }
  }

  y += 4;
  doc.setFontSize(12);
  doc.text('Defect Report', 14, y); y += 8;
  doc.setFontSize(9);
  if (todayDefects.length === 0) {
    doc.text('No defects recorded today.', 14, y); y += 6;
  } else {
    for (const d of todayDefects) {
      doc.text(`[${d.urgency}] ${d.description} - ${d.status}`, 14, y); y += 5;
    }
  }

  y += 4;
  doc.setFontSize(12);
  doc.text('Aircraft Status', 14, y); y += 8;
  doc.setFontSize(9);
  doc.text(`Tach: ${ac.totalTachTime || 0} hrs`, 14, y); y += 5;
  const hoursSinceOil = (ac.totalTachTime || 0) - (ac.lastOilChangeTach || 0);
  const hoursSince100hr = (ac.totalTachTime || 0) - (ac.last100hrTach || 0);
  doc.text(`50hr: ${Math.max(0, (ac.oilInterval || 50) - hoursSinceOil).toFixed(1)} hrs remaining`, 14, y); y += 5;
  doc.text(`100hr: ${Math.max(0, (ac.structInterval || 100) - hoursSince100hr).toFixed(1)} hrs remaining`, 14, y); y += 5;
  doc.text(`Engine TSO: ${(ac.engineETSO || 0).toFixed(1)} hrs`, 14, y); y += 5;
  doc.text(`Prop TSO: ${(ac.propellerPTSO || 0).toFixed(1)} hrs`, 14, y); y += 5;

  doc.line(14, y + 4, 196, y + 4);
  y += 10;
  doc.setFontSize(9);
  doc.text('Maintenance Release / CRS:', 14, y); y += 6;
  doc.line(14, y, 100, y); y += 8;
  doc.text('Signature & Date', 14, y);

  doc.save(`tech-log-${ac.tailNumber}-${today}.pdf`);
  showToast('Daily tech log PDF generated');
  window.__sheetClose(true);
}

function generateEngineerGuide() {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) { showToast('PDF library not loaded', 'error'); return; }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const w = 210;
  let y = 20;
  const line = () => { doc.line(14, y, 196, y); y += 6; };
  const text = (t, size = 10, indent = 14) => { doc.setFontSize(size); doc.text(t, indent, y); y += size * 0.5; };
  const section = (t) => { y += 4; doc.setFontSize(13); doc.text(t, 14, y); y += 7; doc.setDrawColor(100); doc.line(14, y - 2, 196, y - 2); };

  doc.setFontSize(20);
  doc.text('AAC Technical Services', w / 2, y, { align: 'center' }); y += 8;
  doc.setFontSize(14);
  doc.text('Engineer User Guide', w / 2, y, { align: 'center' }); y += 6;
  doc.setFontSize(9);
  doc.text(`Issued: ${new Date().toLocaleDateString()}`, w / 2, y, { align: 'center' }); y += 14;
  line();

  section('1. Getting Started');
  text('1.1 Select your name on the login screen and enter your PIN.', 10);
  text('1.2 The Dashboard shows fleet status: tach time, 50hr / 100hr remaining, open tasks, low stock, fuel, and defects.', 10);
  text('1.3 Use the sidebar (top-left hamburger icon) to navigate between modules.', 10);

  section('2. Fleet Manager (Aircraft Management)');
  text('2.1 Navigate to Fleet Manager in the sidebar to add, edit, or remove aircraft.', 10);
  text('2.2 Each aircraft stores tail number, type, tach time, engine/prop TBO, and 50hr / 100hr baselines.', 10);
  text('2.3 To edit an aircraft, tap its row in the fleet list and update the fields.', 10);
  text('2.4 The default aircraft is marked with a star. Switch the default by tapping the star on another aircraft.', 10);
  text('2.5 You can upload an aircraft photo from the fleet manager edit view.', 10);

  section('3. Flight Operations');
  text('3.1 Log Flights: enter pilot, tach start/end, route, and remarks.', 10);
  text('3.2 The system auto-calculates flown hours, ETA (add 10 min), and arrival reminders.', 10);
  text('3.3 Deleting a flight rolls back tach time, engine ETSO, prop PTSO, and 50hr / 100hr baselines.', 10);
  text('3.4 Departure is blocked when the aircraft is grounded (active grounding defect).', 10);
  text('3.5 Fuel Ops: log fuel uplifts and track current fuel state per aircraft.', 10);

  section('4. Maintenance & Defects');
  text('4.1 Defects: log defects with urgency (grounding / normal) and assign to a crew member.', 10);
  text('4.2 Grounding defects auto-ground the aircraft (blocks departures).', 10);
  text('4.3 Work Orders: create tasks from the Maintenance view, assign to a technician.', 10);
  text('4.4 Rectify: mark a task as rectified (requires PIN for engineer role).', 10);
  text('4.5 CRS (Release to Service): only Engineer and Admin can issue a CRS. This releases the task.', 10);
  text('4.6 Production Planner CANNOT issue a CRS — only sign-offs.', 10);

  section('5. Inspections');
  text('5.1 The system tracks 50hr (oil change) and 100hr (structural) intervals automatically.', 10);
  text('5.2 Engine TBO and Prop TBO are tracked via ETSO / PTSO counters.', 10);
  text('5.3 Inspection reminders appear in the sidebar and as dashboard notifications.', 10);
  text('5.4 Overdue alerts escalate automatically (e.g. 100hr overdue by 10 hrs).', 10);

  section('6. Crew & Attendance');
  text('6.1 Crew Board shows all users with their sign-in status for the day.', 10);
  text('6.2 Approved sign-ins count as "On Duty". Pending sign-ins require approval.', 10);
  text('6.3 Admin and Engineer can approve / reject attendance requests.', 10);

  section('7. Parts & Inventory');
  text('7.1 Track parts stock with low-stock alerts on the dashboard.', 10);
  text('7.2 Use the Parts view to add, adjust, or delete inventory items.', 10);
  text('7.3 Fuel stock is managed separately under Fuel Ops.', 10);

  section('8. Notifications & Alerts');
  text('8.1 Notifications appear for flight arrivals, inspections due, and defect reports.', 10);
  text('8.2 Admin can delete individual notifications. All users can mark them as read.', 10);
  text('8.3 Push notifications are sent via Firebase Cloud Messaging.', 10);

  section('9. Reports & Export');
  text('9.1 Export / Tech Log: generate a PDF report of selected data with date range and aircraft filter.', 10);
  text('9.2 Daily Tech Log Summary: generates a one-page PDF with today\'s flights, work orders, defects, and aircraft status.', 10);
  text('9.3 The PDF can be printed or shared from your device.', 10);

  section('10. Offline Mode');
  text('10.1 The app works offline. Data syncs when connectivity is restored.', 10);
  text('10.2 A sync indicator (top-right) shows the sync status.', 10);
  text('10.3 Buttons are disabled when offline to prevent data loss.', 10);

  section('11. Role Permissions Summary');
  doc.setFontSize(9);
  const roles = [
    ['Function', 'Admin', 'Engineer', 'Prod Plan', 'Sr Tech', 'Tech', 'Pilot', 'Guest'],
    ['CRS (Release)', 'Yes', 'Yes', 'No', 'No', 'No', 'No', 'No'],
    ['Rectify Tasks', 'Yes', 'Yes', 'Yes', 'Yes', 'No', 'No', 'No'],
    ['Fleet Manager', 'Yes', 'Yes', 'Yes', 'No', 'No', 'No', 'No'],
    ['Delete Flights', 'Yes', 'Yes', 'Yes', 'No', 'No', 'No', 'No'],
    ['Manage Parts', 'Yes', 'Yes', 'Yes', 'No', 'No', 'No', 'No'],
    ['Manage Fuel', 'Yes', 'Yes', 'Yes', 'No', 'No', 'No', 'No'],
    ['Attendance', 'Yes', 'Yes', 'Yes', 'Yes', 'No', 'No', 'No'],
    ['Factory Reset', 'Yes', 'No', 'No', 'No', 'No', 'No', 'No'],
    ['All Read-Only', 'No', 'No', 'No', 'No', 'No', 'No', 'Yes'],
  ];
  const colW = [50, 20, 22, 24, 18, 18, 14, 16];
  const rolesStartY = y + 4;
  let ry = rolesStartY;
  roles.forEach((row, ri) => {
    let cx = 14;
    row.forEach((cell, ci) => {
      doc.setFontSize(ci === 0 ? 8 : 7);
      doc.text(cell, cx, ry);
      cx += colW[ci] || 20;
    });
    ry += 5;
    if (ri === 0) { doc.line(14, ry - 2, 196, ry - 2); }
  });
  doc.line(14, ry - 2, 196, ry - 2);

  y = ry + 10;
  section('12. Support');
  text('For issues or feature requests, contact the system administrator.', 10);

  doc.save('aacts-engineer-guide.pdf');
  showToast('Engineer guide PDF generated');
}

async function renderACListSheet() {
  const all = await getAllAircraft();
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

  all.sort((a, b) => {
    if (a.tailNumber === '4R-ACV') return -1;
    if (b.tailNumber === '4R-ACV') return 1;
    return a.tailNumber.localeCompare(b.tailNumber);
  });
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
      if (typeof denyGuest === 'function' && denyGuest()) return;
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
      if (typeof denyGuest === 'function' && denyGuest()) return;
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
      renderACListSheet();
    });
  });
  el.querySelectorAll('.del-ac-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (typeof denyGuest === 'function' && denyGuest()) return;
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
          <img src="img/logo.jpg" alt="AACTS" style="width:80px;height:80px;border-radius:50%;margin-bottom:8px;object-fit:cover;border:2px solid var(--border)">
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

  document.getElementById('login-btn').addEventListener('click', async () => {
    const sel = document.getElementById('login-user');
    const name = sel.value;
    const role = sel.options[sel.selectedIndex]?.dataset?.role || '';
    const error = document.getElementById('login-error');
    error.style.display = 'none';
    if (!name) { showToast('Select a user', 'error'); return; }
    if (privilegedRoles.includes(role)) {
      const pin = document.getElementById('login-pin').value.trim();
      let userPins = {};
      try { userPins = JSON.parse(localStorage.getItem('aac_user_pins')) || {}; } catch(e) {}
      const storedPin = userPins[name] || '1234';
      if (!pin) { error.textContent = 'PIN required for this role'; error.style.display = ''; return; }
      if (pin !== storedPin) { error.textContent = 'Incorrect PIN'; error.style.display = ''; return; }
    }
    localStorage.setItem('aac_user', escHtml(name));
    localStorage.setItem('aac_user_role', role);
    // Restore profile photo from DB and set user ID
    const allUsers = await DB.getAll('users');
    // Match by canonical name (e.g. "Pasan" → "Pasan Anishka")
    let match = allUsers.find(u => u.name === name);
    if (!match) {
      match = allUsers.find(u => u.name.includes(name) || name.includes(u.name));
    }
    if (match) {
      localStorage.setItem('aac_user_id', match.id);
      if (match.photo) {
        localStorage.setItem('aac_user_photo', match.photo);
      } else {
        localStorage.removeItem('aac_user_photo');
      }
      // Store canonical name
      localStorage.setItem('aac_user', match.name);
    } else {
      localStorage.removeItem('aac_user_photo');
      localStorage.removeItem('aac_user_id');
    }
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

  if (typeof restoreArrivalReminders === 'function') restoreArrivalReminders();
  if (typeof restoreFlightProgressBars === 'function') restoreFlightProgressBars();

  window.addEventListener('online', () => {
    document.getElementById('offline-banner')?.classList.add('hidden');
  });
  window.addEventListener('offline', () => {
    document.getElementById('offline-banner')?.classList.remove('hidden');
  });
  if (!navigator.onLine) {
    document.getElementById('offline-banner')?.classList.remove('hidden');
  }

  // Seed per-user PINs if not yet set
  if (!localStorage.getItem('aac_user_pins')) {
    const pins = {};
    let users = [];
    try { users = JSON.parse(localStorage.getItem('aac_users')) || []; } catch(e) {}
    users.forEach(u => { pins[u.name] = '1234'; });
    localStorage.setItem('aac_user_pins', JSON.stringify(pins));
  }

  if (localStorage.getItem('aac_users')) {
    // Clean up duplicate user names (e.g. "Pasan" vs "Pasan Anishka")
    let localUsers = [];
    try { localUsers = JSON.parse(localStorage.getItem('aac_users')) || []; } catch(e) {}
    if (localUsers.length > 0) {
      const seenNames = new Set();
      const cleanedLocal = [];
      for (const u of localUsers) {
        const dup = localUsers.find(other =>
          other.name !== u.name && (other.name.includes(u.name) || u.name.includes(other.name))
        );
        if (dup) {
          const longer = u.name.length >= dup.name.length ? u : dup;
          if (!seenNames.has(longer.name)) {
            seenNames.add(longer.name);
            cleanedLocal.push(longer);
          }
        } else if (!seenNames.has(u.name)) {
          seenNames.add(u.name);
          cleanedLocal.push(u);
        }
      }
      localStorage.setItem('aac_users', JSON.stringify(cleanedLocal));
    }
  }

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
      { name: 'Rajapaksha', role: 'technician' },
      { name: 'Guest', role: 'guest' }
    ];
    localStorage.setItem('aac_users', JSON.stringify(defaultUsers));
  }

  // Sync login users into DB so crew board shows everyone
  const seedUsers = JSON.parse(localStorage.getItem('aac_users') || '[]');
  // Dedup existing DB users by name, merging similar names (e.g. "Pasan" → "Pasan Anishka")
  const existingDbUsers = await DB.getAll('users');
  // Map: canonical name → user object
  const canon = new Map();
  for (const u of existingDbUsers) {
    // Find if this name is a substring of or contains another existing name
    const similar = existingDbUsers.find(other =>
      other.name !== u.name && (other.name.includes(u.name) || u.name.includes(other.name))
    );
    const canonicalName = similar ? (u.name.length >= similar.name.length ? u.name : similar.name) : u.name;
    const prev = canon.get(canonicalName);
    const better = !prev || (u.photo && !prev.photo) || (!prev.photo && !u.photo && u.createdAt > prev.createdAt);
    if (better) {
      if (prev && prev.id !== u.id) await DB.del('users', prev.id);
      // Update name to canonical if needed
      if (u.name !== canonicalName) {
        u.name = canonicalName;
        await DB.put('users', u);
      }
      canon.set(canonicalName, u);
    } else {
      await DB.del('users', u.id);
    }
  }
  // Update localStorage user name if logged-in user had a non-canonical name
  const curUser = localStorage.getItem('aac_user');
  if (curUser) {
    for (const [canonicalName, u] of canon) {
      if (curUser !== canonicalName && (curUser.includes(canonicalName) || canonicalName.includes(curUser))) {
        localStorage.setItem('aac_user', canonicalName);
        localStorage.setItem('aac_user_id', u.id);
        break;
      }
    }
  }
  const existingNames = new Set(canon.keys());
  for (const su of seedUsers) {
    if (!existingNames.has(su.name)) {
      const id = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      await DB.put('users', { id, name: su.name, role: su.role, photo: '', createdAt: new Date().toISOString() });
    }
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
    if (typeof denyGuest === 'function' && denyGuest()) return;
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
    const currentUser = localStorage.getItem('aac_user');
    if (!currentUser) { showToast('No user logged in', 'error'); return; }
    let userPins = {};
    try { userPins = JSON.parse(localStorage.getItem('aac_user_pins')) || {}; } catch(e) {}
    const current = userPins[currentUser] || '1234';
    const old = await showPromptDialog('Change PIN', 'Enter current PIN:');
    if (old === null) return;
    if (old.trim() !== current) { showToast('Incorrect PIN', 'error'); return; }
    const newPin = await showPromptDialog('Change PIN', 'Enter new PIN:');
    if (newPin === null) return;
    if (!newPin.trim()) { showToast('PIN cannot be empty', 'error'); return; }
    const confirmPin = await showPromptDialog('Change PIN', 'Confirm new PIN:');
    if (confirmPin === null || confirmPin.trim() !== newPin.trim()) { showToast('PINs do not match', 'error'); return; }
    userPins[currentUser] = newPin.trim();
    localStorage.setItem('aac_user_pins', JSON.stringify(userPins));
    showToast('PIN changed successfully');
  });
  document.getElementById('sidebar-export').addEventListener('click', async e => {
    e.preventDefault();
    closeSidebar();
    showExportSheet();
  });
  document.getElementById('sidebar-guide').addEventListener('click', async e => {
    e.preventDefault();
    closeSidebar();
    generateEngineerGuide();
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
    { key: 'defects', label: 'Defects', hasDate: true, dateField: 'createdAt' },
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
    <button class="btn btn-secondary btn-block" id="export-tech-log-btn" style="margin-top:8px">&#128196; Daily Tech Log Summary</button>
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
  document.getElementById('export-tech-log-btn').addEventListener('click', async () => {
    generateDailyTechLog();
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
