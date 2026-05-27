let _deviceId;
try { _deviceId = localStorage.getItem('aac_device_id'); } catch (e) {}
if (!_deviceId) {
  _deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  try { localStorage.setItem('aac_device_id', _deviceId); } catch (e) {}
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
  startRealtimeSync();
  _pollInterval = setInterval(pullAllCollections, 300000);
}

async function initSync() {
  if (typeof InsForge === 'undefined') { console.warn('InsForge not loaded — offline-only mode'); return; }
  const insforge = InsForge.insforge;
  try {
    await insforge.realtime.connect();
    startPolling();
  } catch (e) {
    console.warn('InsForge sync init failed — offline-only mode', e);
    startPolling();
  }
  updateSyncBadge();
}

function startRealtimeSync() {
  if (typeof InsForge === 'undefined') return;
  const insforge = InsForge.insforge;
  if (!insforge.realtime.isConnected) return;
  for (const name of FIRESTORE_COLLECTIONS) {
    const channel = 'sync:' + name;
    insforge.realtime.subscribe(channel).then(({ ok }) => {
      if (!ok) return;
      insforge.realtime.on('sync_insert', async (payload) => {
        if (payload.collection !== name) return;
        await pullDoc(name, payload.id);
      });
      insforge.realtime.on('sync_update', async (payload) => {
        if (payload.collection !== name) return;
        await pullDoc(name, payload.id);
      });
      insforge.realtime.on('sync_delete', async (payload) => {
        if (payload.collection !== name) return;
        await DB.del(name, payload.id).catch(() => {});
        if (typeof onRemoteUpdate === 'function') onRemoteUpdate();
      });
    }).catch(() => {});
  }
}

async function pullDoc(collection, docId) {
  if (typeof InsForge === 'undefined') return;
  try {
    const { data, error } = await InsForge.insforge.database
      .from('sync_docs')
      .select()
      .eq('collection', collection)
      .eq('id', docId)
      .maybeSingle();
    if (error || !data) return;
    if (data._deleted) {
      await DB.del(collection, docId).catch(() => {});
    } else {
      const docData = data.data;
      docData._updatedAt = data._updated_at;
      docData._deviceId = data._device_id;
      if (collection === 'aircraft') docData.tailNumber = docData.tailNumber || data.id;
      const local = await DB.get(collection, docId).catch(() => null);
      if (local && !docData.photoData && local.photoData) docData.photoData = local.photoData;
      await DB.put(collection, docData).catch(() => {});
    }
    if (typeof onRemoteUpdate === 'function') onRemoteUpdate();
  } catch (e) { /* skip */ }
}

async function pullAllCollections(fromBroadcast) {
  if (typeof InsForge === 'undefined' || !navigator.onLine) return;
  let lastSync = parseInt(localStorage.getItem('aac_last_sync') || '0');
  if (fromBroadcast && lastSync > 0) lastSync = Date.now() - 60000;
  _pollCount++;
  const isFullSync = lastSync === 0 || _pollCount % 40 === 0;
  const queryTime = Date.now();
  for (const name of FIRESTORE_COLLECTIONS) {
    try {
      let query = InsForge.insforge.database.from('sync_docs').select().eq('collection', name);
      if (!isFullSync) query = query.gte('_updated_at', lastSync);
      const { data, error } = await query;
      if (error) continue;
      const localDocs = await DB.getAll(name);
      const localMap = new Map(localDocs.map(d => {
        const id = getDocId(name, d);
        return [id, d];
      }));
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
          if (name === 'aircraft') docData.tailNumber = docData.tailNumber || doc.id;
          if (name === 'parts') docData.partNumber = docData.partNumber || doc.id;
          if (!docData.id) docData.id = doc.id;
          if (local && !docData.photoData && local.photoData) docData.photoData = local.photoData;
          await DB.put(name, docData).catch(() => {});
        }
      }
      if (isFullSync) {
        for (const [id, local] of localMap) {
          if (!remoteIds.has(id) && local._deviceId && local._deviceId !== _deviceId) {
            await DB.del(name, id);
          }
        }
      }
    } catch (e) { /* continue */ }
  }
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
  if (!FIRESTORE_COLLECTIONS.includes(collection)) { updateSyncBadge(); return; }
  data._deviceId = _deviceId;
  data._updatedAt = Date.now();
  if (action !== 'delete') {
    await DB.put(collection, data).catch(() => {});
  }
  if (typeof InsForge === 'undefined') {
    await DB.put('sync_queue', { collection, action, data: JSON.parse(JSON.stringify(data)), createdAt: Date.now() }).catch(() => {});
    updateSyncBadge();
    return;
  }
  const toSync = JSON.parse(JSON.stringify(data));
  if (toSync.photoData) delete toSync.photoData;
  try {
    if (action === 'delete') {
      await InsForge.insforge.database.from('sync_docs').update({ _deleted: true, _updated_at: Date.now() }).eq('collection', collection).eq('id', getDocId(collection, data));
    } else {
      await InsForge.insforge.database.rpc('upsert_sync_doc', {
        p_id: getDocId(collection, data),
        p_collection: collection,
        p_data: toSync,
        p_device_id: _deviceId,
        p_updated_at: Date.now(),
        p_deleted: false
      });
    }
  } catch (e) {
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
  try {
    const entries = await DB.getAll('sync_queue');
    for (const entry of entries) {
      try {
        const { collection, action, data } = entry;
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
      } catch (e) {
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
  showSyncToast('Online \u2014 syncing...', 'success');
});
window.addEventListener('offline', () => {
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