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
let _messaging;

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
      const swUrl = window.location.pathname.includes('/aacts/') ? '/aacts/firebase-messaging-sw.js' : 'firebase-messaging-sw.js';
      const reg = await navigator.serviceWorker.register(swUrl);
      _messaging = firebase.messaging();
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        const token = await _messaging.getToken({ vapidKey: 'BPDOB1rrNFE1rDZF1kssXN6m3stPy6e69cpC7nFhkXrVq6vFw8kQRh3amP6nfw43X4T9qN4N-s6NoFzQrUYYN1o', serviceWorkerRegistration: reg });
        if (token) {
          await db_firestore.collection('fcm_tokens').doc(_deviceId).set({ token, _deviceId, _updatedAt: Date.now() }, { merge: true });
        }
        _messaging.onMessage(payload => {
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

function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  if (db_firestore && firebase.auth().currentUser && navigator.onLine) {
    badge.textContent = '✓';
    badge.style.background = 'rgba(16,185,129,0.25)';
    badge.style.color = '#10b981';
    badge.style.display = 'flex';
  } else {
    badge.textContent = '✕';
    badge.style.background = 'rgba(239,68,68,0.25)';
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

window.addEventListener('online', () => { updateSyncBadge(); processSyncQueue(); });
window.addEventListener('offline', () => { updateSyncBadge(); });

try { updateSyncBadge(); } catch (e) { /* firebase not yet inited */ }
