/* Modelo opcional: descarga desde el mismo origen e inferencia en un worker local. */
(function (root) {
  'use strict';
  const CACHE = 'neural-spider-model-v1';
  // Longitud y SHA-256 de los archivos empaquetados; cambiar la versión de caché si cambian.
  const FILES = [
    ['vendor/transformers/transformers.min.js', 897938, 'bcf7cf304e51f470ed59409622b9d6ffbad80dfcf5baf6a40c919e4b9c4ff812'],
    ['vendor/transformers/ort-wasm-simd.wasm', 10014674, '9bd07bababc65f53d061f457233eeae501be7ceb8a2adb9eef52d87fe776d865'],
    ['vendor/transformers/ort-wasm.wasm', 9223228, 'bbdcb6b3c7d294577d806077630460be4e13ca35a345acb5e81188e9649fa74a'],
    ['models/minilm/config.json', 665, '49377f658dcedad2ebb7088c77917c45d7480e7d7848f3671111a6ba4b156d7a'],
    ['models/minilm/tokenizer_config.json', 381, 'ac4db152b467998d8ded6c68803f885b964945df9dda3d58fea1f5d4cb55b882'],
    ['models/minilm/special_tokens_map.json', 132, '3c3507f36dff57bce437223db3b3081d1e2b52ec3e56ee55438193ecb2c94dd6'],
    ['models/minilm/tokenizer.json', 742260, 'fe61a69b21a5183abd4fc9cd74b9c9d16d81441b19dc6763a8df0470227b603b'],
    ['models/minilm/onnx/model_quantized.onnx', 22972370, 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1']
  ];
  const totalBytes = FILES.reduce((sum, [, size]) => sum + size, 0);
  let worker = null, controller = null, generation = 0, nextId = 1, indexing = null, rerun = false, removing = false;
  const pending = new Map(), vectors = new Map(), mutations = new Set();
  let state = { status: 'inactive', enabled: false, installed: false, hasDownload: false,
    progress: 0, indexed: 0, total: 0, message: 'Modelo opcional desactivado.' };
  const S = () => root.NeuralStore;
  const urlFor = path => new URL(path, document.baseURI).href;
  const cancelled = token => token !== generation;
  const abortError = () => new DOMException('Cancelado', 'AbortError');
  function info() { return { ...state, indexed: vectors.size }; }
  function update(patch) { state = { ...state, ...patch }; S()?.emit('model:status', info()); }
  function assertCurrent(token) { if (cancelled(token)) throw abortError(); }

  async function getCache() {
    try { return typeof caches !== 'undefined' ? await caches.open(CACHE) : null; }
    catch (_) { return null; }
  }
  async function inventory() {
    const cache = await getCache();
    if (!cache) return { count: 0, bytes: 0 };
    let count = 0, bytes = 0;
    for (const [path, size] of FILES) if (await cache.match(urlFor(path))) { count++; bytes += size; }
    return { count, bytes };
  }
  async function isDownloaded() { return (await inventory()).count === FILES.length; }
  function inventoryState({ count, bytes }) {
    return { installed: count === FILES.length, hasDownload: count > 0, progress: bytes / totalBytes };
  }
  function inventoryMessage(info) {
    return info.installed ? 'Descargado en este navegador; puedes activarlo.' :
      info.hasDownload ? 'Descarga parcial guardada; puedes reanudarla o eliminarla.' : 'Modelo opcional desactivado.';
  }
  // Una cancelación puede coincidir con cache.put/delete. Espera esas operaciones
  // antes de borrar la caché o de iniciar otra descarga en esta pestaña.
  function trackMutation(operation) {
    const promise = Promise.resolve(operation);
    mutations.add(promise);
    return promise.finally(() => mutations.delete(promise));
  }
  async function settleMutations() { await Promise.allSettled([...mutations]); }

  function waitFor(promise, signal, message) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort); fn(value);
      };
      const onAbort = () => finish(reject, abortError());
      const timer = setTimeout(() => finish(reject, new Error(message)), 12000);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) return onAbort();
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  async function ensureOfflineSupport(signal) {
    const sw = navigator.serviceWorker;
    if (!sw || !root.crypto?.subtle) throw new Error('El modelo necesita HTTPS o localhost, Service Worker y almacenamiento disponibles.');
    await waitFor(sw.ready, signal, 'No se pudo preparar el funcionamiento sin conexión. Recarga e inténtalo de nuevo.');
    if (sw.controller) return;
    // clients.claim() normalmente toma el control enseguida; también cubre la primera instalación.
    let changed;
    try {
      await waitFor(new Promise(resolve => {
        changed = () => { if (sw.controller) resolve(); };
        sw.addEventListener('controllerchange', changed);
        changed();
      }), signal, 'La aplicación aún no controla la caché. Recarga e inténtalo de nuevo.');
    } finally { if (changed) sw.removeEventListener('controllerchange', changed); }
  }
  async function verify(blob, expectedHash) {
    const digest = await root.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return actual === expectedHash;
  }
  async function downloadAssets(token, signal, onlyCached) {
    const cache = await getCache();
    if (!cache) throw new Error('El almacenamiento de modelos no está disponible en este navegador.');
    let completed = 0;
    for (let i = 0; i < FILES.length; i++) {
      const [path, expected, hash] = FILES[i], url = urlFor(path);
      assertCurrent(token);
      const cached = await cache.match(url);
      assertCurrent(token);
      if (cached) {
        update({ hasDownload: true, progress: completed / totalBytes, message: `Verificando archivos locales (${i + 1}/${FILES.length})…` });
        const blob = await cached.blob();
        const valid = blob.size === expected && await verify(blob, hash);
        assertCurrent(token);
        if (valid) {
          completed += expected;
          update({ progress: completed / totalBytes });
          continue;
        }
        // No se ejecutan archivos corruptos ni se sirven desde la caché al reintentar.
        await trackMutation(cache.delete(url));
        assertCurrent(token);
        update({ installed: false });
        if (onlyCached) throw new Error(`Archivo local dañado: ${path}. Vuelve a descargarlo desde MODELO.`);
      }
      if (onlyCached) throw new Error('El modelo no está completamente descargado.');
      update({ progress: completed / totalBytes, message: `Descargando desde esta instalación (${i + 1}/${FILES.length})…` });
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`No se pudo descargar ${path} (HTTP ${response.status}).`);
      const chunks = []; let received = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          assertCurrent(token);
          if (done) break;
          chunks.push(value); received += value.byteLength;
          if (received > expected) throw new Error(`Tamaño inesperado: ${path}.`);
          update({ progress: Math.min(1, (completed + received) / totalBytes) });
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer()); chunks.push(bytes); received = bytes.byteLength;
      }
      if (received !== expected) throw new Error(`Archivo incompleto: ${path}. Vuelve a intentarlo.`);
      const blob = new Blob(chunks);
      update({ message: `Verificando integridad (${i + 1}/${FILES.length})…` });
      if (!await verify(blob, hash)) throw new Error(`La comprobación de integridad falló: ${path}.`);
      assertCurrent(token);
      const headers = new Headers(response.headers);
      // Fetch ya descomprime el cuerpo; no conservar cabeceras de transferencia obsoletas.
      ['content-length', 'content-encoding', 'transfer-encoding'].forEach(name => headers.delete(name));
      try { await trackMutation(cache.put(url, new Response(blob, { status: 200, headers }))); }
      catch (_) { throw new Error('No hay espacio para guardar el modelo. Libera almacenamiento y vuelve a intentarlo.'); }
      assertCurrent(token);
      completed += expected;
      update({ hasDownload: true, progress: completed / totalBytes });
    }
  }
  function send(type, payload, onProgress) {
    if (!worker) return Promise.reject(new Error('El modelo no está activo.'));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, onProgress });
      try { worker.postMessage({ id, type, ...payload }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  function createWorker() {
    const current = new Worker(new URL('js/onnx-worker.js', document.baseURI));
    worker = current;
    current.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      if (data.progress) { job.onProgress?.(data.progress); return; }
      pending.delete(data.id);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
    };
    current.onerror = event => {
      if (worker !== current) return;
      const error = new Error(event.message || 'No se pudo ejecutar el modelo en este navegador.');
      pending.forEach(job => job.reject(error)); pending.clear();
      if (state.enabled) {
        generation++; controller?.abort(); controller = null;
        current.terminate(); worker = null; vectors.clear(); indexing = null; rerun = false;
        S().setSetting('onnxEnabled', false);
        update({ enabled: false, status: 'error', indexed: 0, total: 0, message: `El modelo se detuvo: ${error.message}` });
      }
    };
  }
  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
    pending.forEach(job => job.reject(abortError())); pending.clear();
  }
  // Los vectores solo viven en memoria; el título forma parte de la entrada
  // del modelo pero no se añade a una cita como si fuera texto del pasaje.
  const modelText = sentence => sentence.contextText || sentence.text;
  function pruneVectors() {
    const index = S().state.index;
    let changed = false;
    for (const [id, entry] of vectors) {
      const pos = index?.posById.get(id);
      if (pos == null || modelText(index.sentences[pos]) !== entry.text) { vectors.delete(id); changed = true; }
    }
    if (changed) S()?.emit('model:vectorsChanged', { reset: true });
  }
  // Copias de solo lectura lógica: ningún consumidor puede mutar el índice del modelo.
  function vectorSnapshot(ids) {
    if (!state.enabled || !S()?.getSetting('embedEnabled', true)) return [];
    const index = S().state.index, out = [];
    const keys = ids || vectors.keys();
    for (const id of keys) {
      const entry = vectors.get(id), pos = index?.posById.get(id);
      if (!entry || pos == null || modelText(index.sentences[pos]) !== entry.text) continue;
      out.push({ id, vector: new Float32Array(entry.vector) });
    }
    return out;
  }
  function indexCorpus() {
    if (!worker || !state.enabled) return Promise.resolve();
    if (indexing) { rerun = true; return indexing; }
    const token = generation;
    const task = (async () => {
      do {
        rerun = false;
        pruneVectors();
        const sentences = S().state.index.sentences.slice();
        const missing = sentences.filter(s => vectors.get(s.id)?.text !== modelText(s));
        update({ status: 'indexing', total: sentences.length, message: `Indexando pasajes: ${sentences.length - missing.length}/${sentences.length}…` });
        for (let i = 0; i < missing.length;) {
          if (cancelled(token)) return;
          // Reducir el lote cuando hay pasajes largos limita memoria en móviles.
          const batch = []; let chars = 0;
          while (i < missing.length && batch.length < 8) {
            const next = missing[i], estimate = Math.min(1100, modelText(next).length);
            if (batch.length && chars + estimate > 2200) break;
            batch.push(next); chars += estimate; i++;
          }
          const result = await send('embed', { texts: batch.map(modelText) });
          if (cancelled(token)) return;
          const currentIndex = S().state.index, added = [];
          batch.forEach((sentence, j) => {
            const pos = currentIndex.posById.get(sentence.id), text = modelText(sentence);
            if (pos != null && modelText(currentIndex.sentences[pos]) === text && result[j]) {
              vectors.set(sentence.id, { text, vector: result[j] }); added.push(sentence.id);
            }
          });
          if (added.length) S()?.emit('model:vectorsChanged', { added });
          update({ status: 'indexing', total: currentIndex.sentences.length,
            message: `Indexando pasajes: ${vectors.size}/${currentIndex.sentences.length}…` });
        }
      } while (rerun && !cancelled(token));
      if (!cancelled(token)) update({ status: 'ready', progress: 1, message: `Modelo activo · ${vectors.size} pasajes indexados.` });
    })().catch(error => {
      if (!cancelled(token) && worker) update({ status: 'error', message: `No se pudo indexar: ${error.message}` });
    });
    indexing = task;
    task.finally(() => {
      if (indexing !== task) return;
      indexing = null;
      // Un cambio síncrono puede llegar justo después de terminar un índice vacío.
      if (rerun && !cancelled(token) && worker && state.enabled) void indexCorpus();
    });
    return task;
  }
  async function activate(options) {
    if (removing || state.enabled || state.status === 'downloading' || state.status === 'loading') return;
    const token = ++generation, abort = new AbortController();
    controller = abort;
    update({ status: 'downloading', enabled: false, progress: 0, message: 'Preparando almacenamiento local…' });
    try {
      await settleMutations();
      assertCurrent(token);
      await ensureOfflineSupport(abort.signal);
      assertCurrent(token);
      await downloadAssets(token, abort.signal, !!options?.onlyCached);
      assertCurrent(token);
      update({ status: 'loading', installed: true, hasDownload: true, message: 'Inicializando ONNX en el dispositivo…' });
      createWorker();
      await send('init', {}, detail => {
        if (!cancelled(token) && detail.status === 'progress') update({ message: `Preparando ${detail.file || 'modelo'}…` });
      });
      assertCurrent(token);
      update({ enabled: true, status: 'indexing', progress: 1, message: 'Modelo activo. Preparando índice…' });
      S().setSetting('onnxEnabled', true);
      await indexCorpus();
    } catch (error) {
      if (cancelled(token)) return;
      stopWorker(); vectors.clear();
      S().setSetting('onnxEnabled', false);
      let cached = {};
      try { cached = inventoryState(await inventory()); } catch (_) { /* conservar estado conocido */ }
      if (cancelled(token)) return;
      update({ ...cached, enabled: false, status: 'error', message: `No se pudo activar: ${error.message}` });
    } finally { if (!cancelled(token)) controller = null; }
  }
  function deactivate() {
    const token = ++generation; controller?.abort(); controller = null;
    stopWorker(); vectors.clear(); rerun = false; indexing = null;
    S()?.setSetting('onnxEnabled', false);
    if (removing) return;
    update({ status: 'inactive', enabled: false, indexed: 0, total: 0,
      message: state.installed ? 'Modelo desactivado. La descarga sigue guardada en este navegador.' :
        state.hasDownload ? 'Descarga parcial guardada; puedes reanudarla o eliminarla.' : 'Modelo desactivado. El motor interno sigue disponible.' });
    // Si se canceló mientras se escribía un archivo, reflejar la caché final.
    void settleMutations().then(inventory).then(result => {
      if (cancelled(token) || removing || state.status !== 'inactive') return;
      const cached = inventoryState(result);
      update({ ...cached, message: inventoryMessage(cached) });
    }).catch(() => {});
  }
  async function removeDownload() {
    if (removing) return;
    removing = true;
    deactivate();
    update({ status: 'removing', enabled: false, indexed: 0, total: 0, message: 'Eliminando descarga…' });
    let result;
    try {
      await settleMutations();
      if (typeof caches !== 'undefined') await caches.delete(CACHE);
      result = { status: 'inactive', installed: false, hasDownload: false, progress: 0, message: 'Descarga eliminada de este navegador.' };
    } catch (error) { result = { status: 'error', message: `No se pudo eliminar la descarga: ${error.message}` }; }
    removing = false;
    update(result);
  }
  async function scores(query) {
    if (!worker || !state.enabled || !vectors.size || !String(query || '').trim()) return null;
    const token = generation;
    const result = await send('embed', { texts: [query] });
    if (cancelled(token)) return null;
    const queryVector = result[0], out = new Map(), index = S().state.index;
    for (const [id, entry] of vectors) {
      const pos = index.posById.get(id);
      if (pos != null && modelText(index.sentences[pos]) === entry.text) out.set(id, root.NCUtil.cosine(queryVector, entry.vector));
    }
    return out;
  }
  async function init() {
    const store = S();
    const reindex = () => {
      pruneVectors();
      if (state.enabled) void indexCorpus();
    };
    ['doc:added', 'doc:removed'].forEach(event => store.on(event, reindex));
    ['brain:imported', 'system:reset'].forEach(event => store.on(event, () => {
      if (state.enabled && !store.getSetting('onnxEnabled', false)) deactivate();
      else if (!state.enabled && store.getSetting('onnxEnabled', false)) {
        if (state.installed) void activate({ onlyCached: true });
        else store.setSetting('onnxEnabled', false);
      }
      reindex();
    }));
    const token = generation, cached = inventoryState(await inventory());
    if (cancelled(token)) return;
    update({ ...cached, message: inventoryMessage(cached) });
    // La restauración automática solo usa recursos previamente descargados.
    if (cached.installed && store.getSetting('onnxEnabled', false)) void activate({ onlyCached: true });
    else if (!cached.installed && store.getSetting('onnxEnabled', false)) store.setSetting('onnxEnabled', false);
  }
  root.NCLocalModel = { init, activate, deactivate, removeDownload, scores, vectorSnapshot, reindex: indexCorpus, info, isDownloaded };
})(typeof window !== 'undefined' ? window : globalThis);
