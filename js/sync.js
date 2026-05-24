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
    initFCM();
    await processSyncQueue();
    startPolling();
    scheduleCleanup();
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
  'aircraft', 'flights', 'defects', 'fuel_logs', 'fuel_stock', 'maintenance_tasks', 'parts', 'users', 'attendance', 'components', 'pilots'
];

let _pollInterval;
let _pollCount = 0;
let _syncChannel;
try { _syncChannel = new BroadcastChannel('aac-sync'); _syncChannel.onmessage = () => { pullAllCollections(); }; } catch (e) { /* no BroadcastChannel support */ }

function startPolling() {
  pullAllCollections();
  _pollInterval = setInterval(pullAllCollections, 60000);
}

async function pullAllCollections() {
  if (!db_firestore || !navigator.onLine) return;
  const lastSync = parseInt(localStorage.getItem('aac_last_sync') || '0');
  _pollCount++;
  const isFullSync = lastSync === 0 || _pollCount % 10 === 0;
  // Capture wall-clock time BEFORE query to avoid write-gap window
  const queryTime = Date.now();
  const hadRemote = await Promise.all(FIRESTORE_COLLECTIONS.map(async name => {
    try {
      const localDocs = await DB.getAll(name);
      const localMap = new Map(localDocs.map(d => [getDocId(name, d), d]));
      let query = db_firestore.collection(name);
      if (!isFullSync) query = query.where('_updatedAt', '>=', lastSync);
      const snap = await query.get();
      const remoteIds = new Set();
      for (const doc of snap.docs) {
        remoteIds.add(doc.id);
        const data = doc.data();
        const local = await DB.get(name, doc.id);
        if (!local || (data._updatedAt && (!local._updatedAt || data._updatedAt >= local._updatedAt))) {
          if (local && !data.photoData && local.photoData) data.photoData = local.photoData;
          await DB.put(name, data);
        }
      }
      // Detect deletions on every poll (not just full sync)
      for (const [id, local] of localMap) {
        if (!remoteIds.has(id) && local._deviceId && local._deviceId !== _deviceId) {
          await DB.del(name, id);
        }
      }
      return true;
    } catch (e) { return false; }
  }));
  localStorage.setItem('aac_last_sync', String(queryTime));
  updateSyncBadge();
  if (hadRemote.some(Boolean) && typeof onRemoteUpdate === 'function') onRemoteUpdate();
}

function getDocId(collection, data) {
  if (collection === 'aircraft') return data.tailNumber;
  if (collection === 'parts') return data.partNumber;
  return data.id;
}

async function queueSync(collection, action, data) {
  if (!db_firestore) { updateSyncBadge(); return; }
  if (!FIRESTORE_COLLECTIONS.includes(collection)) { updateSyncBadge(); return; }
  data._deviceId = _deviceId;
  data._updatedAt = Date.now();
  // Persist _deviceId and _updatedAt locally so refresh doesn't delete them
  if (action !== 'delete') {
    await DB.put(collection, data).catch(() => {});
  }
  // Strip heavy photo data before cloud sync
  const toSync = JSON.parse(JSON.stringify(data));
  if (toSync.photoData) delete toSync.photoData;
  try {
    if (action === 'delete') {
      await db_firestore.collection(collection).doc(getDocId(collection, data)).delete();
    } else {
      await db_firestore.collection(collection).doc(getDocId(collection, data)).set(toSync, { merge: true });
    }
    // Notify other tabs to pull latest
    try { _syncChannel.postMessage('sync'); } catch (e) { /* no channel */ }
  } catch (e) {
    // Offline — save to retry queue (original data for offline retry)
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
      const toSync = JSON.parse(JSON.stringify(data));
      // Refresh timestamp so incremental polls on other devices pick this up
      toSync._updatedAt = Date.now();
      toSync._deviceId = _deviceId;
      if (toSync.photoData) delete toSync.photoData;
      if (action === 'delete') {
        await db_firestore.collection(collection).doc(getDocId(collection, data)).delete();
      } else {
        await db_firestore.collection(collection).doc(getDocId(collection, data)).set(toSync, { merge: true });
      }
      await DB.del('sync_queue', entry.id);
      // Notify other tabs to pull latest
      try { _syncChannel.postMessage('sync'); } catch (e) { /* no channel */ }
    } catch (e) { break; } // still offline, stop processing
  }
  updateSyncBadge();
}

firebase.auth().onAuthStateChanged(() => { updateSyncBadge(); processSyncQueue(); });

window.addEventListener('online', () => {
  updateSyncBadge();
  processSyncQueue();
  pullAllCollections();
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

/* ── Idle-time Firestore cleanup ── */
const CLEANUP_COLLECTIONS = {
  flights: 365, attendance: 90, fuel_logs: 365, activity_log: 90
};

async function firestoreCleanup() {
  if (!db_firestore || !navigator.onLine) return;
  for (const [col, days] of Object.entries(CLEANUP_COLLECTIONS)) {
    if (!FIRESTORE_COLLECTIONS.includes(col)) continue;
    try {
      const cutoff = Date.now() - days * 86400000;
      const snap = await db_firestore.collection(col).where('_updatedAt', '<', cutoff).limit(50).get();
      if (snap.empty) continue;
      const batch = db_firestore.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) { /* skip collection on error */ }
  }
}

async function firestoreDropLegacyCollections() {
  const legacy = ['certificates', 'calibration_tools', 'activity_log', 'notifications'];
  if (!db_firestore || !navigator.onLine) return;
  for (const col of legacy) {
    try {
      const snap = await db_firestore.collection(col).limit(100).get();
      if (snap.empty) continue;
      const batch = db_firestore.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) { /* skip */ }
  }
}

function scheduleCleanup() {
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 5000));
  idle(() => {
    firestoreCleanup();
    firestoreDropLegacyCollections();
  });
  // Repeat daily
  setInterval(() => {
    const idle2 = window.requestIdleCallback || (fn => setTimeout(fn, 5000));
    idle2(() => {
      firestoreCleanup();
      firestoreDropLegacyCollections();
    });
  }, 86400000);
}

try { updateSyncBadge(); } catch (e) { /* firebase not yet inited */ }
