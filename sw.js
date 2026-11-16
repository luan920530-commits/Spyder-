/* Shell y dependencias empaquetadas: instalación atómica, sin CDN. */
const CACHE_NAME = 'neural-spider-os-v11-4';
const ASSETS = [
  './', './index.html', './manifest.json', './css/hud.css',
  './icons/icon-192.png', './icons/icon-512.png',
  './vendor/fonts/jetbrains-mono-latin-400-normal.woff2', './vendor/fonts/jetbrains-mono-latin-600-normal.woff2',
  './vendor/fonts/chakra-petch-latin-500-normal.woff2', './vendor/fonts/chakra-petch-latin-700-normal.woff2',
  './vendor/d3/d3.min.js', './vendor/jszip/jszip.min.js', './vendor/mammoth/mammoth.browser.min.js',
  './vendor/pdfjs/pdf.min.mjs', './vendor/pdfjs/pdf.worker.min.mjs',
  './js/util.js', './js/retrieval.js', './js/analysis.js', './js/srs.js', './js/db.js',
  './js/embeddings.js', './js/store.js', './js/parsers.js', './js/memory.js', './js/providers.js',
  './js/rag.js', './js/kimi-aux-model.js', './js/viewer.js', './js/neural-graph.js', './js/spiders.js',
  './js/eval.js', './js/brain-rag.js', './js/study-bots.js', './js/app.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('neural-spider-os-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(Promise.resolve(new Response('Red externa bloqueada', { status: 403 })));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (_) {
      if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return new Response('Recurso no disponible sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
