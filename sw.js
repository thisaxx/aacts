const CACHE = 'aac-v7';
const BASE = self.location.pathname.replace(/\/[^/]*$/, '') || '/aacts';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/css/style.css',
  BASE + '/js/app.js',
  BASE + '/js/db.js',
  BASE + '/js/sync.js',
  BASE + '/js/flight-ops.js',
  BASE + '/js/defects.js',
  BASE + '/js/fuel.js',
  BASE + '/js/maintenance.js',
  BASE + '/js/inventory.js',
  BASE + '/js/history.js',
  BASE + '/js/attendance.js',
  BASE + '/js/notifications.js',
  BASE + '/manifest.json',
  BASE + '/img/aircraft.jpg',
  BASE + '/img/icon-192.png',
  BASE + '/img/icon-512.png',
  BASE + '/firebase-messaging-sw.js'
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
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('firebase') || e.request.url.includes('googleapis') || e.request.url.includes('gstatic.com') || e.request.url.startsWith('file://')) return;
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => new Response('Offline', { status: 503 }))
    )
  );
});
