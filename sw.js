const CACHE_NAME = 'neural-spider-os-v3';
const ASSETS = [
  './',
  './index.html',
  './css/hud.css',
  './js/store.js',
  './js/parsers.js',
  './js/neural-graph.js',
  './js/spiders.js',
  './js/brain-rag.js',
  './js/study-bots.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp && resp.status === 200 && event.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
