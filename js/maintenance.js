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

      <button class="btn btn-primary btn-block" id="new-task-btn">+ New Maintenance Task</button>

      <div id="new-task-form" class="card hidden">
        <div class="card-header">
          <h3>Create Task</h3>
        </div>
        <div class="form-group">
          <label for="task-description">Task Description</label>
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
        <button class="btn btn-primary" id="save-task-btn">Save Task</button>
        <button class="btn btn-secondary" id="cancel-task-btn">Cancel</button>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Open Tasks</h3>
        </div>
        <div id="tasks-list"><p class="text-muted small">Loading...</p></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Rectified / Released</h3>
        </div>
        <div id="completed-tasks"><p class="text-muted small">Loading...</p></div>
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

  renderTasks();
}

async function onNewTask() {
  const desc = document.getElementById('task-description').value.trim();
  const priority = document.getElementById('task-priority').value;
  if (!desc) { showToast('Please enter a description', 'error'); return; }

  const task = {
    id: 'mnt_' + Date.now(),
    aircraftId: getCurrentAircraftKey(),
    description: desc,
    priority,
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
  showToast('Task created');
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
    openEl.innerHTML = '<p class="muted">No open tasks</p>';
  } else {
    openEl.innerHTML = open.map(t => taskCard(t)).join('');
  }

  const done = [...rectified, ...released];
  if (done.length === 0) {
    completedEl.innerHTML = '<p class="muted">No completed tasks</p>';
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
      const confirmed = await showConfirmDialog('Delete Task', 'Delete this maintenance task permanently?');
      if (!confirmed) return;
      await DB.del('maintenance_tasks', id);
      await queueSync('maintenance_tasks', 'delete', { id });
      showToast('Task deleted');
      renderTasks();
    });
  });
}

function taskCard(task) {
  const priorityColors = { low: '#2563eb', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };
  const statusBadge = {
    open: '<span class="badge badge-open">Open</span>',
    rectified: '<span class="badge badge-rectified">Rectified</span>',
    released: '<span class="badge badge-released">Released to Service</span>'
  };

  return `
    <div class="task-card">
      <div class="task-header">
        <span class="task-priority" style="background:${priorityColors[task.priority] || '#666'}">${task.priority}</span>
        ${statusBadge[task.status]}
      </div>
      <p class="task-desc">${escHtml(task.description)}</p>
      <p class="task-meta">${new Date(task.createdAt).toLocaleDateString()}</p>
      ${task.technicianNotes ? `<p class="task-notes">${escHtml(task.technicianNotes)}</p>` : ''}
      ${task.rectifiedBy ? `<p class="task-meta">Rectified by ${escHtml(task.rectifiedBy)}</p>` : ''}
      <div class="task-actions">
        ${task.status === 'open' ? `<button class="btn btn-sm btn-primary task-detail-btn" data-id="${task.id}">Rectify</button>` : ''}
        ${task.status === 'rectified' ? `<button class="btn btn-sm btn-success release-btn" data-id="${task.id}">Release to Service</button>` : ''}
        <button class="btn btn-sm btn-danger del-task-btn" data-id="${task.id}" style="padding:4px 8px;font-size:11px;margin-left:auto">&times;</button>
      </div>
      ${task.releasedBy ? `<p class="task-meta">Released by ${escHtml(task.releasedBy)} &middot; ${new Date(task.releasedAt).toLocaleString()}</p>` : ''}
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
  task.rectifiedBy = localStorage.getItem('aac_user') || 'Technician';
  task.rectifiedAt = new Date().toISOString();
  task.rectifiedRole = localStorage.getItem('aac_user_role') || '';

  await DB.put('maintenance_tasks', task);
  await queueSync('maintenance_tasks', 'update', task);
  showToast('Task marked as rectified');
  renderTasks();
}

async function onRelease(taskId) {
  const task = await DB.get('maintenance_tasks', taskId);
  if (!task) return;

  const userRole = localStorage.getItem('aac_user_role');
  const isAfterFlight = task.type === 'after-flight';
  const allowedRoles = isAfterFlight ? ['engineer', 'senior_technician', 'admin'] : ['engineer', 'admin'];

  if (!allowedRoles.includes(userRole)) {
    showToast(`Only ${isAfterFlight ? 'Senior Technician or Engineer' : 'engineers'} can release to service (CRS)`, 'error');
    return;
  }

  const confirmed = await showConfirmDialog(
    isAfterFlight ? 'Sign After-Flight Inspection' : 'Certificate of Release to Service',
    `Confirm you are signing as ${userRole.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}?`
  );
  if (!confirmed) return;

  task.status = 'released';
  task.releasedBy = localStorage.getItem('aac_user') || 'Authorized Personnel';
  task.releasedAt = new Date().toISOString();
  task.releasedRole = localStorage.getItem('aac_user_role') || '';

  await DB.put('maintenance_tasks', task);
  await queueSync('maintenance_tasks', 'update', task);
  showToast('Task released to service');
  renderTasks();
}


