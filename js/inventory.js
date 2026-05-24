const DEFAULT_PARTS = [
  { partNumber: 'OIL-FILTER-C152', description: 'Oil Filter - Cessna 152', quantityOnHand: 10, minSafeStock: 3 },
  { partNumber: 'AV-OIL-20W50', description: 'Aviation Oil 20W-50 (ml)', quantityOnHand: 22712, minSafeStock: 5678 },
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
        <h2>Component Inventory</h2>
        <div class="subtitle">Component inventory management</div>
      </div>

      <div class="card">
        <div class="form-group">
          <input type="text" id="inv-search" class="form-input" placeholder="Search parts..." style="font-size:12px">
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Component Catalog</h3>
          <button class="btn btn-sm btn-primary" id="add-part-btn">+ Add Part</button>
        </div>
        <div id="add-part-form" class="hidden" style="margin-bottom:14px">
          <div class="form-group">
            <label>Part Number</label>
            <input type="text" id="part-number" placeholder="e.g. OIL-FILTER-C152">
          </div>
          <div class="form-group">
            <label>Description</label>
            <input type="text" id="part-desc" placeholder="e.g. Oil Filter">
          </div>
          <div class="row">
            <div class="form-group">
              <label>Quantity</label>
              <input type="number" id="part-qty" value="1" min="0">
            </div>
            <div class="form-group">
              <label>Min Stock Level</label>
              <input type="number" id="part-min" value="1" min="0">
            </div>
          </div>
          <div class="row" style="gap:6px">
            <button class="btn btn-sm btn-primary" id="save-part-btn">Save Part</button>
            <button class="btn btn-sm btn-secondary" id="cancel-part-btn">Cancel</button>
          </div>
        </div>
        <div id="inventory-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Low Inventory Alerts</h3></div>
        <div id="low-stock-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
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
  document.getElementById('inv-search').addEventListener('input', renderInventory);

  seedParts().then(() => {
    renderInventory();
    populateAdjustSelect();
  }).catch(e => {
    console.error('Seed error:', e);
    renderInventory();
    populateAdjustSelect();
  });
}

async function onSavePart() {
  if (typeof denyGuest === 'function' && denyGuest()) return;
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
  if (typeof denyGuest === 'function' && denyGuest()) return;
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
  const parts = await getParts();
  const q = (document.getElementById('inv-search')?.value || '').toLowerCase();
  const filtered = q ? parts.filter(p => p.partNumber.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) : parts;
  const list = document.getElementById('inventory-list');
  const lowEl = document.getElementById('low-stock-list');

  list.innerHTML = `
    <table class="inv-table">
      <thead><tr><th>Part #</th><th>Description</th><th>On Hand</th><th>Min</th><th></th></tr></thead>
      <tbody>
        ${filtered.map(p => {
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
      if (typeof denyGuest === 'function' && denyGuest()) return;
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
  const allLow = [];

  for (const p of lowParts) {
    allLow.push(`<div class="low-stock-item"><strong>${escHtml(p.partNumber)}</strong> - ${escHtml(p.description)}<br><span class="text-red">${p.quantityOnHand} on hand (min: ${p.minSafeStock})</span></div>`);
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
      ${stepperHTML('add-fuel-liters', 100, 0, 99999, 0.1)}
    </div>
    <div class="form-group">
      <label>Source</label>
      <input type="text" id="add-fuel-source" class="form-input" placeholder="e.g. Manual add" value="Manual add">
    </div>
    <button class="btn btn-primary btn-block" id="add-fuel-btn">Add Fuel Stock</button>
    <button class="btn btn-secondary btn-block" id="cancel-add-stock-btn" style="margin-top:8px">Cancel</button>
  `);

  document.getElementById('add-fuel-btn').addEventListener('click', async () => {
    if (typeof denyGuest === 'function' && denyGuest()) return;
    const liters = parseFloat(document.getElementById('add-fuel-liters').value) || 0;
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
      ${stepperHTML('reduce-fuel-liters', 50, 0, 99999, 0.1)}
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
    if (typeof denyGuest === 'function' && denyGuest()) return;
    const liters = parseFloat(document.getElementById('reduce-fuel-liters').value) || 0;
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
