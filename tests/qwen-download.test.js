const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/qwen-download-worker.js'), 'utf8');
const bytes = Buffer.from('GGUF-archivo-de-prueba-verificado');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const config = {
  cache: 'qwen-test', url: 'https://huggingface.co/fijo/modelo.gguf',
  modelPath: 'models/qwen3/model.gguf', bytes: bytes.length, sha256: hash(bytes)
};

function harness({ initial, fetcher, quota = false } = {}) {
  const entries = new Map(), calls = [], messages = [];
  const key = 'https://local.test/app/models/qwen3/model.gguf';
  if (initial) entries.set(key, Buffer.from(initial));
  const cache = {
    async match(url) { const value = entries.get(String(url)); return value ? new Response(value) : undefined; },
    async put(url, response) {
      if (quota) throw new DOMException('Cuota agotada', 'QuotaExceededError');
      entries.set(String(url), Buffer.from(await response.arrayBuffer()));
    },
    async delete(url) { return entries.delete(String(url)); }
  };
  let resolveReply, notifyProgress = () => {};
  const self = {
    NCQwenConfig: config, location: { href: 'https://local.test/app/js/qwen-download-worker.js' },
    sha256: { create() { const h = crypto.createHash('sha256'); return { update(value) { h.update(value); }, hex() { return h.digest('hex'); } }; } },
    postMessage(message) {
      messages.push(message);
      if (message.progress) notifyProgress(message.progress);
      if (message.id === 1) resolveReply?.(message);
    }
  };
  const context = { self, navigator: {}, importScripts() {}, URL, Response, TransformStream,
    AbortController, DOMException, caches: { open: async () => cache },
    fetch: async (url, options) => { calls.push({ url, options }); return fetcher ? fetcher(url, options) : new Response(bytes); } };
  vm.runInNewContext(source, context);
  return { entries, calls, messages, key, self,
    run(data = {}) { return new Promise(resolve => { resolveReply = resolve; self.onmessage({ data: { type: 'prepare', id: 1, ...data } }); }); },
    progress(fn) { notifyProgress = fn; }
  };
}

test('descarga exacta en streaming, comprueba SHA y no envía libros ni credenciales', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.result.downloaded, true);
  assert.deepEqual(h.entries.get(h.key), bytes);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, config.url);
  assert.equal(h.calls[0].options.credentials, 'omit');
  assert.equal(h.calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(h.calls[0].options.method, 'GET');
  assert.ok(h.messages.some(m => m.progress?.loaded === bytes.length));
});

test('restaura solo la caché verificada y rechaza corrupción e interrupción', async () => {
  let h = harness({ initial: bytes });
  assert.equal((await h.run({ onlyCached: true })).result.downloaded, true);
  assert.equal(h.calls.length, 0);
  h = harness({ initial: Buffer.alloc(bytes.length) });
  let result = await h.run({ onlyCached: true });
  assert.match(result.error, /dañado/i);
  assert.equal(h.entries.has(h.key), false);
  assert.equal(h.calls.length, 0);
  h = harness({ initial: Buffer.alloc(bytes.length) });
  result = await h.run();
  assert.match(result.error, /dañado/i);
  assert.equal(h.calls.length, 0, 'activar una copia dañada no debe disparar una descarga inesperada');
  h = harness({ initial: Buffer.alloc(bytes.length) });
  result = await h.run({ file: new Blob([bytes]) });
  assert.equal(result.result.downloaded, true);
  assert.equal(h.calls.length, 0);
  h = harness({ fetcher: async () => new Response(Buffer.alloc(bytes.length)) });
  result = await h.run();
  assert.match(result.error, /SHA-256/i);
  assert.equal(h.entries.has(h.key), false);
  h = harness({ fetcher: async () => new Response(bytes.subarray(0, 4)) });
  result = await h.run();
  assert.match(result.error, /incompleta/i);
  assert.equal(h.entries.has(h.key), false);
});

test('importa solo el archivo correcto sin usar la red', async () => {
  let h = harness();
  let result = await h.run({ file: new Blob([bytes]) });
  assert.equal(result.result.downloaded, true);
  assert.equal(h.calls.length, 0);
  h = harness();
  result = await h.run({ file: new Blob(['mal']) });
  assert.match(result.error, /tamaño/i);
  assert.equal(h.entries.has(h.key), false);
  assert.equal(h.calls.length, 0);
});

test('cancelar una transferencia no publica un archivo parcial', async () => {
  const h = harness({ fetcher: async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 5));
      options.signal.addEventListener('abort', () => controller.error(new DOMException('Cancelado', 'AbortError')), { once: true });
    }
  })) });
  h.progress(p => { if (p.loaded > 0) queueMicrotask(() => h.self.onmessage({ data: { type: 'cancel' } })); });
  const result = await h.run();
  assert.equal(result.name, 'AbortError');
  assert.equal(h.entries.has(h.key), false);
});

test('informa errores de red, HTTP, exceso de bytes y cuota sin activar pesos', async () => {
  let h = harness({ fetcher: async () => { throw new TypeError('CORS o red'); } });
  let result = await h.run();
  assert.match(result.error, /Hugging Face/); assert.equal(h.entries.has(h.key), false);
  h = harness({ fetcher: async () => new Response('no encontrado', { status: 404 }) });
  result = await h.run(); assert.match(result.error, /HTTP 404/); assert.equal(h.entries.has(h.key), false);
  h = harness({ fetcher: async () => new Response(Buffer.concat([bytes, Buffer.from('exceso')])) });
  result = await h.run(); assert.match(result.error, /supera el tamaño/); assert.equal(h.entries.has(h.key), false);
  h = harness({ quota: true }); result = await h.run();
  assert.match(result.error, /espacio suficiente/); assert.equal(h.entries.has(h.key), false);
});
