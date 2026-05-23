async function getMaintenanceTasks() {
  const ac = await getAircraft();
  return (await DB.getAll('maintenance_tasks'))
    .filter(t => t.aircraftId === ac.tailNumber)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function maintenanceView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Hangar Sign-offs</h2>
        <div class="subtitle">Maintenance &amp; Release Tracking</div>
      </div>

      <button class="btn btn-primary btn-block" id="new-task-btn">+ New Work Order</button>

      <div id="new-task-form" class="card hidden">
        <div class="card-header">
          <h3>Work Order Entry</h3>
        </div>
        <div class="form-group">
          <label for="task-description">Work Description</label>
          <textarea id="task-description" rows="3" placeholder="Describe the maintenance issue..."></textarea>
        </div>
        <div class="form-group">
          <label for="task-priority">Priority</label>
          <select id="task-priority">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div class="form-group">
          <label for="task-assign">Assign To</label>
          <select id="task-assign" class="form-input">
            <option value="">Unassigned</option>
          </select>
        </div>
        <button class="btn btn-primary" id="save-task-btn">Create Work Order</button>
        <button class="btn btn-secondary" id="cancel-task-btn">Cancel</button>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Open Work Orders</h3>
        </div>
      <div id="tasks-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
      <div class="card">
        <div class="card-header"><h3>Completed / Released</h3></div>
        <div id="completed-tasks"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
      </div>
    </div>
  `;

  document.getElementById('new-task-btn').addEventListener('click', () => {
    document.getElementById('new-task-form').classList.remove('hidden');
  });
  document.getElementById('cancel-task-btn').addEventListener('click', () => {
    document.getElementById('new-task-form').classList.add('hidden');
  });
  document.getElementById('save-task-btn').addEventListener('click', onNewTask);

  // Populate crew selector
  DB.getAll('users').then(users => {
    const sel = document.getElementById('task-assign');
    if (!sel) return;
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = u.name + (u.role ? ' (' + u.role.replace(/_/g, ' ') + ')' : '');
      sel.appendChild(opt);
    });
  });

  renderTasks();
}

async function onNewTask() {
  const desc = document.getElementById('task-description').value.trim();
  const priority = document.getElementById('task-priority').value;
  if (!desc) { showToast('Please enter a description', 'error'); return; }

  const assignedTo = document.getElementById('task-assign')?.value || '';

  const task = {
    id: 'mnt_' + Date.now(),
    aircraftId: getCurrentAircraftKey(),
    description: desc,
    priority,
    assignedTo,
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
  showToast('Work order created');
  const user = localStorage.getItem('aac_user') || 'Unknown';
  createNotification('task', 'Work Order Created', `${user} created work order on ${task.aircraftId}: ${task.description}`, 'maintenance');
  document.getElementById('new-task-form').classList.add('hidden');
  document.getElementById('task-description').value = '';
  renderTasks();
}

async function renderTasks() {
  const tasks = await getMaintenanceTasks();
  const open = tasks.filter(t => t.status === 'open');
  const rectified = tasks.filter(t => t.status === 'rectified');
  const released = tasks.filter(t => t.status === 'released');

  const openEl = document.getElementById('tasks-list');
  const completedEl = document.getElementById('completed-tasks');

  if (open.length === 0) {
    openEl.innerHTML = '<p class="muted">No open work orders</p>';
  } else {
    openEl.innerHTML = open.map(t => taskCard(t)).join('');
  }

  const done = [...rectified, ...released];
  if (done.length === 0) {
    completedEl.innerHTML = '<p class="muted">No completed work orders</p>';
  } else {
    completedEl.innerHTML = done.map(t => taskCard(t)).join('');
  }

  document.querySelectorAll('.release-btn').forEach(btn => {
    btn.addEventListener('click', () => onRelease(btn.dataset.id));
  });
  document.querySelectorAll('.task-detail-btn').forEach(btn => {
    btn.addEventListener('click', () => showTaskDetail(btn.dataset.id));
  });
  document.querySelectorAll('.del-task-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const confirmed = await showConfirmDialog('Delete Work Order', 'Delete this work order permanently?');
      if (!confirmed) return;
      await DB.del('maintenance_tasks', id);
      await queueSync('maintenance_tasks', 'delete', { id });
      showToast('Work order deleted');
      renderTasks();
    });
  });
  document.querySelectorAll('.edit-task-btn').forEach(btn => {
    btn.addEventListener('click', () => editTask(btn.dataset.id));
  });
  document.querySelectorAll('.task-comments-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const container = document.getElementById('task-comments-' + id);
      if (!container) return;
      const wasHidden = container.style.display === 'none';
      container.style.display = wasHidden ? 'block' : 'none';
      if (wasHidden) {
        renderComments('task', id, container);
        container.innerHTML += commentInputHTML();
        attachCommentHandler('task', id, container);
      }
    });
  });
}

async function editTask(taskId) {
  const task = await DB.get('maintenance_tasks', taskId);
  if (!task) { showToast('Work order not found', 'error'); return; }
  showBottomSheet(`
    <div class="card-header"><h3>Edit Work Order</h3></div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="edit-task-desc" rows="3" class="form-input">${escHtml(task.description)}</textarea>
    </div>
    <div class="form-group">
      <label>Priority</label>
      <select id="edit-task-priority" class="form-input">
        <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
        <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
        <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
        <option value="critical" ${task.priority === 'critical' ? 'selected' : ''}>Critical</option>
      </select>
    </div>
    <button class="btn btn-primary btn-block" id="save-edit-task-btn">Save Changes</button>
    <button class="btn btn-secondary btn-block" id="cancel-edit-task-btn" style="margin-top:8px">Cancel</button>
  `);
  document.getElementById('save-edit-task-btn').addEventListener('click', async () => {
    const desc = document.getElementById('edit-task-desc').value.trim();
    if (!desc) { showToast('Enter a description', 'error'); return; }
    task.description = desc;
    task.priority = document.getElementById('edit-task-priority').value;
    await DB.put('maintenance_tasks', task);
    await queueSync('maintenance_tasks', 'update', task);
    showToast('Work order updated');
    window.__sheetClose(true);
    renderTasks();
  });
  document.getElementById('cancel-edit-task-btn').addEventListener('click', () => window.__sheetClose(null));
}

function taskCard(task) {
  const priorityColors = { low: '#2563eb', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };
  const statusBadge = {
    open: '<span class="badge badge-open">Open</span>',
    rectified: '<span class="badge badge-rectified">Rectified</span>',
    released: '<span class="badge badge-released">Released to Service</span>'
  };

  return `
    <div class="task-card" data-task-id="${task.id}">
      <div class="task-header">
        <span class="task-priority" style="background:${priorityColors[task.priority] || '#666'}">${task.priority}</span>
        ${statusBadge[task.status]}
      </div>
      <p class="task-desc">${escHtml(task.description)}</p>
      <p class="task-meta">${new Date(task.createdAt).toLocaleDateString()}</p>
      ${task.assignedTo ? `<p class="task-meta">&#128100; Assigned to <strong>${escHtml(task.assignedTo)}</strong></p>` : ''}
      ${task.technicianNotes ? `<p class="task-notes">${escHtml(task.technicianNotes)}</p>` : ''}
      ${task.rectifiedBy ? `<p class="task-meta">Rectified by ${escHtml(task.rectifiedBy)}</p>` : ''}
      <div class="task-actions">
        ${task.status === 'open' ? `<button class="btn btn-sm btn-primary task-detail-btn" data-id="${task.id}">Rectify</button>` : ''}
        ${task.status === 'open' ? `<button class="btn btn-sm btn-ghost edit-task-btn" data-id="${task.id}" title="Edit" style="padding:4px 6px;font-size:11px">&#9998;</button>` : ''}
        ${task.status === 'rectified' ? `<button class="btn btn-sm btn-success release-btn" data-id="${task.id}">Release to Service</button>` : ''}
        ${task.status === 'open' || task.status === 'rectified' ? `<button class="btn btn-sm btn-ghost task-comments-btn" data-id="${task.id}" title="Comments" style="padding:4px 6px;font-size:11px">&#128172;</button>` : ''}
        <button class="btn btn-sm btn-danger del-task-btn" data-id="${task.id}" style="padding:4px 8px;font-size:11px;margin-left:auto">&times;</button>
      </div>
      ${task.releasedBy ? `<p class="task-meta">Released by ${escHtml(task.releasedBy)} &middot; ${new Date(task.releasedAt).toLocaleString()}</p>` : ''}
      <div class="task-comments-container" id="task-comments-${task.id}" style="display:none;margin-top:8px;border-top:1px solid var(--glass-border);padding-top:8px"></div>
    </div>
  `;
}

async function showTaskDetail(taskId) {
  const task = await DB.get('maintenance_tasks', taskId);
  if (!task) return;

  const notes = await showPromptDialog(
    `Rectify: ${task.description}`,
    'Enter what was fixed:'
  );

  if (notes === null) return;
  if (!notes.trim()) { showToast('Please enter fix details', 'error'); return; }

  task.technicianNotes = notes.trim();
  task.status = 'rectified';
  const currentUser = localStorage.getItem('aac_user') || 'Technician';
  task.rectifiedBy = currentUser;
  task.rectifiedAt = new Date().toISOString();
  task.rectifiedRole = localStorage.getItem('aac_user_role') || '';
  if (!task.assignedTo) task.assignedTo = currentUser;

  await DB.put('maintenance_tasks', task);
  await queueSync('maintenance_tasks', 'update', task);
  showToast('Work order marked as rectified');
  const user = localStorage.getItem('aac_user') || 'Unknown';
  createNotification('task', 'Work Order Rectified', `${user} completed work on ${task.aircraftId}: ${task.description}`, 'maintenance');
  logActivity('task_rectified', `${user} rectified work order: ${task.description}`, task.id);
  renderTasks();
}

async function onRelease(taskId) {
  const task = await DB.get('maintenance_tasks', taskId);
  if (!task) return;

  const userRole = localStorage.getItem('aac_user_role');
  const isAfterFlight = task.type === 'after-flight';
  const allowedRoles = isAfterFlight ? ['engineer', 'senior_technician', 'production_planner', 'admin'] : ['engineer', 'admin'];

  if (!allowedRoles.includes(userRole)) {
    showToast(`Only ${isAfterFlight ? 'Senior Technician or Engineer' : 'engineers'} can release to service (CRS)`, 'error');
    return;
  }

  const confirmed = await showConfirmDialog(
    isAfterFlight ? 'Sign After-Flight Inspection' : 'Certificate of Release to Service (CRS)',
    `Confirm you are signing as ${userRole.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}?`
  );
  if (!confirmed) return;

  task.status = 'released';
  task.releasedBy = localStorage.getItem('aac_user') || 'Authorized Personnel';
  task.releasedAt = new Date().toISOString();
  task.releasedRole = localStorage.getItem('aac_user_role') || '';

  await DB.put('maintenance_tasks', task);
  await queueSync('maintenance_tasks', 'update', task);
  showToast('Work order released to service');
  const user = localStorage.getItem('aac_user') || 'Unknown';
  createNotification('crs', task.type === 'after-flight' ? 'After-Flight Inspection Signed' : 'CRS Issued', `${user} released ${task.description} to service on ${task.aircraftId}`, 'maintenance');
  logActivity('task_released', `${user} released ${task.type === 'after-flight' ? 'after-flight inspection' : 'work order'}: ${task.description}`, task.id);

  // If this is an after-flight inspection being released, ground the aircraft until next daily CRS
  if (task.type === 'after-flight') {
    const ac2 = await DB.get('aircraft', task.aircraftId);
    if (ac2) {
      ac2.groundedAfterInspection = true;
      ac2.groundedAfterInspAt = new Date().toISOString();
      await DB.put('aircraft', ac2);
      await queueSync('aircraft', 'update', ac2);
      showToast('Aircraft grounded — daily CRS required before next flight');
      createNotification('system', 'Aircraft Grounded', `${ac2.tailNumber} grounded after after-flight inspection. Daily CRS required.`, 'dashboard');
    }
  }

  renderTasks();
}


