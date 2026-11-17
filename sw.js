/* Shell y dependencias empaquetadas: instalación atómica, sin CDN. */
importScripts('./js/qwen-config.js');
const CACHE_NAME = 'neural-spider-os-v11-21';
const MODEL_CACHE = 'neural-spider-model-v1';
const QWEN = self.NCQwenConfig;
// Recursos de pdfjs-dist 4.2.67 incluidos en el shell: la lectura de CMaps y
// fuentes debe funcionar también en la primera importación sin conexión.
const PDF_CMAPS = `
  78-EUC-H 78-EUC-V 78-H 78-RKSJ-H 78-RKSJ-V 78-V 78ms-RKSJ-H 78ms-RKSJ-V 83pv-RKSJ-H 90ms-RKSJ-H
  90ms-RKSJ-V 90msp-RKSJ-H 90msp-RKSJ-V 90pv-RKSJ-H 90pv-RKSJ-V Add-H Add-RKSJ-H Add-RKSJ-V Add-V
  Adobe-CNS1-0 Adobe-CNS1-1 Adobe-CNS1-2 Adobe-CNS1-3 Adobe-CNS1-4 Adobe-CNS1-5 Adobe-CNS1-6
  Adobe-CNS1-UCS2 Adobe-GB1-0 Adobe-GB1-1 Adobe-GB1-2 Adobe-GB1-3 Adobe-GB1-4 Adobe-GB1-5
  Adobe-GB1-UCS2 Adobe-Japan1-0 Adobe-Japan1-1 Adobe-Japan1-2 Adobe-Japan1-3 Adobe-Japan1-4
  Adobe-Japan1-5 Adobe-Japan1-6 Adobe-Japan1-UCS2 Adobe-Korea1-0 Adobe-Korea1-1 Adobe-Korea1-2
  Adobe-Korea1-UCS2 B5-H B5-V B5pc-H B5pc-V CNS-EUC-H CNS-EUC-V CNS1-H CNS1-V CNS2-H CNS2-V
  ETHK-B5-H ETHK-B5-V ETen-B5-H ETen-B5-V ETenms-B5-H ETenms-B5-V EUC-H EUC-V Ext-H Ext-RKSJ-H
  Ext-RKSJ-V Ext-V GB-EUC-H GB-EUC-V GB-H GB-V GBK-EUC-H GBK-EUC-V GBK2K-H GBK2K-V GBKp-EUC-H
  GBKp-EUC-V GBT-EUC-H GBT-EUC-V GBT-H GBT-V GBTpc-EUC-H GBTpc-EUC-V GBpc-EUC-H GBpc-EUC-V H
  HKdla-B5-H HKdla-B5-V HKdlb-B5-H HKdlb-B5-V HKgccs-B5-H HKgccs-B5-V HKm314-B5-H HKm314-B5-V
  HKm471-B5-H HKm471-B5-V HKscs-B5-H HKscs-B5-V Hankaku Hiragana KSC-EUC-H KSC-EUC-V KSC-H
  KSC-Johab-H KSC-Johab-V KSC-V KSCms-UHC-H KSCms-UHC-HW-H KSCms-UHC-HW-V KSCms-UHC-V KSCpc-EUC-H
  KSCpc-EUC-V Katakana NWP-H NWP-V RKSJ-H RKSJ-V Roman UniCNS-UCS2-H UniCNS-UCS2-V UniCNS-UTF16-H
  UniCNS-UTF16-V UniCNS-UTF32-H UniCNS-UTF32-V UniCNS-UTF8-H UniCNS-UTF8-V UniGB-UCS2-H
  UniGB-UCS2-V UniGB-UTF16-H UniGB-UTF16-V UniGB-UTF32-H UniGB-UTF32-V UniGB-UTF8-H UniGB-UTF8-V
  UniJIS-UCS2-H UniJIS-UCS2-HW-H UniJIS-UCS2-HW-V UniJIS-UCS2-V UniJIS-UTF16-H UniJIS-UTF16-V
  UniJIS-UTF32-H UniJIS-UTF32-V UniJIS-UTF8-H UniJIS-UTF8-V UniJIS2004-UTF16-H UniJIS2004-UTF16-V
  UniJIS2004-UTF32-H UniJIS2004-UTF32-V UniJIS2004-UTF8-H UniJIS2004-UTF8-V UniJISPro-UCS2-HW-V
  UniJISPro-UCS2-V UniJISPro-UTF8-V UniJISX0213-UTF32-H UniJISX0213-UTF32-V UniJISX02132004-UTF32-H
  UniJISX02132004-UTF32-V UniKS-UCS2-H UniKS-UCS2-V UniKS-UTF16-H UniKS-UTF16-V UniKS-UTF32-H
  UniKS-UTF32-V UniKS-UTF8-H UniKS-UTF8-V V WP-Symbol
`.trim().split(/\s+/).map(name => `./vendor/pdfjs/cmaps/${name}.bcmap`);
const PDF_FONTS = `
  FoxitDingbats.pfb FoxitFixed.pfb FoxitFixedBold.pfb FoxitFixedBoldItalic.pfb FoxitFixedItalic.pfb
  FoxitSerif.pfb FoxitSerifBold.pfb FoxitSerifBoldItalic.pfb FoxitSerifItalic.pfb FoxitSymbol.pfb
  LiberationSans-Bold.ttf LiberationSans-BoldItalic.ttf LiberationSans-Italic.ttf
  LiberationSans-Regular.ttf
`.trim().split(/\s+/).map(name => `./vendor/pdfjs/standard_fonts/${name}`);
const ASSETS = [
  './', './index.html', './manifest.json', './css/hud.css',
  './icons/icon-192.png', './icons/icon-512.png',
  './vendor/fonts/jetbrains-mono-latin-400-normal.woff2', './vendor/fonts/jetbrains-mono-latin-600-normal.woff2',
  './vendor/fonts/chakra-petch-latin-500-normal.woff2', './vendor/fonts/chakra-petch-latin-700-normal.woff2',
  './vendor/d3/d3.min.js', './vendor/jszip/jszip.min.js', './vendor/mammoth/mammoth.browser.min.js',
  './vendor/pdfjs/pdf.min.mjs', './vendor/pdfjs/pdf.worker.min.mjs', ...PDF_CMAPS, ...PDF_FONTS,
  './js/util.js', './js/retrieval.js', './js/analysis.js', './js/srs.js', './js/db.js',
  './js/embeddings.js', './js/chunks.js', './js/store.js', './js/local-model.js', './js/semantic-clusters.js', './js/onnx-worker.js', './js/parsers.js', './js/memory.js', './js/providers.js',
  './js/qwen-config.js', './js/qwen-prompt.js', './js/qwen-model.js', './js/qwen-download-worker.js', './js/qwen-inference-worker.js', './vendor/sha256/sha256.min.js',
  './js/character.js', './js/rag.js', './js/kimi-aux-model.js', './js/viewer.js', './js/spider-visual.js', './js/neural-graph.js', './js/spiders.js',
  './js/spider-paths.js', './js/spider-motion.js', './js/eval.js', './js/brain-rag.js', './js/study-bots.js', './js/app.js'
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
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    // Única excepción: GET al archivo público, fijo y versionado que el usuario
    // pidió descargar. Nunca se envían consultas ni documentos a ese servidor.
    event.respondWith(event.request.method === 'GET' && event.request.url === QWEN.url
      ? fetch(event.request)
      : Promise.resolve(new Response('Red externa bloqueada', { status: 403 })));
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const optional = url.pathname.startsWith(new URL('./vendor/transformers/', self.location.href).pathname) ||
      url.pathname.startsWith(new URL('./models/minilm/', self.location.href).pathname);
    const qwenRuntime = url.pathname.startsWith(new URL('./vendor/wllama/', self.location.href).pathname);
    const cache = await caches.open(qwenRuntime ? QWEN.cache : optional ? MODEL_CACHE : CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (_) {
      if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return new Response('Recurso no disponible sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
