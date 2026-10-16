// Offline support: pages and assets are network-first with a cache fallback, so updates arrive at once when online.
// The API is never cached here: the admin app keeps its own data copy and change queue (see offline.js).
const CACHE = 'salone-pro-v1';
const SHELL = ['/', '/base.css', '/common.js', '/offline.js', '/vendor/phosphor.css', '/vendor/phosphor.woff2', '/vendor/geist.woff2', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error())));
});
