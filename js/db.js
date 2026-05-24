const DB_NAME = 'aac';
const DB_VERSION = 6;

function denyGuest() {
  if (localStorage.getItem('aac_user_role') === 'guest') {
    return true;
  }
  return false;
}

function openDB() {
  return new Promise((resolve, reject) => {
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => { resolve(req.result || []); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => { resolve(req.result || null); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => { resolve(req.result); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => { resolve(); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  });
}

const DB = { getAll: dbGetAll, get: dbGet, put: dbPut, del: dbDelete };
