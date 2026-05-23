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
        <h2>Squawks</h2>
        <div class="subtitle">Report issues &amp; track resolutions</div>
      </div>

      <button class="btn btn-primary btn-block" id="report-defect-btn">+ Report Squawk</button>

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
    <div class="card-header"><h3>Report New Squawk</h3></div>
    <div class="form-group">
      <label for="defect-desc">Description of Squawk</label>
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
    <div class="form-group">
      <label for="defect-assign">Assign To</label>
      <select id="defect-assign" class="form-input">
        <option value="">Unassigned</option>
      </select>
    </div>
    <div class="form-group">
      <label>Photo (optional)</label>
      <input type="file" id="defect-photo-input" accept="image/*" style="display:none">
      <button class="btn btn-sm btn-secondary" id="defect-photo-btn" style="font-size:11px">+ Attach Photo</button>
      <div id="defect-photo-preview" style="margin-top:6px;max-width:100%;border-radius:8px;overflow:hidden;display:none">
        <img id="defect-photo-img" style="width:100%;max-height:150px;object-fit:cover">
        <button class="btn btn-sm btn-ghost" id="defect-photo-remove" style="font-size:10px">Remove</button>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="save-defect-btn">Submit Squawk</button>
    <button class="btn btn-secondary btn-block" id="cancel-defect-btn" style="margin-top:8px">Cancel</button>
  `);

  // Populate crew selector
  DB.getAll('users').then(users => {
    const sel = document.getElementById('defect-assign');
    if (!sel) return;
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = u.name + (u.role ? ' (' + u.role.replace(/_/g, ' ') + ')' : '');
      sel.appendChild(opt);
    });
  });

  let defectPhotoData = null;
  document.getElementById('defect-photo-btn').addEventListener('click', () => {
    document.getElementById('defect-photo-input').click();
  });
  document.getElementById('defect-photo-input').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
      defectPhotoData = await compressImage(e.target.result, 800, 600, 0.6);
      const preview = document.getElementById('defect-photo-preview');
      document.getElementById('defect-photo-img').src = defectPhotoData;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
    this.value = '';
  });
  document.getElementById('defect-photo-remove').addEventListener('click', () => {
    defectPhotoData = null;
    document.getElementById('defect-photo-preview').style.display = 'none';
  });

  document.getElementById('save-defect-btn').addEventListener('click', async () => {
    const desc = document.getElementById('defect-desc').value.trim();
    const urgencyEl = document.querySelector('input[name="urgency"]:checked');
    const urgency = urgencyEl ? urgencyEl.value : 'monitor';
    if (!desc) {     showToast('Please describe the squawk', 'error'); return; }

    const assignedTo = document.getElementById('defect-assign')?.value || '';

    const defect = {
      id: 'def_' + Date.now(),
      aircraftId: getCurrentAircraftKey(),
      description: desc,
      urgency,
      status: 'open',
      assignedTo,
      photoData: defectPhotoData,
      reportedBy: localStorage.getItem('aac_user') || 'Flight Ops',
      reportedAt: new Date().toISOString(),
      workOrderId: null,
      createdAt: new Date().toISOString()
    };

    await DB.put('defects', defect);
    await queueSync('defects', 'create', defect);

    const user = localStorage.getItem('aac_user') || 'Unknown';
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
      showToast('Grounding squawk reported & work order created', 'warning');
      createNotification('squawk', 'Grounding Squawk Reported', `${user} reported a grounding squawk on ${defect.aircraftId}: ${desc}`, 'defects');
      logActivity('defect_grounding', `${user} reported grounding squawk: ${desc} on ${defect.aircraftId}`, defect.id);
    } else {
      showToast('Monitor squawk reported');
      createNotification('squawk', 'Squawk Reported', `${user} reported a squawk on ${defect.aircraftId}: ${desc}`, 'defects');
      logActivity('defect_reported', `${user} reported squawk: ${desc} on ${defect.aircraftId}`, defect.id);
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
    resolvedEl.innerHTML = '<p class="text-muted small">No resolved squawks</p>';
  } else {
    resolvedEl.innerHTML = resolved.map(d => defectCard(d)).join('');
  }

  document.querySelectorAll('.resolve-defect-btn').forEach(btn => {
    btn.addEventListener('click', () => resolveDefect(btn.dataset.id));
  });
  document.querySelectorAll('.defect-comments-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const container = document.getElementById('defect-comments-' + id);
      if (!container) return;
      const wasHidden = container.style.display === 'none';
      container.style.display = wasHidden ? 'block' : 'none';
      if (wasHidden) {
        renderComments('defect', id, container);
        container.innerHTML += commentInputHTML();
        attachCommentHandler('defect', id, container);
      }
    });
  });
  document.querySelectorAll('.del-defect-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const role = localStorage.getItem('aac_user_role');
      if (role !== 'engineer' && role !== 'admin' && role !== 'production_planner') {
        showToast('Only Engineer or Admin can delete squawks');
        return;
      }
      const id = btn.dataset.id;
      const confirmed = await showConfirmDialog('Delete Squawk', 'Delete this squawk permanently?');
      if (!confirmed) return;
      await DB.del('defects', id);
      await queueSync('defects', 'delete', { id });
      showToast('Squawk deleted');
      renderDefects();
    });
  });
}

function defectCard(defect) {
  const role = localStorage.getItem('aac_user_role');
  const canResolve = role === 'engineer' || role === 'senior_technician' || role === 'production_planner' || role === 'admin';
  const canDelete = role === 'engineer' || role === 'production_planner' || role === 'admin';
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
      ${defect.photoData ? `<img src="${defect.photoData}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin:6px 0" onclick="window.open(this.src)">` : ''}
      <p class="task-meta">Reported by ${escHtml(defect.reportedBy)} &middot; ${new Date(defect.createdAt).toLocaleDateString()}</p>
      ${defect.assignedTo ? `<p class="task-meta">&#128100; Assigned to <strong>${escHtml(defect.assignedTo)}</strong></p>` : ''}
      <div class="task-actions">
        ${defect.status === 'open' && canResolve ? `<button class="btn btn-sm btn-success resolve-defect-btn" data-id="${defect.id}">Resolve</button>` : ''}
        ${defect.status === 'open' || defect.status === 'in-work' ? `<button class="btn btn-sm btn-ghost defect-comments-btn" data-id="${defect.id}" title="Comments" style="padding:4px 6px;font-size:11px">&#128172;</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm btn-danger del-defect-btn" data-id="${defect.id}" style="padding:4px 8px;font-size:11px">&times;</button>` : ''}
      </div>
      <div class="defect-comments-container" id="defect-comments-${defect.id}" style="display:none;margin-top:8px;border-top:1px solid var(--glass-border);padding-top:8px"></div>
    </div>
  `;
}

async function resolveDefect(defectId) {
  const role = localStorage.getItem('aac_user_role');
  if (role !== 'engineer' && role !== 'senior_technician' && role !== 'production_planner' && role !== 'admin') {
    showToast('Only Engineer or Senior Technician can resolve squawks');
    return;
  }
  const confirmed = await showConfirmDialog('Resolve Squawk', 'Mark this squawk as rectified?');
  if (!confirmed) return;
  const defect = await DB.get('defects', defectId);
  if (!defect) return;
  defect.status = 'rectified';
  await DB.put('defects', defect);
  await queueSync('defects', 'update', defect);
  showToast('Squawk resolved');
  const user = localStorage.getItem('aac_user') || 'Unknown';
  createNotification('squawk', 'Squawk Resolved', `${user} resolved squawk on ${defect.aircraftId}: ${defect.description}`, 'defects');
  logActivity('defect_resolved', `${user} resolved squawk: ${defect.description}`, defect.id);
  renderDefects();
}
