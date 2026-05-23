async function createNotification(type, title, message, link) {
  const user = localStorage.getItem('aac_user') || 'unknown';
  const notif = {
    id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    userId: user,
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
  const user = localStorage.getItem('aac_user') || 'unknown';
  return (await DB.getAll('notifications'))
    .filter(n => n.userId === user)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getUnreadCount() {
  const user = localStorage.getItem('aac_user') || 'unknown';
  const all = await DB.getAll('notifications');
  return all.filter(n => n.userId === user && !n.read).length;
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
  const user = localStorage.getItem('aac_user') || 'unknown';
  const all = await DB.getAll('notifications');
  for (const n of all) {
    if (n.userId === user && !n.read) {
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
  const navNotif = document.getElementById('notif-badge-nav');
  if (navNotif) {
    if (count > 0) {
      navNotif.textContent = count > 99 ? '99+' : count;
      navNotif.style.display = 'flex';
    } else {
      navNotif.style.display = 'none';
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
    system: '&#8505;'
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
      <div style="text-align:right;margin-bottom:14px">
        <button class="btn btn-sm btn-ghost" id="mark-all-read-btn" style="font-size:11px">Mark All Read</button>
      </div>
      <div id="notif-list"></div>
    </div>
  `;

  document.getElementById('mark-all-read-btn').addEventListener('click', async () => {
    await markAllNotifsRead();
    renderNotifList();
    showToast('All notifications marked read');
  });

  renderNotifList();
}

async function renderNotifList() {
  const el = document.getElementById('notif-list');
  const notifs = await getNotifications();
  if (notifs.length === 0) {
    el.innerHTML = emptyState('&#128276;', 'No notifications yet');
    return;
  }
  el.innerHTML = notifs.map(n => `
    <div class="task-card notif-card ${n.read ? '' : 'notif-unread'}" data-id="${n.id}" style="cursor:pointer">
      <div class="task-header">
        <span>${notifTypeIcon(n.type)} ${escHtml(n.title)}</span>
        <span class="badge ${n.read ? 'badge-rectified' : 'badge-open'}" style="font-size:10px">${n.read ? 'Read' : 'New'}</span>
      </div>
      <p class="task-desc">${escHtml(n.message)}</p>
      <p class="task-meta">${new Date(n.createdAt).toLocaleString()}</p>
    </div>
  `).join('');

  el.querySelectorAll('.notif-card').forEach(card => {
    card.addEventListener('click', async () => {
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
}

// Periodically check for unread
setInterval(() => { updateNotifBadge(); }, 30000);
