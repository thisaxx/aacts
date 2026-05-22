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
  } catch (e) {
    console.warn('Firebase init failed — offline-only mode', e);
  }
  updateSyncBadge();
}

const FIRESTORE_COLLECTIONS = [
  'aircraft', 'flights', 'defects', 'fuel_logs', 'fuel_stock', 'maintenance_tasks', 'parts'
];

function subscribeToAll() {
  FIRESTORE_COLLECTIONS.forEach(name => {
    db_firestore.collection(name).onSnapshot(snapshot => {
      let hadRemote = false;
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'removed') return;
        const data = change.doc.data();
        if (data._deviceId === _deviceId) return;
        const local = await DB.get(name, change.doc.id);
        if (!local || (data._updatedAt && (!local._updatedAt || data._updatedAt >= local._updatedAt))) {
          await DB.put(name, data);
          hadRemote = true;
        }
      });
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
  if (action === 'delete') {
    try {
      await db_firestore.collection(collection).doc(getDocId(collection, data)).delete();
    } catch (e) { /* offline */ }
    updateSyncBadge();
    return;
  }
  data._deviceId = _deviceId;
  data._updatedAt = Date.now();
  try {
    await db_firestore.collection(collection).doc(getDocId(collection, data)).set(data, { merge: true });
  } catch (e) { /* offline */ }
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

firebase.auth().onAuthStateChanged(() => { updateSyncBadge(); });

window.addEventListener('online', () => { updateSyncBadge(); });
window.addEventListener('offline', () => { updateSyncBadge(); });

try { updateSyncBadge(); } catch (e) { /* firebase not yet inited */ }
