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
  return localStorage.getItem('aac_current_aircraft') || 'C-152-001';
}

function setCurrentAircraftKey(tailNumber) {
  localStorage.setItem('aac_current_aircraft', tailNumber);
}

async function getAllAircraft() {
  let all = await DB.getAll('aircraft');
  if (all.length === 0) {
    const ac = { ...DEFAULT_AIRCRAFT };
    await DB.put('aircraft', ac);
    all = [ac];
  }
  return all;
}

async function getAircraft() {
  const key = getCurrentAircraftKey();
  let ac = await DB.get('aircraft', key);
  if (!ac) {
    const all = await getAllAircraft();
    if (all.length > 0) {
      ac = all[0];
      setCurrentAircraftKey(ac.tailNumber);
    } else {
      ac = { ...DEFAULT_AIRCRAFT };
      await DB.put('aircraft', ac);
    }
  }
  return ac;
}

async function switchAircraft(tailNumber) {
  setCurrentAircraftKey(tailNumber);
}

async function getFlights() {
  const ac = await getAircraft();
  return (await DB.getAll('flights'))
    .filter(f => f.aircraftId === ac.tailNumber)
    .sort((a, b) => b.flightDate.localeCompare(a.flightDate));
}

function flightOpsView() {
  const app = document.getElementById('app');
  getAircraft().then(ac => {
    app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Flight Logging</h2>
        <div class="subtitle">${escHtml(ac.type || 'Aircraft')} &middot; ${escHtml(ac.tailNumber)}</div>
      </div>

      <div class="status-card" id="aircraft-status">
        <div class="status-dot" id="status-dot"></div>
        <div class="status-text" id="status-text"><span class="skeleton" style="display:inline-block;width:140px;height:14px;vertical-align:middle"></span></div>
      </div>

      <form id="flight-form" class="card">
        <div class="card-header">
          <h3>Log New Flight</h3>
        </div>
        <div class="form-group">
          <label for="flight-date">Flight Date</label>
          <input type="date" id="flight-date" required>
        </div>
        <div class="form-group">
          <label for="pilot-name">Pilot Name <span class="text-muted small">(optional)</span></label>
          <input type="text" id="pilot-name" placeholder="e.g. John Smith">
        </div>
        <div class="row">
          <div class="form-group">
            <label for="takeoff-time">Takeoff Time</label>
            <input type="time" id="takeoff-time" class="form-input">
          </div>
          <div class="form-group">
            <label for="landing-time">Landing Time</label>
            <input type="time" id="landing-time" class="form-input">
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);padding:0 2px 14px;border-bottom:1px solid var(--glass-border);margin-bottom:14px">
          <span>Duration: <strong id="calc-duration" style="color:var(--gold)">—</strong></span>
        </div>
        <div class="card-header"><h3>Fuel</h3></div>
        <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;display:block;margin-bottom:8px">Before Flight</label>
        <div class="row">
          <div class="form-group">
            <label>Left Wing (gal)</label>
            <input type="number" id="fuel-before-left" value="0" min="0" step="1" class="form-input fuel-input">
          </div>
          <div class="form-group">
            <label>Right Wing (gal)</label>
            <input type="number" id="fuel-before-right" value="0" min="0" step="1" class="form-input fuel-input">
          </div>
        </div>
        <label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px;display:block;margin:10px 0 8px">After Flight</label>
        <div class="row">
          <div class="form-group">
            <label>Left Wing (gal)</label>
            <input type="number" id="fuel-after-left" value="0" min="0" step="1" class="form-input fuel-input">
          </div>
          <div class="form-group">
            <label>Right Wing (gal)</label>
            <input type="number" id="fuel-after-right" value="0" min="0" step="1" class="form-input fuel-input">
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
            <label>Gallons Added</label>
            ${stepperHTML('refuel-amount', 0, 0, 9999, 5, true)}
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
        <button type="submit" class="btn btn-primary btn-block">Log Flight</button>
      </form>

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
          <h3>Engine &amp; Propeller</h3>
        </div>
        <div id="etso-ptso-bars"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Recent Flights</h3>
        </div>
        <div id="recent-flights"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
      </div>
    </div>
  `;

  document.getElementById('flight-form').addEventListener('submit', onFlightSubmit);
  document.getElementById('update-meters-btn').addEventListener('click', onUpdateMeters);
  initSteppers();
  initToggles();
  document.querySelector('[data-toggle-id="refueled-check"]').addEventListener('change', function(e) {
    document.getElementById('refuel-fields').classList.toggle('hidden', !e.checked);
  });
  ['takeoff-time','landing-time'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateCalcDuration);
  });
  ['fuel-before-left','fuel-before-right','fuel-after-left','fuel-after-right'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateFuelCalc);
  });

  // Auto-save draft to localStorage
  const draftKey = 'aac_flight_draft';
  const formInputs = document.querySelectorAll('#flight-form input, #flight-form select');
  const saveDraft = () => {
    const draft = {};
    formInputs.forEach(el => {
      if (el.type === 'checkbox') draft[el.id] = el.checked;
      else if (el.type === 'date' || el.type === 'time' || el.type === 'text' || el.type === 'number') draft[el.id] = el.value;
    });
    // Save stepper values
    document.querySelectorAll('.stepper-value').forEach(el => { draft[el.id] = el.textContent; });
    // Save toggle state
    const toggle = document.querySelector('[data-toggle-id="refueled-check"] .toggle-track');
    if (toggle) draft['refueled-check'] = toggle.classList.contains('on');
    localStorage.setItem(draftKey, JSON.stringify(draft));
  };
  formInputs.forEach(el => el.addEventListener('input', saveDraft));
  document.querySelectorAll('.stepper-btn').forEach(el => el.addEventListener('click', () => setTimeout(saveDraft, 50)));

  // Restore draft
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey));
    if (saved) {
      Object.entries(saved).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'refueled-check') {
          // handled below
        } else if (el.classList.contains('stepper-value')) {
          el.textContent = val;
        } else if (el.type === 'checkbox') {
          el.checked = val;
        } else {
          el.value = val;
        }
      });
      if (saved['refueled-check']) {
        const toggle = document.querySelector('[data-toggle-id="refueled-check"] .toggle-track');
        if (toggle && saved['refueled-check']) {
          toggle.classList.add('on');
          document.getElementById('refuel-fields').classList.remove('hidden');
        }
      }
    }
  } catch(e) {}
  // Clear draft on submit
  const origSubmit = onFlightSubmit;
  onFlightSubmit = async function(e) {
    localStorage.removeItem(draftKey);
    return origSubmit.call(this, e);
  };

  document.getElementById('flight-date').valueAsDate = new Date();
  updateFuelCalc();

    renderAircraftStatus();
    renderIntervalBars();
    renderETSO_PTSO();
    renderRecentFlights();
  });
}

function timeToMin(id) {
  const v = document.getElementById(id).value;
  if (!v) return 0;
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

function updateCalcDuration() {
  const t = timeToMin('takeoff-time');
  const l = timeToMin('landing-time');
  const el = document.getElementById('calc-duration');
  if (!t || !l || l <= t) { el.textContent = '—'; return; }
  el.textContent = (l - t) + ' min';
  updateFuelCalc();
}

function fuelVal(id) { return parseFloat(document.getElementById(id)?.value) || 0; }

function updateFuelCalc() {
  const before = fuelVal('fuel-before-left') + fuelVal('fuel-before-right');
  const after = fuelVal('fuel-after-left') + fuelVal('fuel-after-right');
  const consumed = Math.max(0, before - after);
  const durationMin = timeToMin('landing-time') - timeToMin('takeoff-time');
  const durationH = durationMin > 0 ? durationMin / 60 : 0;

  document.getElementById('calc-consumed').textContent = consumed > 0 ? consumed.toFixed(1) + ' gal' : '—';
  document.getElementById('calc-rate').textContent = (consumed > 0 && durationH > 0)
    ? (consumed / durationH).toFixed(1) + ' gal/hr'
    : '—';
}

async function onUpdateMeters() {
  const ac = await getAircraft();
  const newTach = parseFloat(document.getElementById('eod-tach').textContent) || 0;
  const newHobbs = parseFloat(document.getElementById('eod-hobbs').textContent) || 0;
  if (newTach <= 0) { showToast('Enter current tach reading', 'error'); return; }
  ac.totalTachTime = newTach;
  await DB.put('aircraft', ac);
  await queueSync('aircraft', 'update', ac);

  const hoursSinceOil = newTach - ac.lastOilChangeTach;
  const hoursSince100hr = newTach - ac.last100hrTach;
  if (hoursSinceOil >= 50) {
    await showOilChangePrompt(newTach);
  }
  if (hoursSince100hr >= 100) {
    await show100hrPrompt(newTach);
  }

  showToast(`Tach updated to ${newTach.toFixed(1)}h${newHobbs > 0 ? `, Hobbs ${newHobbs.toFixed(1)}h` : ''}`);
  renderAircraftStatus();
  renderIntervalBars();
  renderETSO_PTSO();
}

async function onFlightSubmit(e) {
  e.preventDefault();
  const pilot = document.getElementById('pilot-name').value.trim() || 'Unknown';
  const takeoffTime = document.getElementById('takeoff-time').value;
  const landingTime = document.getElementById('landing-time').value;
  const durationMin = timeToMin('landing-time') - timeToMin('takeoff-time');
  const duration = durationMin > 0 ? durationMin / 60 : 0;

  if (durationMin <= 0 || !takeoffTime || !landingTime) {
    showToast('Enter valid takeoff and landing times', 'error');
    return;
  }

  const fuelBeforeLeft = fuelVal('fuel-before-left');
  const fuelBeforeRight = fuelVal('fuel-before-right');
  const fuelAfterLeft = fuelVal('fuel-after-left');
  const fuelAfterRight = fuelVal('fuel-after-right');
  const fuelConsumed = Math.max(0, (fuelBeforeLeft + fuelBeforeRight) - (fuelAfterLeft + fuelAfterRight));
  const refuelToggle = document.querySelector('[data-toggle-id="refueled-check"]');
  const refueled = refuelToggle.querySelector('.toggle-track').classList.contains('on');
  const refuelAmt = refueled ? parseFloat(document.getElementById('refuel-amount').textContent) || 0 : 0;
  const refuelSrc = refueled ? document.getElementById('refuel-source').value : '';
  const fuelType = refueled ? document.getElementById('fuel-type').value : '';

  const ac = await getAircraft();
  const flight = {
    id: 'flt_' + Date.now(),
    aircraftId: ac.tailNumber,
    flightDate: document.getElementById('flight-date').value,
    pilotName: pilot,
    takeoffTime,
    landingTime,
    flownHours: duration,
    fuelBeforeLeft,
    fuelBeforeRight,
    fuelAfterLeft,
    fuelAfterRight,
    fuelConsumed,
    refueled,
    refuelAmount: refuelAmt,
    refuelSource: refuelSrc,
    fuelType,
    createdAt: new Date().toISOString()
  };

  await DB.put('flights', flight);
  await queueSync('flights', 'create', flight);

  ac.engineETSO = (ac.engineETSO || 0) + duration;
  ac.propellerPTSO = (ac.propellerPTSO || 0) + duration;
  ac.totalTachTime = (ac.totalTachTime || 0) + duration;
  await DB.put('aircraft', ac);
  await queueSync('aircraft', 'update', ac);

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
    showToast(`Flight logged & ${refuelAmt.toFixed(1)} gal deducted from stock`);
  } else {
    showToast('Flight logged successfully');
  }

  // Create after-flight inspection only if CRS was issued today
  const flightDate = flight.flightDate;
  const crsToday = ac.dailyCrsDate === flightDate;
  const releasedTasksToday = (await DB.getAll('maintenance_tasks')).filter(t =>
    t.aircraftId === ac.tailNumber && t.status === 'released' &&
    t.releasedAt && t.releasedAt.slice(0, 10) === flightDate
  );
  if (crsToday || releasedTasksToday.length > 0) {
    const inspTask = {
      id: 'insp_' + Date.now(),
      type: 'after-flight',
      aircraftId: ac.tailNumber,
      description: `After-flight inspection for ${flight.flightDate} flight (${(duration * 60).toFixed(0)} min)`,
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
  }

  document.getElementById('flight-form').reset();
  document.getElementById('flight-date').valueAsDate = new Date();
  document.getElementById('takeoff-time').value = '';
  document.getElementById('landing-time').value = '';
  ['fuel-before-left','fuel-before-right','fuel-after-left','fuel-after-right','refuel-amount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 0;
  });
  document.getElementById('calc-duration').textContent = '—';
  document.getElementById('calc-consumed').textContent = '—';
  document.getElementById('calc-rate').textContent = '—';
  renderAircraftStatus();
  renderIntervalBars();
  renderETSO_PTSO();
  renderRecentFlights();
}

async function showOilChangePrompt(currentTach) {
  const confirmed = await showConfirmDialog(
    '50-Hour Oil Change',
    'This flight brings the aircraft to the 50-hour oil change interval. Did you use 1 oil filter and 6 quarts of aviation oil?'
  );
  if (confirmed) {
    const filter = await DB.get('parts', 'OIL-FILTER-C152');
    if (filter && filter.quantityOnHand >= 1) {
      filter.quantityOnHand -= 1;
      await DB.put('parts', filter);
      await queueSync('parts', 'update', filter);
    }
    const oil = await DB.get('parts', 'AV-OIL-20W50');
    if (oil && oil.quantityOnHand >= 6) {
      oil.quantityOnHand -= 6;
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
    '100-Hour Structural Inspection',
    'This flight brings the aircraft to the 100-hour structural inspection interval. Has the inspection been completed?'
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
        <span class="label">Oil Change (50 hrs)</span>
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
        <span class="label">Structural Inspection (100 hrs)</span>
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

async function renderETSO_PTSO() {
  const ac = await getAircraft();
  const etso = ac.engineETSO || 0;
  const ptso = ac.propellerPTSO || 0;
  const eTBO = ac.engineTBO || 2000;
  const pTBO = ac.propellerTBO || 2000;
  const ePct = Math.min(100, (etso / eTBO) * 100);
  const pPct = Math.min(100, (ptso / pTBO) * 100);

  const el = document.getElementById('etso-ptso-bars');
  if (!el) return;
  el.innerHTML = `
    <div class="interval-item">
      <div class="interval-label">
        <span class="label">Engine TSO</span>
        <span class="interval-value ${etso >= eTBO ? 'text-red' : etso >= eTBO - 50 ? 'text-orange' : 'text-green'}">
          ${etso.toFixed(1)}h / ${eTBO}h
        </span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${etso >= eTBO ? 'fill-red' : etso >= eTBO - 50 ? 'fill-orange' : 'fill-green'}"
             style="width:${ePct}%"></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
        ${etso >= eTBO ? '<span class="text-red">Overhaul Due</span>' : `${(eTBO - etso).toFixed(1)}h until TBO`}
      </div>
    </div>
    <div class="interval-item">
      <div class="interval-label">
        <span class="label">Propeller TSO</span>
        <span class="interval-value ${ptso >= pTBO ? 'text-red' : ptso >= pTBO - 50 ? 'text-orange' : 'text-green'}">
          ${ptso.toFixed(1)}h / ${pTBO}h
        </span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${ptso >= pTBO ? 'fill-red' : ptso >= pTBO - 50 ? 'fill-orange' : 'fill-green'}"
             style="width:${pPct}%"></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
        ${ptso >= pTBO ? '<span class="text-red">Overhaul Due</span>' : `${(pTBO - ptso).toFixed(1)}h until TBO`}
      </div>
    </div>
  `;
}

async function deleteFlight(flightId) {
  const flight = await DB.get('flights', flightId);
  if (!flight) return;
  const h = flight.flownHours || 0;
  const confirmed = await showConfirmDialog('Delete Flight', `Delete this ${(h * 60).toFixed(0)} min flight and reverse ETSO/PTSO?`);
  if (!confirmed) return;
  const ac = await getAircraft();
  if (h > 0) {
    ac.engineETSO = Math.max(0, (ac.engineETSO || 0) - h);
    ac.propellerPTSO = Math.max(0, (ac.propellerPTSO || 0) - h);
    await DB.put('aircraft', ac);
    await queueSync('aircraft', 'update', ac);
  }
  await DB.del('flights', flightId);
  await queueSync('flights', 'delete', { id: flightId });
  showToast('Flight deleted & ETSO/PTSO reversed');
  renderRecentFlights();
  renderAircraftStatus();
  renderIntervalBars();
  renderETSO_PTSO();
}

async function renderRecentFlights() {
  const flights = await getFlights();
  const el = document.getElementById('recent-flights');
  if (flights.length === 0) {
    el.innerHTML = emptyState('&#9992;', 'No flights logged yet');
    return;
  }
  el.innerHTML = flights.slice(0, 20).map(f => `
    <div class="flight-row">
      <div style="flex:1;min-width:0">
        <div class="flight-pilot">${escHtml(f.pilotName)}</div>
        <div class="flight-date">${f.flightDate}${f.takeoffTime ? ` &middot; ${f.takeoffTime}-${f.landingTime}` : ''}</div>
        ${f.fuelConsumed ? `<div class="flight-date">Fuel: ${f.fuelConsumed.toFixed(1)} gal ${f.fuelConsumed > 0 && f.flownHours > 0 ? `&middot; ${(f.fuelConsumed / f.flownHours).toFixed(1)} gal/hr` : ''}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div class="flight-hours">${(f.flownHours * 60).toFixed(0)}m</div>
        <button class="btn btn-sm btn-danger del-flight-btn" data-id="${f.id}" style="padding:4px 8px;font-size:11px">&times;</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.del-flight-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteFlight(btn.dataset.id));
  });
}
