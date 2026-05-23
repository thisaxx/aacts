const GAL_TO_L = 3.78541;

const DEFAULT_AIRCRAFT = {
  tailNumber: 'C-152-001',
  type: 'Cessna 152',
  totalTachTime: 0,
  lastOilChangeTach: 0,
  last100hrTach: 0,
  oilInterval: 50,
  structInterval: 100,
  engineETSO: 0,
  propellerPTSO: 0,
  engineTBO: 2000,
  propellerTBO: 2000,
  photoData: null
};

function getCurrentAircraftKey() {
  return localStorage.getItem('aac_current_aircraft') || localStorage.getItem('aac_default_aircraft') || '';
}

function setCurrentAircraftKey(tailNumber) {
  localStorage.setItem('aac_current_aircraft', tailNumber);
}

function getDefaultAircraftKey() {
  return localStorage.getItem('aac_default_aircraft') || '';
}

function setDefaultAircraftKey(tailNumber) {
  localStorage.setItem('aac_default_aircraft', tailNumber);
  localStorage.setItem('aac_current_aircraft', tailNumber);
}

async function getAllAircraft() {
  return await DB.getAll('aircraft');
}

async function getAircraft() {
  const key = getCurrentAircraftKey();
  let ac = await DB.get('aircraft', key);
  if (!ac) {
    const all = await getAllAircraft();
    if (all.length > 0) {
      ac = all[0];
      setCurrentAircraftKey(ac.tailNumber);
    }
  }
  return ac;
}

async function switchAircraft(tailNumber) {
  setCurrentAircraftKey(tailNumber);
}

async function getFlights() {
  const ac = await getAircraft();
  if (!ac) return [];
  return (await DB.getAll('flights'))
    .filter(f => f.aircraftId === ac.tailNumber)
    .sort((a, b) => b.flightDate.localeCompare(a.flightDate));
}

function timeToMin(id) {
  const v = document.getElementById(id).value;
  if (!v) return 0;
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

function fuelVal(id) { return parseFloat(document.getElementById(id)?.value) || 0; }

function flightOpsView() {
  const app = document.getElementById('app');
  getAircraft().then(ac => {
    if (!ac) {
      app.innerHTML = `<div class="page"><div class="page-header"><h2>Log Flights</h2></div><div class="card" style="text-align:center;padding:40px 20px"><p class="text-muted">Add an aircraft first in Fleet Manager.</p><button class="btn btn-primary btn-block" id="goto-fleet-from-flights" style="margin-top:16px">+ Add Aircraft</button></div></div>`;
      document.getElementById('goto-fleet-from-flights').addEventListener('click', () => showAircraftSheet());
      return;
    }
    app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Log Flights</h2>
        <div class="subtitle">${escHtml(ac.type || 'Aircraft')} &middot; ${escHtml(ac.tailNumber)}</div>
      </div>

      <div class="status-card" id="aircraft-status">
        <div class="status-dot" id="status-dot"></div>
        <div class="status-text" id="status-text"><span class="skeleton" style="display:inline-block;width:140px;height:14px;vertical-align:middle"></span></div>
      </div>

      <form id="depart-form" class="card">
        <div class="card-header">
          <h3>Departure</h3>
        </div>
        <div class="form-group">
          <label for="flight-date">Flight Date</label>
          <input type="date" id="flight-date" required>
        </div>
        <div class="form-group">
          <label for="pilot-name">Pilot <span class="text-muted small">(optional)</span></label>
          <input type="text" id="pilot-name" placeholder="e.g. John Smith">
        </div>
        <div class="form-group">
          <label for="takeoff-time">Departure Time</label>
          <input type="time" id="takeoff-time" class="form-input">
        </div>
        <div class="card-header" style="margin-top:6px"><h3>Pre-flight Fuel</h3></div>
        <div class="row">
          <div class="form-group">
            <label>Left Wing (gal)</label>
            <input type="number" id="fuel-before-left" value="0" min="0" step="0.1" class="form-input fuel-input">
          </div>
          <div class="form-group">
            <label>Right Wing (gal)</label>
            <input type="number" id="fuel-before-right" value="0" min="0" step="0.1" class="form-input fuel-input">
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Depart</button>
      </form>

      <div class="card">
        <div class="card-header">
          <h3>Awaiting Arrival</h3>
        </div>
        <div id="departed-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
      </div>

      <button class="btn btn-secondary btn-block" id="flight-ops-eof-btn" style="margin-bottom:14px">&#128200; End of Flying — Enter Tach &amp; Start Inspection</button>

      <div class="card hidden" id="arrival-card">
        <div class="card-header">
          <h3>Record Arrival <span id="arrival-flight-ref" style="font-weight:400;font-size:12px"></span></h3>
        </div>
        <form id="arrival-form">
          <input type="hidden" id="arrival-flight-id">
          <div class="form-group">
            <label for="landing-time">Arrival Time</label>
            <input type="time" id="landing-time" class="form-input" required>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);padding:0 2px 14px;border-bottom:1px solid var(--glass-border);margin-bottom:14px">
            <span>Duration: <strong id="calc-duration" style="color:var(--gold)">—</strong></span>
          </div>
          <div class="card-header"><h3>Post-flight Fuel</h3></div>
          <div class="row">
            <div class="form-group">
              <label>Left Wing (gal)</label>
              <input type="number" id="fuel-after-left" value="0" min="0" step="0.1" class="form-input fuel-input">
            </div>
            <div class="form-group">
              <label>Right Wing (gal)</label>
              <input type="number" id="fuel-after-right" value="0" min="0" step="0.1" class="form-input fuel-input">
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);padding:6px 2px 0">
            <span>Consumed: <strong id="calc-consumed" style="color:var(--text)">—</strong></span>
            <span>Rate: <strong id="calc-rate" style="color:var(--text)">—</strong></span>
          </div>
          <div class="form-group" id="refuel-toggle-wrap" style="margin-top:14px">
            ${toggleSwitchHTML('refueled-check', 'Aircraft was refueled', false)}
          </div>
          <div id="refuel-fields" class="hidden">
            <div class="form-group">
              <label>Fuel Added (gal)</label>
              ${stepperHTML('refuel-amount', 0, 0, 9999, 0.1, true)}
            </div>
            <div class="row">
              <div class="form-group">
                <label for="refuel-source">Source</label>
                <select id="refuel-source">
                  <option value="Main Pump">Main Pump</option>
                </select>
              </div>
              <div class="form-group">
                <label for="fuel-type">Fuel Type</label>
                <select id="fuel-type">
                  <option value="mix">Mix</option>
                </select>
              </div>
            </div>
          </div>
          <button type="submit" class="btn btn-success btn-block">Complete Sortie</button>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Update Tach / Hobbs</h3>
        </div>
        <p class="text-muted small" style="margin-bottom:14px">At end of day, enter current meter readings to update totals.</p>
        <div class="row">
          <div class="form-group">
            <label>Current Tach Time</label>
            ${stepperHTML('eod-tach', ac.totalTachTime || 0, 0, 99999, 0.1, true)}
          </div>
          <div class="form-group">
            <label>Current Hobbs Time</label>
            ${stepperHTML('eod-hobbs', 0, 0, 99999, 0.1, true)}
          </div>
        </div>
        <button class="btn btn-secondary btn-block" id="update-meters-btn">Update Meters</button>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Inspection Intervals</h3>
        </div>
        <div id="interval-bars"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Recent Sorties</h3>
        </div>
        <div id="recent-flights"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
      </div>
    </div>
  `;

  document.getElementById('depart-form').addEventListener('submit', onDepartureSubmit);
  document.getElementById('arrival-form').addEventListener('submit', onArrivalSubmit);
  document.getElementById('update-meters-btn').addEventListener('click', onUpdateMeters);
  document.getElementById('flight-ops-eof-btn').addEventListener('click', showEndOfFlyingSheet);
  initSteppers();
  initToggles();
  document.querySelector('[data-toggle-id="refueled-check"]')?.addEventListener('change', function(e) {
    document.getElementById('refuel-fields').classList.toggle('hidden', !e.checked);
  });
  document.getElementById('landing-time')?.addEventListener('change', updateArrivalCalc);
  ['fuel-after-left','fuel-after-right'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateArrivalCalc);
  });

  document.getElementById('flight-date').valueAsDate = new Date();

  renderAircraftStatus();
  renderIntervalBars();
  renderRecentFlights();
  renderDepartedList();
  });
}

async function renderDepartedList() {
  const ac = await getAircraft();
  const el = document.getElementById('departed-list');
  if (!el) return;
  const departed = (await DB.getAll('flights'))
    .filter(f => f.aircraftId === ac.tailNumber && f.status === 'departed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (departed.length === 0) {
    el.innerHTML = '<p class="text-muted small">No flights awaiting arrival data</p>';
    return;
  }
  el.innerHTML = departed.map(f => `
    <div class="flight-row departed-item" data-id="${f.id}" style="cursor:pointer;border-left:3px solid var(--gold);padding-left:10px;margin-bottom:6px">
      <div style="flex:1;min-width:0">
        <div class="flight-pilot">${escHtml(f.pilotName)} &middot; ${f.flightDate}</div>
        <div class="flight-date">Departed ${f.takeoffTime} &middot; Pre-flight: ${((f.fuelBeforeLeft||0)+(f.fuelBeforeRight||0)).toFixed(1)} gal</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span class="badge badge-rectified" style="font-size:9px">DEPARTED</span>
        <button class="btn btn-sm btn-danger del-departed-btn" data-id="${f.id}" style="padding:4px 8px;font-size:11px">&times;</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.departed-item').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.del-departed-btn')) return;
      showArrivalForm(row.dataset.id);
    });
  });
  el.querySelectorAll('.del-departed-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirmDialog('Delete Departure', 'Delete this departure record? Arrival data will be lost.');
      if (!confirmed) return;
      await DB.del('flights', btn.dataset.id);
      await queueSync('flights', 'delete', { id: btn.dataset.id });
      showToast('Departure deleted');
      renderDepartedList();
      renderRecentFlights();
    });
  });
}

async function showArrivalForm(flightId) {
  const flight = await DB.get('flights', flightId);
  if (!flight) return;
  const card = document.getElementById('arrival-card');
  const ref = document.getElementById('arrival-flight-ref');
  card.classList.remove('hidden');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('arrival-flight-id').value = flightId;
  ref.textContent = `— ${escHtml(flight.pilotName)} &middot; ${flight.flightDate} &middot; Dep ${flight.takeoffTime}`;
  document.getElementById('landing-time').value = '';
  document.getElementById('landing-time').focus();
  document.getElementById('calc-duration').textContent = '—';
  document.getElementById('fuel-after-left').value = 0;
  document.getElementById('fuel-after-right').value = 0;
  document.getElementById('calc-consumed').textContent = '—';
  document.getElementById('calc-rate').textContent = '—';
  const toggle = document.querySelector('[data-toggle-id="refueled-check"] .toggle-track');
  if (toggle) toggle.classList.remove('on');
  document.getElementById('refuel-fields').classList.add('hidden');
  const sv = document.getElementById('refuel-amount');
  if (sv) sv.value = '0';
}

function updateArrivalCalc() {
  const flightId = document.getElementById('arrival-flight-id')?.value;
  if (!flightId) return;
  DB.get('flights', flightId).then(flight => {
    if (!flight) return;
    const l = timeToMin('landing-time');
    const takeoffParts = (flight.takeoffTime || '').split(':').map(Number);
    const t = takeoffParts[0]*60 + takeoffParts[1];
    const durationEl = document.getElementById('calc-duration');
    if (!t || isNaN(t) || !l || l <= t) { durationEl.textContent = '—'; return; }
    durationEl.textContent = (l - t) + ' min';

    const beforeLeft = flight.fuelBeforeLeft || 0;
    const beforeRight = flight.fuelBeforeRight || 0;
    const afterLeft = fuelVal('fuel-after-left');
    const afterRight = fuelVal('fuel-after-right');
    const consumed = Math.max(0, (beforeLeft + beforeRight) - (afterLeft + afterRight));
    const durationH = (l - t) / 60;

    document.getElementById('calc-consumed').textContent = consumed > 0 ? consumed.toFixed(1) + ' gal' : '—';
    document.getElementById('calc-rate').textContent = (consumed > 0 && durationH > 0)
      ? (consumed / durationH).toFixed(1) + ' gal/hr'
      : '—';
  });
}

async function onDepartureSubmit(e) {
  e.preventDefault();
  const pilot = document.getElementById('pilot-name').value.trim() || 'Unknown';
  const takeoffTime = document.getElementById('takeoff-time').value;
  const flightDate = document.getElementById('flight-date').value;

  if (!takeoffTime) {
    showToast('Enter departure time', 'error');
    return;
  }

  const ac = await getAircraft();
  const flight = {
    id: 'flt_' + Date.now(),
    aircraftId: ac.tailNumber,
    flightDate,
    pilotName: pilot,
    takeoffTime,
    landingTime: null,
    flownHours: 0,
    fuelBeforeLeft: fuelVal('fuel-before-left'),
    fuelBeforeRight: fuelVal('fuel-before-right'),
    fuelAfterLeft: 0,
    fuelAfterRight: 0,
    fuelConsumed: 0,
    status: 'departed',
    refueled: false,
    refuelAmount: 0,
    refuelSource: '',
    fuelType: '',
    createdAt: new Date().toISOString()
  };

  await DB.put('flights', flight);
  await queueSync('flights', 'create', flight);

  document.getElementById('depart-form').reset();
  document.getElementById('flight-date').valueAsDate = new Date();

  showToast('Departure recorded — awaiting arrival');

  createNotification('sortie', 'Departure Recorded', `${pilot} departed in ${ac.tailNumber} at ${takeoffTime}`, 'flight-ops');
  logActivity('departure', `${pilot} departed in ${ac.tailNumber} at ${takeoffTime}`, flight.id);

  renderDepartedList();
  renderRecentFlights();
  showArrivalForm(flight.id);
}

async function onArrivalSubmit(e) {
  e.preventDefault();
  const flightId = document.getElementById('arrival-flight-id').value;
  const flight = await DB.get('flights', flightId);
  if (!flight) { showToast('Flight record not found', 'error'); return; }

  const landingTime = document.getElementById('landing-time').value;
  if (!landingTime) {
    showToast('Enter valid arrival time', 'error');
    return;
  }
  const takeoffParts = (flight.takeoffTime || '').split(':').map(Number);
  const landingParts = landingTime.split(':').map(Number);
  const durationMin = (landingParts[0]*60 + landingParts[1]) - (takeoffParts[0]*60 + takeoffParts[1]);
  if (durationMin <= 0) {
    showToast('Arrival time must be after departure time', 'error');
    return;
  }
  const duration = durationMin / 60;

  const fuelAfterLeft = fuelVal('fuel-after-left');
  const fuelAfterRight = fuelVal('fuel-after-right');
  const fuelConsumed = Math.max(0, (flight.fuelBeforeLeft + flight.fuelBeforeRight) - (fuelAfterLeft + fuelAfterRight));
  const refuelToggle = document.querySelector('[data-toggle-id="refueled-check"]');
  const refueled = refuelToggle?.querySelector('.toggle-track')?.classList.contains('on') || false;
  const refuelAmt = refueled ? parseFloat(document.getElementById('refuel-amount')?.value) || 0 : 0;
  const refuelSrc = refueled ? document.getElementById('refuel-source')?.value : '';
  const fuelType = refueled ? document.getElementById('fuel-type')?.value : '';

  flight.landingTime = landingTime;
  flight.flownHours = duration;
  flight.fuelAfterLeft = fuelAfterLeft;
  flight.fuelAfterRight = fuelAfterRight;
  flight.fuelConsumed = fuelConsumed;
  flight.refueled = refueled;
  flight.refuelAmount = refuelAmt;
  flight.refuelSource = refuelSrc;
  flight.fuelType = fuelType;
  flight.status = 'completed';

  await DB.put('flights', flight);
  await queueSync('flights', 'update', flight);

  const ac = await getAircraft();
  ac.engineETSO = (ac.engineETSO || 0) + duration;
  ac.propellerPTSO = (ac.propellerPTSO || 0) + duration;
  ac.totalTachTime = (ac.totalTachTime || 0) + duration;
  await DB.put('aircraft', ac);
  await queueSync('aircraft', 'update', ac);
  if (typeof checkAndCreateInspectionTasks === 'function') checkAndCreateInspectionTasks(ac);

  const hoursSinceOil = ac.totalTachTime - ac.lastOilChangeTach;
  const hoursSince100hr = ac.totalTachTime - ac.last100hrTach;
  if (hoursSinceOil >= 50) {
    await showOilChangePrompt(ac.totalTachTime);
  }
  if (hoursSince100hr >= 100) {
    await show100hrPrompt(ac.totalTachTime);
  }

  if (refueled && refuelAmt > 0 && fuelType) {
    const refuelLiters = refuelAmt * GAL_TO_L;
    await deductFuel(fuelType, refuelLiters);
    await DB.put('fuel_logs', {
      id: 'fuellog_' + Date.now(),
      aircraftId: ac.tailNumber,
      type: 'refuel',
      flightId: flight.id,
      fuelType,
      liters: refuelLiters,
      source: refuelSrc,
      createdAt: new Date().toISOString()
    });
    await queueSync('fuel_logs', 'create', { flightId: flight.id, fuelType, liters: refuelLiters, source: refuelSrc });
    showToast(`Sortie completed & ${refuelAmt.toFixed(1)} gal deducted from stock`);
  } else {
    showToast('Sortie completed');
  }

  // After-flight inspection — created after every landing
  const inspTask = {
    id: 'insp_' + Date.now(),
    type: 'after-flight',
    aircraftId: ac.tailNumber,
    description: `After-flight inspection for ${flight.flightDate} sortie (${(duration * 60).toFixed(0)} min)`,
    priority: 'medium',
    status: 'open',
    notes: '',
    rectifiedBy: '',
    rectifiedAt: '',
    rectifiedRole: '',
    createdAt: new Date().toISOString()
  };
  await DB.put('maintenance_tasks', inspTask);
  await queueSync('maintenance_tasks', 'create', inspTask);
  createNotification('inspection', 'After-Flight Inspection Created', `After-flight inspection due for ${ac.tailNumber} after ${flight.flightDate} sortie`, 'maintenance');

  createNotification('sortie', 'Sortie Completed', `${flight.pilotName} completed sortie in ${ac.tailNumber} (${(duration*60).toFixed(0)} min)`, 'flight-ops');
  logActivity('arrival', `${flight.pilotName} completed sortie in ${ac.tailNumber} (${(duration*60).toFixed(0)} min)`, flight.id);
  notifyDataChange();

  // Reset arrival form
  document.getElementById('arrival-card').classList.add('hidden');
  document.getElementById('arrival-flight-id').value = '';
  document.getElementById('landing-time').value = '';
  document.getElementById('fuel-after-left').value = 0;
  document.getElementById('fuel-after-right').value = 0;
  document.getElementById('calc-duration').textContent = '—';
  document.getElementById('calc-consumed').textContent = '—';
  document.getElementById('calc-rate').textContent = '—';

  renderAircraftStatus();
  renderIntervalBars();
  renderRecentFlights();
  renderDepartedList();
}

async function onUpdateMeters() {
  const ac = await getAircraft();
  const newTach = parseFloat(document.getElementById('eod-tach').value) || 0;
  const newHobbs = parseFloat(document.getElementById('eod-hobbs').value) || 0;
  if (newTach <= 0) { showToast('Enter current tach reading', 'error'); return; }
  ac.totalTachTime = newTach;
  await DB.put('aircraft', ac);
  await queueSync('aircraft', 'update', ac);
  if (typeof checkAndCreateInspectionTasks === 'function') checkAndCreateInspectionTasks(ac);

  const hoursSinceOil = newTach - ac.lastOilChangeTach;
  const hoursSince100hr = newTach - ac.last100hrTach;
  if (hoursSinceOil >= 50) {
    await showOilChangePrompt(newTach);
  }
  if (hoursSince100hr >= 100) {
    await show100hrPrompt(newTach);
  }
  showToast('Meters updated');
  renderAircraftStatus();
  renderIntervalBars();
  notifyDataChange();
}

async function showOilChangePrompt(currentTach) {
  const confirmed = await showConfirmDialog(
    '50hr Inspection',
    'This sortie brings the aircraft to the 50-hour inspection interval. Did you use 1 oil filter and 5678 ml of aviation oil?'
  );
  if (confirmed) {
    const filter = await DB.get('parts', 'OIL-FILTER-C152');
    if (filter && filter.quantityOnHand >= 1) {
      filter.quantityOnHand -= 1;
      await DB.put('parts', filter);
      await queueSync('parts', 'update', filter);
    }
    const oil = await DB.get('parts', 'AV-OIL-20W50');
    if (oil && oil.quantityOnHand >= 5678) {
      oil.quantityOnHand -= 5678;
      await DB.put('parts', oil);
      await queueSync('parts', 'update', oil);
    }
    showToast('Parts deducted & oil change recorded');
  } else {
    showToast('Oil change recorded (no parts deducted)');
  }
  const ac = await getAircraft();
  ac.lastOilChangeTach = currentTach;
  await DB.put('aircraft', ac);
  await queueSync('aircraft', 'update', ac);
  renderIntervalBars();
}

async function show100hrPrompt(currentTach) {
  const confirmed = await showConfirmDialog(
    '100hr Inspection',
    'This sortie brings the aircraft to the 100-hour structural inspection interval. Has the inspection been completed?'
  );
  if (confirmed) {
    const ac = await getAircraft();
    ac.last100hrTach = currentTach;
    await DB.put('aircraft', ac);
    await queueSync('aircraft', 'update', ac);
    showToast('100-hour inspection recorded');
    renderIntervalBars();
  }
}

async function showEndOfFlyingSheet() {
  const ac = await getAircraft();
  const currentTach = ac.totalTachTime || 0;
  showBottomSheet(`
    <div class="card-header"><h3>&#128200; End of Flying — ${escHtml(ac.tailNumber)}</h3></div>
    <p class="text-muted small" style="margin-bottom:12px">Enter current tach reading. Hours flown since last update will be deducted from inspection intervals.</p>
    <div class="form-group">
      <label>Current Tach Time (hours)</label>
      ${stepperHTML('eof-tach', currentTach, 0, 99999, 0.1, true)}
    </div>
    <button class="btn btn-primary btn-block" id="eof-confirm-btn">Confirm End of Flying</button>
    <button class="btn btn-secondary btn-block" id="eof-cancel-btn" style="margin-top:8px">Cancel</button>
  `);
  initSteppers();
  document.getElementById('eof-confirm-btn').addEventListener('click', async () => {
    const newTach = parseFloat(document.getElementById('eof-tach').value) || currentTach;
    const ac2 = await getAircraft();
    const duration = newTach - (ac2.totalTachTime || 0);
    if (duration > 0) {
      ac2.engineETSO = (ac2.engineETSO || 0) + duration;
      ac2.propellerPTSO = (ac2.propellerPTSO || 0) + duration;
      ac2.totalTachTime = newTach;
    }
    if (typeof checkAndCreateInspectionTasks === 'function') checkAndCreateInspectionTasks(ac2);
    const hoursSinceOil = newTach - ac2.lastOilChangeTach;
    const hoursSince100hr = newTach - ac2.last100hrTach;
    const today = new Date().toISOString().slice(0, 10);
    const inspTask = {
      id: 'insp_' + Date.now(),
      type: 'after-flight',
      aircraftId: ac2.tailNumber,
      description: `After-flight inspection for end of flying day — ${today}${duration > 0 ? ` (${duration.toFixed(1)} tach hrs)` : ''}`,
      priority: 'medium',
      status: 'open',
      notes: '',
      rectifiedBy: '',
      rectifiedAt: '',
      rectifiedRole: '',
      createdAt: new Date().toISOString()
    };
    await DB.put('maintenance_tasks', inspTask);
    await queueSync('maintenance_tasks', 'create', inspTask);
    ac2.groundedAfterInspection = true;
    ac2.groundedAfterInspAt = new Date().toISOString();
    await DB.put('aircraft', ac2);
    await queueSync('aircraft', 'update', ac2);
    window.__sheetClose(true);
    showToast('Aircraft grounded — after-flight inspection required');
    createNotification('inspection', 'After-Flight Inspection Created', `End-of-day inspection due for ${ac2.tailNumber} — aircraft grounded`, 'maintenance');
    logActivity('after_flight_created', `End-of-day after-flight inspection created for ${ac2.tailNumber} — grounded (tach: ${newTach.toFixed(1)})`, inspTask.id);
    notifyDataChange();
  });
  document.getElementById('eof-cancel-btn').addEventListener('click', () => {
    window.__sheetClose(null);
  });
}

async function renderAircraftStatus() {
  const ac = await getAircraft();
  const tach = ac.totalTachTime;
  const hoursSinceOil = tach - ac.lastOilChangeTach;
  const hoursSince100hr = tach - ac.last100hrTach;
  const oilRemaining = ac.oilInterval - hoursSinceOil;
  const structRemaining = ac.structInterval - hoursSince100hr;
  const minRemaining = Math.min(oilRemaining, structRemaining);

  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  let statusClass, statusText;

  if (minRemaining <= 0) {
    statusClass = 'red';
    statusText = `GROUNDED: ${ac.tailNumber} - Inspection overdue`;
  } else if (minRemaining <= 5) {
    statusClass = 'orange';
    statusText = `CAUTION: ${ac.tailNumber} - ${minRemaining.toFixed(1)} hrs until next inspection`;
  } else {
    statusClass = 'green';
    statusText = `SAFE: ${ac.tailNumber} - ${minRemaining.toFixed(1)} hrs until next inspection`;
  }

  dot.className = 'status-dot ' + statusClass;
  text.textContent = statusText;
}

async function renderIntervalBars() {
  const ac = await getAircraft();
  const tach = ac.totalTachTime;
  const hoursSinceOil = tach - ac.lastOilChangeTach;
  const hoursSince100hr = tach - ac.last100hrTach;
  const oilRemaining = Math.max(0, ac.oilInterval - hoursSinceOil);
  const structRemaining = Math.max(0, ac.structInterval - hoursSince100hr);

  const el = document.getElementById('interval-bars');
  el.innerHTML = `
    <div class="interval-item">
      <div class="interval-label">
        <span class="label">50hr Inspection</span>
        <span class="interval-value ${hoursSinceOil >= ac.oilInterval ? 'text-red' : hoursSinceOil >= ac.oilInterval - 5 ? 'text-orange' : 'text-green'}">
          ${oilRemaining.toFixed(1)}h left
        </span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${hoursSinceOil >= ac.oilInterval ? 'fill-red' : hoursSinceOil >= ac.oilInterval - 5 ? 'fill-orange' : 'fill-green'}" 
             style="width: ${Math.min(100, (hoursSinceOil / ac.oilInterval) * 100)}%"></div>
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
             style="width: ${Math.min(100, (hoursSince100hr / ac.structInterval) * 100)}%"></div>
      </div>
    </div>
  `;
}

async function deleteFlight(flightId) {
  const flight = await DB.get('flights', flightId);
  if (!flight) return;
  const h = flight.flownHours || 0;
  const isDeparted = flight.status === 'departed';
  const confirmed = await showConfirmDialog(isDeparted ? 'Delete Departure' : 'Delete Sortie',
    isDeparted ? 'Delete this departure record?' : `Delete this ${(h * 60).toFixed(0)} min sortie?`);
  if (!confirmed) return;
  if (!isDeparted && h > 0) {
    const ac = await getAircraft();
    ac.engineETSO = Math.max(0, (ac.engineETSO || 0) - h);
    ac.propellerPTSO = Math.max(0, (ac.propellerPTSO || 0) - h);
    await DB.put('aircraft', ac);
    await queueSync('aircraft', 'update', ac);
  }
  await DB.del('flights', flightId);
  await queueSync('flights', 'delete', { id: flightId });
  showToast(isDeparted ? 'Departure deleted' : 'Sortie deleted');
  renderRecentFlights();
  renderDepartedList();
  renderAircraftStatus();
  renderIntervalBars();
}

async function renderRecentFlights() {
  const flights = await getFlights();
  const el = document.getElementById('recent-flights');
  if (flights.length === 0) {
    el.innerHTML = emptyState('&#9992;', 'No sorties recorded yet');
    return;
  }
  el.innerHTML = flights.slice(0, 20).map(f => {
    const isDeparted = f.status === 'departed';
    return `
    <div class="flight-row">
      <div style="flex:1;min-width:0">
        <div class="flight-pilot">${escHtml(f.pilotName)}${isDeparted ? ' <span class="badge badge-rectified" style="font-size:9px">DEP</span>' : ''}</div>
        <div class="flight-date">${f.flightDate}${f.takeoffTime ? ` &middot; ${f.takeoffTime}${f.landingTime ? '-' + f.landingTime : '...'}` : ''}</div>
        ${f.fuelConsumed ? `<div class="flight-date">Fuel: ${f.fuelConsumed.toFixed(1)} gal${f.fuelConsumed > 0 && f.flownHours > 0 ? ` &middot; ${(f.fuelConsumed / f.flownHours).toFixed(1)} gal/hr` : ''}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        ${!isDeparted ? `<div class="flight-hours">${(f.flownHours * 60).toFixed(0)}m</div>` : '<div class="flight-hours" style="opacity:0.4">—</div>'}
        <button class="btn btn-sm btn-ghost edit-flight-btn" data-id="${f.id}" title="Edit" style="padding:4px 6px;font-size:11px">&#9998;</button>
        <button class="btn btn-sm btn-danger del-flight-btn" data-id="${f.id}" style="padding:4px 8px;font-size:11px">&times;</button>
      </div>
    </div>
  `}).join('');

  el.querySelectorAll('.del-flight-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteFlight(btn.dataset.id));
  });
  el.querySelectorAll('.edit-flight-btn').forEach(btn => {
    btn.addEventListener('click', () => editFlight(btn.dataset.id));
  });
}

async function editFlight(flightId) {
  const flight = await DB.get('flights', flightId);
  if (!flight) { showToast('Flight not found', 'error'); return; }
  showBottomSheet(`
    <div class="card-header"><h3>Edit Sortie</h3></div>
    <div class="form-group">
      <label>Flight Date</label>
      <input type="date" id="edit-flight-date" class="form-input" value="${flight.flightDate}">
    </div>
    <div class="form-group">
      <label>Pilot Name</label>
      <input type="text" id="edit-flight-pilot" class="form-input" value="${escHtml(flight.pilotName)}">
    </div>
    <div class="row">
      <div class="form-group">
        <label>Takeoff Time</label>
        <input type="time" id="edit-flight-takeoff" class="form-input" value="${flight.takeoffTime || ''}">
      </div>
      <div class="form-group">
        <label>Landing Time</label>
        <input type="time" id="edit-flight-landing" class="form-input" value="${flight.landingTime || ''}">
      </div>
    </div>
    <div class="form-group">
      <label>Flown Hours</label>
      ${stepperHTML('edit-flight-hours', flight.flownHours || 0, 0, 99, 0.1)}
    </div>
    <div class="row">
      <div class="form-group">
        <label>Fuel Before (L)</label>
        ${stepperHTML('edit-fuel-before-left', flight.fuelBeforeLeft || 0, 0, 999, 0.1)}
      </div>
      <div class="form-group">
        <label>Fuel Before (R)</label>
        ${stepperHTML('edit-fuel-before-right', flight.fuelBeforeRight || 0, 0, 999, 0.1)}
      </div>
    </div>
    <div class="row">
      <div class="form-group">
        <label>Fuel After (L)</label>
        ${stepperHTML('edit-fuel-after-left', flight.fuelAfterLeft || 0, 0, 999, 0.1)}
      </div>
      <div class="form-group">
        <label>Fuel After (R)</label>
        ${stepperHTML('edit-fuel-after-right', flight.fuelAfterRight || 0, 0, 999, 0.1)}
      </div>
    </div>
    <div class="form-group">
      <label>Fuel Consumed (gal)</label>
      ${stepperHTML('edit-fuel-consumed', flight.fuelConsumed || 0, 0, 999, 0.1)}
    </div>
    <div class="form-group">
      ${toggleSwitchHTML('edit-refueled-check', 'Aircraft was refueled', flight.refueled || false)}
    </div>
    <div id="edit-refuel-fields" class="${flight.refueled ? '' : 'hidden'}">
      <div class="form-group">
        <label>Refuel Amount (gal)</label>
        ${stepperHTML('edit-refuel-amount', flight.refuelAmount || 0, 0, 9999, 0.1)}
      </div>
      <div class="row">
        <div class="form-group">
          <label>Source</label>
          <input type="text" id="edit-refuel-source" class="form-input" value="${escHtml(flight.refuelSource || '')}">
        </div>
        <div class="form-group">
          <label>Fuel Type</label>
          <input type="text" id="edit-fuel-type" class="form-input" value="${escHtml(flight.fuelType || '')}">
        </div>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="save-edit-flight-btn">Save Changes</button>
    <button class="btn btn-secondary btn-block" id="cancel-edit-flight-btn" style="margin-top:8px">Cancel</button>
  `);
  initSteppers();
  initToggles();
  document.querySelector('[data-toggle-id="edit-refueled-check"]')?.addEventListener('change', function(e) {
    document.getElementById('edit-refuel-fields').classList.toggle('hidden', !e.checked);
  });
  document.getElementById('save-edit-flight-btn').addEventListener('click', async () => {
    const date = document.getElementById('edit-flight-date').value;
    const pilot = document.getElementById('edit-flight-pilot').value.trim();
    if (!date || !pilot) { showToast('Date and pilot required', 'error'); return; }
    flight.flightDate = date;
    flight.pilotName = pilot;
    flight.takeoffTime = document.getElementById('edit-flight-takeoff').value || '';
    flight.landingTime = document.getElementById('edit-flight-landing').value || '';
    flight.flownHours = parseFloat(document.getElementById('edit-flight-hours').value) || 0;
    flight.fuelBeforeLeft = parseFloat(document.getElementById('edit-fuel-before-left').value) || 0;
    flight.fuelBeforeRight = parseFloat(document.getElementById('edit-fuel-before-right').value) || 0;
    flight.fuelAfterLeft = parseFloat(document.getElementById('edit-fuel-after-left').value) || 0;
    flight.fuelAfterRight = parseFloat(document.getElementById('edit-fuel-after-right').value) || 0;
    flight.fuelConsumed = parseFloat(document.getElementById('edit-fuel-consumed').value) || 0;
    const refuelToggle = document.querySelector('[data-toggle-id="edit-refueled-check"]');
    flight.refueled = refuelToggle?.querySelector('.toggle-track')?.classList.contains('on') || false;
    flight.refuelAmount = flight.refueled ? parseFloat(document.getElementById('edit-refuel-amount').value) || 0 : 0;
    flight.refuelSource = flight.refueled ? document.getElementById('edit-refuel-source').value : '';
    flight.fuelType = flight.refueled ? document.getElementById('edit-fuel-type').value : '';
    if (flight.status === 'departed' && flight.landingTime) flight.status = 'completed';
    else if (flight.status === 'completed' && !flight.landingTime) flight.status = 'departed';
    await DB.put('flights', flight);
    await queueSync('flights', 'update', flight);
    showToast('Sortie updated');
    window.__sheetClose(true);
    renderRecentFlights();
    renderDepartedList();
  });
  document.getElementById('cancel-edit-flight-btn').addEventListener('click', () => window.__sheetClose(null));
}
