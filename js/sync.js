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
try { _deviceId = localStorage.getItem('aac_device_id'); } catch (e) {}
if (!_deviceId) {
  _deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  try { localStorage.setItem('aac_device_id', _deviceId); } catch (e) {}
}

async function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    db_firestore = firebase.firestore();
    db_firestore.settings({ merge: true });
    await firebase.auth().signInAnonymously();
    let _firebaseReady = false;
    firebase.auth().onAuthStateChanged(() => { updateSyncBadge(); if (_firebaseReady) processSyncQueue(); });
    initFCM();
    await processSyncQueue();
    _firebaseReady = true;
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
          const uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : _deviceId;
          await db_firestore.collection('fcm_tokens').doc(uid).set({ token, _deviceId, _updatedAt: Date.now() }, { merge: true });
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
try { _syncChannel = new BroadcastChannel('aac-sync'); _syncChannel.onmessage = () => { pullAllCollections(true); }; } catch (e) { /* no BroadcastChannel support */ }

function startPolling() {
  pullAllCollections();
  _pollInterval = setInterval(pullAllCollections, 60000);
}

async function pullAllCollections(fromBroadcast) {
  if (!db_firestore || !navigator.onLine) return;
  let lastSync = parseInt(localStorage.getItem('aac_last_sync') || '0');
  // Broadcast-triggered pulls: use a 60s lookback so cross-tab writes aren't missed
  if (fromBroadcast && lastSync > 0) lastSync = Date.now() - 60000;
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
        if (data._deleted) {
          await DB.del(name, doc.id).catch(() => {});
          continue;
        }
        const local = localMap.get(doc.id);
        if (!local || (data._updatedAt && (!local._updatedAt || data._updatedAt >= local._updatedAt))) {
          if (local && !data.photoData && local.photoData) data.photoData = local.photoData;
          await DB.put(name, data);
        }
      }
      // Full sync: detect documents that were hard-deleted (no _deleted flag) from remote
      if (isFullSync) {
        for (const [id, local] of localMap) {
          if (!remoteIds.has(id) && local._deviceId && local._deviceId !== _deviceId) {
            await DB.del(name, id);
          }
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
  if (!FIRESTORE_COLLECTIONS.includes(collection)) { updateSyncBadge(); return; }
  data._deviceId = _deviceId;
  data._updatedAt = Date.now();
  // Persist _deviceId and _updatedAt locally so refresh doesn't delete them
  if (action !== 'delete') {
    await DB.put(collection, data).catch(() => {});
  }
  if (!db_firestore) {
    await DB.put('sync_queue', { collection, action, data: JSON.parse(JSON.stringify(data)), createdAt: Date.now() }).catch(() => {});
    updateSyncBadge();
    return;
  }
  // Strip heavy photo data before cloud sync
  const toSync = JSON.parse(JSON.stringify(data));
  if (toSync.photoData) delete toSync.photoData;
    try {
      if (action === 'delete') {
        await db_firestore.collection(collection).doc(getDocId(collection, data)).set({ _deleted: true, _updatedAt: Date.now() }, { merge: true });
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

let _syncBusy = false;
async function processSyncQueue() {
  if (!db_firestore || !navigator.onLine || _syncBusy) return;
  _syncBusy = true;
  try {
    const entries = await DB.getAll('sync_queue');
    for (const entry of entries) {
      try {
        const { collection, action, data } = entry;
        const toSync = JSON.parse(JSON.stringify(data));
        // Refresh timestamp so incremental polls on other devices pick this up
        toSync._updatedAt = Date.now();
        toSync._deviceId = _deviceId;
        if (toSync.photoData) delete toSync.photoData;
        const docId = getDocId(collection, data);
        if (action === 'delete') {
          await db_firestore.collection(collection).doc(docId).set({ _deleted: true, _updatedAt: Date.now() }, { merge: true });
        } else {
          await db_firestore.collection(collection).doc(docId).set(toSync, { merge: true });
          // Sync succeeded — update local record with correct _deviceId and _updatedAt
          const local = await DB.get(collection, docId);
          if (local) {
            local._deviceId = _deviceId;
            local._updatedAt = toSync._updatedAt;
            await DB.put(collection, local).catch(() => {});
          }
        }
        await DB.del('sync_queue', entry.id);
        // Notify other tabs to pull latest
        try { _syncChannel.postMessage('sync'); } catch (e) { /* no channel */ }
      } catch (e) {
        // Increment retry count; discard after 5 failures to prevent buildup
        const retries = (entry.retries || 0) + 1;
        if (retries >= 5) {
          await DB.del('sync_queue', entry.id).catch(() => {});
        } else {
          await DB.put('sync_queue', { ...entry, retries }).catch(() => {});
        }
      }
    }
  } finally {
    _syncBusy = false;
    updateSyncBadge();
  }
}

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
