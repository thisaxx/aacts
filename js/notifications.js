async function createNotification(type, title, message, link) {
  const notif = {
    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    type,
    title,
    message,
    read: false,
    link: link || null,
    createdAt: new Date().toISOString()
  };
  await DB.put('notifications', notif);
  await queueSync('notifications', 'create', notif);
  updateNotifBadge();
  return notif;
}

async function getNotifications() {
  return (await DB.getAll('notifications'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getUnreadCount() {
  const all = await DB.getAll('notifications');
  return all.filter(n => !n.read).length;
}

async function markNotifRead(notifId) {
  const n = await DB.get('notifications', notifId);
  if (!n) return;
  n.read = true;
  await DB.put('notifications', n);
  await queueSync('notifications', 'update', n);
  updateNotifBadge();
}

async function markAllNotifsRead() {
  const all = await DB.getAll('notifications');
  for (const n of all) {
    if (!n.read) {
      n.read = true;
      await DB.put('notifications', n);
      await queueSync('notifications', 'update', n);
    }
  }
  updateNotifBadge();
}

async function updateNotifBadge() {
  const count = await getUnreadCount();
  const badge = document.getElementById('notif-badge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
  const sidebarNotif = document.getElementById('sidebar-notif-badge');
  if (sidebarNotif) {
    if (count > 0) {
      sidebarNotif.textContent = count > 99 ? '99+' : count;
      sidebarNotif.style.display = 'inline';
    } else {
      sidebarNotif.style.display = 'none';
    }
  }
}

function notifTypeIcon(type) {
  const icons = {
    squawk: '&#9888;',
    task: '&#9881;',
    attendance: '&#10003;',
    crs: '&#9989;',
    inspection: '&#128197;',
    sortie: '&#9992;',
    fuel: '&#9981;',
    system: '&#8505;',
    arrival: '&#128196;'
  };
  return icons[type] || '&#9679;';
}

function notificationsView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Notifications</h2>
        <div class="subtitle">Alerts &amp; reminders</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px">
        <button class="btn btn-sm btn-ghost" id="mark-all-read-btn" style="font-size:11px">Mark All Read</button>
        <button class="btn btn-sm btn-ghost" id="clear-all-notifs-btn" style="font-size:11px;color:var(--danger)">Clear All</button>
      </div>
      <div id="notif-list"></div>
    </div>
  `;

  document.getElementById('mark-all-read-btn').addEventListener('click', async () => {
    await markAllNotifsRead();
    renderNotifList();
    showToast('All notifications marked read');
  });
  document.getElementById('clear-all-notifs-btn').addEventListener('click', async () => {
    if (typeof denyGuest === 'function' && denyGuest()) return;
    const role = localStorage.getItem('aac_user_role');
    if (role !== 'admin') { showToast('Only Admin can clear all notifications', 'error'); return; }
    const confirmed = await showConfirmDialog('Clear All Notifications', 'Delete all notifications? This cannot be undone.');
    if (!confirmed) return;
    const all = await DB.getAll('notifications');
    for (const n of all) {
      await DB.del('notifications', n.id);
      await queueSync('notifications', 'delete', { id: n.id });
    }
    updateNotifBadge();
    renderNotifList();
    showToast('All notifications cleared');
  });

  renderNotifList();
}

const FLIGHT_NOTIF_TYPES = ['sortie', 'fuel', 'arrival'];
const MAINT_NOTIF_TYPES = ['squawk', 'task', 'inspection', 'crs', 'system'];

function notifTypeSection(type) {
  if (FLIGHT_NOTIF_TYPES.includes(type)) return 'flight';
  if (MAINT_NOTIF_TYPES.includes(type)) return 'maintenance';
  return 'other';
}

function renderNotifGroup(notifs, title, icon) {
  if (notifs.length === 0) return '';
  const role = localStorage.getItem('aac_user_role');
  const isAdmin = role === 'admin';
  return `
    <div class="notif-section-title">${icon} ${title} <span class="notif-section-count">${notifs.length}</span></div>
    ${notifs.map(n => `
      <div class="task-card notif-card ${n.read ? '' : 'notif-unread'}" data-id="${n.id}" style="cursor:pointer">
        <div class="task-header">
          <span>${notifTypeIcon(n.type)} ${escHtml(n.title)}</span>
          <span style="display:flex;align-items:center;gap:6px">
            ${isAdmin ? `<button class="del-notif-btn" data-id="${n.id}" style="background:none;border:none;color:var(--text-muted);font-size:14px;cursor:pointer;padding:0;line-height:1">&times;</button>` : ''}
            <span class="badge ${n.read ? 'badge-rectified' : 'badge-open'}" style="font-size:10px">${n.read ? 'Read' : 'New'}</span>
          </span>
        </div>
        <p class="task-desc">${escHtml(n.message)}</p>
        <p class="task-meta">${new Date(n.createdAt).toLocaleString()}</p>
      </div>
    `).join('')}
  `;
}

async function renderNotifList() {
  const el = document.getElementById('notif-list');
  const notifs = await getNotifications();
  if (notifs.length === 0) {
    el.innerHTML = emptyState('&#128276;', 'No notifications yet');
    return;
  }

  const flightNotifs = notifs.filter(n => notifTypeSection(n.type) === 'flight');
  const maintNotifs = notifs.filter(n => notifTypeSection(n.type) === 'maintenance');
  const otherNotifs = notifs.filter(n => notifTypeSection(n.type) === 'other');

  el.innerHTML = renderNotifGroup(flightNotifs, 'Flight Notifications', '&#9992;') +
    renderNotifGroup(maintNotifs, 'Maintenance Notifications', '&#9881;') +
    renderNotifGroup(otherNotifs, 'Other', '&#9679;');

  el.querySelectorAll('.notif-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.classList.contains('del-notif-btn')) return;
      const id = card.dataset.id;
      await markNotifRead(id);
      const notif = await DB.get('notifications', id);
      if (notif && notif.link) {
        navigate(notif.link);
      } else {
        renderNotifList();
      }
    });
  });
  el.querySelectorAll('.del-notif-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const confirmed = await showConfirmDialog('Delete Notification', 'Delete this notification?');
      if (!confirmed) return;
      await DB.del('notifications', id);
      await queueSync('notifications', 'delete', { id });
      updateNotifBadge();
      renderNotifList();
      showToast('Notification deleted');
    });
  });
}

// Periodically check for unread
setInterval(() => { updateNotifBadge(); }, 30000);
