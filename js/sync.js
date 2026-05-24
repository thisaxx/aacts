const firebaseConfig = {
  apiKey: "AIzaSyAlD63vXpUi3WuxA8CjKfFcHyI5DP5-PIE",
  authDomain: "aacts-a931b.firebaseapp.com",
  projectId: "aacts-a931b",
  storageBucket: "aacts-a931b.firebasestorage.app",
  messagingSenderId: "578815078348",
  appId: "1:578815078348:web:032e6d5ca9ccb717f17769",
  measurementId: "G-5JFW3LH3HS"
};

let db_firestore;
let _deviceId;

async function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    db_firestore = firebase.firestore();
    db_firestore.settings({ merge: true });
    await firebase.auth().signInAnonymously();
    _deviceId = firebase.auth().currentUser.uid;
    subscribeToAll();
    initFCM();
    processSyncQueue();
  } catch (e) {
    console.warn('Firebase init failed — offline-only mode', e);
  }
  updateSyncBadge();
}

async function initFCM() {
  try {
    if ('Notification' in window && navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.ready;
      const messaging = firebase.messaging();
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        const token = await messaging.getToken({ vapidKey: 'BPDOB1rrNFE1rDZF1kssXN6m3stPy6e69cpC7nFhkXrVq6vFw8kQRh3amP6nfw43X4T9qN4N-s6NoFzQrUYYN1o', serviceWorkerRegistration: reg });
        if (token) {
          await db_firestore.collection('fcm_tokens').doc(_deviceId).set({ token, _deviceId, _updatedAt: Date.now() }, { merge: true });
        }
        messaging.onMessage(payload => {
          if (payload.notification) {
            showNotification(payload.notification.title, payload.notification.body);
          }
        });
      }
    }
  } catch (e) {
    console.warn('FCM init failed', e);
  }
}

const FIRESTORE_COLLECTIONS = [
  'aircraft', 'flights', 'defects', 'fuel_logs', 'fuel_stock', 'maintenance_tasks', 'parts', 'users', 'attendance', 'notifications'
];

function subscribeToAll() {
  FIRESTORE_COLLECTIONS.forEach(name => {
    db_firestore.collection(name).onSnapshot(async snapshot => {
      let hadRemote = false;
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') {
          await DB.del(name, change.doc.id);
          hadRemote = true;
          continue;
        }
        const data = change.doc.data();
        if (data._deviceId && data._deviceId === _deviceId) continue;
        const local = await DB.get(name, change.doc.id);
        if (!local || (data._updatedAt && (!local._updatedAt || data._updatedAt >= local._updatedAt))) {
          await DB.put(name, data);
          hadRemote = true;
        }
      }
      updateSyncBadge();
      if (hadRemote && typeof onRemoteUpdate === 'function') onRemoteUpdate();
    }, () => { updateSyncBadge(); });
  });
}

function getDocId(collection, data) {
  if (collection === 'aircraft') return data.tailNumber;
  if (collection === 'parts') return data.partNumber;
  return data.id;
}

async function queueSync(collection, action, data) {
  if (!db_firestore) { updateSyncBadge(); return; }
  data._deviceId = _deviceId;
  data._updatedAt = Date.now();
  try {
    if (action === 'delete') {
      await db_firestore.collection(collection).doc(getDocId(collection, data)).delete();
    } else {
      await db_firestore.collection(collection).doc(getDocId(collection, data)).set(data, { merge: true });
    }
  } catch (e) {
    // Offline — save to retry queue
    try {
      await DB.put('sync_queue', { collection, action, data: JSON.parse(JSON.stringify(data)), createdAt: Date.now() });
    } catch (qe) { /* queue full */ }
  }
  updateSyncBadge();
}

async function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  // Count pending sync queue items
  let pendingCount = 0;
  try { pendingCount = (await DB.getAll('sync_queue')).length; } catch(e) {}
  if (db_firestore && firebase.auth().currentUser && navigator.onLine) {
    badge.textContent = pendingCount > 0 ? `↻${pendingCount}` : '✓';
    badge.style.background = pendingCount > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)';
    badge.style.color = pendingCount > 0 ? '#f59e0b' : '#10b981';
    badge.style.display = 'flex';
  } else {
    badge.textContent = pendingCount > 0 ? `✕${pendingCount}` : '✕';
    badge.style.background = pendingCount > 0 ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.25)';
    badge.style.color = '#ef4444';
    badge.style.display = 'flex';
  }
}

async function processSyncQueue() {
  if (!db_firestore || !navigator.onLine) return;
  const entries = await DB.getAll('sync_queue');
  for (const entry of entries) {
    try {
      const { collection, action, data } = entry;
      if (action === 'delete') {
        await db_firestore.collection(collection).doc(getDocId(collection, data)).delete();
      } else {
        await db_firestore.collection(collection).doc(getDocId(collection, data)).set(data, { merge: true });
      }
      await DB.del('sync_queue', entry.id);
    } catch (e) { break; } // still offline, stop processing
  }
  updateSyncBadge();
}

firebase.auth().onAuthStateChanged(() => { updateSyncBadge(); processSyncQueue(); });

window.addEventListener('online', () => {
  updateSyncBadge();
  processSyncQueue();
  document.body.classList.remove('offline');
  showSyncToast('Online — syncing...', 'success');
});
window.addEventListener('offline', () => {
  updateSyncBadge();
  document.body.classList.add('offline');
  showSyncToast('Offline — changes saved locally', 'error');
});

// Initial offline check
if (!navigator.onLine) document.body.classList.add('offline');

function showSyncToast(msg, type) {
  const existing = document.getElementById('sync-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'sync-toast';
  t.className = `sync-toast show ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.className = 'sync-toast'; }, 3000);
}

try { updateSyncBadge(); } catch (e) { /* firebase not yet inited */ }
