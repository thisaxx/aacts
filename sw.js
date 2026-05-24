const CACHE = 'aac-v15';
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
  BASE + '/img/icon-512.png'
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

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAlD63vXpUi3WuxA8CjKfFcHyI5DP5-PIE",
  authDomain: "aacts-a931b.firebaseapp.com",
  projectId: "aacts-a931b",
  storageBucket: "aacts-a931b.firebasestorage.app",
  messagingSenderId: "578815078348",
  appId: "1:578815078348:web:032e6d5ca9ccb717f17769",
  measurementId: "G-5JFW3LH3HS"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  if (payload.notification) {
    self.registration.showNotification(payload.notification.title, {
      body: payload.notification.body,
      icon: BASE + '/img/icon-192.png',
      badge: BASE + '/img/icon-192.png',
      vibrate: [200, 100, 200]
    });
  }
});
