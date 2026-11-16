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
  const listeners = {}, entries = new Map(), removed = [];
  const cache = {
    addAll: async assets => { for (const asset of assets) entries.set(absolute(asset), new Response('cached:' + asset)); },
    match: async request => entries.get(absolute(request))?.clone()
  };
  const context = {
    self: { location: { origin: 'https://local.test' }, addEventListener: (type, cb) => { listeners[type] = cb; },
      skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => ['neural-spider-os-v3', 'other-app'], delete: async key => { removed.push(key); } },
    fetch: async () => { throw new Error('offline'); }, URL, Response, console
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
  for (const font of ['jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-600-normal.woff2', 'chakra-petch-latin-500-normal.woff2', 'chakra-petch-latin-700-normal.woff2']) assert.ok(assets.includes('./vendor/fonts/' + font));
  let pending;
  listeners.install({ waitUntil: p => { pending = p; } }); await pending;
  listeners.activate({ waitUntil: p => { pending = p; } }); await pending;
  assert.deepEqual(removed, ['neural-spider-os-v3']);
  let response;
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/js/rag.js', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*js\/rag/);
  listeners.fetch({ request: { method: 'GET', url: 'https://local.test/app/unknown', mode: 'navigate' }, respondWith: p => { response = p; } });
  assert.match(await (await response).text(), /cached:.*index/);
  listeners.fetch({ request: { method: 'GET', url: 'https://external.test/track', mode: 'cors' }, respondWith: p => { response = p; } });
  assert.equal((await response).status, 403);
});
