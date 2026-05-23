async function logHistory(type, description, relatedId, aircraftId) {
  const entry = {
    id: 'hist_' + Date.now(),
    type,
    description,
    relatedId: relatedId || '',
    aircraftId: aircraftId || getCurrentAircraftKey(),
    performedBy: localStorage.getItem('aac_user') || 'Unknown',
    userRole: localStorage.getItem('aac_user_role') || '',
    createdAt: new Date().toISOString()
  };
  await DB.put('flights', entry); // temp store — reads merged from all sources instead
}

async function getAllHistory() {
  const ac = getCurrentAircraftKey();
  const [flights, defects, tasks, fuelLogs, attendance] = await Promise.all([
    DB.getAll('flights').then(l => l.filter(f => f.aircraftId === ac || !f.aircraftId).map(f => ({ ...f, _type: 'flight', _desc: `Sortie: ${f.pilotName || 'Unknown'} — ${f.flownHours ? (f.flownHours * 60).toFixed(0) + 'min' : ''}`, _date: f.flightDate || f.createdAt }))),
    DB.getAll('defects').then(l => l.filter(d => d.aircraftId === ac || !d.aircraftId).map(d => ({ ...d, _type: 'defect', _desc: `Squawk: ${d.description}`, _date: d.createdAt || d.flightDate }))),
    DB.getAll('maintenance_tasks').then(l => l.filter(t => t.aircraftId === ac || !t.aircraftId).map(t => ({ ...t, _type: 'task', _desc: `Work Order: ${t.description} (${t.status})`, _date: t.createdAt }))),
    DB.getAll('fuel_logs').then(l => l.filter(f => f.aircraftId === ac || !f.aircraftId).map(f => ({ ...f, _type: 'fuel', _desc: `Fuel Ops: ${f.type || 'refuel'} — ${f.liters || 0}L`, _date: f.createdAt }))),
    DB.getAll('attendance').then(l => l.map(a => ({ ...a, _type: 'attendance', _desc: `Crew: ${a.userName || a.userId} — ${a.status}`, _date: a.date || a.createdAt })))
  ]);
  return [...flights, ...defects, ...tasks, ...fuelLogs, ...attendance]
    .filter(e => e._date)
    .sort((a, b) => (b._date || '').localeCompare(a._date || ''));
}

function calendarView() {
  const app = document.getElementById('app');
  const today = new Date().toISOString().slice(0, 10);
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Calendar &amp; History</h2>
        <div class="subtitle">Search all activity by date</div>
      </div>
      <div class="card">
        <div class="form-group">
          <label for="cal-date">Select Date</label>
          <input type="date" id="cal-date" value="${today}">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" id="cal-today-btn" style="flex:1">Today</button>
          <button class="btn btn-secondary btn-sm" id="cal-prev-btn" style="flex:1">Previous Day</button>
          <button class="btn btn-secondary btn-sm" id="cal-next-btn" style="flex:1">Next Day</button>
        </div>
      </div>
      <div id="cal-results"><p class="text-muted small">Select a date to view activity</p></div>
    </div>
  `;

  const dateInput = document.getElementById('cal-date');
  const results = document.getElementById('cal-results');

  async function loadDate(dateStr) {
    dateInput.value = dateStr;
    const all = await getAllHistory();
    const filtered = all.filter(e => (e._date || '').slice(0, 10) === dateStr);
    const ac = await getAircraft();

    let html = '';
    const insp = getInspectionStatus(ac);
    html += `<div class="card"><div class="card-header"><h3>Inspections on ${dateStr}</h3></div>`;
    if (dateStr === new Date().toISOString().slice(0, 10)) {
      html += `<div class="interval-item"><div class="interval-label"><span class="label">Oil Change (50hr)</span><span class="interval-value ${insp.oilClass}">${insp.oilRemaining.toFixed(1)}h left</span></div><div class="progress-bar"><div class="progress-fill ${insp.oilFill}" style="width:${insp.oilPct}%"></div></div></div>`;
      html += `<div class="interval-item"><div class="interval-label"><span class="label">Structural (100hr)</span><span class="interval-value ${insp.structClass}">${insp.structRemaining.toFixed(1)}h left</span></div><div class="progress-bar"><div class="progress-fill ${insp.structFill}" style="width:${insp.structPct}%"></div></div></div>`;
    } else {
      html += `<p class="text-muted small">No inspection data for this date</p>`;
    }
    html += `</div>`;

    if (filtered.length === 0) {
      html += `<p class="text-muted small" style="padding:20px 0">No activity on ${dateStr}</p>`;
    } else {
      html += `<div class="card"><div class="card-header"><h3>Activity (${filtered.length})</h3></div>`;
      filtered.forEach(e => {
        const icon = { flight: '&#9992;', defect: '&#9888;', task: '&#9881;', fuel: '&#9981;', attendance: '&#10003;' }[e._type] || '&#9679;';
        const color = { flight: 'var(--primary)', defect: 'var(--ruby)', task: 'var(--gold)', fuel: 'var(--emerald)', attendance: 'var(--text-muted)' }[e._type] || 'var(--text-muted)';
        html += `<div class="flight-row"><div style="flex:1;min-width:0"><span style="color:${color};margin-right:6px">${icon}</span><strong>${escHtml(e._desc)}</strong><div class="flight-date" style="font-size:10px">${e.performedBy || ''} ${e.userRole ? '(' + e.userRole + ')' : ''}</div></div></div>`;
      });
      html += `</div>`;
    }
    results.innerHTML = html;
  }

  document.getElementById('cal-date').addEventListener('change', () => loadDate(document.getElementById('cal-date').value));
  document.getElementById('cal-today-btn').addEventListener('click', () => loadDate(new Date().toISOString().slice(0, 10)));
  document.getElementById('cal-prev-btn').addEventListener('click', () => {
    const d = new Date(dateInput.value + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    loadDate(d.toISOString().slice(0, 10));
  });
  document.getElementById('cal-next-btn').addEventListener('click', () => {
    const d = new Date(dateInput.value + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    loadDate(d.toISOString().slice(0, 10));
  });

  loadDate(today);
}

function getInspectionStatus(ac) {
  const tach = ac.totalTachTime || 0;
  const hoursSinceOil = tach - (ac.lastOilChangeTach || 0);
  const hoursSince100hr = tach - (ac.last100hrTach || 0);
  const oilRemaining = Math.max(0, (ac.oilInterval || 50) - hoursSinceOil);
  const structRemaining = Math.max(0, (ac.structInterval || 100) - hoursSince100hr);
  const oilClass = hoursSinceOil >= (ac.oilInterval || 50) ? 'text-red' : hoursSinceOil >= (ac.oilInterval || 50) - 5 ? 'text-orange' : 'text-green';
  const structClass = hoursSince100hr >= (ac.structInterval || 100) ? 'text-red' : hoursSince100hr >= (ac.structInterval || 100) - 5 ? 'text-orange' : 'text-green';
  const oilFill = hoursSinceOil >= (ac.oilInterval || 50) ? 'fill-red' : hoursSinceOil >= (ac.oilInterval || 50) - 5 ? 'fill-orange' : 'fill-green';
  const structFill = hoursSince100hr >= (ac.structInterval || 100) ? 'fill-red' : hoursSince100hr >= (ac.structInterval || 100) - 5 ? 'fill-orange' : 'fill-green';
  const oilPct = Math.min(100, (hoursSinceOil / (ac.oilInterval || 50)) * 100);
  const structPct = Math.min(100, (hoursSince100hr / (ac.structInterval || 100)) * 100);
  return { oilRemaining, structRemaining, oilClass, structClass, oilFill, structFill, oilPct, structPct, oilDue: hoursSinceOil >= (ac.oilInterval || 50), structDue: hoursSince100hr >= (ac.structInterval || 100) };
}

function checkInspectionNotifications() {
  getAircraft().then(ac => {
    const insp = getInspectionStatus(ac);
    if (insp.oilRemaining <= 0) showToast('⚠ OIL CHANGE OVERDUE — 50hr interval exceeded', 'error');
    else if (insp.oilRemaining <= 5) showToast(`⚙ Oil change due in ${insp.oilRemaining.toFixed(1)}h`, 'warning');
    if (insp.structRemaining <= 0) showToast('⚠ STRUCTURAL INSPECTION OVERDUE — 100hr interval exceeded', 'error');
    else if (insp.structRemaining <= 5) showToast(`🔧 Structural inspection due in ${insp.structRemaining.toFixed(1)}h`, 'warning');
  });
}