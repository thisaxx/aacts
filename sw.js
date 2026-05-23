const CACHE = 'aac-v7';
const PREFIX = '/aacts';
const ASSETS = [
  PREFIX + '/',
  PREFIX + '/index.html',
  PREFIX + '/css/style.css',
  PREFIX + '/js/app.js',
  PREFIX + '/js/db.js',
  PREFIX + '/js/sync.js',
  PREFIX + '/js/flight-ops.js',
  PREFIX + '/js/defects.js',
  PREFIX + '/js/fuel.js',
  PREFIX + '/js/maintenance.js',
  PREFIX + '/js/inventory.js',
  PREFIX + '/js/history.js',
  PREFIX + '/js/attendance.js',
  PREFIX + '/js/notifications.js',
  PREFIX + '/manifest.json',
  PREFIX + '/img/aircraft.jpg',
  PREFIX + '/img/icon-192.png',
  PREFIX + '/img/icon-512.png',
  PREFIX + '/firebase-messaging-sw.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('firebase') || e.request.url.includes('googleapis') || e.request.url.includes('gstatic.com')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request).then(cached => cached || new Response('Offline', { status: 503 })))
  );
});
