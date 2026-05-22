async function getCurrentUser() {
  const uid = localStorage.getItem('aac_user_id');
  if (!uid) return null;
  return await DB.get('users', uid);
}

function attendanceView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Attendance</h2>
        <div class="subtitle">Check in / approve site attendance</div>
      </div>
      <div id="attendance-self" class="card"></div>
      <div id="attendance-pending" class="card">
        <div class="card-header"><h3>Pending Approvals</h3></div>
        <div id="attendance-pending-list"><p class="text-muted small">Loading...</p></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Today's Records</h3></div>
        <div id="attendance-today-list"><p class="text-muted small">Loading...</p></div>
      </div>
    </div>
  `;
  renderAttendance();
}

async function renderAttendance() {
  const user = await getCurrentUser();
  const today = new Date().toISOString().slice(0, 10);

  // Self check-in card
  const selfEl = document.getElementById('attendance-self');
  if (!user) {
    selfEl.innerHTML = `<p class="text-muted small">Set up your profile first (sidebar &rarr; My Profile)</p>`;
  } else {
    const existing = (await DB.getAll('attendance')).filter(a => a.userId === user.id && a.date === today);
    const active = existing.find(a => a.status === 'pending' || a.status === 'approved');
    if (active) {
      selfEl.innerHTML = `
        <div class="card-header"><h3>${active.status === 'approved' ? '&#10003; Checked In' : '&#9203; Pending Approval'}</h3></div>
        <p class="text-muted small">Date: ${today} &middot; Status: <strong>${active.status.toUpperCase()}</strong></p>
        ${active.approvedBy ? `<p class="text-muted small">Approved by: ${active.approvedBy}</p>` : ''}
        ${active.notes ? `<p class="text-muted small">Notes: ${escHtml(active.notes)}</p>` : ''}
      `;
    } else {
      selfEl.innerHTML = `
        <div class="card-header"><h3>Check In for Today</h3></div>
        <div class="form-group">
          <label>Job Site / Location</label>
          <input type="text" id="att-site" placeholder="e.g. Hangar 3, Ramp A">
        </div>
        <div class="form-group">
          <label>Notes (optional)</label>
          <input type="text" id="att-notes" placeholder="e.g. Engine oil change">
        </div>
        <button class="btn btn-primary btn-block" id="att-checkin-btn">Check In</button>
      `;
      document.getElementById('att-checkin-btn').addEventListener('click', async () => {
        const site = document.getElementById('att-site').value.trim();
        if (!site) { showToast('Enter job site / location', 'error'); return; }
        const notes = document.getElementById('att-notes').value.trim();
        const record = {
          id: 'att_' + Date.now(),
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          date: today,
          site,
          notes,
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        await DB.put('attendance', record);
        await queueSync('attendance', 'create', record);
        showToast('Checked in — awaiting approval');
        renderAttendance();
      });
    }
  }

  // Pending approvals (for engineers / senior techs)
  const pendingEl = document.getElementById('attendance-pending-list');
  if (user && (user.role === 'engineer' || user.role === 'admin' || user.role === 'senior_technician')) {
    const all = await DB.getAll('attendance');
    const pending = all.filter(a => a.status === 'pending');
    if (pending.length === 0) {
      pendingEl.innerHTML = '<p class="text-muted small">No pending approvals</p>';
    } else {
      pendingEl.innerHTML = pending.map(a => `
        <div class="task-card" style="margin-bottom:8px">
          <div class="task-header"><strong>${escHtml(a.userName)}</strong> <span class="badge badge-open">${a.userRole || '?'}</span></div>
          <div class="task-desc" style="font-size:13px">${escHtml(a.site)}${a.notes ? ' &mdash; ' + escHtml(a.notes) : ''}</div>
          <div class="task-meta">${a.date}</div>
          <div class="task-actions">
            <button class="btn btn-sm btn-success att-approve-btn" data-id="${a.id}" style="flex:1">Approve</button>
            <button class="btn btn-sm btn-danger att-reject-btn" data-id="${a.id}" style="flex:1">Reject</button>
          </div>
        </div>
      `).join('');

      pendingEl.querySelectorAll('.att-approve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const rec = await DB.get('attendance', btn.dataset.id);
          if (!rec) return;
          rec.status = 'approved';
          rec.approvedBy = user.name;
          rec.approvedAt = new Date().toISOString();
          await DB.put('attendance', rec);
          await queueSync('attendance', 'update', rec);
          showToast('Attendance approved');
          renderAttendance();
        });
      });
      pendingEl.querySelectorAll('.att-reject-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const rec = await DB.get('attendance', btn.dataset.id);
          if (!rec) return;
          rec.status = 'rejected';
          rec.approvedBy = user.name;
          rec.approvedAt = new Date().toISOString();
          await DB.put('attendance', rec);
          await queueSync('attendance', 'update', rec);
          showToast('Attendance rejected');
          renderAttendance();
        });
      });
    }
  } else {
    pendingEl.innerHTML = '<p class="text-muted small">Only engineers/senior technicians can approve attendance</p>';
  }

  // Today's records
  const todayEl = document.getElementById('attendance-today-list');
  const records = (await DB.getAll('attendance')).filter(a => a.date === today);
  if (records.length === 0) {
    todayEl.innerHTML = '<p class="text-muted small">No attendance records for today</p>';
  } else {
    todayEl.innerHTML = records.map(a => `
      <div class="flight-row">
        <div style="flex:1;min-width:0">
          <strong>${escHtml(a.userName)}</strong>
          <div class="flight-date">${escHtml(a.site)} ${a.notes ? '&middot; ' + escHtml(a.notes) : ''}</div>
        </div>
        <span class="badge ${a.status === 'approved' ? 'badge-released' : a.status === 'rejected' ? 'badge-open' : 'badge-rectified'}">${a.status.toUpperCase()}</span>
      </div>
    `).join('');
  }
}