const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');

test('precache incluye el shell completo y funciona desconectado', async () => {
  const swUrl = 'https://local.test/app/sw.js';
  const absolute = value => new URL(typeof value === 'string' ? value : value.url, swUrl).href;
  const listeners = {}, buckets = new Map(), removed = [];
  function cacheFor(name) {
    if (!buckets.has(name)) {
      const entries = new Map();
      buckets.set(name, {
        addAll: async assets => { for (const asset of assets) entries.set(absolute(asset), new Response('cached:' + asset)); },
        match: async request => entries.get(absolute(request))?.clone(),
        put: async (request, response) => { entries.set(absolute(request), response.clone()); }
      });
    }
    return buckets.get(name);
  }
  const network = [];
  const qwen = require('../js/qwen-config');
  const context = {
    self: { location: { origin: 'https://local.test', href: swUrl }, addEventListener: (type, cb) => { listeners[type] = cb; },
      skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async name => cacheFor(name), keys: async () => [...buckets.keys(), 'neural-spider-os-v3', 'other-app'], delete: async key => { removed.push(key); buckets.delete(key); } },
    importScripts: () => { context.self.NCQwenConfig = qwen; },
    fetch: async request => { network.push(request.url); if (request.url === qwen.url) return new Response('modelo'); throw new Error('offline'); }, URL, Response, console
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8') + '\nglobalThis.assets = ASSETS;', context);
  const assets = Array.from(context.assets);
  for (const asset of assets) assert.ok(fs.existsSync(path.join(root, asset)), `Falta ${asset}`);
  const html = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).window.document;
  for (const el of html.querySelectorAll('script[src],link[rel="stylesheet"],link[rel="manifest"],link[rel="icon"]')) {
    const asset = el.getAttribute('src') || el.getAttribute('href');
    assert.ok(!/^https?:/i.test(asset), `Dependencia externa: ${asset}`);
    assert.ok(assets.includes('./' + asset), `Falta en precache: ${asset}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  for (const icon of manifest.icons) assert.ok(assets.includes('./' + icon.src));
  assert.ok(assets.includes('./vendor/pdfjs/pdf.worker.min.mjs'));
  for (const [dir, extensions] of [['cmaps', ['.bcmap']], ['standard_fonts', ['.ttf', '.pfb']]]) {
    const files = fs.readdirSync(path.join(root, 'vendor/pdfjs', dir)).filter(name => extensions.some(ext => name.endsWith(ext)));
    assert.ok(files.length > 0);
    for (const name of files) assert.ok(assets.includes(`./vendor/pdfjs/${dir}/${name}`), `Falta PDF.js offline: ${name}`);
  }
  assert.ok(assets.includes('./js/spider-visual.js'), 'la silueta compartida debe estar disponible sin conexión');
  assert.ok(assets.includes('./js/spider-motion.js'), 'la locomoción debe funcionar sin conexión');
  assert.ok(assets.includes('./js/chunks.js'), 'las ventanas deben poder reconstruirse sin conexión');
  assert.ok(assets.includes('./js/semantic-clusters.js'), 'los temas deben poder reconstruirse sin conexión');
  assert.ok(assets.includes('./js/graph-projection.js'), 'la paginación de la red debe estar disponible sin conexión');
  assert.ok(assets.includes('./js/knowledge-base.js'), 'las fichas locales deben estar disponibles sin conexión');
  assert.ok(assets.includes('./js/character.js'), 'el modo personaje debe estar disponible sin conexión');
  assert.ok(assets.includes('./js/onnx-worker.js'));
  assert.ok(!assets.some(asset => asset.startsWith('./models/minilm/') || asset.startsWith('./vendor/transformers/') || asset.startsWith('./vendor/wllama/') || asset.endsWith('.gguf')), 'los pesos y motores opcionales no deben descargarse al instalar el shell');
  assert.ok(assets.includes('./js/qwen-download-worker.js'));
  assert.ok(assets.includes('./js/qwen-inference-worker.js'));
  assert.ok(assets.includes('./vendor/sha256/sha256.min.js'));
  for (const font of ['jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-600-normal.woff2', 'chakra-petch-latin-500-normal.woff2', 'chakra-petch-latin-700-normal.woff2']) assert.ok(assets.includes('./vendor/fonts/' + font));
  let pending;
  listeners.install({ waitUntil: p => { pending = p; } }); await pending;
  const previousShell = await context.caches.open('neural-spider-os-v11-21');
  await previousShell.put('https://local.test/app/js/spiders.js', new Response('versión anterior'));
  const modelCache = await context.caches.open('neural-spider-model-v1');
  await modelCache.put('https://local.test/app/models/minilm/onnx/model_quantized.onnx', new Response('pesos opcionales'));
  const qwenCache = await context.caches.open(qwen.cache);
  await qwenCache.put('https://local.test/app/vendor/wllama/wllama.wasm', new Response('runtime qwen'));
  await qwenCache.put('https://local.test/app/' + qwen.modelPath, new Response('pesos qwen'));
  listeners.activate({ waitUntil: p => { pending = p; } }); await pending;
  assert.deepEqual(removed, ['neural-spider-os-v11-21', 'neural-spider-os-v3']);
  assert.ok(!buckets.has('neural-spider-os-v11-21'), 'la actualización sustituye el shell anterior');
  assert.ok(buckets.has('neural-spider-model-v1'), 'actualizar el shell no debe borrar MiniLM');
  assert.ok(buckets.has(qwen.cache), 'actualizar el shell no debe borrar Qwen');
  let response;
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/js/rag.js', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*js\/rag/);
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/js/spider-motion.js', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*js\/spider-motion/);
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/js/spider-visual.js', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*js\/spider-visual/);
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/js/spiders.js', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*js\/spiders/, 'el nuevo enjambre se sirve sin conexión');
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/js/graph-projection.js', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*js\/graph-projection/);
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/js/knowledge-base.js', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*js\/knowledge-base/);
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/vendor/pdfjs/cmaps/UniJIS-UCS2-H.bcmap', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*UniJIS-UCS2-H\.bcmap/);
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/models/minilm/onnx/model_quantized.onnx', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.equal(await (await response).text(), 'pesos opcionales');
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/vendor/wllama/wllama.wasm', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.equal(await (await response).text(), 'runtime qwen');
  assert.equal(await (await qwenCache.match('https://local.test/app/' + qwen.modelPath)).text(), 'pesos qwen');
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/unknown', mode: 'navigate' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*index/);
  listeners.fetch({ request: { method: 'GET', url: 'https://external.test/track', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.equal((await response).status, 403);
  listeners.fetch({ request: { method: 'GET', url: qwen.url, mode: 'cors' }, respondWith: p => { response = p; } });
  assert.equal(await (await response).text(), 'modelo');
  listeners.fetch({ request: { method: 'POST', url: qwen.url, mode: 'cors' }, respondWith: p => { response = p; } });
  assert.equal((await response).status, 403);
  listeners.fetch({ request: { method: 'GET', url: qwen.url + '?prompt=secreto', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.equal((await response).status, 403);
  assert.equal(network.filter(url => url === qwen.url).length, 1, 'solo el GET exacto puede salir');
});
