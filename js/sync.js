const DEBUG = true;
function dbg(...args) { if (DEBUG) console.log('[SYNC]', ...args); }

window.__logAllRealtime = true;

let _deviceId;
try { _deviceId = localStorage.getItem('aac_device_id'); } catch (e) {}
if (!_deviceId) {
  _deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  try { localStorage.setItem('aac_device_id', _deviceId); } catch (e) {}
}
dbg('Device ID:', _deviceId);

const FIRESTORE_COLLECTIONS = [
  'aircraft', 'flights', 'defects', 'fuel_logs', 'fuel_stock', 'maintenance_tasks', 'parts', 'users', 'attendance', 'components', 'pilots'
];

let _pollInterval;
let _pollCount = 0;
let _syncChannel;
let _realtimeListenersRegistered = false;
try { _syncChannel = new BroadcastChannel('aac-sync'); _syncChannel.onmessage = () => { pullAllCollections(true); }; } catch (e) { /* no BroadcastChannel support */ }

function startPolling() {
  dbg('startPolling: running initial pull + realtime');
  pullAllCollections();
  startRealtimeSync();
  _pollInterval = setInterval(pullAllCollections, 300000);
}

async function initSync() {
  dbg('initSync: starting');
  if (typeof InsForge === 'undefined') { dbg('initSync: InsForge not loaded — offline-only mode'); return; }
  const insforge = InsForge.insforge;
  dbg('initSync: connecting to realtime...');
  try {
    await insforge.realtime.connect();
    dbg('initSync: realtime connected, isConnected:', insforge.realtime.isConnected);
    startPolling();
    dbg('initSync: flushing queue');
    processSyncQueue();
  } catch (e) {
    console.warn('[SYNC] initSync failed — offline-only mode', e);
    startPolling();
  }
  updateSyncBadge();
}

function startRealtimeSync() {
  if (typeof InsForge === 'undefined') return;
  const insforge = InsForge.insforge;
  if (!insforge.realtime.isConnected) { dbg('startRealtimeSync: not connected yet, skipping'); return; }
  dbg('startRealtimeSync: connected, registering listeners');
  if (!_realtimeListenersRegistered) {
    _realtimeListenersRegistered = true;
    insforge.realtime.on('sync_insert', handleSyncEvent);
    insforge.realtime.on('sync_update', handleSyncEvent);
    insforge.realtime.on('sync_delete', handleSyncDelete);
    insforge.realtime.on('connect', () => dbg('REALTIME EVENT: connect'));
    insforge.realtime.on('disconnect', (r) => dbg('REALTIME EVENT: disconnect', r));
    // Log ALL realtime events for debugging
    if (window.__logAllRealtime) {
      insforge.realtime.on('*', (p) => dbg('REALTIME EVENT (catch-all):', typeof p === 'object' ? JSON.stringify(p).slice(0, 500) : p));
    }
  }
  for (const name of FIRESTORE_COLLECTIONS) {
    const ch = 'sync:' + name;
    dbg('startRealtimeSync: subscribing to channel', ch);
    insforge.realtime.subscribe(ch).then(r => {
      dbg('subscribe result for', ch, ':', JSON.stringify(r));
    }).catch(e => {
      dbg('subscribe error for', ch, ':', e);
    });
  }
}

async function handleSyncEvent(payload) {
  dbg('handleSyncEvent: received', payload ? JSON.stringify(payload).slice(0, 300) : '(empty)');
  if (!payload || !payload.collection || !FIRESTORE_COLLECTIONS.includes(payload.collection)) {
    dbg('handleSyncEvent: skipping - invalid payload');
    return;
  }
  await pullDoc(payload.collection, payload.id);
}

async function handleSyncDelete(payload) {
  dbg('handleSyncDelete: received', payload ? JSON.stringify(payload).slice(0, 300) : '(empty)');
  if (!payload || !payload.collection || !FIRESTORE_COLLECTIONS.includes(payload.collection)) return;
  await DB.del(payload.collection, payload.id).catch(() => {});
  if (typeof onRemoteUpdate === 'function') onRemoteUpdate();
}

async function pullDoc(collection, docId) {
  dbg('pullDoc:', collection, docId);
  if (typeof InsForge === 'undefined') return;
  try {
    const { data, error } = await InsForge.insforge.database
      .from('sync_docs')
      .select()
      .eq('collection', collection)
      .eq('id', docId)
      .maybeSingle();
    if (error) { dbg('pullDoc error:', error); return; }
    if (!data) { dbg('pullDoc: no data for', collection, docId); return; }
    dbg('pullDoc: got data', data._deleted ? '(deleted)' : '(live)', '_updated_at:', data._updated_at);
    if (data._deleted) {
      await DB.del(collection, docId).catch(() => {});
    } else {
      const docData = data.data || {};
      docData._updatedAt = data._updated_at;
      docData._deviceId = data._device_id;
      if (collection === 'aircraft' && !docData.tailNumber) docData.tailNumber = data.id;
      if (collection === 'parts' && !docData.partNumber) docData.partNumber = data.id;
      const local = await DB.get(collection, docId).catch(() => null);
      if (local && !docData.photoData && local.photoData) docData.photoData = local.photoData;
      await DB.put(collection, docData).catch(() => {});
      dbg('pullDoc: written to IndexedDB');
    }
    if (typeof onRemoteUpdate === 'function') onRemoteUpdate();
  } catch (e) { dbg('pullDoc exception:', e); }
}

async function pullAllCollections(fromBroadcast) {
  dbg('pullAllCollections: starting', fromBroadcast ? '(from broadcast)' : '');
  if (typeof InsForge === 'undefined' || !navigator.onLine) { dbg('pullAllCollections: skipping (no InsForge or offline)'); return; }
  let lastSync = parseInt(localStorage.getItem('aac_last_sync') || '0');
  if (fromBroadcast && lastSync > 0) lastSync = Date.now() - 60000;
  _pollCount++;
  const isFullSync = lastSync === 0 || _pollCount % 40 === 0;
  dbg('pullAllCollections: isFullSync=' + isFullSync, 'lastSync=' + lastSync, 'pollCount=' + _pollCount);
  const queryTime = Date.now();
  let totalDocs = 0;
  for (const name of FIRESTORE_COLLECTIONS) {
    try {
      let query = InsForge.insforge.database.from('sync_docs').select().eq('collection', name);
      if (!isFullSync) query = query.gte('_updated_at', lastSync);
      const { data, error } = await query;
      if (error) { dbg('pullAllCollections: query error for', name, error); continue; }
      dbg('pullAllCollections:', name, '- received', data ? data.length : 0, 'docs');
      totalDocs += (data ? data.length : 0);
      const localDocs = await DB.getAll(name);
      const localMap = new Map(localDocs.map(d => [getDocId(name, d), d]));
      const remoteIds = new Set();
      for (const doc of data || []) {
        remoteIds.add(doc.id);
        if (doc._deleted) {
          await DB.del(name, doc.id).catch(() => {});
          continue;
        }
        const local = localMap.get(doc.id);
        if (!local || (doc._updated_at && (!local._updatedAt || doc._updated_at >= local._updatedAt))) {
          const docData = doc.data || {};
          docData._updatedAt = doc._updated_at;
          docData._deviceId = doc._device_id;
          if (name === 'aircraft' && !docData.tailNumber) docData.tailNumber = doc.id;
          if (name === 'parts' && !docData.partNumber) docData.partNumber = doc.id;
          if (!docData.id) docData.id = doc.id;
          if (local && !docData.photoData && local.photoData) docData.photoData = local.photoData;
          await DB.put(name, docData).catch(() => {});
        }
      }
      if (isFullSync) {
        for (const [id, local] of localMap) {
          if (!remoteIds.has(id) && local._deviceId && local._deviceId !== _deviceId) {
            dbg('pullAllCollections: removing orphan', name, id);
            await DB.del(name, id);
          }
        }
      }
    } catch (e) { dbg('pullAllCollections: exception for', name, e); }
  }
  dbg('pullAllCollections: done, total remote docs:', totalDocs);
  localStorage.setItem('aac_last_sync', String(queryTime));
  updateSyncBadge();
  if (typeof onRemoteUpdate === 'function') onRemoteUpdate();
}

function getDocId(collection, data) {
  if (collection === 'aircraft') return data.tailNumber;
  if (collection === 'parts') return data.partNumber;
  return data.id;
}

async function queueSync(collection, action, data) {
  dbg('queueSync:', collection, action, data ? data.id || data.tailNumber : '(no data)');
  if (!FIRESTORE_COLLECTIONS.includes(collection)) { updateSyncBadge(); return; }
  data._deviceId = _deviceId;
  data._updatedAt = Date.now();
  if (action !== 'delete') {
    await DB.put(collection, data).catch(() => {});
  }
  if (typeof InsForge === 'undefined') {
    dbg('queueSync: InsForge not loaded, queueing locally');
    await DB.put('sync_queue', { collection, action, data: JSON.parse(JSON.stringify(data)), createdAt: Date.now() }).catch(() => {});
    updateSyncBadge();
    return;
  }
  const toSync = JSON.parse(JSON.stringify(data));
  if (toSync.photoData) delete toSync.photoData;
  try {
    if (action === 'delete') {
      dbg('queueSync: soft-deleting on server');
      await InsForge.insforge.database.from('sync_docs').update({ _deleted: true, _updated_at: Date.now() }).eq('collection', collection).eq('id', getDocId(collection, data));
    } else {
      dbg('queueSync: writing to server via RPC');
      const result = await InsForge.insforge.database.rpc('upsert_sync_doc', {
        p_id: getDocId(collection, data),
        p_collection: collection,
        p_data: toSync,
        p_device_id: _deviceId,
        p_updated_at: Date.now(),
        p_deleted: false
      });
      dbg('queueSync: RPC result:', JSON.stringify(result));
    }
  } catch (e) {
    console.warn('[SYNC] queueSync: server write failed, queueing locally:', e);
    try {
      await DB.put('sync_queue', { collection, action, data: JSON.parse(JSON.stringify(data)), createdAt: Date.now() });
    } catch (qe) { /* queue full */ }
  }
  updateSyncBadge();
}

async function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  let pendingCount = 0;
  try { pendingCount = (await DB.getAll('sync_queue')).length; } catch(e) {}
  if (typeof InsForge !== 'undefined' && InsForge.insforge?.realtime?.isConnected && navigator.onLine) {
    badge.textContent = pendingCount > 0 ? '\u21BB' + pendingCount : '\u2713';
    badge.style.background = pendingCount > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)';
    badge.style.color = pendingCount > 0 ? '#f59e0b' : '#10b981';
    badge.style.display = 'flex';
  } else {
    badge.textContent = pendingCount > 0 ? '\u2715' + pendingCount : '\u2715';
    badge.style.background = pendingCount > 0 ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.25)';
    badge.style.color = '#ef4444';
    badge.style.display = 'flex';
  }
}

let _syncBusy = false;
async function processSyncQueue() {
  if (typeof InsForge === 'undefined' || !navigator.onLine || _syncBusy) return;
  _syncBusy = true;
  dbg('processSyncQueue: starting');
  try {
    const entries = await DB.getAll('sync_queue');
    dbg('processSyncQueue: found', entries.length, 'pending entries');
    for (const entry of entries) {
      try {
        const { collection, action, data } = entry;
        dbg('processSyncQueue: processing', action, collection, data ? data.id || data.tailNumber : '(no data)');
        const toSync = JSON.parse(JSON.stringify(data));
        toSync._updatedAt = Date.now();
        toSync._deviceId = _deviceId;
        if (toSync.photoData) delete toSync.photoData;
        const docId = getDocId(collection, data);
        if (action === 'delete') {
          await InsForge.insforge.database.from('sync_docs').update({ _deleted: true, _updated_at: Date.now() }).eq('collection', collection).eq('id', docId);
        } else {
          await InsForge.insforge.database.rpc('upsert_sync_doc', {
            p_id: docId,
            p_collection: collection,
            p_data: toSync,
            p_device_id: _deviceId,
            p_updated_at: toSync._updatedAt,
            p_deleted: false
          });
          const local = await DB.get(collection, docId);
          if (local) {
            local._deviceId = _deviceId;
            local._updatedAt = toSync._updatedAt;
            await DB.put(collection, local).catch(() => {});
          }
        }
        await DB.del('sync_queue', entry.id);
        dbg('processSyncQueue: done', action, collection, docId);
      } catch (e) {
        const retries = (entry.retries || 0) + 1;
        dbg('processSyncQueue: failed for entry', entry.id, 'retry', retries, e);
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
  dbg('Browser online event');
  updateSyncBadge();
  processSyncQueue();
  pullAllCollections();
  document.body.classList.remove('offline');
  showSyncToast('Online \u2014 syncing...', 'success');
});
window.addEventListener('offline', () => {
  dbg('Browser offline event');
  updateSyncBadge();
  document.body.classList.add('offline');
  showSyncToast('Offline \u2014 changes saved locally', 'error');
});

if (!navigator.onLine) document.body.classList.add('offline');

function showSyncToast(msg, type) {
  const existing = document.getElementById('sync-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'sync-toast';
  t.className = 'sync-toast show ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.className = 'sync-toast'; }, 3000);
}

try { updateSyncBadge(); } catch (e) { /* not yet inited */ }

// Debug helpers
window.syncDebug = {
  deviceId: _deviceId,
  pullAll: () => { dbg('Manual pullAll triggered'); pullAllCollections(); },
  queueSize: async () => { const q = await DB.getAll('sync_queue').catch(() => []); dbg('Queue size:', q.length); return q; },
  write: async (collection, data) => { dbg('Manual write:', collection, data); await queueSync(collection, 'write', data); return 'done'; },
  readAll: async () => { dbg('Manual readAll'); await pullAllCollections(); return 'done'; },
  status: () => ({
    connected: typeof InsForge !== 'undefined' && InsForge.insforge?.realtime?.isConnected,
    online: navigator.onLine,
    dbAvailable: typeof DB !== 'undefined',
    deviceId: _deviceId,
    pollCount: _pollCount
  }),
  logAllRealtime: (on) => {
    if (on && typeof InsForge !== 'undefined' && InsForge.insforge?.realtime) {
      window.__logAllRealtime = true;
      InsForge.insforge.realtime.on('*', (p) => dbg('REALTIME EVENT (catch-all):', typeof p === 'object' ? JSON.stringify(p).slice(0, 500) : p));
      dbg('Enabled catch-all realtime logging');
    } else {
      window.__logAllRealtime = false;
    }
  },
  testRPC: async () => {
    if (typeof InsForge === 'undefined') { dbg('InsForge not loaded'); return; }
    try {
      const result = await InsForge.insforge.database.rpc('upsert_sync_doc', {
        p_id: '__test__',
        p_collection: 'aircraft',
        p_data: { test: true, timestamp: Date.now() },
        p_device_id: _deviceId,
        p_updated_at: Date.now(),
        p_deleted: false
      });
      dbg('testRPC result:', JSON.stringify(result));
    } catch (e) { dbg('testRPC error:', e); }
  },
  testRead: async () => {
    if (typeof InsForge === 'undefined') { dbg('InsForge not loaded'); return; }
    try {
      const { data, error } = await InsForge.insforge.database
        .from('sync_docs')
        .select()
        .eq('collection', 'aircraft');
      dbg('testRead: got', data ? data.length : 0, 'aircraft docs');
      if (error) dbg('testRead error:', error);
      if (data) dbg('testRead data:', JSON.stringify(data).slice(0, 500));
    } catch (e) { dbg('testRead exception:', e); }
  }
};
dbg('Debug helpers available at window.syncDebug');
dbg('To test: syncDebug.testRPC() then syncDebug.testRead()');