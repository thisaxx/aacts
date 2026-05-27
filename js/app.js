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

function playAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

let _pullStartY = 0;
let _pullThreshold = 80;
function initPullToRefresh() {
  const app = document.getElementById('app');
  if (!app) return;
  app.addEventListener('touchstart', e => { _pullStartY = e.touches[0].clientY; }, { passive: true });
  app.addEventListener('touchmove', e => {
    if (window.__sheetOpen || document.getElementById('app').scrollTop > 0) return;
    const dy = e.touches[0].clientY - _pullStartY;
    const ind = document.getElementById('pull-indicator');
    if (dy > _pullThreshold) {
      ind.textContent = '\u2191 Release to refresh';
      ind.classList.add('visible');
    } else if (dy > 0) {
      ind.textContent = '\u2191 Pull to refresh';
      ind.classList.add('visible');
    } else {
      ind.classList.remove('visible');
    }
  }, { passive: true });
  app.addEventListener('touchend', async () => {
    const ind = document.getElementById('pull-indicator');
    if (ind.classList.contains('visible') && ind.textContent.includes('Release')) {
      ind.textContent = '\u21BB Refreshing...';
      await refreshCurrentView();
    }
    ind.classList.remove('visible');
  }, { passive: true });
}

async function refreshCurrentView() {
  const active = document.querySelector('.nav-link.active');
  const view = active ? active.dataset.view : 'dashboard';
  showToast('Refreshed');
  navigate(view);
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

async function renderComments(parentType, parentId, containerEl) {
  const comments = await getComments(parentType, parentId);
  containerEl.innerHTML = comments.map(c => `
    <div style="padding:8px 0;border-bottom:1px solid var(--glass-border)">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)">
        <strong>${escHtml(c.author)}</strong>
        <span>${new Date(c.createdAt).toLocaleString()}</span>
      </div>
      <div style="font-size:13px;margin-top:2px">${escHtml(c.text)}</div>
    </div>
  `).join('') || '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">No comments yet</div>';
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
    await addComment(parentType, parentId, input.value).catch(() => {});
    input.value = '';
    await renderComments(parentType, parentId, containerEl).catch(() => {});
  };
  btn.addEventListener('click', () => { post().catch(() => {}); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') post().catch(() => {}); });
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
  await DB.put('activity_log', entry).catch(() => {});
}

const INSPECTION_TEMPLATES = [
  { type: 'inspection_50hr', label: '50-hour inspection', interval: (ac) => ac.oilInterval || 50, getElapsed: (ac) => (ac.totalTachTime || 0) - (ac.lastOilChangeTach || 0), leadHr: 5 },
  { type: 'inspection_100hr', label: '100-hour inspection', interval: (ac) => ac.structInterval || 100, getElapsed: (ac) => (ac.totalTachTime || 0) - (ac.last100hrTach || 0), leadHr: 5 },
  { type: 'inspection_engine_TBO', label: 'Engine TBO', interval: (ac) => ac.engineTBO || 2000, getElapsed: (ac) => ac.engineETSO || 0, leadHr: 50 },
  { type: 'inspection_prop_TBO', label: 'Propeller TBO', interval: (ac) => ac.propellerTBO || 2000, getElapsed: (ac) => ac.propellerPTSO || 0, leadHr: 50 },
];

async function checkAndCreateInspectionTasks(ac) {
  if (!ac) return;
  try {
    const tasks = await DB.getAll('maintenance_tasks');
    const acTasks = tasks.filter(t => t.aircraftId === ac.tailNumber);

    for (const tmpl of INSPECTION_TEMPLATES) {
      const elapsed = tmpl.getElapsed(ac);
      const interval = tmpl.interval(ac);
      const threshold = interval - (tmpl.leadHr || 0);
      if (elapsed >= threshold) {
        const hasOpen = acTasks.some(t => t.type === tmpl.type && t.status === 'open');
        if (!hasOpen) {
          const hrsDesc = elapsed > interval ? `${elapsed.toFixed(2)} hrs (overdue by ${(elapsed - interval).toFixed(2)})` : `${elapsed.toFixed(2)} hrs since last (${(interval - elapsed).toFixed(2)} hrs remaining)`;
          const task = {
            id: 'mnt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            aircraftId: ac.tailNumber,
            description: `${tmpl.label} — ${hrsDesc}`,
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
          createNotification('task', 'Inspection Due', `${tmpl.label} task auto-created for ${ac.tailNumber}`, 'maintenance');
        }
      }
    }
  } catch(e) { /* not critical */ }
}

async function getActivityFeed(limit = 50) {
  const [fromActivity, fromFlights] = await Promise.all([
    DB.getAll('activity_log').catch(() => []),
    DB.getAll('flights').catch(() => [])
  ]);
  const merged = [...fromActivity, ...fromFlights.filter(e => e.id && e.id.startsWith('act_'))];
  return merged
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit);
}

function activityFeedView() {
  if (typeof denyGuest === 'function' && denyGuest()) return;
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
  let seedUsers = [];
  try { seedUsers = JSON.parse(localStorage.getItem('aac_users')) || []; } catch(e) {}
  const dbUsers = await DB.getAll('users');
  const attendance = await DB.getAll('attendance');
  const today = new Date().toISOString().slice(0, 10);
  const activeAttendance = attendance.filter(a => a.date === today && (a.status === 'approved' || a.status === 'pending'));
  return seedUsers.map(su => {
    const match = dbUsers.find(u => u.name === su.name);
    const user = match || { name: su.name, role: su.role, photo: '' };
    const att = activeAttendance.find(a => a.userName === su.name);
    return { user, attendance: att || null };
  }).sort((a, b) => {
    const aApproved = a.attendance?.status === 'approved' ? 0 : a.attendance?.status === 'pending' ? 1 : 2;
    const bApproved = b.attendance?.status === 'approved' ? 0 : b.attendance?.status === 'pending' ? 1 : 2;
    return aApproved - bApproved;
  });
}

function compressImage(dataUrl, maxW = 320, maxH = 240, quality = 0.5) {
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
    const _id = 'd' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <h3>${escHtml(title)}</h3>
        <p>${escHtml(message)}</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary" id="${_id}-no">No</button>
          <button class="btn btn-primary" id="${_id}-yes">Yes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.getElementById(_id + '-yes').onclick = () => {
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); resolve(true); }, 300);
    };
    document.getElementById(_id + '-no').onclick = () => {
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); resolve(false); }, 300);
    };
  });
}

function showPromptDialog(title, message) {
  return new Promise(resolve => {
    const _id = 'p' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <h3>${escHtml(title)}</h3>
        <p>${escHtml(message)}</p>
        <textarea id="${_id}-input" rows="4" style="width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.4);color:#fff;font-size:15px;font-family:inherit;margin:12px 0;outline:none"></textarea>
        <div class="dialog-actions">
          <button class="btn btn-secondary" id="${_id}-cancel">Cancel</button>
          <button class="btn btn-primary" id="${_id}-ok">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.getElementById(_id + '-ok').onclick = () => {
      const val = document.getElementById(_id + '-input').value;
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); resolve(val); }, 300);
    };
    document.getElementById(_id + '-cancel').onclick = () => {
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
    window.__sheetOpen = true;

    let resolved = false;
    const close = (result) => {
      if (resolved) return;
      resolved = true;
      window.__sheetOpen = false;
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
  document.querySelectorAll('.toggle-wrap:not([data-toggles-initialized])').forEach(el => {
    el.setAttribute('data-toggles-initialized', '1');
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
  const arrivalBtn = document.getElementById(`fsb-arrival-btn-${flight.id}`);
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
    // Show arrival button when ETA is reached
    if (arrivalBtn && pct >= 100) arrivalBtn.style.display = 'block';
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
        <button class="btn btn-sm btn-primary" id="fsb-arrival-btn-${escHtml(flight.id)}" style="display:none;margin-top:6px;width:100%" onclick="navigate('flight-ops')">&#128644; Record Arrival</button>
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

  // Today stats
  const today = new Date().toISOString().slice(0, 10);
  const todayFlights = flights.filter(f => f.flightDate === today);
  const todayHours = todayFlights.reduce((s, f) => s + f.flownHours, 0);

  // After-flight inspection pending
  const afterFlightPending = tasks.filter(t => t.type === 'after-flight' && t.status === 'open').length > 0;
  // Daily CRS check
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
  if (!crsIssuedToday && hasRole('engineer','production_planner','admin')) alerts.push('No daily CRS issued');
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
          <div class="stat-label">Total Flights</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalHours.toFixed(2)}</div>
          <div class="stat-label">Total Hours</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${todayHours.toFixed(2)}</div>
          <div class="stat-label">Today's Hours</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${(ac.currentHobbs || 0).toFixed(2)}</div>
          <div class="stat-label">Hobbs</div>
        </div>
      </div>

      ${alerts.length > 0 || ac.groundedAfterInspection ? `
      <div class="dash-alerts">
        ${alerts.map(a => `<div class="dash-alert">&#9888; ${a}</div>`).join('')}
        ${ac.groundedAfterInspection ? `<div class="dash-alert" style="border-color:var(--danger)">&#128308; Aircraft grounded — daily CRS required before next flight</div>` : ''}
        ${(!crsIssuedToday || ac.groundedAfterInspection) && hasRole('engineer','admin') ? `
        <button class="btn btn-primary btn-block" id="issue-daily-crs-btn" style="margin-top:8px">${ac.groundedAfterInspection ? '&#9989; Issue Daily CRS for Airworthiness' : 'Issue Daily CRS'}</button>` : ''}
        ${inspectionOverdue ? `<button class="btn btn-primary btn-block" id="perform-inspection-btn" style="margin-top:8px">&#9881; Perform Inspection Sign-off</button>` : ''}
      </div>` : ''}

      <div class="dashboard-widgets">
        <div class="dash-widget">
          <div class="dw-icon">&#128197;</div>
          <div class="dw-info">
            <div class="dw-value ${inspectionOverdue ? 'text-red' : oilRemaining <= 5 ? 'text-orange' : 'text-green'}">${oilRemaining.toFixed(2)}h</div>
            <div class="dw-label">50hr Inspection Left</div>
          </div>
        </div>
        <div class="dash-widget">
          <div class="dw-icon">&#128197;</div>
          <div class="dw-info">
            <div class="dw-value ${structRemaining <= 0 ? 'text-red' : structRemaining <= 5 ? 'text-orange' : 'text-green'}">${structRemaining.toFixed(2)}h</div>
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
                ${oilRemaining.toFixed(2)}h left
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
                ${structRemaining.toFixed(2)}h left
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
                  <span class="interval-value ${etso >= eTBO ? 'text-red' : etso >= eTBO - 50 ? 'text-orange' : 'text-green'}">${etso.toFixed(2)}h / ${eTBO}h</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill ${etso >= eTBO ? 'fill-red' : etso >= eTBO - 50 ? 'fill-orange' : 'fill-green'}" style="width:${ePct}%"></div>
                </div>
              </div>
              <div class="interval-item">
                <div class="interval-label">
                  <span class="label">Propeller TSO</span>
                  <span class="interval-value ${ptso >= pTBO ? 'text-red' : ptso >= pTBO - 50 ? 'text-orange' : 'text-green'}">${ptso.toFixed(2)}h / ${pTBO}h</span>
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

  // Play alert sound for critical dash conditions
  if ((groundingDefects > 0 || minRemaining <= 0 || ac.groundedAfterInspection) && !window._alertedThisSession) {
    setTimeout(playAlert, 500);
    window._alertedThisSession = true;
  }

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
      if (!hasRole('engineer','admin')) { showToast('Only Engineer or Admin can issue CRS', 'error'); return; }
      const ac = await getAircraft();
      const hoursSinceOil = (ac.totalTachTime || 0) - (ac.lastOilChangeTach || 0);
      const oilDue = hoursSinceOil >= (ac.oilInterval || 50);

      // Oil check step before issuing CRS
      const oilCheckConfirm = await new Promise(resolve => {
        const sheetPromise = showBottomSheet(`
          <div class="card-header"><h3>&#128167; Pre-Flight Oil Check — ${escHtml(ac.tailNumber)}</h3></div>
          <p class="text-muted small" style="margin-bottom:12px">Oil change due every ${ac.oilInterval || 50} tach hrs. Current: ${hoursSinceOil.toFixed(2)} hrs since last change.${oilDue ? ' <strong class="text-red">Oil change overdue.</strong>' : ''}</p>
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
        // Resolve outer promise if sheet is dismissed via overlay
        sheetPromise.then(() => resolve(true));
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

/* ── Reports View ── */
async function reportsView() {
  if (typeof denyGuest === 'function' && denyGuest()) return;
  const app = document.getElementById('app');
  const ac = await getAircraft();
  const allFlights = await DB.getAll('flights');
  const flights = allFlights.filter(f => f.aircraftId === (ac ? ac.tailNumber : ''));
  const now = new Date();

  // Monthly breakdown per aircraft
  const monthly = {};
  flights.forEach(f => {
    if (!f.flownHours) return;
    const month = (f.flightDate || '').slice(0, 7);
    if (!month) return;
    if (!monthly[month]) monthly[month] = { hours: 0, count: 0, pilotHours: {} };
    monthly[month].hours += f.flownHours;
    monthly[month].count++;
    const pilot = f.pilotName || 'Unknown';
    if (!monthly[month].pilotHours[pilot]) monthly[month].pilotHours[pilot] = 0;
    monthly[month].pilotHours[pilot] += f.flownHours;
  });
  const months = Object.keys(monthly).sort().reverse();

  // Total per pilot
  const pilotTotals = {};
  flights.forEach(f => {
    if (!f.flownHours) return;
    const pilot = f.pilotName || 'Unknown';
    pilotTotals[pilot] = (pilotTotals[pilot] || 0) + f.flownHours;
  });

  // Calendar year totals
  const thisYear = now.getFullYear();
  const yearFlights = flights.filter(f => (f.flightDate || '').startsWith(String(thisYear)));
  const yearHours = yearFlights.reduce((s, f) => s + (f.flownHours || 0), 0);

  let html = `
    <div class="page">
      <div class="page-header">
        <h2>&#128200; Flight Reports</h2>
        <div class="subtitle">${ac ? escHtml(ac.tailNumber) : 'N/A'} &middot; ${escHtml(String(thisYear))} total: ${yearHours.toFixed(2)}h</div>
      </div>
      <div class="report-grid">`;
  const cards = [
    { icon: '&#9992;', label: `${flights.length} Flights` },
    { icon: '&#9201;', label: `${flights.reduce((s,f) => s+(f.flownHours||0),0).toFixed(2)} Total Hrs` },
    { icon: '&#128101;', label: `${Object.keys(pilotTotals).length} Pilots` },
    { icon: '&#128197;', label: `${months.length} Months` }
  ];
  cards.forEach(c => { html += `<div class="report-card"><div class="rc-icon">${c.icon}</div><div class="rc-label">${c.label}</div></div>`; });
  html += `</div>`;

  // Pilot breakdown
  const sortedPilots = Object.entries(pilotTotals).sort((a, b) => b[1] - a[1]);
  html += `<div class="card"><div class="card-header"><h3>&#128101; Pilot Hours</h3></div><div style="padding:4px 16px 12px">`;
  sortedPilots.forEach(([pilot, hrs]) => {
    const pct = Math.min(100, (hrs / (sortedPilots[0][1] || 1)) * 100);
    html += `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span>${escHtml(pilot)}</span><span>${hrs.toFixed(2)}h</span>
        </div>
        <div class="progress-bar" style="height:6px"><div class="progress-fill fill-green" style="width:${pct}%;height:6px"></div></div>
      </div>`;
  });
  html += `</div></div>`;

  // Monthly table
  html += `<div class="card"><div class="card-header"><h3>&#128200; Monthly Hours</h3></div><div style="padding:4px 16px 12px">`;
  months.forEach(m => {
    const d = monthly[m];
    html += `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--glass-border)">
      <span>${m}</span><span>${d.hours.toFixed(2)}h (${d.count} flights)</span>
    </div>`;
  });
  html += `</div></div>`;

  // Certificates section
  html += `<div class="card"><div class="card-header"><h3>&#128196; Certificate Expiry Tracker</h3></div><div style="padding:0 16px"><div id="certs-list"></div>
    <button class="btn btn-sm btn-primary" id="add-cert-btn" style="margin:8px 0">+ Add Certificate</button>
  </div></div>`;

  // Calibration tools section
  html += `<div class="card"><div class="card-header"><h3>&#128295; Calibration Tracker</h3></div><div style="padding:0 16px"><div id="cal-tools-list"></div>
    <button class="btn btn-sm btn-primary" id="add-cal-btn" style="margin:8px 0">+ Add Tool</button>
  </div></div>`;

  html += `</div>`;
  app.innerHTML = html;

  // Render certs and tools
  renderCerts();
  renderCalibrationTools();

  document.getElementById('add-cert-btn').addEventListener('click', () => addCertDialog());
  document.getElementById('add-cal-btn').addEventListener('click', () => addCalToolDialog());
}

async function renderCerts() {
  const el = document.getElementById('certs-list');
  if (!el) return;
  const certs = (await DB.getAll('certificates')).sort((a,b) => (a.expiry||'').localeCompare(b.expiry||''));
  if (certs.length === 0) { el.innerHTML = '<p class="text-muted small" style="padding:8px 0">No certificates tracked</p>'; return; }
  const today = new Date();
  el.innerHTML = certs.map(c => {
    const exp = c.expiry ? new Date(c.expiry) : null;
    const daysLeft = exp ? Math.ceil((exp - today) / 86400000) : null;
    const isExpired = daysLeft !== null && daysLeft <= 0;
    const isSoon = daysLeft !== null && daysLeft > 0 && daysLeft <= 30;
    const statusColor = isExpired ? '#ef4444' : isSoon ? '#f59e0b' : '#22c55e';
    const statusDot = isExpired ? '&#128308;' : isSoon ? '&#128992;' : '&#128994;';
    return `<div class="cert-row">
      <div style="width:32px;text-align:center;font-size:18px">${statusDot}</div>
      <div class="cert-info">
        <div class="cert-name">${escHtml(c.name)}</div>
        <div class="cert-meta">${c.issuer ? escHtml(c.issuer) + ' &middot; ' : ''}Expires: ${c.expiry || '—'} ${daysLeft !== null ? '(' + daysLeft + 'd)' : ''}</div>
      </div>
      <button class="btn btn-sm btn-ghost del-cert-btn" data-id="${c.id}" style="font-size:14px;padding:4px 8px">&times;</button>
    </div>`;
  }).join('');
  document.querySelectorAll('.del-cert-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog('Delete Certificate', 'Remove this certificate?');
      if (!confirmed) return;
      await DB.del('certificates', btn.dataset.id);
      await queueSync('certificates', 'delete', { id: btn.dataset.id });
      renderCerts();
    });
  });
}

async function addCertDialog() {
  const name = await showPromptDialog('Add Certificate', 'Certificate name (e.g. C of A, ARC, ELT Battery, Insurance):');
  if (!name || !name.trim()) return;
  const issuer = await showPromptDialog('Add Certificate', 'Issuer / notes (optional):');
  if (issuer === null) return;
  const expiry = await showPromptDialog('Add Certificate', 'Expiry date (YYYY-MM-DD):');
  if (!expiry || !expiry.trim()) return;
  const cert = { id: 'cert_' + Date.now(), name: name.trim(), issuer: (issuer||'').trim(), expiry: expiry.trim(), createdAt: new Date().toISOString() };
  await DB.put('certificates', cert);
  await queueSync('certificates', 'create', cert);
  showToast('Certificate added');
  renderCerts();
}

async function renderCalibrationTools() {
  const el = document.getElementById('cal-tools-list');
  if (!el) return;
  const tools = (await DB.getAll('calibration_tools')).sort((a,b) => (a.nextDue||'').localeCompare(b.nextDue||''));
  if (tools.length === 0) { el.innerHTML = '<p class="text-muted small" style="padding:8px 0">No calibration tools tracked</p>'; return; }
  const now = new Date();
  el.innerHTML = tools.map(t => {
    const due = t.nextDue ? new Date(t.nextDue) : null;
    const daysLeft = due ? Math.ceil((due - now) / 86400000) : null;
    const isOverdue = daysLeft !== null && daysLeft <= 0;
    const isSoon = daysLeft !== null && daysLeft > 0 && daysLeft <= 30;
    const statusColor = isOverdue ? '#ef4444' : isSoon ? '#f59e0b' : '#22c55e';
    return `<div class="cal-row">
      <div style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0"></div>
      <div class="cal-info">
        <div class="cal-name">${escHtml(t.name)}</div>
        <div class="cal-meta">S/N: ${escHtml(t.serial || '—')} &middot; Last cal: ${t.lastCal || '—'} &middot; Next due: ${t.nextDue || '—'} ${daysLeft !== null ? '(' + daysLeft + 'd)' : ''}</div>
      </div>
      <button class="btn btn-sm btn-ghost del-cal-btn" data-id="${t.id}" style="font-size:14px;padding:4px 8px">&times;</button>
    </div>`;
  }).join('');
  document.querySelectorAll('.del-cal-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog('Delete Tool', 'Remove this calibration tool?');
      if (!confirmed) return;
      await DB.del('calibration_tools', btn.dataset.id);
      await queueSync('calibration_tools', 'delete', { id: btn.dataset.id });
      renderCalibrationTools();
    });
  });
}

async function addCalToolDialog() {
  const name = await showPromptDialog('Add Tool', 'Tool name (e.g. Torque Wrench 1/2"):');
  if (!name || !name.trim()) return;
  const serial = await showPromptDialog('Add Tool', 'Serial number:');
  if (serial === null) return;
  const lastCal = await showPromptDialog('Add Tool', 'Last calibration date (YYYY-MM-DD):');
  if (lastCal === null) return;
  const intervalMonths = await showPromptDialog('Add Tool', 'Calibration interval (months):', '12');
  if (intervalMonths === null) return;
  const months = parseInt(intervalMonths, 10) || 12;
  const nextDue = lastCal.trim() ? new Date(lastCal.trim()).toISOString().slice(0, 10) : '';
  if (nextDue) {
    const d = new Date(nextDue);
    d.setMonth(d.getMonth() + months);
    const tool = { id: 'cal_' + Date.now(), name: name.trim(), serial: (serial||'').trim(), lastCal: lastCal.trim(), nextDue: d.toISOString().slice(0, 10), intervalMonths: months, createdAt: new Date().toISOString() };
    await DB.put('calibration_tools', tool);
    await queueSync('calibration_tools', 'create', tool);
    showToast('Tool added');
    renderCalibrationTools();
  } else {
    const tool = { id: 'cal_' + Date.now(), name: name.trim(), serial: (serial||'').trim(), lastCal: '', nextDue: '', intervalMonths: months, createdAt: new Date().toISOString() };
    await DB.put('calibration_tools', tool);
    await queueSync('calibration_tools', 'create', tool);
    showToast('Tool added');
    renderCalibrationTools();
  }
}

/* ── Swipe gesture helpers ── */
function enableSwipe(el, { onSwipeLeft, onSwipeRight }) {
  let startX = 0, startY = 0;
  el.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0 && onSwipeRight) onSwipeRight();
      else if (dx < 0 && onSwipeLeft) onSwipeLeft();
    }
  }, { passive: true });
}

function navigate(view) {
  if (!_authenticated) return false;
  const role = localStorage.getItem('aac_user_role') || '';
  if (role === 'guest' && view !== 'dashboard' && view !== 'fuel') {
    view = 'dashboard';
  }
  _currentView = view;
  try { localStorage.setItem('aac_last_view', view); } catch(e) {}
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
    case 'dashboard': { const r = dashboardView(); if (r && typeof r.catch === 'function') r.catch(() => {}); } break;
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
    case 'reports': { const r = reportsView(); if (r && typeof r.catch === 'function') r.catch(() => {}); } break;
    case 'settings': settingsView(); break;
  }
  // Show FAB only on flight-ops view
  const fab = document.getElementById('fab');
  if (fab) { fab.classList.toggle('hidden', view !== 'flight-ops'); }
  return false;
}

let _refreshTimer = null;
let _currentView = null;
let _knownNotifIds = new Set();
async function checkNewNotifications() {
  try {
    const notifs = await DB.getAll('notifications');
    for (const n of notifs) {
      if (!n.read && !_knownNotifIds.has(n.id)) {
        _knownNotifIds.add(n.id);
        if (typeof showNotifPopup === 'function') showNotifPopup(n);
      }
      if (n.read) _knownNotifIds.add(n.id);
    }
  } catch (e) {}
}
function onRemoteUpdate() {
  updateNotifBadge();
  checkNewNotifications();
  if (_refreshTimer) return;
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    if (_currentView) refreshView(_currentView);
  }, 500);
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
  }, 250);
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
      <div class="sidebar-insp-item"><span>50hr Inspection</span><span class="${insp.oilClass}">${insp.oilRemaining.toFixed(2)}h</span></div>
      <div class="sidebar-insp-item"><span>100hr Inspection</span><span class="${insp.structClass}">${insp.structRemaining.toFixed(2)}h</span></div>
    `;
  } catch (e) {}
}

/* ── Profile View ── */
function profileView() {
  if (typeof denyGuest === 'function' && denyGuest()) return;
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
        const dataUrl = await compressImage(e.target.result, 240, 240, 0.5);
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
  document.getElementById('profile-logout-btn').addEventListener('click', async () => {
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
  if (typeof denyGuest === 'function' && denyGuest()) return;
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
  window._liveFeedTimer = setInterval(renderLiveFeed, 30000);
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
  if (typeof denyGuest === 'function' && denyGuest()) return;
  const canEdit = hasRole('engineer','production_planner','admin');
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

  document.getElementById('close-ac-btn')?.addEventListener('click', () => { if (typeof window.__sheetClose === 'function') window.__sheetClose(true); });

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
      currentHobbs: 0,
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
    // Refresh the current view so dashboard shows the newly added aircraft
    navigate(document.querySelector('.nav-link.active')?.dataset?.view || 'dashboard');
  });

}

async function showComponentsSheet(ac) {
  const tail = ac.tailNumber;
  const components = (await DB.getAll('components')).filter(c => c.aircraftId === tail);
  showBottomSheet(`
    <div class="card-header"><h3>Components — ${escHtml(tail)}</h3></div>
    <div style="margin-bottom:12px">
      ${components.length === 0 ? '<p class="text-muted small">No components tracked yet. Add one below.</p>' : components.map(c => {
        const tach = ac.totalTachTime || 0;
        const hoursOnComp = tach - (c.installTach || 0);
        const lifePct = c.lifeLimit > 0 ? (hoursOnComp / c.lifeLimit) * 100 : 0;
        const overdue = c.lifeLimit > 0 && hoursOnComp >= c.lifeLimit;
        return `
        <div class="flight-row" style="flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <strong>${escHtml(c.name)}</strong>
            <div class="flight-date">SN: ${escHtml(c.serialNumber || '—')} &middot; PN: ${escHtml(c.partNumber || '—')}</div>
            <div class="flight-date">Installed: ${c.installDate || '—'} @ ${c.installTach ? c.installTach.toFixed(2) + 'h' : '—'} &middot; ${hoursOnComp.toFixed(2)}h used</div>
            ${c.lifeLimit > 0 ? `<div class="progress-bar" style="margin-top:4px;height:6px"><div class="progress-fill ${overdue ? 'fill-red' : lifePct > 80 ? 'fill-orange' : 'fill-green'}" style="width:${Math.min(100, lifePct)}%"></div></div><div style="font-size:10px;color:${overdue ? 'var(--danger)' : 'var(--text-muted)'}">${overdue ? 'OVERDUE' : Math.max(0, c.lifeLimit - hoursOnComp).toFixed(2) + 'h remaining'}</div>` : ''}
          </div>
          <button class="btn btn-sm btn-danger del-comp-btn" data-id="${c.id}" style="margin-top:4px">&times;</button>
        </div>`;
      }).join('')}
    </div>
    <hr>
    <div class="form-group">
      <label>Component Name</label>
      <input type="text" id="comp-name" class="form-input" placeholder="e.g. Battery, Alternator, Spark Plug">
    </div>
    <div class="row">
      <div class="form-group">
        <label>Serial Number</label>
        <input type="text" id="comp-sn" class="form-input" placeholder="SN-12345">
      </div>
      <div class="form-group">
        <label>Part Number</label>
        <input type="text" id="comp-pn" class="form-input" placeholder="RG-24">
      </div>
    </div>
    <div class="row">
      <div class="form-group">
        <label>Install Date</label>
        <input type="date" id="comp-install-date" class="form-input">
      </div>
      <div class="form-group">
        <label>Install Tach (hrs)</label>
        <input type="number" id="comp-install-tach" class="form-input" value="${(ac.totalTachTime || 0).toFixed(2)}" step="0.1">
      </div>
    </div>
    <div class="form-group">
      <label>Life Limit (hours, 0 = unlimited)</label>
      <input type="number" id="comp-life" class="form-input" value="0" min="0" step="10">
    </div>
    <button class="btn btn-primary btn-block" id="add-comp-btn">Add Component</button>
    <button class="btn btn-secondary btn-block" id="close-comp-btn" style="margin-top:8px">Done</button>
  `);

  document.getElementById('add-comp-btn').addEventListener('click', async () => {
    if (typeof denyGuest === 'function' && denyGuest()) return;
    const name = document.getElementById('comp-name').value.trim();
    if (!name) { showToast('Component name required', 'error'); return; }
    const comp = {
      id: 'comp_' + Date.now(),
      aircraftId: tail,
      name,
      serialNumber: document.getElementById('comp-sn').value.trim(),
      partNumber: document.getElementById('comp-pn').value.trim(),
      installDate: document.getElementById('comp-install-date').value,
      installTach: parseFloat(document.getElementById('comp-install-tach').value) || 0,
      lifeLimit: parseFloat(document.getElementById('comp-life').value) || 0,
      createdAt: new Date().toISOString()
    };
    await DB.put('components', comp);
    await queueSync('components', 'create', comp);
    showToast(`Added ${name}`);
    window.__sheetClose(true);
    showComponentsSheet(ac);
  });

  document.getElementById('close-comp-btn').addEventListener('click', () => window.__sheetClose(null));

  document.querySelectorAll('.del-comp-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirmDialog('Delete Component', 'Remove this component?');
      if (!confirmed) return;
      await DB.del('components', btn.dataset.id);
      await queueSync('components', 'delete', { id: btn.dataset.id });
      showToast('Component deleted');
      window.__sheetClose(true);
      showComponentsSheet(ac);
    });
  });
}

async function generateDailyTechLog() {
  const today = new Date().toISOString().slice(0, 10);
  const ac = await getAircraft();
  if (!ac) { showToast('No aircraft selected', 'error'); return; }
  const flights = await DB.getAll('flights');
  const tasks = await DB.getAll('maintenance_tasks');
  const defects = await DB.getAll('defects');
  const parts = await DB.getAll('parts');
  const fuelStocks = await DB.getAll('fuel_stock');

  const todayFlights = flights.filter(f => f.flightDate === today && f.aircraftId === ac.tailNumber);
  const todayTasks = tasks.filter(t => t.createdAt?.slice(0, 10) === today && t.aircraftId === ac.tailNumber);
  const todayDefects = defects.filter(d => (d.createdAt?.slice(0, 10) === today || d.updatedAt?.slice(0, 10) === today) && d.aircraftId === ac.tailNumber);
  const openDefects = defects.filter(d => d.status === 'open' && d.aircraftId === ac.tailNumber);
  const todayHours = todayFlights.reduce((s, f) => s + (f.flownHours || 0), 0);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 196;
  const left = 14;
  const right = 196;
  const col2 = 100;

  function hdr(text, y) { doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text(text, left, y); doc.setFont('helvetica', 'normal'); return y + 7; }
  function row(label, val, y) { doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text(label, left, y); doc.setFont('helvetica', 'normal'); doc.text(String(val), col2, y); return y + 5; }

  // ── Header ──
  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('DAILY TECH LOG', left, 20);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`AAC Technical Services — Ratmalana`, left, 27);
  doc.setDrawColor(0); doc.setLineWidth(0.8);
  doc.line(left, 31, right, 31);

  let y = 40;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Aircraft: ${ac.tailNumber}`, left, y); doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${today}`, col2, y); y += 5;
  doc.text(`Type: ${ac.type || 'Cessna 152'}`, left, y);
  doc.text(`Generated: ${new Date().toLocaleString()}`, col2, y); y += 5;
  doc.setDrawColor(180); doc.setLineWidth(0.3);
  doc.line(left, y + 2, right, y + 2); y += 6;

  // ── Aircraft Status ──
  y = hdr('Aircraft Status', y);
  const hoursSinceOil = (ac.totalTachTime || 0) - (ac.lastOilChangeTach || 0);
  const hoursSince100hr = (ac.totalTachTime || 0) - (ac.last100hrTach || 0);
  const isAirworthy = ac.dailyCrsDate === today && !ac.groundedAfterInspection;
  y = row('Status:', isAirworthy ? 'AIRWORTHY' : 'GROUNDED — CRS PENDING', y);
  y = row('Tach Time:', (ac.totalTachTime || 0).toFixed(2) + ' hrs', y);
  y = row('Hobbs:', (ac.currentHobbs || 0).toFixed(2) + ' hrs', y);
  y = row('50hr Inspection Remaining:', Math.max(0, (ac.oilInterval || 50) - hoursSinceOil).toFixed(2) + ' hrs', y);
  y = row('100hr Inspection Remaining:', Math.max(0, (ac.structInterval || 100) - hoursSince100hr).toFixed(2) + ' hrs', y);
  y = row('Engine TSO:', (ac.engineETSO || 0).toFixed(2) + ' / ' + (ac.engineTBO || 2000) + ' hrs', y);
  y = row('Prop TSO:', (ac.propellerPTSO || 0).toFixed(2) + ' / ' + (ac.propellerTBO || 2000) + ' hrs', y);
  y = row('Daily CRS:', ac.dailyCrsDate === today ? 'Issued by ' + (ac.dailyCrsBy || '—') : 'NOT ISSUED', y);
  y += 2; doc.line(left, y, right, y); y += 5;

  // ── Flight Summary ──
  y = hdr('Flight Summary', y);
  y = row('Total Today:', todayFlights.length + ' flights / ' + todayHours.toFixed(2) + ' hrs', y);
  y += 2;

  if (todayFlights.length > 0) {
    // Table header
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Pilot', left, y); doc.text('Dep', left + 50, y); doc.text('Arr', left + 80, y);
    doc.text('Hrs', left + 105, y); doc.text('Route', left + 125, y); doc.text('Fuel Used', left + 165, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
    doc.setDrawColor(180); doc.line(left, y + 1, right, y + 1); y += 4;

    for (const f of todayFlights) {
      const fuelUsed = ((f.fuelBeforeLeft || 0) + (f.fuelBeforeRight || 0)) - ((f.fuelAfterLeft || 0) + (f.fuelAfterRight || 0));
      doc.text((f.pilotName || '—').slice(0, 14), left, y);
      doc.text(f.takeoffTime || '--', left + 50, y);
      doc.text(f.landingTime || '--', left + 80, y);
      doc.text((f.flownHours || 0).toFixed(2), left + 105, y);
      doc.text((f.route || '—').slice(0, 12), left + 125, y);
      doc.text(fuelUsed.toFixed(2) + ' gal', left + 165, y);
      y += 4;
      if (f.remarks) { doc.setFontSize(7); doc.setTextColor(120); doc.text('    Remarks: ' + f.remarks, left, y); doc.setTextColor(0); doc.setFontSize(8); y += 3; }
    }
  } else {
    doc.setFontSize(8); doc.setTextColor(120); doc.text('No flights recorded today.', left, y); doc.setTextColor(0); y += 4;
  }
  y += 2; doc.setDrawColor(180); doc.line(left, y, right, y); y += 5;

  // ── Open Defects ──
  y = hdr('Open Defects', y);
  if (openDefects.length > 0) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100);
    doc.text('Urgency', left, y); doc.text('Description', left + 35, y); doc.text('Status', left + 155, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
    doc.setDrawColor(180); doc.line(left, y + 1, right, y + 1); y += 4;
    for (const d of openDefects) {
      doc.text(d.urgency || '—', left, y);
      doc.text((d.description || '—').slice(0, 42), left + 35, y);
      doc.text(d.status || '—', left + 155, y);
      y += 4;
    }
  } else {
    doc.setFontSize(8); doc.setTextColor(120); doc.text('No open defects.', left, y); doc.setTextColor(0); y += 4;
  }
  y += 2; doc.line(left, y, right, y); y += 5;

  // ── Maintenance ──
  y = hdr('Maintenance / Work Orders', y);
  if (todayTasks.length > 0) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100);
    doc.text('Status', left, y); doc.text('Description', left + 30, y); doc.text('Rectified By', left + 130, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
    doc.setDrawColor(180); doc.line(left, y + 1, right, y + 1); y += 4;
    for (const t of todayTasks) {
      doc.text((t.status || '—').slice(0, 10), left, y);
      doc.text((t.description || '—').slice(0, 38), left + 30, y);
      doc.text((t.rectifiedBy || t.releasedBy || '—').slice(0, 16), left + 130, y);
      y += 4;
    }
  } else {
    doc.setFontSize(8); doc.setTextColor(120); doc.text('No work orders today.', left, y); doc.setTextColor(0); y += 4;
  }
  y += 2; doc.line(left, y, right, y); y += 5;

  // ── Fuel Status ──
  y = hdr('Fuel Status', y);
  for (const fs of fuelStocks) {
    if (fs.aircraftId && fs.aircraftId !== ac.tailNumber) continue;
    const pct = fs.capacity > 0 ? ((fs.quantityLiters / fs.capacity) * 100).toFixed(0) : '—';
    y = row((fs.name || fs.id || 'Fuel').charAt(0).toUpperCase() + (fs.name || fs.id || 'Fuel').slice(1) + ':', fs.quantityLiters.toFixed(2) + 'L / ' + (fs.capacity || '—') + 'L (' + pct + '%)', y);
  }
  if (fuelStocks.length === 0) { doc.setFontSize(8); doc.setTextColor(120); doc.text('No fuel data.', left, y); doc.setTextColor(0); y += 4; }
  y += 2; doc.line(left, y, right, y); y += 5;

  // ── Low Stock Parts ──
  const lowParts = parts.filter(p => p.quantityOnHand <= p.minSafeStock);
  if (lowParts.length > 0) {
    y = hdr('Low Stock Alerts', y);
    for (const p of lowParts) {
      y = row(p.partNumber || p.name || 'Part' + ':', p.quantityOnHand + ' remaining (min ' + p.minSafeStock + ')', y);
    }
    y += 2; doc.line(left, y, right, y); y += 5;
  }

  // ── CRS / Sign-off ──
  y = hdr('Certificate of Release to Service', y);
  doc.setFontSize(9);
  doc.text('I hereby certify that the above aircraft has been inspected and is', left, y); y += 4;
  doc.text('serviceable in accordance with current maintenance procedures.', left, y); y += 6;
  doc.setDrawColor(0); doc.setLineWidth(0.5);
  doc.line(left, y, left + 80, y); y += 7;
  doc.text('Engineer Signature & Date', left, y);

  doc.save(`tech-log-${ac.tailNumber}-${today}.pdf`);
  showToast('Daily tech log PDF generated');
  window.__sheetClose(true);
}

async function renderACListSheet() {
  const all = await getAllAircraft();
  const current = getCurrentAircraftKey();
  const canEdit = hasRole('engineer','production_planner','admin');
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
          <span>Engine TSO: ${(ac.engineETSO || 0).toFixed(2)}h</span>
          <span>Prop TSO: ${(ac.propellerPTSO || 0).toFixed(2)}h</span>
        </div>` : ''}
        ${canEdit ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-ghost edit-ac-btn" data-tail="${ac.tailNumber}" style="font-size:9px;padding:4px 8px">Edit</button>
          <button class="btn btn-ghost change-photo-btn" data-tail="${ac.tailNumber}" style="font-size:9px;padding:4px 8px">Photo</button>
          <button class="btn btn-ghost comp-btn" data-tail="${ac.tailNumber}" style="font-size:9px;padding:4px 8px">Components</button>
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
  el.querySelectorAll('.comp-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ac = await DB.get('aircraft', btn.dataset.tail);
      if (!ac) return;
      showComponentsSheet(ac);
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
      }
      showToast(`Deleted ${tail}`);
      populateACSelector();
      renderACListSheet();
      navigate(document.querySelector('.nav-link.active')?.dataset?.view || 'dashboard');
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
      navigate(document.querySelector('.nav-link.active')?.dataset?.view || 'dashboard');
    });
    document.getElementById('cancel-edit-ac-btn').addEventListener('click', () => {
      window.__sheetClose(true);
      showAircraftSheet();
    });
  }
}

async function clearAllData() {
  const stores = ['flights','aircraft','defects','fuel_logs','fuel_stock','maintenance_tasks','parts','sync_queue','users','attendance','notifications','comments','components','calibration_tools','certificates','activity_log'];
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
  localStorage.removeItem('aac_pilots');
  // Also clear InsForge sync_docs
  if (typeof InsForge !== 'undefined' && InsForge.insforge) {
    try {
      const { data } = await InsForge.insforge.database.from('sync_docs').select('collection, id');
      if (data && data.length > 0) {
        for (const doc of data) {
          await InsForge.insforge.database.from('sync_docs').update({ _deleted: true, _updated_at: Date.now() }).eq('collection', doc.collection).eq('id', doc.id);
        }
      }
    } catch (e) { /* ignore */ }
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

function settingsView() {
  if (typeof denyGuest === 'function' && denyGuest()) return;
  const app = document.getElementById('app');
  const role = localStorage.getItem('aac_user_role');
  const name = localStorage.getItem('aac_user');
  const roleLabel = role ? role.replace(/_/g, ' ') : '—';

  const common = (r, label, items) => {
    const out = [`<div class="card"><div class="card-header"><h3>${label} — User Guide</h3></div><div style="padding:4px 16px 16px"><div class="text-muted small" style="margin-bottom:10px">How to use AACTS for your role:</div>`];
    items.forEach(item => {
      out.push(`<div style="margin-bottom:10px"><strong style="font-size:13px">${item.h}</strong>`);
      if (item.t) out.push(`<div style="font-size:12px;color:var(--text-muted);margin-top:2px;line-height:1.6">${item.t}</div>`);
      if (item.l) {
        out.push(`<ul style="margin:4px 0 0;padding-left:16px;font-size:12px;color:var(--text-muted);line-height:1.7">`);
        item.l.forEach(li => out.push(`<li>${li}</li>`));
        out.push(`</ul>`);
      }
      out.push(`</div>`);
    });
    if (r === 'engineer' || r === 'admin' || r === 'production_planner') {
      out.push(`<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted);line-height:1.6"><strong>Note:</strong> Aircraft selector in the top-right header lets you switch between aircraft. The dashboard and all views update to show data for the selected aircraft.</div>`);
    }
    if (r === 'production_planner') {
      out.push(`<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);font-size:12px;color:var(--danger);line-height:1.6"><strong>Important:</strong> Production Planner CANNOT issue CRS. Only Engineer and Admin can release tasks to service.</div>`);
    }
    out.push(`</div></div>`);
    return out.join('');
  };

  const guideHTML = {
    admin: common('admin', 'Admin', [
      { h: 'Dashboard', t: 'Your home screen. View aircraft status (Airworthy/Grounded), inspection countdowns, open tasks, low stock alerts, and fuel status. Tap the Issue Daily CRS button to make the aircraft airworthy for the day.' },
      { h: 'Fleet Manager', t: 'Sidebar → Fleet Manager. Add new aircraft (tail number, type, TBO limits), edit existing ones, upload photos, set a default aircraft, or delete aircraft.' },
      { h: 'Log Flights', t: 'Bottom nav → Log Flights or sidebar. Tap + New Flight to record a sortie. Enter pilot name, tach start/end, route, remarks, and fuel gauges. Flight time auto-calculates. ETSO/PTSO increment automatically. After-flight inspection auto-created. Delete a flight by tapping × — ETSO/PTSO are rolled back.' },
      { h: 'Defects (Squawks)', t: 'Bottom nav → Mx/Defects → Defects tab. Tap + Report Squawk to log a defect. Set urgency: Grounding (grounds aircraft) or Normal. Resolve defects by tapping Resolve. Delete any defect with ×.' },
      { h: 'Mx / Sign-offs', t: 'Bottom nav → Mx/Defects → Work tab. View all maintenance tasks. Sign off 50hr/100hr inspections, after-flight inspections, and work orders. Issue CRS to release tasks to service. Overhaul engine or propeller to reset TSO counters.' },
      { h: 'Parts', t: 'Bottom nav → Parts or sidebar. Add new parts, adjust quantities with +/- buttons, tap number to type directly, delete parts. Red text = below minimum stock.' },
      { h: 'Fuel Ops', t: 'Sidebar or bottom nav → Fuel. Record fuel deliveries, view fuel stock levels (Avgas 100LL, Mogas, Mix). Fuel auto-deducted by flight logging.' },
      { h: 'Crew', t: 'Sidebar → Crew. View all users with today\'s attendance status. Approve or reject pending sign-ins.' },
      { h: 'Live Feed', t: 'Sidebar → Live Feed. Real-time view of airborne flights (pulsing dot with ETA), on-duty crew with avatars, and today\'s activity timeline. Auto-refreshes every 15 seconds.' },
      { h: 'Logbook', t: 'Sidebar → Logbook. Browse all records by date: flights, defects, maintenance, fuel, attendance in a single timeline.' },
      { h: 'Export / Tech Log', t: 'Sidebar → Export / Tech Log. Select date range, aircraft, and data types to include. Generate a PDF report or a Daily Tech Log Summary PDF.' },
      { h: 'Settings', t: 'Sidebar → Settings. Change your PIN, toggle dark/light theme, view this guide, or factory reset (Admin only — deletes ALL data).' }
    ]),
    engineer: common('engineer', 'Engineer', [
      { h: 'Dashboard', t: 'Your home screen. Check aircraft status and inspection countdowns. Tap Issue Daily CRS each day to make the aircraft airworthy. View open tasks, low stock, and fuel status.' },
      { h: 'Fleet Manager', t: 'Sidebar → Fleet Manager. Add new aircraft (tail number, type, TBO limits). Edit existing aircraft, upload photos, set default aircraft, or delete aircraft.' },
      { h: 'Defects (Squawks)', t: 'Bottom nav → Mx/Defects → Defects tab. Report squawks with Grounding or Normal urgency. Resolve defects by entering resolution notes. Delete defects with ×.' },
      { h: 'Mx / Sign-offs', t: 'Bottom nav → Mx/Defects → Work tab. Sign off maintenance tasks (50hr, 100hr, after-flight inspections). Issue CRS to release tasks to service. Overhaul engine/propeller to reset TSO. Rectify work orders with repair notes.' },
      { h: 'Log Flights', t: 'Bottom nav → Log Flights. Record flights with pilot, tach times, route, and fuel data. Delete flights when needed.' },
      { h: 'Parts', t: 'Bottom nav → Parts. Add parts, adjust stock levels, set minimum quantities.' },
      { h: 'Fuel Ops', t: 'Sidebar → Fuel Ops. Record fuel deliveries, monitor stock levels.' },
      { h: 'Crew', t: 'Sidebar → Crew. Approve or reject crew attendance requests.' },
      { h: 'Export / Tech Log', t: 'Sidebar → Export / Tech Log. Generate PDF reports and Daily Tech Log summaries for record-keeping.' }
    ]),
    production_planner: common('production_planner', 'Production Planner', [
      { h: 'Fleet Manager', t: 'Sidebar → Fleet Manager. Add, edit, and delete aircraft. Manage fleet records and set default aircraft.' },
      { h: 'Log Flights', t: 'Bottom nav → Log Flights. Record flights and delete them when needed.' },
      { h: 'Mx / Sign-offs', t: 'Bottom nav → Mx/Defects → Work tab. Create work orders and sign off tasks. Note: you CANNOT issue CRS — only Engineer and Admin can release tasks to service.' },
      { h: 'Defects', t: 'Report defects and track open squawks.' },
      { h: 'Parts', t: 'Manage parts inventory and stock levels.' },
      { h: 'Fuel Ops', t: 'Record deliveries and monitor fuel stock.' },
      { h: 'Crew', t: 'Approve or reject attendance requests.' },
      { h: 'Export', t: 'Generate PDF reports and tech logs.' }
    ]),
    senior_technician: common('senior_technician', 'Senior Technician', [
      { h: 'Log Flights', t: 'Bottom nav → Log Flights. Record flights with pilot, tach times, route, and fuel data.' },
      { h: 'Defects', t: 'Bottom nav → Mx/Defects → Defects tab. Report and resolve squawks.' },
      { h: 'Mx / Sign-offs', t: 'Bottom nav → Mx/Defects → Work tab. Sign off after-flight inspections and rectification tasks.' },
      { h: 'Parts', t: 'Bottom nav → Parts. View and manage inventory, adjust stock levels.' },
      { h: 'Crew', t: 'Sidebar → Crew. Approve or reject attendance requests.' },
      { h: 'Dashboard', t: 'View fleet status, inspection intervals, and alerts.' }
    ]),
    technician: common('technician', 'Technician', [
      { h: 'Log Flights', t: 'Bottom nav → Log Flights. Record flights: enter pilot name, tach start/end times, route, remarks, and wing fuel readings. Flight time and fuel consumption auto-calculate.' },
      { h: 'Defects', t: 'Bottom nav → Mx/Defects → Defects tab. Tap + Report Squawk to log a defect with description and urgency.' },
      { h: 'Parts', t: 'Bottom nav → Parts. View and manage inventory. Add parts, adjust stock with +/- buttons, or tap the number to type directly.' },
      { h: 'Dashboard', t: 'View the aircraft status, inspection countdowns, open tasks, and alerts.' },
      { h: 'Mx / Sign-offs', t: 'Bottom nav → Mx/Defects → Work tab. View maintenance tasks assigned to the current aircraft.' }
    ]),
    pilot: common('pilot', 'Pilot', [
      { h: 'Log Flights', t: 'Bottom nav → Log Flights. Tap + New Flight. Enter pilot name, tach start/end, takeoff/landing times, route, and wing fuel before/after. Fuel used and consumption auto-calculate. Save to record the flight — ETSO/PTSO and intervals update automatically.' },
      { h: 'Defects', t: 'Bottom nav → Mx/Defects → Defects tab. Report squawks if you find any issues during pre-flight or after flight.' },
      { h: 'Dashboard', t: 'View the current aircraft status, inspection intervals remaining, and any alerts or grounding notices.' },
      { h: 'Fuel Ops', t: 'View fuel stock levels before flight.' }
    ]),
    guest: common('guest', 'Guest', [
      { h: 'Dashboard', t: 'View aircraft status, inspection intervals, open tasks, and alerts. Read-only.' },
      { h: 'Log Flights', t: 'View flight history and details. Cannot create or edit flights.' },
      { h: 'Defects', t: 'View open and resolved defects. Cannot report or resolve.' },
      { h: 'Mx / Sign-offs', t: 'View maintenance tasks and their status. Cannot sign off.' },
      { h: 'Parts', t: 'View parts inventory and stock levels. Cannot add or edit.' },
      { h: 'Fuel Ops', t: 'View fuel stock levels and delivery history.' },
      { h: 'Crew', t: 'View attendance records.' }
    ])
  };

  const guide = guideHTML[role] || guideHTML.guest;

  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Settings</h2>
        <div class="subtitle">${escHtml(name || '')} — ${roleLabel}</div>
      </div>

      ${guide}

      <div class="card">
        <div class="card-header"><h3>Security</h3></div>
        <div style="padding:12px 16px">
          ${role !== 'guest' ? `
          <p class="text-muted small" style="margin-bottom:8px">Your PIN is required to sign in. Default PIN is 1234 — change it below.</p>
          <button class="btn btn-primary btn-block" id="settings-change-pin">Change PIN</button>
          ` : '<p class="text-muted small">Guest users sign in without a PIN.</p>'}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Pilot Management</h3></div>
        <div style="padding:12px 16px" id="pilot-management">
          <p class="text-muted small" style="margin-bottom:8px">Manage the pilot list used in flight logging. These are separate from login users — only names added here appear in the pilot dropdown.</p>
          <div id="pilot-list"></div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input type="text" id="new-pilot-name" class="form-input" placeholder="Enter pilot name" style="flex:1">
            <button class="btn btn-primary" id="add-pilot-btn">Add</button>
          </div>
        </div>
      </div>

      ${role === 'admin' ? `
      <div class="card">
        <div class="card-header"><h3>User Management</h3></div>
        <div style="padding:12px 16px" id="user-management">
          <p class="text-muted small" style="margin-bottom:8px">Add or remove login users. Each user appears on the login screen with their role. Default PIN for new users is 1234.</p>
          <div id="user-list"></div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input type="text" id="new-user-name" class="form-input" placeholder="Full name" style="flex:1">
            <select id="new-user-role" class="form-input" style="flex-shrink:0;max-width:110px;font-size:12px">
              <option value="admin">Admin</option>
              <option value="engineer">Engineer</option>
              <option value="production_planner">Prod Planner</option>
              <option value="senior_technician">Sr Tech</option>
              <option value="technician">Technician</option>
              <option value="pilot">Pilot</option>
              <option value="guest">Guest</option>
            </select>
            <button class="btn btn-primary" id="add-user-btn">Add</button>
          </div>
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-header"><h3>Appearance</h3></div>
        <div style="padding:12px 16px">
          <button class="btn btn-secondary btn-block" id="settings-toggle-theme">Toggle Dark/Light Theme</button>
        </div>
      </div>

      ${role === 'admin' ? `
      <div class="card" style="border-color:var(--danger)">
        <div class="card-header"><h3 style="color:var(--danger)">Danger Zone</h3></div>
        <div style="padding:12px 16px">
          <p class="text-muted small" style="margin-bottom:8px">Factory reset deletes ALL data — aircraft, flights, defects, parts, fuel, users, and attendance. This cannot be undone.</p>
          <button class="btn btn-danger btn-block" id="settings-factory-reset">&#128260; Factory Reset All Data</button>
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-header"><h3>About</h3></div>
        <div style="padding:12px 16px">
          <p class="text-muted small">AAC Technical Services v1.0</p>
          <p class="text-muted small">Offline-ready PWA for flight school maintenance, flight logging, and inventory management.</p>
        </div>
      </div>
    </div>`;

  const pinBtn = document.getElementById('settings-change-pin');
  if (pinBtn) {
    pinBtn.addEventListener('click', async () => {
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
  }

  document.getElementById('settings-toggle-theme').addEventListener('click', () => {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    if (isLight) {
      html.removeAttribute('data-theme');
      localStorage.setItem('aac_theme', 'dark');
    } else {
      html.setAttribute('data-theme', 'light');
      localStorage.setItem('aac_theme', 'light');
    }
    document.getElementById('sidebar-theme-toggle').innerHTML = isLight ? '&#127769;' : '&#127774;';
    showToast(isLight ? 'Dark mode' : 'Light mode');
  });

  const resetBtn = document.getElementById('settings-factory-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (typeof denyGuest === 'function' && denyGuest()) return;
      const role = localStorage.getItem('aac_user_role');
      if (role !== 'admin') { showToast('Only Admin can reset all data', 'error'); return; }
      const confirmed = await showConfirmDialog('Factory Reset', 'This will delete ALL data including aircraft, sorties, defects, parts, and fuel. Are you sure?');
      if (confirmed) await clearAllData();
    });
  }

  renderPilotList();
  document.getElementById('add-pilot-btn').addEventListener('click', addPilot);
  document.getElementById('new-pilot-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addPilot();
  });

  const addUserBtn = document.getElementById('add-user-btn');
  if (addUserBtn) {
    renderUserList();
    addUserBtn.addEventListener('click', addLoginUser);
    document.getElementById('new-user-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') addLoginUser();
    });
  }
}

function getLoginUsers() {
  try { return JSON.parse(localStorage.getItem('aac_users')) || []; } catch(e) { return []; }
}

function saveLoginUsers(list) {
  localStorage.setItem('aac_users', JSON.stringify(list));
}

function renderUserList() {
  const el = document.getElementById('user-list');
  if (!el) return;
  const users = getLoginUsers();
  const currentUser = localStorage.getItem('aac_user');
  if (users.length === 0) {
    el.innerHTML = '<div class="text-muted small" style="padding:4px 0">No users yet.</div>';
    return;
  }
  el.innerHTML = users.map((u, i) =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <span style="font-size:13px;font-weight:600">${escHtml(u.name)}</span>
        <span class="badge" style="font-size:10px;margin-left:6px;background:var(--surface);color:var(--text-muted)">${u.role.replace(/_/g, ' ')}</span>
        ${u.name === currentUser ? ' <span class="badge badge-released" style="font-size:9px">You</span>' : ''}
      </div>
      ${u.name !== currentUser ? `<button class="btn btn-small btn-danger del-user-btn" data-index="${i}" style="padding:2px 8px;font-size:11px">×</button>` : ''}
    </div>`
  ).join('');
  el.querySelectorAll('.del-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const users = getLoginUsers();
      const idx = parseInt(btn.dataset.index);
      const name = users[idx].name;
      const confirmed = await showConfirmDialog('Remove User', `Remove "${name}" from the login list?`);
      if (!confirmed) return;
      // Remove from aac_users
      users.splice(idx, 1);
      saveLoginUsers(users);
      // Also remove from DB users
      const dbUsers = await DB.getAll('users');
      for (const du of dbUsers) {
        if (du.name === name) { await DB.del('users', du.id); await queueSync('users', 'delete', { id: du.id }); }
      }
      renderUserList();
    });
  });
}

async function addLoginUser() {
  const nameInput = document.getElementById('new-user-name');
  const roleSel = document.getElementById('new-user-role');
  const name = nameInput.value.trim();
  const role = roleSel.value;
  if (!name) { showToast('Enter a name', 'error'); return; }
  const users = getLoginUsers();
  if (users.some(u => u.name === name)) { showToast('User already exists', 'error'); return; }
  users.push({ name, role });
  saveLoginUsers(users);
  // Sync to DB users store for crew board
  const id = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  await DB.put('users', { id, name, role, photo: '', createdAt: new Date().toISOString() });
  await queueSync('users', 'create', { id, name, role, photo: '', createdAt: new Date().toISOString() });
  // Seed their PIN
  let userPins = {};
  try { userPins = JSON.parse(localStorage.getItem('aac_user_pins')) || {}; } catch(e) {}
  userPins[name] = '1234';
  localStorage.setItem('aac_user_pins', JSON.stringify(userPins));
  nameInput.value = '';
  renderUserList();
  showToast(`User "${name}" added as ${role.replace(/_/g, ' ')}`);
}

function getPilots() {
  try { return JSON.parse(localStorage.getItem('aac_pilots')) || []; } catch(e) { return []; }
}

function savePilots(list) {
  localStorage.setItem('aac_pilots', JSON.stringify(list));
}

function renderPilotList() {
  const el = document.getElementById('pilot-list');
  if (!el) return;
  const pilots = getPilots();
  if (pilots.length === 0) {
    el.innerHTML = '<div class="text-muted small" style="padding:4px 0">No pilots added yet.</div>';
    return;
  }
  el.innerHTML = pilots.map((p, i) =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px">${escHtml(p)}</span>
      <button class="btn btn-small btn-danger" data-index="${i}" style="padding:2px 8px;font-size:11px">×</button>
    </div>`
  ).join('');
  el.querySelectorAll('[data-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pilots = getPilots();
      const idx = parseInt(btn.dataset.index);
      const name = pilots[idx];
      pilots.splice(idx, 1);
      savePilots(pilots);
      // Remove from Firestore sync
      DB.del('pilots', 'pilot_' + name).catch(() => {});
      if (typeof queueSync === 'function') queueSync('pilots', 'delete', { id: 'pilot_' + name });
      renderPilotList();
    });
  });
}

function addPilot() {
  const input = document.getElementById('new-pilot-name');
  const name = input.value.trim();
  if (!name) { showToast('Enter a pilot name', 'error'); return; }
  const pilots = getPilots();
  if (pilots.includes(name)) { showToast('Pilot already exists', 'error'); return; }
  pilots.push(name);
  savePilots(pilots);
  // Sync to Firestore via IndexedDB
  const doc = { id: 'pilot_' + name, name };
  DB.put('pilots', doc).catch(() => {});
  if (typeof queueSync === 'function') queueSync('pilots', 'create', doc);
  input.value = '';
  renderPilotList();
  showToast(`Pilot "${name}" added`);
}

function showLoginGate() {
  const app = document.getElementById('app');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  document.getElementById('hamburger-btn').style.display = 'none';
  document.querySelector('.app-header').style.display = 'none';
  document.querySelector('.bottom-nav').style.display = 'none';

  const users = getLoginUsers();

  app.innerHTML = `
    <div class="page" style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px">
      <div style="max-width:400px;width:100%">
        <div style="text-align:center;margin-bottom:24px">
          <img src="img/logo.jpg" alt="AACTS" style="width:80px;height:80px;border-radius:50%;margin-bottom:8px;object-fit:cover;border:2px solid var(--glass-border);box-shadow:0 0 30px var(--accent-glow)">
          <h1 style="font-family:var(--dot);font-size:22px;margin:0">AAC Technical Services</h1>
          <p class="text-muted" style="margin-top:4px">Sign in to continue</p>
        </div>
        <div class="card" style="padding:20px">
          <div id="login-error" class="text-red small" style="display:none;margin-bottom:8px"></div>
          <div class="form-group">
            <label>Username</label>
            <select id="login-username" class="form-input">
              <option value="">Select user...</option>
              ${users.map(u => `<option value="${escHtml(u.name)}" data-role="${escHtml(u.role)}">${escHtml(u.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="login-pin-group">
            <label>PIN</label>
            <input type="password" id="login-pin" class="form-input" placeholder="Enter PIN" autocomplete="off">
          </div>
          <button class="btn btn-primary btn-block" id="login-signin-btn">Sign In</button>
          <button class="btn btn-secondary btn-block" id="login-guest-btn" style="margin-top:8px">Continue as Guest</button>
        </div>
      </div>
    </div>
  `;

  const usernameSel = document.getElementById('login-username');
  const pinGroup = document.getElementById('login-pin-group');
  usernameSel.addEventListener('change', () => {
    const opt = usernameSel.selectedOptions[0];
    if (opt && opt.dataset.role === 'guest') {
      pinGroup.style.display = 'none';
    } else {
      pinGroup.style.display = '';
    }
  });

  document.getElementById('login-signin-btn').addEventListener('click', async () => {
    const name = document.getElementById('login-username').value;
    if (!name) { showToast('Select a user', 'error'); return; }
    const userPins = JSON.parse(localStorage.getItem('aac_user_pins') || '{}');
    const pin = document.getElementById('login-pin').value;
    const expected = userPins[name] || '1234';
    if (pin !== expected) { showToast('Incorrect PIN', 'error'); return; }
    const user = getLoginUsers().find(u => u.name === name);
    const role = user ? user.role : 'technician';
    localStorage.setItem('aac_user', name);
    localStorage.setItem('aac_user_role', role);
    localStorage.setItem('aac_user_id', 'user_' + Date.now());
    if (sidebar) sidebar.style.display = '';
    if (overlay) overlay.style.display = '';
    document.getElementById('hamburger-btn').style.display = '';
    document.querySelector('.app-header').style.display = '';
    document.querySelector('.bottom-nav').style.display = '';
    updateSidebarUser();
    await initAppData();
    navigate('dashboard');
    checkInspectionNotifications();
    scheduleEndOfDayCheck();
  });

  document.getElementById('login-guest-btn').addEventListener('click', () => {
    localStorage.setItem('aac_user', 'Guest');
    localStorage.setItem('aac_user_role', 'guest');
    localStorage.setItem('aac_user_id', 'user_guest');
    if (sidebar) sidebar.style.display = '';
    if (overlay) overlay.style.display = '';
    document.getElementById('hamburger-btn').style.display = '';
    document.querySelector('.app-header').style.display = '';
    document.querySelector('.bottom-nav').style.display = '';
    updateSidebarUser();
    initAppData().then(() => {
    navigate('dashboard');
    checkInspectionNotifications();
    scheduleEndOfDayCheck();
    });
  });
}

let _authenticated = false;

function startHeaderClock() {
  const el = document.getElementById('header-clock');
  if (!el) return;
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  tick();
  setInterval(tick, 1000);
}

async function initAppData() {
  if (_authenticated) return;
  _authenticated = true;

  initSync();

  try {
    const allFlights = await DB.getAll('flights');
    for (const f of allFlights) {
      if (!f.aircraftId && f.id && f.id.startsWith('act_')) {
        await DB.del('flights', f.id);
      }
    }
  } catch (e) { /* skip */ }

  if (typeof restoreArrivalReminders === 'function') restoreArrivalReminders();
  if (typeof restoreFlightProgressBars === 'function') restoreFlightProgressBars();

  try { await populateACSelector(); } catch (e) { /* ok */ }

  try {
    const syncedPilots = await DB.getAll('pilots');
    if (syncedPilots && syncedPilots.length > 0) {
      const localPilots = JSON.parse(localStorage.getItem('aac_pilots') || '[]');
      const merged = [...new Set([...localPilots, ...syncedPilots.map(p => p.name)])];
      localStorage.setItem('aac_pilots', JSON.stringify(merged));
    }
  } catch(e) {}

  try {
    const seedUsers = JSON.parse(localStorage.getItem('aac_users') || '[]');
    const existingDbUsers = await DB.getAll('users');
    const existingNames = new Set(existingDbUsers.map(u => u.name));
    for (const su of seedUsers) {
      if (!existingNames.has(su.name)) {
        const id = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        await DB.put('users', { id, name: su.name, role: su.role, photo: '', createdAt: new Date().toISOString() });
      }
    }
  } catch (e) { /* skip user sync — non-critical */ }

}

document.addEventListener('DOMContentLoaded', async () => {
  try {
  // Apply saved theme
  const savedTheme = localStorage.getItem('aac_theme');
  const isLight = savedTheme === 'light';
  if (isLight) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  // Set sidebar theme toggle icon
  const themeToggle = document.getElementById('sidebar-theme-toggle');
  if (themeToggle) themeToggle.innerHTML = isLight ? '&#127774;' : '&#127769;';

  // Seed known notification IDs
  try {
    const notifs = await DB.getAll('notifications');
    for (const n of notifs) _knownNotifIds.add(n.id);
  } catch (e) {}

  startHeaderClock();

  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.register('sw.js');
    reg.update();
    setInterval(() => reg.update(), 300000);
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (newSW) {
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Update available — reload to apply', 'warning');
          }
        });
      }
    });
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  window.addEventListener('online', () => {
    document.getElementById('offline-banner')?.classList.add('hidden');
  });
  window.addEventListener('offline', () => {
    document.getElementById('offline-banner')?.classList.remove('hidden');
  });
  if (!navigator.onLine) {
    document.getElementById('offline-banner')?.classList.remove('hidden');
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

  if (!localStorage.getItem('aac_user_pins')) {
    const pins = {};
    let users = [];
    try { users = JSON.parse(localStorage.getItem('aac_users')) || []; } catch(e) {}
    users.forEach(u => { pins[u.name] = '1234'; });
    localStorage.setItem('aac_user_pins', JSON.stringify(pins));
  }

  if (!localStorage.getItem('aac_pilots')) {
    localStorage.setItem('aac_pilots', JSON.stringify([]));
  }

  document.getElementById('ac-photo-input').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    const tail = this.dataset.targetTail;
    if (!tail) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
      const ac = await DB.get('aircraft', tail);
      if (!ac) return;
      ac.photoData = await compressImage(e.target.result, 320, 240, 0.5);
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
  document.getElementById('sidebar-logout-btn').addEventListener('click', e => {
    e.stopPropagation();
    localStorage.removeItem('aac_user');
    localStorage.removeItem('aac_user_role');
    localStorage.removeItem('aac_user_photo');
    localStorage.removeItem('aac_user_id');
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('sidebar-overlay').style.display = 'none';
    document.getElementById('hamburger-btn').style.display = 'none';
    showLoginGate();
  });
  document.getElementById('sidebar-user').addEventListener('click', e => {
    e.preventDefault();
    closeSidebar();
    navigate('profile');
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
  document.getElementById('fab')?.addEventListener('click', () => {
    haptic();
    navigate('flight-ops');
  });

  // Haptic on nav clicks only (avoid global listener overhead)
  document.getElementById('sidebar').addEventListener('click', e => {
    if (e.target.closest('.sidebar-link, .sidebar-theme-toggle')) haptic();
  });
  document.querySelector('.bottom-nav')?.addEventListener('click', e => {
    if (e.target.closest('.nav-link')) haptic();
  });

  initPullToRefresh();

  const savedUser = localStorage.getItem('aac_user');
  const savedRole = localStorage.getItem('aac_user_role');
  if (savedUser && savedRole) {
    document.querySelector('.app-header').style.display = '';
    document.querySelector('.bottom-nav').style.display = '';
    document.getElementById('hamburger-btn').style.display = '';
    document.getElementById('sidebar').style.display = '';
    document.getElementById('sidebar-overlay').style.display = '';
    updateSidebarUser();
    await initAppData();
    const lastView = localStorage.getItem('aac_last_view') || 'dashboard';
    navigate(lastView);
    scheduleEndOfDayCheck();
    checkInspectionNotifications();
  } else {
    showLoginGate();
  }
  const ls = document.getElementById('loading-screen');
  } catch (e) {
    console.warn('App init error — showing fallback UI', e);
    const app = document.getElementById('app');
    if (app && !app.innerHTML.trim()) {
      app.innerHTML = '<div class="page"><div class="card" style="padding:20px;text-align:center"><h3>App load error</h3><p class="text-muted" style="margin-top:8px">Please refresh or clear site data and try again.</p><button class="btn btn-primary btn-block" style="margin-top:16px" onclick="location.reload()">Reload</button></div></div>';
    }
  }
  const ls = document.getElementById('loading-screen');
  if (ls) { ls.style.opacity = '0'; ls.style.visibility = 'hidden'; setTimeout(() => ls.remove(), 500); }
});
// Safety: hide loading screen after 8s no matter what
setTimeout(() => {
  const ls = document.getElementById('loading-screen');
  if (ls) { ls.style.opacity = '0'; ls.style.visibility = 'hidden'; setTimeout(() => ls.remove(), 500); }
}, 8000);

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

      // Per-collection field whitelists for clean export
      const exportFields = {
        aircraft: ['tailNumber', 'type', 'totalTachTime', 'currentHobbs', 'engineETSO', 'propellerPTSO', 'engineTBO', 'propellerTBO', 'oilInterval', 'structInterval', 'lastOilChangeTach', 'last100hrTach', 'dailyCrsDate', 'dailyCrsBy'],
        flights: ['flightDate', 'pilotName', 'takeoffTime', 'landingTime', 'flownHours', 'tachStart', 'tachEnd', 'route', 'remarks', 'fuelBeforeLeft', 'fuelBeforeRight', 'fuelAfterLeft', 'fuelAfterRight', 'fuelConsumed', 'status', 'aircraftId'],
        defects: ['description', 'urgency', 'status', 'createdAt', 'resolvedAt', 'resolvedBy', 'resolution', 'aircraftId'],
        maintenance_tasks: ['description', 'type', 'priority', 'status', 'assignedTo', 'technicianNotes', 'rectifiedBy', 'rectifiedAt', 'releasedBy', 'releasedAt', 'createdAt', 'aircraftId'],
        fuel_stock: ['name', 'quantityLiters', 'capacity', 'minSafeLevel', 'fuelType'],
        fuel_logs: ['date', 'fuelType', 'quantityLiters', 'supplier', 'cost', 'notes', 'aircraftId'],
        parts: ['partNumber', 'name', 'quantityOnHand', 'minSafeStock', 'location'],
        users: ['name', 'role'],
        attendance: ['userName', 'role', 'date', 'checkinTime', 'checkoutTime', 'status'],
        components: ['name', 'serialNumber', 'partNumber', 'installDate', 'installTach', 'lifeLimit', 'aircraftId']
      };

      const sorted = [...items].sort((a, b) => {
        const ka = a.flightDate || a.date || a.tailNumber || a.partNumber || a.name || '';
        const kb = b.flightDate || b.date || b.tailNumber || b.partNumber || b.name || '';
        return kb.toString().localeCompare(ka.toString()) || a.id?.localeCompare(b.id);
      });

      let keys = exportFields[name] || Object.keys(sorted[0]).filter(k => !k.startsWith('_') && k !== 'photoData' && k !== 'id' && k !== 'createdAt');
      keys = keys.filter(k => sorted[0].hasOwnProperty(k));
      const headers = keys.map(k => k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()));
      const rows = sorted.map(item => keys.map(k => {
        const v = item[k];
        if (v === null || v === undefined) return '';
        if (Array.isArray(v)) return v.join(', ');
        if (typeof v === 'object') return '';
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
  document.getElementById('export-tech-log-btn').addEventListener('click', () => generateDailyTechLog());
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
