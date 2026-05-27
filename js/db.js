const DB_NAME = 'aac';
const DB_VERSION = 8;

let _db = null;
let _dbOpen = null;

function denyGuest() {
  if (localStorage.getItem('aac_user_role') === 'guest') {
    return true;
  }
  return false;
}
function hasRole(...roles) {
  return roles.includes(localStorage.getItem('aac_user_role'));
}

function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_dbOpen) return _dbOpen;
  _dbOpen = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('flights')) {
        db.createObjectStore('flights', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('aircraft')) {
        db.createObjectStore('aircraft', { keyPath: 'tailNumber' });
      }
      if (!db.objectStoreNames.contains('maintenance_tasks')) {
        db.createObjectStore('maintenance_tasks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('parts')) {
        db.createObjectStore('parts', { keyPath: 'partNumber' });
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('defects')) {
        db.createObjectStore('defects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('fuel_logs')) {
        db.createObjectStore('fuel_logs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('fuel_stock')) {
        db.createObjectStore('fuel_stock', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('attendance')) {
        db.createObjectStore('attendance', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notifications')) {
        db.createObjectStore('notifications', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('comments')) {
        db.createObjectStore('comments', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('components')) {
        db.createObjectStore('components', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('calibration_tools')) {
        db.createObjectStore('calibration_tools', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('certificates')) {
        db.createObjectStore('certificates', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('activity_log')) {
        db.createObjectStore('activity_log', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pilots')) {
        db.createObjectStore('pilots', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
  return _dbOpen;
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    tx.oncomplete = () => { resolve(req.result || []); };
    tx.onerror = () => { reject(tx.error); };
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    tx.oncomplete = () => { resolve(req.result || null); };
    tx.onerror = () => { reject(tx.error); };
  });
}

async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    tx.oncomplete = () => { resolve(req.result); };
    tx.onerror = () => { reject(tx.error); };
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error); };
  });
}

const DB = { getAll: dbGetAll, get: dbGet, put: dbPut, del: dbDelete };
