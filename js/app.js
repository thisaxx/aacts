function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
  const cls = mini ? 'stepper stepper-mini' : 'stepper';
  return `<div class="${cls}" data-stepper-id="${id}" data-min="${min}" data-max="${max}" data-step="${step}">
    <button class="stepper-btn stepper-dec">-</button>
    <span class="stepper-value" id="${id}" contenteditable="true">${value}</span>
    <button class="stepper-btn stepper-inc">+</button>
  </div>`;
}

function initSteppers() {
  document.querySelectorAll('.stepper').forEach(el => {
    const min = parseFloat(el.dataset.min);
    const max = parseFloat(el.dataset.max);
    const step = parseFloat(el.dataset.step);
    const valEl = el.querySelector('.stepper-value');

    function getStepDecimals() {
      const s = step.toString();
      const i = s.indexOf('.');
      return i === -1 ? 1 : s.length - i - 1;
    }
    function snap(v) {
      const d = getStepDecimals();
      return Math.round(Math.max(min, Math.min(max, v)) * (10 ** d)) / (10 ** d);
    }
    function readVal() {
      const v = parseFloat(valEl.textContent);
      return isNaN(v) ? min : v;
    }

    el.querySelector('.stepper-dec').addEventListener('click', () => {
      valEl.textContent = snap(readVal() - step);
      valEl.dispatchEvent(new Event('change', { bubbles: true }));
    });
    el.querySelector('.stepper-inc').addEventListener('click', () => {
      valEl.textContent = snap(readVal() + step);
      valEl.dispatchEvent(new Event('change', { bubbles: true }));
    });

    valEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); valEl.blur(); }
    });
    valEl.addEventListener('blur', () => {
      const v = parseFloat(valEl.textContent);
      valEl.textContent = isNaN(v) ? min : snap(v);
      valEl.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
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
  const flights = await getFlights();
  const tasks = await getMaintenanceTasks();
  const parts = await getParts();
  const defects = await getDefects();
  const fuelStocks = await getFuelStock();

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

  let statusClass, statusLabel;
  if (groundingDefects > 0 || minRemaining <= 0) {
    statusClass = 'red'; statusLabel = 'Grounded';
  } else if (minRemaining <= 5) {
    statusClass = 'orange'; statusLabel = 'Caution';
  } else {
    statusClass = 'green'; statusLabel = 'Flightworthy';
  }

  let statusExtra = '';
  if (groundingDefects > 0) statusExtra = ` &middot; ${groundingDefects} grounding defect(s)`;
  else if (minRemaining <= 0) statusExtra = ' &middot; Inspection overdue';
  else statusExtra = ` &middot; ${minRemaining.toFixed(1)} hrs until next inspection`;

  app.innerHTML = `
    <div class="page">
      <div class="dashboard-hero">
        <img src="${ac.photoData || 'img/aircraft.jpg'}" alt="${escHtml(ac.tailNumber)}" class="aircraft-image">
        <span class="aircraft-badge">${escHtml(ac.tailNumber)}${ac.type ? ` &middot; ${escHtml(ac.type)}` : ''}</span>
      </div>

      <div class="status-card">
        <div class="status-dot ${statusClass}"></div>
        <div class="status-text">${statusLabel}${statusExtra}</div>
      </div>

      ${lowFuels > 0 ? `<div class="status-card" style="border-color:rgba(245,158,11,0.3)">
        <div class="status-dot orange"></div>
        <div class="status-text text-orange">Fuel alert: ${lowFuels} fuel type(s) below minimum stock (200L)</div>
      </div>` : ''}

      <div class="dashboard-grid">
        <div class="stat-card">
          <div class="stat-icon">&#9992;</div>
          <div class="stat-value">${flights.length}</div>
          <div class="stat-label">Flights</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">&#9201;</div>
          <div class="stat-value">${totalHours.toFixed(1)}</div>
          <div class="stat-label">Total Hours</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">&#9881;</div>
          <div class="stat-value ${openTasks > 0 ? 'text-orange' : 'text-green'}">${openTasks}</div>
          <div class="stat-label">Open Tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">&#128230;</div>
          <div class="stat-value ${(lowParts + lowFuels) > 0 ? 'text-red' : 'text-green'}">${lowParts + lowFuels}</div>
          <div class="stat-label">Low Stock</div>
        </div>
      </div>

      <div class="quick-actions">
        <a href="#" class="quick-action" onclick="navigate('flight-ops')">
          <div class="qa-icon">&#9992;</div>
          <div class="qa-label">Log Flight</div>
        </a>
        <a href="#" class="quick-action" onclick="navigate('defects')">
          <div class="qa-icon">&#9888;</div>
          <div class="qa-label">Squawks</div>
        </a>
        <a href="#" class="quick-action" onclick="navigate('maintenance')">
          <div class="qa-icon">&#9881;</div>
          <div class="qa-label">Sign-offs</div>
        </a>
        <a href="#" class="quick-action" onclick="navigate('inventory')">
          <div class="qa-icon">&#128230;</div>
          <div class="qa-label">Stock</div>
        </a>
        <a href="#" class="quick-action" onclick="navigate('inventory')">
          <div class="qa-icon">&#9981;</div>
          <div class="qa-label">Fuel</div>
        </a>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Inspection Intervals</h3>
        </div>
        <div id="dash-intervals">
          <div class="interval-item">
            <div class="interval-label">
              <span class="label">Oil Change (50 hrs)</span>
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
              <span class="label">Structural Insp. (100 hrs)</span>
              <span class="interval-value ${hoursSince100hr >= ac.structInterval ? 'text-red' : hoursSince100hr >= ac.structInterval - 5 ? 'text-orange' : 'text-green'}">
                ${structRemaining.toFixed(1)}h left
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${hoursSince100hr >= ac.structInterval ? 'fill-red' : hoursSince100hr >= ac.structInterval - 5 ? 'fill-orange' : 'fill-green'}"
                   style="width:${Math.min(100, (hoursSince100hr / ac.structInterval) * 100)}%"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Engine &amp; Propeller</h3>
        </div>
        <div id="dash-etso-ptso">
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
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${etso >= eTBO ? '<span class="text-red">Overhaul Due</span>' : `${(eTBO - etso).toFixed(1)}h until TBO`}</div>
            </div>
            <div class="interval-item">
              <div class="interval-label">
                <span class="label">Propeller TSO</span>
                <span class="interval-value ${ptso >= pTBO ? 'text-red' : ptso >= pTBO - 50 ? 'text-orange' : 'text-green'}">${ptso.toFixed(1)}h / ${pTBO}h</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${ptso >= pTBO ? 'fill-red' : ptso >= pTBO - 50 ? 'fill-orange' : 'fill-green'}" style="width:${pPct}%"></div>
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${ptso >= pTBO ? '<span class="text-red">Overhaul Due</span>' : `${(pTBO - ptso).toFixed(1)}h until TBO`}</div>
            </div>`;
          })()}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Recent Flights</h3>
        </div>
        <div id="dash-flights">
          ${flights.length === 0 ? '<p class="text-muted small">No flights logged yet</p>' :
            flights.slice(0, 5).map(f => `
              <div class="flight-row">
                <div style="flex:1;min-width:0">
                  <div class="flight-pilot">${escHtml(f.pilotName)}</div>
                  <div class="flight-date">${f.flightDate}${f.takeoffTime ? ` &middot; ${f.takeoffTime}-${f.landingTime}` : ''}</div>
                  ${f.fuelConsumed ? `<div class="flight-date" style="font-size:10px">${f.fuelConsumed.toFixed(1)} gal consumed</div>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                  <div class="flight-hours">${(f.flownHours * 60).toFixed(0)}m</div>
                  <button class="btn btn-sm btn-danger dash-del-flight-btn" data-id="${f.id}" style="padding:4px 8px;font-size:11px">&times;</button>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('.dash-del-flight-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteFlight(btn.dataset.id);
      dashboardView();
    });
  });
}

function navigate(view) {
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
    case 'calendar': calendarView(); break;
    case 'attendance': attendanceView(); break;
    case 'profile': profileView(); break;
  }
  updateSidebarInspections();
}

let _refreshTimer = null;
function onRemoteUpdate() {
  if (_refreshTimer) return;
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    const active = document.querySelector('.nav-link.active')?.dataset?.view;
    if (active) navigate(active);
  }, 1000);
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

function updateSidebarUser() {
  const name = localStorage.getItem('aac_user');
  const role = localStorage.getItem('aac_user_role');
  document.getElementById('sidebar-name').textContent = name || 'No User';
  document.getElementById('sidebar-role').textContent = role ? role.replace(/_/g, ' ') : '—';
  document.getElementById('sidebar-avatar').textContent = name ? name[0].toUpperCase() : '?';
}

async function updateSidebarInspections() {
  try {
    const ac = await getAircraft();
    if (!ac) return;
    const insp = getInspectionStatus(ac);
    const el = document.getElementById('sidebar-insp-list');
    if (!el) return;
    el.innerHTML = `
      <div class="sidebar-insp-item"><span>50hr Oil</span><span class="${insp.oilClass}">${insp.oilRemaining.toFixed(1)}h</span></div>
      <div class="sidebar-insp-item"><span>100hr Structural</span><span class="${insp.structClass}">${insp.structRemaining.toFixed(1)}h</span></div>
    `;
  } catch (e) {}
}

/* ── Profile View ── */
function profileView() {
  const app = document.getElementById('app');
  const name = localStorage.getItem('aac_user') || '';
  const role = localStorage.getItem('aac_user_role') || '';
  const roles = [
    { value: 'technician', label: 'Technician', desc: 'Can log flights, report defects, view data' },
    { value: 'senior_technician', label: 'Senior Technician', desc: 'Above + can approve attendance' },
    { value: 'engineer', label: 'Engineer', desc: 'Above + can approve CRS (Release to Service)' },
    { value: 'admin', label: 'Admin', desc: 'Full access to all features' }
  ];
  app.innerHTML = `
    <div class="page">
      <div class="page-header"><h2>My Profile</h2></div>
      <div class="card">
        <div class="form-group">
          <label>Your Name</label>
          <input type="text" id="profile-name" value="${escHtml(name)}" placeholder="e.g. John Smith">
        </div>
        <div class="form-group">
          <label>Your Role</label>
          <div class="profile-role-select">
            ${roles.map(r => `
              <label class="profile-role-option ${role === r.value ? 'selected' : ''}">
                <input type="radio" name="profile-role" value="${r.value}" ${role === r.value ? 'checked' : ''}>
                <div><div class="profile-role-label">${r.label}</div><div class="profile-role-desc">${r.desc}</div></div>
              </label>
            `).join('')}
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="profile-save-btn">Save Profile</button>
      </div>
    </div>
  `;
  document.querySelectorAll('.profile-role-option').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.profile-role-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      el.querySelector('input').checked = true;
    });
  });
  document.getElementById('profile-save-btn').addEventListener('click', async () => {
    const n = document.getElementById('profile-name').value.trim();
    const r = document.querySelector('input[name="profile-role"]:checked')?.value;
    if (!n) { showToast('Enter your name', 'error'); return; }
    if (!r) { showToast('Select your role', 'error'); return; }

    if (r === 'admin' || r === 'engineer' || r === 'senior_technician') {
      const pin = localStorage.getItem('aac_pin') || '1234';
      const entered = await showPromptDialog('Pincode Required', `Enter admin pincode to set role as ${r.replace(/_/g, ' ')}:`);
      if (entered === null) { showToast('Profile save cancelled', 'warning'); return; }
      if (entered.trim() !== pin) { showToast('Incorrect pincode', 'error'); return; }
    }

    localStorage.setItem('aac_user', n);
    localStorage.setItem('aac_user_role', r);
    const uid = localStorage.getItem('aac_user_id');
    if (uid) {
      const existing = await DB.get('users', uid);
      if (existing) {
        existing.name = n;
        existing.role = r;
        await DB.put('users', existing);
        await queueSync('users', 'update', existing);
      }
    } else {
      const id = 'user_' + Date.now();
      localStorage.setItem('aac_user_id', id);
      const u = { id, name: n, role: r, createdAt: new Date().toISOString() };
      await DB.put('users', u);
      await queueSync('users', 'create', u);
    }
    updateSidebarUser();
    showToast('Profile saved');
    navigate('dashboard');
  });
}

function showAircraftSheet() {
  showBottomSheet(`
    <div class="card-header"><h3>Manage Aircraft</h3></div>
    <div id="ac-list-sheet"></div>
    <hr>
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
    <button class="btn btn-primary btn-block" id="add-ac-btn">+ Add Aircraft</button>
    <button class="btn btn-secondary btn-block" id="close-ac-btn" style="margin-top:8px">Close</button>
  `);

  initSteppers();
  renderACListSheet();

  document.getElementById('add-ac-btn').addEventListener('click', async () => {
    const tail = document.getElementById('new-ac-tail').value.trim().toUpperCase();
    const type = document.getElementById('new-ac-type').value.trim() || 'Aircraft';
    if (!tail) { showToast('Enter a tail number', 'error'); return; }
    const existing = await DB.get('aircraft', tail);
    if (existing) { showToast('Aircraft already exists', 'error'); return; }
    const etbo = parseFloat(document.getElementById('new-ac-etbo').textContent) || 2000;
    const ptbo = parseFloat(document.getElementById('new-ac-ptbo').textContent) || 2000;
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
  const el = document.getElementById('ac-list-sheet');
  if (!el) return;
  if (all.length === 0) {
    el.innerHTML = '<p class="text-muted small">No aircraft added yet</p>';
    return;
  }
  el.innerHTML = all.map(ac => `
    <div class="ac-list-item ${ac.tailNumber === current ? 'ac-current' : ''}"
         data-tail="${ac.tailNumber}">
      <div class="ac-list-info">
        ${ac.photoData ? `<img src="${ac.photoData}" alt="" class="ac-thumb">` : ''}
        <strong>${escHtml(ac.tailNumber)}</strong>
        <div class="text-muted small">${escHtml(ac.type || 'Aircraft')}</div>
        ${ac.tailNumber === current ? `<div class="ac-list-tso">
          <span>Engine TSO: ${(ac.engineETSO || 0).toFixed(1)}h</span>
          <span>Prop TSO: ${(ac.propellerPTSO || 0).toFixed(1)}h</span>
        </div>` : ''}
        <div style="margin-top:6px">
          <button class="btn btn-ghost change-photo-btn" data-tail="${ac.tailNumber}" style="font-size:10px;padding:4px 10px">Change Photo</button>
        </div>
      </div>
      <div class="ac-list-actions">
        ${ac.tailNumber !== current ? `<button class="btn btn-sm btn-primary switch-ac-btn" data-tail="${ac.tailNumber}">Select</button>` : `
          <button class="btn btn-sm btn-ghost reset-etso-btn" data-tail="${ac.tailNumber}" title="Reset Engine TSO">E</button>
          <button class="btn btn-sm btn-ghost reset-ptso-btn" data-tail="${ac.tailNumber}" title="Reset Prop TSO">P</button>
          <span class="badge badge-released">Current</span>
        `}
        <button class="btn btn-sm btn-danger del-ac-btn" data-tail="${ac.tailNumber}" ${all.length <= 1 ? 'disabled' : ''}>&times;</button>
      </div>
    </div>
  `).join('');

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
  el.querySelectorAll('.switch-ac-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tail = btn.dataset.tail;
      await switchAircraft(tail);
      populateACSelector();
      window.__sheetClose(true);
      navigate(document.querySelector('.nav-link.active')?.dataset?.view || 'dashboard');
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

async function clearAllData() {
  const stores = ['flights','aircraft','defects','fuel_logs','fuel_stock','maintenance_tasks','parts','sync_queue','users','attendance'];
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

document.addEventListener('DOMContentLoaded', async () => {
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

  const user = localStorage.getItem('aac_user');
  if (!user) {
    const name = prompt('Enter your name:');
    if (name) localStorage.setItem('aac_user', name.trim());
  }

  await populateACSelector();

  document.getElementById('ac-photo-input').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    const tail = this.dataset.targetTail;
    if (!tail) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
      const ac = await DB.get('aircraft', tail);
      if (!ac) return;
      ac.photoData = e.target.result;
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
    const confirmed = await showConfirmDialog('Reset All Data', 'This will delete ALL data including aircraft, flights, defects, parts, and fuel. Are you sure?');
    if (confirmed) await clearAllData();
  });
  document.getElementById('sidebar-pincode').addEventListener('click', async e => {
    e.preventDefault();
    closeSidebar();
    const current = localStorage.getItem('aac_pin') || '1234';
    const old = await showPromptDialog('Change Pincode', 'Enter current pincode:');
    if (old === null) return;
    if (old.trim() !== current) { showToast('Incorrect pincode', 'error'); return; }
    const newPin = await showPromptDialog('Change Pincode', 'Enter new pincode:');
    if (newPin === null || newPin.trim().length < 4) { showToast('Pincode must be at least 4 characters', 'error'); return; }
    const confirmPin = await showPromptDialog('Change Pincode', 'Confirm new pincode:');
    if (confirmPin === null || confirmPin.trim() !== newPin.trim()) { showToast('Pincodes do not match', 'error'); return; }
    localStorage.setItem('aac_pin', newPin.trim());
    showToast('Pincode changed successfully');
  });

  updateSidebarUser();
  updateSidebarInspections();

  document.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigate(a.dataset.view);
    });
  });

  navigate('dashboard');
  checkInspectionNotifications();
});
