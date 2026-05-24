const FUEL_TYPES = [
  { id: 'avgas', name: 'Avgas 100LL', quantityLiters: 1000, minSafeLevel: 200 },
  { id: 'mogas', name: 'Mogas', quantityLiters: 500, minSafeLevel: 200 },
  { id: 'mix', name: 'Mix', quantityLiters: 300, minSafeLevel: 40 }
];

async function seedFuelStock() {
  for (const ft of FUEL_TYPES) {
    const existing = await DB.get('fuel_stock', ft.id);
    if (!existing) {
      await DB.put('fuel_stock', { ...ft, lastUpdated: new Date().toISOString() });
    }
  }
}

async function getFuelStock() {
  return await DB.getAll('fuel_stock');
}

async function getFuelStockById(id) {
  return await DB.get('fuel_stock', id);
}

async function deductFuel(fuelType, liters) {
  if (typeof denyGuest === 'function' && denyGuest()) return null;
  await seedFuelStock();
  const stock = await DB.get('fuel_stock', fuelType);
  if (!stock) return;
  stock.quantityLiters = Math.max(0, stock.quantityLiters - liters);
  stock.lastUpdated = new Date().toISOString();
  await DB.put('fuel_stock', stock);
  await queueSync('fuel_stock', 'update', stock);
  return stock;
}

async function addFuel(fuelType, liters) {
  if (typeof denyGuest === 'function' && denyGuest()) return;
  await seedFuelStock();
  if (fuelType === 'mix') {
    const half = liters / 2;
    // Deduct avgas and mogas for making the mix
    for (const t of ['avgas', 'mogas']) {
      const stock = await DB.get('fuel_stock', t);
      if (stock) {
        stock.quantityLiters = Math.max(0, stock.quantityLiters - half);
        stock.lastUpdated = new Date().toISOString();
        await DB.put('fuel_stock', stock);
        await queueSync('fuel_stock', 'update', stock);
      }
    }
  }
  const stock = await DB.get('fuel_stock', fuelType);
  if (!stock) return;
  stock.quantityLiters += liters;
  stock.lastUpdated = new Date().toISOString();
  await DB.put('fuel_stock', stock);
  await queueSync('fuel_stock', 'update', stock);
  return stock;
}

async function getFuelLogs() {
  const ac = await getAircraft();
  return (await DB.getAll('fuel_logs'))
    .filter(l => !l.aircraftId || l.aircraftId === ac.tailNumber)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function fuelView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Fuel Management</h2>
        <div class="subtitle">Bulk Storage &amp; Refueling Records</div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Bulk Fuel Stock</h3>
          <button class="btn btn-sm btn-primary" id="topup-btn">+ Record Delivery</button>
        </div>
        <div id="fuel-stock-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:60%"></div></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Refueling Log</h3></div>
        <div id="fuel-log-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
      </div>
    </div>
  `;

  document.getElementById('topup-btn').addEventListener('click', showTopUpSheet);

  seedFuelStock().then(() => {
    renderFuelStock();
    renderFuelLogs();
  });
}

function showTopUpSheet() {
  showBottomSheet(`
    <div class="card-header"><h3>Record Fuel Delivery</h3></div>
    <div class="form-group">
      <label for="topup-type">Fuel Type</label>
      <select id="topup-type">
        <option value="avgas">Avgas 100LL</option>
        <option value="mogas">Mogas</option>
        <option value="mix">Mix</option>
      </select>
    </div>
    <div class="form-group">
      <label>Liters Added</label>
      ${stepperHTML('topup-liters', 200, 0, 99999, 50)}
    </div>
    <button class="btn btn-primary btn-block" id="confirm-topup-btn">Confirm Delivery</button>
    <button class="btn btn-secondary btn-block" id="cancel-topup-btn" style="margin-top:8px">Cancel</button>
  `);

  initSteppers();

  document.getElementById('confirm-topup-btn').addEventListener('click', async () => {
    const type = document.getElementById('topup-type').value;
    const liters = parseFloat(document.getElementById('topup-liters').value) || 0;
    if (liters <= 0) { showToast('Enter valid liters', 'error'); return; }

    await addFuel(type, liters);
    await DB.put('fuel_logs', {
      id: 'fuellog_' + Date.now(),
      aircraftId: getCurrentAircraftKey(),
      type: 'topup',
      fuelType: type,
      liters,
      source: 'Delivery',
      createdAt: new Date().toISOString()
    });
    await queueSync('fuel_logs', 'create', { fuelType: type, liters });

    if (type === 'mix') {
      const half = liters / 2;
      await DB.put('fuel_logs', {
        id: 'fuellog_' + Date.now() + '_1', aircraftId: getCurrentAircraftKey(),
        type: 'blend', fuelType: 'avgas', liters: -half,
        source: `Mix blend (${liters}L mix)`, createdAt: new Date().toISOString()
      });
      await DB.put('fuel_logs', {
        id: 'fuellog_' + Date.now() + '_2', aircraftId: getCurrentAircraftKey(),
        type: 'blend', fuelType: 'mogas', liters: -half,
        source: `Mix blend (${liters}L mix)`, createdAt: new Date().toISOString()
      });
    }

    showToast(`Added ${liters}L ${type.toUpperCase()} to stock`);
    window.__sheetClose(true);
    renderFuelStock();
    renderFuelLogs();
  });

  document.getElementById('cancel-topup-btn').addEventListener('click', () => {
    window.__sheetClose(null);
  });
}

async function deleteFuelStock(fuelId, fuelName) {
  const confirmed = await showConfirmDialog('Delete Fuel Type', `Delete ${fuelName} from stock permanently? Fuel logs will be preserved.`);
  if (!confirmed) return;
  await DB.del('fuel_stock', fuelId);
  await queueSync('fuel_stock', 'delete', { id: fuelId });
  showToast(`${fuelName} removed from stock`);
  renderFuelStock();
  renderFuelLogs();
  const invFuel = document.getElementById('fuel-stock-inv');
  if (invFuel && typeof renderInventory === 'function') renderInventory();
}

async function renderFuelStock() {
  const stocks = await getFuelStock();
  const el = document.getElementById('fuel-stock-list');
  if (stocks.length === 0) {
    el.innerHTML = '<p class="text-muted small">No fuel types configured. Add one via Record Fuel Delivery.</p>';
    return;
  }
  el.innerHTML = stocks.map(s => {
    const low = s.quantityLiters <= s.minSafeLevel;
    return `
      <div class="fuel-stock-item ${low ? 'fuel-low' : ''}">
        <div class="fuel-stock-header">
          <strong>${escHtml(s.name)}</strong>
          <div style="display:flex;align-items:center;gap:6px">
            <input type="number" class="form-input stock-qty-input" data-id="${s.id}" value="${s.quantityLiters}" min="0" style="width:70px;font-size:14px;text-align:center">
            <span style="font-size:12px;color:var(--text-muted)">L</span>
            <button class="btn btn-sm btn-danger del-fuel-stock-btn" data-id="${s.id}" data-name="${escHtml(s.name)}" style="padding:2px 6px;font-size:10px">&times;</button>
          </div>
        </div>
        <div class="progress-bar" style="margin-top:8px">
          <div class="progress-fill ${low ? 'fill-red' : 'fill-green'}"
               style="width:${Math.min(100, (s.quantityLiters / (s.minSafeLevel * 3)) * 100)}%"></div>
        </div>
        <div class="fuel-stock-min">Min safe level: ${s.minSafeLevel} L${low ? ' &mdash; <span class="text-red">LOW STOCK</span>' : ''}</div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.stock-qty-input').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.dataset.id;
      const v = Math.max(0, parseFloat(input.value) || 0);
      input.value = v;
      await updateFuelStockQty(id, v);
    });
  });
  el.querySelectorAll('.del-fuel-stock-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteFuelStock(btn.dataset.id, btn.dataset.name));
  });
}

async function updateFuelStockQty(id, qty) {
  const stock = await DB.get('fuel_stock', id);
  if (!stock) return;
  const diff = qty - stock.quantityLiters;
  stock.quantityLiters = qty;
  stock.lastUpdated = new Date().toISOString();
  await DB.put('fuel_stock', stock);
  await queueSync('fuel_stock', 'update', stock);
  // Log the adjustment
  if (diff !== 0) {
    const reason = await showPromptDialog('Stock Adjustment', `Reason for ${diff > 0 ? 'adding' : 'removing'} ${Math.abs(diff).toFixed(1)}L ${stock.name}?`);
    if (reason) {
      await DB.put('fuel_logs', {
        id: 'fuellog_' + Date.now(),
        fuelType: stock.id,
        type: 'adjustment',
        liters: diff,
        source: reason.trim(),
        createdAt: new Date().toISOString()
      });
    }
  }
  renderFuelStock();
  const invEl = document.getElementById('fuel-stock-inv');
  if (invEl && typeof renderInventory === 'function') renderInventory();
}

async function deleteFuelLog(logId, logType, fuelType, liters) {
  const confirmed = await showConfirmDialog('Delete Record', `Delete this ${logType} record of ${liters}L ${fuelType}? This reverses the stock change.`);
  if (!confirmed) return;
  if (logType === 'topup') {
    await deductFuel(fuelType, liters);
  } else if (logType === 'refuel') {
    await addFuel(fuelType, liters);
  }
  await DB.del('fuel_logs', logId);
  await queueSync('fuel_logs', 'delete', { id: logId });
  showToast('Fuel record deleted & stock adjusted');
  renderFuelLogs();
  renderFuelStock();
}

async function renderFuelLogs() {
  const logs = await getFuelLogs();
  const el = document.getElementById('fuel-log-list');
  if (logs.length === 0) {
    el.innerHTML = emptyState('&#9981;', 'No refueling records yet');
    return;
  }
  el.innerHTML = logs.slice(0, 20).map(l => `
    <div class="flight-row">
      <div>
        <div class="flight-pilot">${escHtml(l.source)}</div>
        <div class="flight-date">${new Date(l.createdAt).toLocaleDateString()} &middot; ${escHtml(l.fuelType)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="flight-hours">+${l.liters}L</div>
        <button class="btn btn-sm btn-danger del-fuel-btn" data-id="${l.id}" data-type="${l.type}" data-fuel="${l.fuelType}" data-liters="${l.liters}" style="padding:4px 8px;font-size:11px">&times;</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.del-fuel-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteFuelLog(btn.dataset.id, btn.dataset.type, btn.dataset.fuel, parseFloat(btn.dataset.liters)));
  });
}


