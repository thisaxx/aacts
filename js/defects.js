async function getDefects() {
  const ac = await getAircraft();
  return (await DB.getAll('defects'))
    .filter(d => d.aircraftId === ac.tailNumber)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getOpenDefects() {
  const all = await getDefects();
  return all.filter(d => d.status === 'open' || d.status === 'in-work');
}

function defectsView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Defects &amp; Squawks</h2>
        <div class="subtitle">Report issues &amp; track resolutions</div>
      </div>

      <button class="btn btn-primary btn-block" id="report-defect-btn">+ Report Defect</button>

      <div class="card">
        <div class="card-header">
          <h3>Open Squawks</h3>
        </div>
      <div id="open-defects"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:50%"></div></div>
      <div class="card">
        <div class="card-header"><h3>Resolved</h3></div>
        <div id="resolved-defects"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
      </div>
    </div>
  `;

  document.getElementById('report-defect-btn').addEventListener('click', showDefectSheet);

  renderDefects();
}

function showDefectSheet() {
  showBottomSheet(`
    <div class="card-header"><h3>Report New Defect</h3></div>
    <div class="form-group">
      <label for="defect-desc">Description of Issue</label>
      <textarea id="defect-desc" rows="3" placeholder="e.g. Rough engine idle, Fuel gauge fluctuating..."></textarea>
    </div>
    <div class="form-group">
      <label>Urgency</label>
      <div class="urgency-selector">
        <label class="urgency-option">
          <input type="radio" name="urgency" value="grounding" checked hidden>
          <span class="urgency-btn urgency-danger">&#9888; Grounding</span>
        </label>
        <label class="urgency-option">
          <input type="radio" name="urgency" value="monitor" hidden>
          <span class="urgency-btn urgency-warning">&#128200; Monitor</span>
        </label>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="save-defect-btn">Submit Defect</button>
    <button class="btn btn-secondary btn-block" id="cancel-defect-btn" style="margin-top:8px">Cancel</button>
  `);

  document.getElementById('save-defect-btn').addEventListener('click', async () => {
    const desc = document.getElementById('defect-desc').value.trim();
    const urgencyEl = document.querySelector('input[name="urgency"]:checked');
    const urgency = urgencyEl ? urgencyEl.value : 'monitor';
    if (!desc) { showToast('Please describe the defect', 'error'); return; }

    const defect = {
      id: 'def_' + Date.now(),
      aircraftId: getCurrentAircraftKey(),
      description: desc,
      urgency,
      status: 'open',
      reportedBy: localStorage.getItem('aac_user') || 'Flight Ops',
      reportedAt: new Date().toISOString(),
      workOrderId: null,
      createdAt: new Date().toISOString()
    };

    await DB.put('defects', defect);
    await queueSync('defects', 'create', defect);

    if (urgency === 'grounding') {
      const task = {
        id: 'mnt_' + Date.now(),
        aircraftId: defect.aircraftId,
        description: 'GROUNDING DEFECT: ' + desc,
        priority: 'critical',
        status: 'open',
        defectId: defect.id,
        technicianNotes: '',
        rectifiedBy: '',
        rectifiedAt: '',
        releasedBy: '',
        releasedAt: '',
        createdAt: new Date().toISOString()
      };
      await DB.put('maintenance_tasks', task);
      await queueSync('maintenance_tasks', 'create', task);
      defect.workOrderId = task.id;
      await DB.put('defects', defect);
      await queueSync('defects', 'update', defect);
      showToast('Grounding defect reported & work order created', 'warning');
    } else {
      showToast('Monitor defect reported');
    }

    window.__sheetClose(true);
    renderDefects();
  });

  document.getElementById('cancel-defect-btn').addEventListener('click', () => {
    window.__sheetClose(null);
  });
}



async function renderDefects() {
  const defects = await getDefects();
  const open = defects.filter(d => d.status === 'open' || d.status === 'in-work');
  const resolved = defects.filter(d => d.status === 'rectified' || d.status === 'released');

  const openEl = document.getElementById('open-defects');
  const resolvedEl = document.getElementById('resolved-defects');

  if (open.length === 0) {
    openEl.innerHTML = '<p class="text-muted small">No open squawks</p>';
  } else {
    openEl.innerHTML = open.map(d => defectCard(d)).join('');
  }

  if (resolved.length === 0) {
    resolvedEl.innerHTML = '<p class="text-muted small">No resolved defects</p>';
  } else {
    resolvedEl.innerHTML = resolved.map(d => defectCard(d)).join('');
  }

  document.querySelectorAll('.resolve-defect-btn').forEach(btn => {
    btn.addEventListener('click', () => resolveDefect(btn.dataset.id));
  });
  document.querySelectorAll('.del-defect-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const role = localStorage.getItem('aac_user_role');
      if (role !== 'engineer' && role !== 'admin') {
        showToast('Only Engineer or Admin can delete defects');
        return;
      }
      const id = btn.dataset.id;
      const confirmed = await showConfirmDialog('Delete Defect', 'Delete this defect permanently?');
      if (!confirmed) return;
      await DB.del('defects', id);
      await queueSync('defects', 'delete', { id });
      showToast('Defect deleted');
      renderDefects();
    });
  });
}

function defectCard(defect) {
  const role = localStorage.getItem('aac_user_role');
  const canResolve = role === 'engineer' || role === 'senior_technician' || role === 'admin';
  const canDelete = role === 'engineer' || role === 'admin';
  const urgencyLabel = defect.urgency === 'grounding'
    ? '<span class="badge badge-open" style="border-color:rgba(239,68,68,0.3)">GROUNDING</span>'
    : '<span class="badge badge-rectified">MONITOR</span>';
  const statusLabel = {
    open: '<span class="badge badge-open">Open</span>',
    'in-work': '<span class="badge badge-rectified">In Work</span>',
    rectified: '<span class="badge badge-rectified">Rectified</span>',
    released: '<span class="badge badge-released">Released</span>'
  };

  return `
    <div class="task-card" style="border-left:3px solid ${defect.urgency === 'grounding' ? 'var(--danger)' : 'var(--gold)'}">
      <div class="task-header">
        ${urgencyLabel}
        ${statusLabel[defect.status]}
      </div>
      <p class="task-desc">${escHtml(defect.description)}</p>
      <p class="task-meta">Reported by ${escHtml(defect.reportedBy)} &middot; ${new Date(defect.createdAt).toLocaleDateString()}</p>
      <div class="task-actions">
        ${defect.status === 'open' && canResolve ? `<button class="btn btn-sm btn-success resolve-defect-btn" data-id="${defect.id}">Resolve</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm btn-danger del-defect-btn" data-id="${defect.id}" style="padding:4px 8px;font-size:11px">&times;</button>` : ''}
      </div>
    </div>
  `;
}

async function resolveDefect(defectId) {
  const role = localStorage.getItem('aac_user_role');
  if (role !== 'engineer' && role !== 'senior_technician' && role !== 'admin') {
    showToast('Only Engineer or Senior Technician can resolve defects');
    return;
  }
  const confirmed = await showConfirmDialog('Resolve Defect', 'Mark this defect as rectified?');
  if (!confirmed) return;
  const defect = await DB.get('defects', defectId);
  if (!defect) return;
  defect.status = 'rectified';
  await DB.put('defects', defect);
  await queueSync('defects', 'update', defect);
  showToast('Defect resolved');
  renderDefects();
}
