const DEFAULT_PARTS = [
  { partNumber: 'OIL-FILTER-C152', description: 'Oil Filter - Cessna 152', quantityOnHand: 10, minSafeStock: 3 },
  { partNumber: 'AV-OIL-20W50', description: 'Aviation Oil 20W-50 (qt)', quantityOnHand: 24, minSafeStock: 6 },
  { partNumber: 'SPARK-PLUG-C152', description: 'Spark Plug - Cessna 152', quantityOnHand: 16, minSafeStock: 4 },
  { partNumber: 'AIR-FILTER-C152', description: 'Air Filter - Cessna 152', quantityOnHand: 5, minSafeStock: 2 },
  { partNumber: 'TIRE-6006', description: 'Main Tire 6.00-6', quantityOnHand: 4, minSafeStock: 2 },
  { partNumber: 'TIRE-5005', description: 'Nose Tire 5.00-5', quantityOnHand: 4, minSafeStock: 2 },
  { partNumber: 'BRAKE-LINING', description: 'Brake Lining Set', quantityOnHand: 6, minSafeStock: 2 },
  { partNumber: 'VACUUM-PUMP', description: 'Vacuum Pump', quantityOnHand: 2, minSafeStock: 1 },
  { partNumber: 'BATTERY-GILL', description: 'Battery G-243', quantityOnHand: 3, minSafeStock: 1 },
  { partNumber: 'CABIN-FILTER', description: 'Cabin Air Filter', quantityOnHand: 8, minSafeStock: 2 }
];

async function seedParts() {
  const existing = await DB.getAll('parts');
  if (existing.length === 0) {
    for (const part of DEFAULT_PARTS) {
      await DB.put('parts', part);
    }
  }
}

async function getParts() {
  return await DB.getAll('parts');
}

function inventoryView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Stock &amp; Inventory</h2>
        <div class="subtitle">Parts &amp; Bulk Fuel</div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Fuel Stock</h3>
        </div>
        <div id="fuel-stock-inv"><p class="text-muted small">Loading...</p></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Parts</h3>
          <button class="btn btn-sm btn-primary" id="add-part-btn">+ Add Part</button>
        </div>
        <div id="add-part-form" class="hidden">
          <div class="form-group">
            <label for="part-number">Part Number</label>
            <input type="text" id="part-number" placeholder="e.g. OIL-FILTER-C152">
          </div>
          <div class="form-group">
            <label for="part-desc">Description</label>
            <input type="text" id="part-desc" placeholder="Part description">
          </div>
          <div class="row">
            <div class="form-group">
              <label for="part-qty">Quantity on Hand</label>
              <input type="number" id="part-qty" min="0">
            </div>
            <div class="form-group">
              <label for="part-min">Min Safe Stock</label>
              <input type="number" id="part-min" min="0">
            </div>
          </div>
          <button class="btn btn-primary" id="save-part-btn">Save Part</button>
          <button class="btn btn-secondary" id="cancel-part-btn">Cancel</button>
        </div>
        <div id="inventory-list"><p class="text-muted small">Loading...</p></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Low Stock &amp; Fuel Alerts</h3>
        </div>
        <div id="low-stock-list"><p class="text-muted small">Loading...</p></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Quick Adjust Parts</h3>
        </div>
        <div class="form-group">
          <label for="adjust-part">Select Part</label>
          <select id="adjust-part"><option value="">Loading...</option></select>
        </div>
        <div class="row">
          <div class="form-group">
            <label for="adjust-qty">Adjust Quantity by</label>
            <input type="number" id="adjust-qty" value="1" min="1">
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <div class="row" style="gap:6px">
              <button class="btn btn-sm btn-primary" id="adj-add">+ Add</button>
              <button class="btn btn-sm btn-danger" id="adj-remove">- Remove</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('add-part-btn').addEventListener('click', () => {
    document.getElementById('add-part-form').classList.remove('hidden');
  });
  document.getElementById('cancel-part-btn').addEventListener('click', () => {
    document.getElementById('add-part-form').classList.add('hidden');
  });
  document.getElementById('save-part-btn').addEventListener('click', onSavePart);
  document.getElementById('adj-add').addEventListener('click', () => adjustPart(1));
  document.getElementById('adj-remove').addEventListener('click', () => adjustPart(-1));

  seedParts().then(() => seedFuelStock()).then(() => {
    renderInventory();
    populateAdjustSelect();
  }).catch(e => {
    console.error('Seed error:', e);
    renderInventory();
    populateAdjustSelect();
  });
}

async function onSavePart() {
  const pn = document.getElementById('part-number').value.trim().toUpperCase();
  const desc = document.getElementById('part-desc').value.trim();
  const qty = parseInt(document.getElementById('part-qty').value) || 0;
  const min = parseInt(document.getElementById('part-min').value) || 0;
  if (!pn || !desc) { showToast('Please fill in all fields', 'error'); return; }

  const part = { partNumber: pn, description: desc, quantityOnHand: qty, minSafeStock: min };
  await DB.put('parts', part);
  await queueSync('parts', 'create', part);
  showToast('Part added');
  document.getElementById('add-part-form').classList.add('hidden');
  document.getElementById('part-number').value = '';
  document.getElementById('part-desc').value = '';
  document.getElementById('part-qty').value = '';
  document.getElementById('part-min').value = '';
  renderInventory();
  populateAdjustSelect();
}

async function adjustPart(dir) {
  const select = document.getElementById('adjust-part');
  const pn = select.value;
  const qty = parseInt(document.getElementById('adjust-qty').value) || 1;
  if (!pn) { showToast('Select a part', 'error'); return; }

  const part = await DB.get('parts', pn);
  if (!part) return;
  part.quantityOnHand = Math.max(0, part.quantityOnHand + (dir * qty));
  await DB.put('parts', part);
  await queueSync('parts', 'update', part);
  showToast(`${part.partNumber}: ${part.quantityOnHand} on hand`);
  renderInventory();
}

async function populateAdjustSelect() {
  const parts = await getParts();
  const select = document.getElementById('adjust-part');
  select.innerHTML = parts.map(p =>
    `<option value="${p.partNumber}">${p.partNumber} - ${p.description}</option>`
  ).join('');
}

async function renderInventory() {
  await seedFuelStock();
  const parts = await getParts();
  const list = document.getElementById('inventory-list');
  const lowEl = document.getElementById('low-stock-list');
  const fuelEl = document.getElementById('fuel-stock-inv');

  const fuelStocks = await getFuelStock();

  if (!fuelStocks || fuelStocks.length === 0) {
    fuelEl.innerHTML = '<p class="text-muted small">No fuel stock configured. Add fuel via <strong>Fuel</strong> tab or record a delivery.</p>';
  } else {
    fuelEl.innerHTML = fuelStocks.map(fs => {
      const low = fs.quantityLiters <= fs.minSafeLevel;
      const mixAlert = fs.id === 'mix' && fs.quantityLiters < 50;
      return `
      <div class="fuel-stock-item ${low ? 'fuel-low' : ''}" style="margin-bottom:10px">
        <div class="fuel-stock-header" style="display:flex;justify-content:space-between;align-items:center">
          <strong>${escHtml(fs.name)}</strong>
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:16px;font-weight:700;${low ? 'color:var(--ruby)' : 'color:var(--emerald)'}">${fs.quantityLiters}L</span>
            <button class="btn btn-sm btn-danger inv-del-fuel-stock-btn" data-id="${fs.id}" data-name="${escHtml(fs.name)}" style="padding:2px 6px;font-size:10px">&times;</button>
          </div>
        </div>
        <div style="display:flex;gap:4px;margin-top:6px">
          <button class="btn btn-sm btn-primary fuel-add-btn" data-id="${fs.id}" data-name="${escHtml(fs.name)}" style="padding:4px 8px;font-size:11px;flex:1">+ Add Stock</button>
          <button class="btn btn-sm btn-danger fuel-reduce-btn" data-id="${fs.id}" data-name="${escHtml(fs.name)}" style="padding:4px 8px;font-size:11px;flex:1">- Reduce Stock</button>
        </div>
        <div class="progress-bar" style="margin-top:6px">
          <div class="progress-fill ${low ? 'fill-red' : 'fill-green'}"
               style="width:${Math.min(100, (fs.quantityLiters / (fs.minSafeLevel * 3)) * 100)}%"></div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
          Min: ${fs.minSafeLevel}L ${low ? '&mdash; <span class="text-red">LOW STOCK</span>' : ''} ${mixAlert ? '&mdash; <span class="text-red">Below 50L threshold</span>' : ''}
        </div>
      </div>
    `;
    }).join('');

    fuelEl.querySelectorAll('.fuel-add-btn').forEach(btn => {
      btn.addEventListener('click', () => showFuelAddSheet(btn.dataset.id, btn.dataset.name));
    });
    fuelEl.querySelectorAll('.fuel-reduce-btn').forEach(btn => {
      btn.addEventListener('click', () => showFuelReduceSheet(btn.dataset.id, btn.dataset.name));
    });
  }

  list.innerHTML = `
    <table class="inv-table">
      <thead><tr><th>Part #</th><th>Description</th><th>On Hand</th><th>Min</th><th></th></tr></thead>
      <tbody>
        ${parts.map(p => {
          const low = p.quantityOnHand <= p.minSafeStock;
          return `<tr class="${low ? 'row-low' : ''}">
            <td>${escHtml(p.partNumber)}</td>
            <td>${escHtml(p.description)}</td>
            <td class="${low ? 'text-red bold' : ''}">${p.quantityOnHand}</td>
            <td>${p.minSafeStock}</td>
            <td><button class="btn btn-sm btn-danger del-part-btn" data-pn="${p.partNumber}" style="padding:2px 6px;font-size:10px">&times;</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;

  list.querySelectorAll('.del-part-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pn = btn.dataset.pn;
      const confirmed = await showConfirmDialog('Delete Part', `Delete ${pn} permanently?`);
      if (!confirmed) return;
      await DB.del('parts', pn);
      await queueSync('parts', 'delete', { partNumber: pn });
      showToast(`Deleted ${pn}`);
      renderInventory();
      populateAdjustSelect();
    });
  });

  const lowParts = parts.filter(p => p.quantityOnHand <= p.minSafeStock);
  const lowFuels = fuelStocks.filter(fs => fs.quantityLiters <= fs.minSafeLevel);
  const mixStock = fuelStocks.find(fs => fs.id === 'mix');
  const allLow = [];

  for (const p of lowParts) {
    allLow.push(`<div class="low-stock-item"><strong>${escHtml(p.partNumber)}</strong> - ${escHtml(p.description)}<br><span class="text-red">${p.quantityOnHand} on hand (min: ${p.minSafeStock})</span></div>`);
  }
  for (const fs of lowFuels) {
    allLow.push(`<div class="low-stock-item" style="border-color:rgba(245,158,11,0.3)"><strong>${escHtml(fs.name)}</strong> - Bulk Fuel<br><span class="text-red">${fs.quantityLiters}L remaining (min: ${fs.minSafeLevel}L)</span></div>`);
  }
  if (mixStock && mixStock.quantityLiters < 50 && mixStock.quantityLiters > mixStock.minSafeLevel) {
    allLow.push(`<div class="low-stock-item" style="border-color:rgba(239,68,68,0.3)"><strong>Mix</strong> - Bulk Fuel<br><span class="text-red">${mixStock.quantityLiters}L remaining — below 50L threshold</span></div>`);
  }

  if (allLow.length === 0) {
    lowEl.innerHTML = '<p class="text-green">All stock levels are healthy</p>';
  } else {
    lowEl.innerHTML = allLow.join('');
  }
}

function logFuelEvent(fuelType, liters, source) {
  return DB.put('fuel_logs', {
    id: 'fuel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    aircraftId: getCurrentAircraftKey(),
    fuelType,
    liters,
    source,
    date: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString()
  });
}

function showFuelAddSheet(fuelId, fuelName) {
  showBottomSheet(`
    <div class="card-header"><h3>Add Stock — ${escHtml(fuelName)}</h3></div>
    <div class="form-group">
      <label>Liters to Add</label>
      ${stepperHTML('add-fuel-liters', 100, 0, 99999, 10)}
    </div>
    <div class="form-group">
      <label>Source</label>
      <input type="text" id="add-fuel-source" placeholder="e.g. Delivery, Bowser, etc." value="Delivery">
    </div>
    <button class="btn btn-primary btn-block" id="confirm-add-stock-btn">Add to Stock</button>
    <button class="btn btn-secondary btn-block" id="cancel-add-stock-btn" style="margin-top:8px">Cancel</button>
  `);
  initSteppers();
  document.getElementById('confirm-add-stock-btn').addEventListener('click', async () => {
    const liters = parseFloat(document.getElementById('add-fuel-liters').textContent) || 0;
    const source = document.getElementById('add-fuel-source').value.trim() || 'Manual add';
    if (liters <= 0) { showToast('Enter valid liters', 'error'); return; }

    await addFuel(fuelId, liters);
    await logFuelEvent(fuelId, liters, source);

    if (fuelId === 'mix') {
      const half = liters / 2;
      await logFuelEvent('avgas', -half, `Mix blend (${fuelName})`);
      await logFuelEvent('mogas', -half, `Mix blend (${fuelName})`);
    }

    showToast(`Added ${liters}L to ${fuelName}`);
    window.__sheetClose(true);
    renderInventory();
  });
  document.getElementById('cancel-add-stock-btn').addEventListener('click', () => window.__sheetClose(null));
}

function showFuelReduceSheet(fuelId, fuelName) {
  showBottomSheet(`
    <div class="card-header"><h3>Reduce Stock — ${escHtml(fuelName)}</h3></div>
    <div class="form-group">
      <label>Liters to Remove</label>
      ${stepperHTML('reduce-fuel-liters', 50, 0, 99999, 10)}
    </div>
    <div class="form-group">
      <label>Reason</label>
      <input type="text" id="reduce-fuel-reason" placeholder="e.g. Spill, transfer, etc." value="Manual reduction">
    </div>
    <button class="btn btn-danger btn-block" id="confirm-reduce-stock-btn">Remove from Stock</button>
    <button class="btn btn-secondary btn-block" id="cancel-reduce-stock-btn" style="margin-top:8px">Cancel</button>
  `);
  initSteppers();
  document.getElementById('confirm-reduce-stock-btn').addEventListener('click', async () => {
    const liters = parseFloat(document.getElementById('reduce-fuel-liters').textContent) || 0;
    const reason = document.getElementById('reduce-fuel-reason').value.trim() || 'Manual reduction';
    if (liters <= 0) { showToast('Enter valid liters', 'error'); return; }

    const stock = await DB.get('fuel_stock', fuelId);
    if (!stock) return;
    const actual = Math.min(liters, stock.quantityLiters);
    stock.quantityLiters = Math.max(0, stock.quantityLiters - liters);
    stock.lastUpdated = new Date().toISOString();
    await DB.put('fuel_stock', stock);
    await queueSync('fuel_stock', 'update', stock);
    await logFuelEvent(fuelId, -actual, reason);

    showToast(`Removed ${actual}L from ${fuelName}`);
    window.__sheetClose(true);
    renderInventory();
  });
  document.getElementById('cancel-reduce-stock-btn').addEventListener('click', () => window.__sheetClose(null));
}
