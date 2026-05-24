async function getCurrentUser() {
  const uid = localStorage.getItem('aac_user_id');
  if (!uid) {
    const name = localStorage.getItem('aac_user');
    const role = localStorage.getItem('aac_user_role');
    if (name && role) return { id: null, name, role };
    return null;
  }
  const u = await DB.get('users', uid);
  if (u) return u;
  const name = localStorage.getItem('aac_user');
  const role = localStorage.getItem('aac_user_role');
  if (name && role) return { id: uid, name, role };
  return null;
}

let _attViewDate = new Date();

function attendanceView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Crew Log</h2>
        <div class="subtitle">Sign in / crew tracking</div>
      </div>
      <div class="card" style="padding:10px 16px">
        <div class="row" style="align-items:center;gap:8px">
          <button class="btn btn-sm btn-ghost" id="att-prev-day" style="padding:4px 8px">&#9664;</button>
          <div style="flex:1;text-align:center">
            <span id="att-view-date" style="font-family:var(--mono);font-size:13px;font-weight:700"></span>
            <span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-left:6px" id="att-view-label"></span>
          </div>
          <button class="btn btn-sm btn-ghost" id="att-next-day" style="padding:4px 8px">&#9654;</button>
          <button class="btn btn-sm btn-primary" id="att-today-btn" style="padding:4px 8px;font-size:9px">Today</button>
        </div>
      </div>
      <div id="attendance-self" class="card"></div>
      <div id="attendance-pending" class="card">
        <div class="card-header"><h3>Pending Authorization</h3></div>
        <div id="attendance-pending-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line" style="width:40%"></div></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Records</h3></div>
        <div id="attendance-today-list"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Crew Status Board</h3></div>
        <div id="crew-status-board"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></div>
      </div>
    </div>
  `;

  const renderWithDate = () => {
    renderAttendance(_attViewDate);
    const d = _attViewDate.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('att-view-date').textContent = d;
    document.getElementById('att-view-label').textContent = d === today ? '(today)' : '';
    document.getElementById('att-next-day').style.visibility = d >= today ? 'hidden' : 'visible';
  };

  renderWithDate();
  document.getElementById('att-prev-day').addEventListener('click', () => {
    _attViewDate.setDate(_attViewDate.getDate() - 1);
    renderWithDate();
  });
  document.getElementById('att-next-day').addEventListener('click', () => {
    _attViewDate.setDate(_attViewDate.getDate() + 1);
    renderWithDate();
  });
  document.getElementById('att-today-btn').addEventListener('click', () => {
    _attViewDate = new Date();
    renderWithDate();
  });
}

async function renderAttendance(viewDate) {
  const user = await getCurrentUser();
  const now = viewDate || new Date();
  let today = now.toISOString().slice(0, 10);

  // Self check-in card
  const selfEl = document.getElementById('attendance-self');
  if (!user) {
    selfEl.innerHTML = `<p class="text-muted small">Set up your profile first (sidebar &rarr; My Profile)</p>`;
  } else {
    const existing = (await DB.getAll('attendance')).filter(a => a.date === today && user.id && a.userId === user.id);
    const active = existing.find(a => a.status === 'pending' || a.status === 'approved');
    if (active) {
      selfEl.innerHTML = `
        <div class="card-header"><h3>${active.status === 'approved' ? '&#10003; Signed In' : '&#9203; Pending Authorization'}</h3></div>
        <p class="text-muted small">Date: ${today} &middot; In: ${active.checkinTime || '—'}${active.checkoutTime ? ' &middot; Out: ' + active.checkoutTime : ''} &middot; Status: <strong>${active.status.toUpperCase()}</strong></p>
        ${active.approvedBy ? `<p class="text-muted small">Approved by: ${active.approvedBy}</p>` : ''}
        ${active.notes ? `<p class="text-muted small">Remarks: ${escHtml(active.notes)}</p>` : ''}
        ${!active.checkoutTime ? `
        <div class="form-group" style="margin-top:10px">
          <label>Sign-out Time</label>
          <div class="row" style="gap:6px">
            <input type="time" id="att-checkout-time-input" class="form-input" style="flex:1">
            <button class="btn btn-sm btn-ghost" id="att-now-checkout-btn" style="padding:4px 8px;flex-shrink:0">Now</button>
          </div>
        </div>
        <button class="btn btn-secondary btn-block" id="att-checkout-btn">Sign Out</button>
        <button class="btn btn-sm btn-danger att-del-btn" data-id="${active.id}" style="margin-top:6px">Delete</button>` : `
        <button class="btn btn-sm btn-danger att-del-btn" data-id="${active.id}" style="margin-top:6px">Delete Record</button>`}
      `;
      if (!active.checkoutTime) {
        document.getElementById('att-checkout-time-input').valueAsDate = new Date();
        document.getElementById('att-now-checkout-btn').addEventListener('click', () => {
          const now = new Date();
          document.getElementById('att-checkout-time-input').value = now.toTimeString().slice(0, 5);
          haptic();
        });
        document.getElementById('att-checkout-btn').addEventListener('click', async () => {
          const timeVal = document.getElementById('att-checkout-time-input').value;
          active.checkoutTime = timeVal || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          await DB.put('attendance', active);
          await queueSync('attendance', 'update', active);
          showToast('Signed out');
          renderAttendance(_attViewDate);
        });
      }
    } else {
      selfEl.innerHTML = `
        <div class="card-header"><h3>Sign In</h3></div>
        <div class="form-group">
          <label>Sign-in Time</label>
          <div class="row" style="gap:6px">
            <input type="time" id="att-checkin-time-input" class="form-input" style="flex:1">
            <button class="btn btn-sm btn-ghost" id="att-now-checkin-btn" style="padding:4px 8px;flex-shrink:0">Now</button>
          </div>
        </div>
        <div class="form-group">
          <label>Remarks (optional)</label>
          <input type="text" id="att-notes" placeholder="e.g. Engine oil change">
        </div>
        <button class="btn btn-primary btn-block" id="att-checkin-btn">Sign In</button>
      `;
      document.getElementById('att-checkin-time-input').valueAsDate = new Date();
      document.getElementById('att-now-checkin-btn').addEventListener('click', () => {
        const now = new Date();
        document.getElementById('att-checkin-time-input').value = now.toTimeString().slice(0, 5);
        haptic();
      });
      document.getElementById('att-checkin-btn').addEventListener('click', async () => {
        if (typeof denyGuest === 'function' && denyGuest()) return;
        const notes = document.getElementById('att-notes').value.trim();
        const timeVal = document.getElementById('att-checkin-time-input').value;
        const now = new Date();
        const record = {
          id: 'att_' + Date.now(),
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          date: today,
          checkinTime: timeVal || now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          notes,
          status: 'pending',
          createdAt: now.toISOString()
        };
        await DB.put('attendance', record);
        await queueSync('attendance', 'create', record);
        showToast('Signed in — awaiting authorization');
        renderAttendance(_attViewDate);
      });
    }
    const delBtn = selfEl.querySelector('.att-del-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (typeof denyGuest === 'function' && denyGuest()) return;
        const confirmed = await showConfirmDialog('Delete Record', 'Delete this crew record?');
        if (!confirmed) return;
        await DB.del('attendance', active.id);
        await queueSync('attendance', 'delete', { id: active.id });
        showToast('Record deleted');
        renderAttendance(_attViewDate);
      });
    }
  }

  // Pending approvals (for engineers / senior techs)
  const pendingEl = document.getElementById('attendance-pending-list');
  if (user && (user.role === 'engineer' || user.role === 'admin' || user.role === 'senior_technician' || user.role === 'production_planner')) {
    const all = await DB.getAll('attendance');
    const pending = all.filter(a => a.status === 'pending');
    if (pending.length === 0) {
      pendingEl.innerHTML = '<p class="text-muted small">No pending approvals</p>';
    } else {
      pendingEl.innerHTML = pending.map(a => `
        <div class="task-card" style="margin-bottom:8px">
          <div class="task-header"><strong>${escHtml(a.userName)}</strong> <span class="badge badge-open">${a.userRole || '?'}</span></div>
          <div class="task-desc" style="font-size:13px">In: ${a.checkinTime || '—'}${a.checkoutTime ? ' &middot; Out: ' + a.checkoutTime : ''}${a.notes ? ' &mdash; ' + escHtml(a.notes) : ''}</div>
          <div class="task-meta">${a.date}</div>
          <div class="task-actions">
            <button class="btn btn-sm btn-success att-approve-btn" data-id="${a.id}" style="flex:1">Approve</button>
            <button class="btn btn-sm btn-danger att-reject-btn" data-id="${a.id}" style="flex:1">Reject</button>
          </div>
        </div>
      `).join('');

      pendingEl.querySelectorAll('.att-approve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (typeof denyGuest === 'function' && denyGuest()) return;
          const rec = await DB.get('attendance', btn.dataset.id);
          if (!rec) return;
          rec.status = 'approved';
          rec.approvedBy = user.name;
          rec.approvedAt = new Date().toISOString();
          await DB.put('attendance', rec);
          await queueSync('attendance', 'update', rec);
          showToast('Sign-in approved');
          const user2 = localStorage.getItem('aac_user') || 'Unknown';
          createNotification('attendance', 'Sign-In Approved', `${user2} approved sign-in for ${rec.userName}`, 'attendance');
          renderAttendance(_attViewDate);
        });
      });
      pendingEl.querySelectorAll('.att-reject-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (typeof denyGuest === 'function' && denyGuest()) return;
          const rec = await DB.get('attendance', btn.dataset.id);
          if (!rec) return;
          rec.status = 'rejected';
          rec.approvedBy = user.name;
          rec.approvedAt = new Date().toISOString();
          await DB.put('attendance', rec);
          await queueSync('attendance', 'update', rec);
          showToast('Sign-in rejected');
          const user2 = localStorage.getItem('aac_user') || 'Unknown';
          createNotification('attendance', 'Sign-In Rejected', `${user2} rejected sign-in for ${rec.userName}`, 'attendance');
          renderAttendance(_attViewDate);
        });
      });
    }
  } else {
    pendingEl.innerHTML = '<p class="text-muted small">Only engineers/senior technicians/production planners can approve sign-ins</p>';
  }

  // Today's records
  const todayEl = document.getElementById('attendance-today-list');
  const records = (await DB.getAll('attendance')).filter(a => a.date === today);
  if (records.length === 0) {
    todayEl.innerHTML = '<p class="text-muted small">No crew records for today</p>';
  } else {
    todayEl.innerHTML = records.map(a => `
      <div class="flight-row">
        <div style="flex:1;min-width:0">
          <strong>${escHtml(a.userName)}</strong>
          <div class="flight-date">In: ${a.checkinTime || '—'}${a.checkoutTime ? ' &middot; Out: ' + a.checkoutTime : ''} ${a.notes ? '&middot; ' + escHtml(a.notes) : ''}</div>
        </div>
        <span class="badge ${a.status === 'approved' ? 'badge-released' : a.status === 'rejected' ? 'badge-open' : 'badge-rectified'}">${a.status.toUpperCase()}</span>
        <button class="btn btn-sm btn-danger att-del-btn" data-id="${a.id}" style="margin-left:6px">&#10005;</button>
      </div>
    `).join('');
      todayEl.querySelectorAll('.att-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const confirmed = await showConfirmDialog('Delete Record', 'Delete this crew record?');
          if (!confirmed) return;
          await DB.del('attendance', btn.dataset.id);
          await queueSync('attendance', 'delete', { id: btn.dataset.id });
          showToast('Record deleted');
          renderAttendance(_attViewDate);
        });
      });
  }
  renderCrewStatusBoard();
}

async function renderCrewStatusBoard() {
  const el = document.getElementById('crew-status-board');
  if (!el) return;
  const statuses = await getCrewStatusBoard();
  if (statuses.length === 0) {
    el.innerHTML = '<p class="text-muted small">No crew data</p>';
    return;
  }
  el.innerHTML = statuses.map(s => {
    const isPresent = s.attendance && s.attendance.status === 'approved';
    const isPending = s.attendance && s.attendance.status === 'pending';
    const photo = s.user.photo;
    const roleLabel = (s.user.role || '').replace(/_/g, ' ');
    return `
      <div class="crew-row" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:var(--surface);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid ${isPresent ? 'var(--text)' : isPending ? 'var(--gold)' : 'var(--border)'}">
          ${photo ? `<img src="${photo}" style="width:100%;height:100%;object-fit:cover">` : (s.user.name ? s.user.name[0].toUpperCase() : '?')}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--mono);font-size:13px;font-weight:600">${escHtml(s.user.name)}</div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.3px">${roleLabel}</div>
          <div style="font-size:11px;margin-top:2px;color:${isPresent ? 'var(--text)' : isPending ? 'var(--gold)' : 'var(--text-muted)'}">
            ${isPresent ? '&#10003; On Duty' + (s.attendance.checkinTime ? ' from ' + s.attendance.checkinTime : '') + (s.attendance.checkoutTime ? ' to ' + s.attendance.checkoutTime : '') : isPending ? '&#9203; Pending approval' : '&#10007; Not signed in'}
          </div>
          ${s.attendance && s.attendance.notes ? `<div style="font-size:10px;color:var(--text-muted);margin-top:1px">${escHtml(s.attendance.notes)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}