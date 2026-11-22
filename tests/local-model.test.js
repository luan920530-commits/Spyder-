const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const R = require('../js/retrieval');
const U = require('../js/util');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/local-model.js'), 'utf8');
const files = [...source.matchAll(/^\s+\['([^']+)',\s*(\d+),\s*'([a-f0-9]{64})'\]/gm)]
  .map(([, name, size, hash]) => ({ name, size: Number(size), hash }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (fn()) return; await pause(5); }
  throw new Error('Tiempo agotado esperando el estado del modelo');
}
function sentence(text = 'Texto original sobre la memoria.') {
  return { id: 's1', docId: 'd1', docName: 'notas.txt', pageNum: 1, text };
}
function harness({ cached = 0, enabled = false, fetcher, holdFirstEmbed = false, holdFirstPut = false, corrupt = [], failFirstEmbed = false } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://local.test/app/', runScripts: 'outside-only' });
  const w = dom.window, listeners = new Map(), requests = [], workerMessages = [];
  let heldReply = null, releasePut = null, worker = null;
  const settings = { onnxEnabled: enabled, embedEnabled: true };
  const store = {
    state: { index: R.rebuildFrom([sentence()]) },
    on(type, cb) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(cb); },
    emit(type, payload) { for (const cb of listeners.get(type) || []) cb(payload); },
    getSetting(key, fallback) { return settings[key] === undefined ? fallback : settings[key]; },
    setSetting(key, value) { settings[key] = value; }
  };
  const entries = new Set(files.slice(0, cached).map(file => new URL(file.name, w.document.baseURI).href));
  const storedHeaders = new Map(), storedResponses = new Map();
  const cache = {
    async match(url) {
      url = String(url);
      if (!entries.has(url)) return undefined;
      if (storedResponses.has(url)) return storedResponses.get(url).clone();
      const file = files.find(item => new URL(item.name, w.document.baseURI).href === url);
      return { blob: async () => new Blob([corrupt.includes(file.name) ? Buffer.alloc(file.size) : fs.readFileSync(path.join(root, file.name))]) };
    },
    async put(url, response) {
      if (holdFirstPut) { holdFirstPut = false; await new Promise(resolve => { releasePut = resolve; }); }
      entries.add(String(url)); storedHeaders.set(String(url), response.headers); storedResponses.set(String(url), response.clone());
    },
    async delete(url) { storedResponses.delete(String(url)); return entries.delete(String(url)); }
  };
  w.caches = { async open() { return cache; }, async delete() { entries.clear(); storedResponses.clear(); return true; } };
  Object.defineProperty(w, 'crypto', { value: crypto.webcrypto, configurable: true });
  Object.defineProperty(w.navigator, 'serviceWorker', { value: { controller: {}, ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} }, configurable: true });
  w.Blob = Blob; w.Response = Response; w.Headers = Headers;
  w.AbortController = AbortController; w.DOMException = DOMException;
  w.NCUtil = U; w.NeuralStore = store;
  w.fetch = async (url, options) => { requests.push(String(url)); if (!fetcher) throw new Error('No debería descargar'); return fetcher(String(url), options); };
  class FakeWorker {
    constructor() { this.terminated = false; worker = this; }
    postMessage(message) {
      workerMessages.push(message);
      const reply = () => {
        if (this.terminated) return;
        if (message.type === 'embed' && failFirstEmbed) {
          failFirstEmbed = false; this.onmessage({ data: { id: message.id, error: 'Error de inferencia simulado' } }); return;
        }
        const result = message.type === 'init' ? { dimensions: 384 } : message.texts.map(text => new Float32Array([1, text.length / 100, .5]));
        this.onmessage({ data: { id: message.id, result } });
      };
      if (holdFirstEmbed && message.type === 'embed') { holdFirstEmbed = false; heldReply = reply; }
      else queueMicrotask(reply);
    }
    terminate() { this.terminated = true; }
  }
  w.Worker = FakeWorker;
  w.eval(source);
  return { dom, w, model: w.NCLocalModel, store, settings, entries, requests, workerMessages, storedHeaders,
    releaseHeld: () => { const reply = heldReply; heldReply = null; reply?.(); },
    putHeld: () => !!releasePut,
    releasePut: () => { const release = releasePut; releasePut = null; release?.(); },
    crashWorker: () => worker?.onerror({ message: 'Fallo fatal simulado' }) };
}

test('los archivos opcionales coinciden con el manifiesto de tamaño e integridad', () => {
  assert.equal(files.length, 8);
  assert.equal(files.reduce((sum, file) => sum + file.size, 0), 43851648);
  for (const file of files) {
    const data = fs.readFileSync(path.join(root, file.name));
    assert.equal(data.length, file.size, file.name);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), file.hash, file.name);
  }
});

test('descarga del mismo origen valida integridad y guarda archivos opcionales', async () => {
  const h = harness({ fetcher: async url => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://local.test');
    const relative = decodeURIComponent(parsed.pathname.replace(/^\/app\//, ''));
    const data = fs.readFileSync(path.join(root, relative));
    return new Response(data, { headers: { 'content-length': String(data.length), 'content-encoding': 'identity', 'content-type': 'application/octet-stream' } });
  } });
  try {
    await h.model.init();
    assert.equal(h.model.info().installed, false);
    await h.model.activate();
    assert.equal(h.model.info().status, 'ready');
    assert.equal(h.model.info().installed, true);
    assert.equal(h.model.info().indexed, 1);
    assert.equal(h.requests.length, files.length);
    assert.equal(await h.model.isDownloaded(), true);
    for (const headers of h.storedHeaders.values()) {
      assert.equal(headers.has('content-length'), false);
      assert.equal(headers.has('content-encoding'), false);
    }
    assert.equal((await h.model.scores('consulta')).size, 1);
    h.model.deactivate();
    assert.equal(h.settings.onnxEnabled, false);
    assert.equal(await h.model.isDownloaded(), true);
    await h.model.removeDownload();
    assert.equal(await h.model.isDownloaded(), false);
    assert.equal(h.model.info().hasDownload, false);
  } finally { h.dom.window.close(); }
});

test('rechaza un recurso modificado aun si tiene el tamaño correcto', async () => {
  const h = harness({ fetcher: async () => new Response(Buffer.alloc(files[0].size)) });
  try {
    await h.model.init();
    await h.model.activate();
    assert.equal(h.model.info().status, 'error');
    assert.match(h.model.info().message, /integridad/i);
    assert.equal(h.entries.size, 0);
    assert.equal(h.workerMessages.length, 0);
  } finally { h.dom.window.close(); }
});

test('verifica también los archivos ya guardados y permite reparar una caché dañada', async () => {
  const h = harness({ cached: files.length, corrupt: [files[0].name], fetcher: async url => {
    const relative = decodeURIComponent(new URL(url).pathname.replace(/^\/app\//, ''));
    return new Response(fs.readFileSync(path.join(root, relative)));
  } });
  try {
    await h.model.init();
    await h.model.activate({ onlyCached: true });
    assert.equal(h.model.info().status, 'error');
    assert.match(h.model.info().message, /archivo local dañado/i);
    assert.equal(h.model.info().installed, false);
    assert.equal(h.entries.size, files.length - 1);
    assert.equal(h.requests.length, 0);
    assert.equal(h.workerMessages.length, 0);
    await h.model.activate();
    assert.equal(h.model.info().status, 'ready');
    assert.equal(h.requests.length, 1);
    assert.equal(h.entries.size, files.length);
  } finally { h.dom.window.close(); }
});

test('restauración usa solo caché y actualiza vectores al cambiar o borrar texto', async () => {
  const h = harness({ cached: files.length, enabled: true });
  try {
    await h.model.init();
    await until(() => h.model.info().status === 'ready');
    assert.equal(h.requests.length, 0);
    assert.equal(h.model.info().indexed, 1);
    h.store.state.index = R.rebuildFrom([sentence('Texto cambiado sobre un tema distinto.')]);
    h.store.emit('brain:imported');
    assert.equal(await h.model.scores('consulta'), null, 'el vector antiguo se invalida inmediatamente');
    await until(() => h.model.info().status === 'ready' && h.model.info().indexed === 1);
    assert.ok(h.workerMessages.some(m => m.type === 'embed' && m.texts.includes('Texto cambiado sobre un tema distinto.')));
    h.store.state.index = R.createIndex();
    h.store.emit('doc:removed', { docId: 'd1' });
    await until(() => h.model.info().status === 'ready' && h.model.info().total === 0);
    assert.equal(h.model.info().indexed, 0);
    assert.equal(await h.model.scores('consulta'), null);
    h.settings.onnxEnabled = false;
    h.store.emit('system:reset');
    assert.equal(h.model.info().enabled, false);
  } finally { h.dom.window.close(); }
});

test('un cambio de corpus durante la inferencia no conserva vectores obsoletos', async () => {
  const h = harness({ cached: files.length, holdFirstEmbed: true });
  try {
    await h.model.init();
    const activation = h.model.activate({ onlyCached: true });
    await until(() => h.workerMessages.some(m => m.type === 'embed'));
    h.store.state.index = R.rebuildFrom([sentence('Contenido nuevo con el mismo identificador.')]);
    h.store.emit('brain:imported');
    assert.equal(await h.model.scores('consulta'), null);
    h.releaseHeld();
    await activation;
    assert.equal(h.model.info().status, 'ready');
    assert.equal(h.model.info().indexed, 1);
    const batches = h.workerMessages.filter(m => m.type === 'embed').map(m => m.texts[0]);
    assert.deepEqual(batches, ['Texto original sobre la memoria.', 'Contenido nuevo con el mismo identificador.']);
    assert.equal((await h.model.scores('consulta')).size, 1);
  } finally { h.dom.window.close(); }
});

test('al cancelar durante la escritura se reconoce la descarga parcial terminada', async () => {
  const h = harness({ holdFirstPut: true, fetcher: async url => {
    const relative = decodeURIComponent(new URL(url).pathname.replace(/^\/app\//, ''));
    return new Response(fs.readFileSync(path.join(root, relative)));
  } });
  try {
    await h.model.init();
    const activation = h.model.activate();
    await until(() => h.putHeld());
    h.model.deactivate();
    h.releasePut();
    await activation;
    await until(() => h.model.info().hasDownload);
    assert.equal(h.model.info().installed, false);
    assert.ok(h.model.info().progress > 0);
    assert.equal(h.entries.size, 1);
    await h.model.removeDownload();
    assert.equal(h.entries.size, 0);
  } finally { h.dom.window.close(); }
});

test('una eliminación mientras se escribe la caché no deja archivos ni permite reactivar antes de tiempo', async () => {
  const h = harness({ holdFirstPut: true, fetcher: async url => {
    const relative = decodeURIComponent(new URL(url).pathname.replace(/^\/app\//, ''));
    return new Response(fs.readFileSync(path.join(root, relative)));
  } });
  try {
    await h.model.init();
    const activation = h.model.activate();
    await until(() => h.putHeld());
    const removal = h.model.removeDownload();
    assert.equal(h.model.info().status, 'removing');
    await h.model.activate();
    assert.equal(h.requests.length, 1);
    h.releasePut();
    await Promise.all([activation, removal]);
    assert.equal(h.entries.size, 0);
    assert.equal(h.model.info().status, 'inactive');
    assert.equal(h.model.info().hasDownload, false);
    assert.equal(await h.model.isDownloaded(), false);
  } finally { h.dom.window.close(); }
});

test('fallo de inferencia permite reintentar y fallo fatal desactiva el worker', async () => {
  const h = harness({ cached: files.length, failFirstEmbed: true });
  try {
    await h.model.init();
    await h.model.activate({ onlyCached: true });
    assert.equal(h.model.info().status, 'error');
    assert.equal(h.model.info().enabled, true);
    assert.match(h.model.info().message, /inferenc/i);
    await h.model.reindex();
    assert.equal(h.model.info().status, 'ready');
    assert.equal(h.model.info().indexed, 1);
    h.crashWorker();
    assert.equal(h.model.info().status, 'error');
    assert.equal(h.model.info().enabled, false);
    assert.equal(h.model.info().indexed, 0);
    assert.equal(h.settings.onnxEnabled, false);
    assert.equal(await h.model.scores('consulta'), null);
    await h.model.activate({ onlyCached: true });
    assert.equal(h.model.info().status, 'ready');
  } finally { h.dom.window.close(); }
});

test('cambios consecutivos tras un corpus vacío no pierden la reindexación', async () => {
  const h = harness({ cached: files.length });
  try {
    await h.model.init();
    await h.model.activate({ onlyCached: true });
    h.store.state.index = R.createIndex();
    h.store.emit('doc:removed');
    h.store.state.index = R.rebuildFrom([sentence('Nuevo texto insertado inmediatamente.')]);
    h.store.emit('doc:added');
    await until(() => h.model.info().status === 'ready' && h.model.info().indexed === 1);
    assert.ok(h.workerMessages.some(m => m.type === 'embed' && m.texts.includes('Nuevo texto insertado inmediatamente.')));
    assert.equal((await h.model.scores('consulta')).size, 1);
  } finally { h.dom.window.close(); }
});

test('cancelar conserva una descarga parcial reanudable y permite borrarla', async () => {
  const h = harness({ cached: 1, fetcher: (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true });
  }) });
  try {
    await h.model.init();
    assert.equal(h.model.info().installed, false);
    assert.equal(h.model.info().hasDownload, true);
    const download = h.model.activate();
    await until(() => h.requests.length === 1);
    h.model.deactivate();
    await download;
    assert.equal(h.model.info().status, 'inactive');
    assert.equal(h.model.info().hasDownload, true);
    await h.model.removeDownload();
    assert.equal(h.entries.size, 0);
    assert.equal(h.model.info().hasDownload, false);
  } finally { h.dom.window.close(); }
});

test('MiniLM recibe el título y el fragmento completo; expone copias y descarta vectores con contexto cambiado', async () => {
  const h = harness({ cached: files.length });
  try {
    const first = { ...sentence('Una oración. Otra oración.'), section: 'Capítulo uno',
      contextText: 'Capítulo uno\nUna oración. Otra oración.' };
    h.store.state.index = R.rebuildFrom([first]);
    const changes = [];
    h.store.on('model:vectorsChanged', detail => changes.push(detail));
    await h.model.init();
    await h.model.activate({ onlyCached: true });
    assert.ok(h.workerMessages.some(message => message.type === 'embed' && message.texts.includes(first.contextText)));
    assert.ok(changes.some(change => change.added?.includes('s1')));
    const snapshot = h.model.vectorSnapshot(['s1']);
    assert.equal(snapshot.length, 1);
    snapshot[0].vector[0] = 999;
    assert.notEqual(h.model.vectorSnapshot(['s1'])[0].vector[0], 999, 'la vista no puede mutar el índice interno');
    h.settings.embedEnabled = false;
    assert.equal(h.model.vectorSnapshot().length, 0);
    h.settings.embedEnabled = true;
    const changed = { ...first, section: 'Capítulo dos', contextText: 'Capítulo dos\nUna oración. Otra oración.' };
    h.store.state.index = R.rebuildFrom([changed]);
    assert.equal(h.model.vectorSnapshot().length, 0, 'un cambio de título también invalida el vector');
    h.store.emit('brain:imported');
    await until(() => h.model.info().status === 'ready' && h.model.info().indexed === 1);
    assert.ok(h.workerMessages.some(message => message.type === 'embed' && message.texts.includes(changed.contextText)));
    assert.ok(changes.some(change => change.reset));
  } finally { h.dom.window.close(); }
});
