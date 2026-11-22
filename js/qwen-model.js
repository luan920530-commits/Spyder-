/* Qwen opcional: descarga verificada, caché propia e inferencia local. */
(function (root) {
  'use strict';
  const CFG = root.NCQwenConfig;
  const S = () => root.NeuralStore;
  const urlFor = path => new URL(path, document.baseURI).href;
  const abortError = () => new DOMException('Cancelado', 'AbortError');
  let state = { status: 'inactive', enabled: false, installed: false, hasDownload: false,
    hasModel: false, progress: 0, message: 'Qwen opcional desactivado.' };
  let epoch = 0, activation = null, controller = null, engine = null, nextId = 0, removing = false;
  const pending = new Map();

  const info = () => ({ ...state });
  function update(patch) { state = { ...state, ...patch }; S()?.emit('qwen:status', info()); }
  function current(token) { if (token !== epoch) throw abortError(); }
  async function cache() {
    try { return typeof caches !== 'undefined' ? await caches.open(CFG.cache) : null; }
    catch (_) { return null; }
  }
  async function inventory() {
    const c = await cache();
    if (!c) return { installed: false, hasModel: false, hasDownload: false };
    const hasModel = !!(await c.match(urlFor(CFG.modelPath)));
    let runtime = 0;
    for (const [path] of CFG.runtime) if (await c.match(urlFor(path))) runtime++;
    return { installed: hasModel && runtime === CFG.runtime.length, hasModel, hasDownload: hasModel || runtime > 0 };
  }
  function inventoryMessage(i) {
    if (i.installed) return 'Qwen descargado en este navegador; puedes activarlo.';
    if (i.hasModel) return 'Modelo guardado; activa Qwen para completar el motor local.';
    return i.hasDownload ? 'Quedan archivos del motor local; puedes descargarlos o eliminarlos.' : 'Qwen opcional desactivado.';
  }
  async function isDownloaded() { return (await inventory()).installed; }
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
    if (!sw || !root.crypto?.subtle || typeof caches === 'undefined' || typeof Worker === 'undefined') {
      throw new Error('Qwen necesita HTTPS o localhost, Service Worker, WebAssembly y almacenamiento disponibles.');
    }
    await waitFor(sw.ready, signal, 'No se pudo preparar el modo sin conexión. Recarga e inténtalo.');
    if (sw.controller) return;
    let changed;
    try {
      await waitFor(new Promise(resolve => {
        changed = () => { if (sw.controller) resolve(); };
        sw.addEventListener('controllerchange', changed); changed();
      }), signal, 'La aplicación aún no controla la caché. Recarga e inténtalo.');
    } finally { if (changed) sw.removeEventListener('controllerchange', changed); }
  }
  async function digest(bytes) {
    const result = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function ensureRuntime(token, signal, onlyCached) {
    const c = await cache();
    if (!c) throw new Error('El almacenamiento de modelos no está disponible.');
    for (const [path, size, hash] of CFG.runtime) {
      current(token);
      const url = urlFor(path), existing = await c.match(url);
      current(token);
      if (existing) {
        const bytes = await existing.arrayBuffer();
        if (bytes.byteLength === size && await digest(bytes) === hash) { current(token); continue; }
        await c.delete(url); current(token);
        if (onlyCached) throw new Error('El motor local está dañado. Actívalo de nuevo con conexión.');
      }
      if (onlyCached) throw new Error('Faltan archivos del motor local. Actívalo con conexión.');
      update({ message: 'Preparando el motor local de Qwen…' });
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`No se pudo obtener el motor local (HTTP ${response.status}).`);
      const bytes = await response.arrayBuffer();
      current(token);
      if (bytes.byteLength !== size || await digest(bytes) !== hash) throw new Error('Falló la integridad del motor local.');
      current(token);
      try { await c.put(url, new Response(bytes, { headers: { 'Content-Type': path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' } })); }
      catch (_) { throw new Error('No hay espacio suficiente para el motor local.'); }
      current(token);
      update({ hasDownload: true });
    }
  }
  function prepareModel(signal, options, token) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(urlFor('js/qwen-download-worker.js'));
      const id = ++nextId;
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true; signal.removeEventListener('abort', onAbort); worker.terminate();
        if (error) reject(error); else resolve(value);
      };
      const onAbort = () => worker.postMessage({ type: 'cancel' });
      signal.addEventListener('abort', onAbort, { once: true });
      worker.onerror = event => finish(new Error(event.message || 'Falló el descargador local.'));
      worker.onmessage = ({ data }) => {
        if (data.progress) {
          if (token !== epoch) return;
          const { phase, loaded, total } = data.progress;
          const messages = { downloading: 'Descargando Qwen desde Hugging Face…', importing: 'Importando Qwen desde el archivo…', verifying: 'Verificando el modelo guardado…' };
          update({ progress: Math.min(1, loaded / total), message: messages[phase] || 'Preparando Qwen…' });
        } else if (data.id === id) {
          if (data.error) { const e = new Error(data.error); e.name = data.name || 'Error'; finish(e); }
          else finish(null, data.result);
        }
      };
      worker.postMessage({ id, type: 'prepare', onlyCached: !!options.onlyCached, file: options.file || null });
      if (signal.aborted) onAbort();
    });
  }
  function stopEngine(error) {
    if (engine) engine.terminate();
    engine = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.cleanup(); item.reject(error || abortError()); }
    pending.clear();
  }
  function failEngine(message) {
    if (!engine) return;
    ++epoch; controller?.abort(); controller = null;
    stopEngine(new Error(message));
    S()?.setSetting('qwenEnabled', false);
    update({ enabled: false, status: 'error', message: `Qwen se detuvo: ${message}` });
  }
  function startEngine() {
    const worker = new Worker(urlFor('js/qwen-inference-worker.js'));
    engine = worker;
    worker.onerror = event => { if (engine === worker) failEngine(event.message || 'Error en el motor local.'); };
    worker.onmessage = ({ data }) => {
      if (engine !== worker) return;
      if (data.fatal) { failEngine(data.fatal); return; }
      const item = pending.get(data.id);
      if (!item) return;
      if (data.progress) { if (!item.signal?.aborted) item.onProgress?.(data.progress); return; }
      pending.delete(data.id); clearTimeout(item.timer); item.cleanup();
      if (item.signal?.aborted || data.name === 'AbortError') item.reject(abortError());
      else if (data.error) { const error = new Error(data.error); error.name = data.name || 'Error'; item.reject(error); }
      else item.resolve(data.result);
    };
  }
  function send(type, payload, options) {
    const opts = options || {};
    if (!engine) return Promise.reject(new Error('Qwen no está activo.'));
    if (opts.signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const id = ++nextId, worker = engine;
      const onAbort = () => { if (engine === worker) worker.postMessage({ type: 'cancel', id }); };
      const cleanup = () => opts.signal?.removeEventListener('abort', onAbort);
      const timer = setTimeout(() => { if (engine === worker) failEngine('El navegador tardó demasiado en responder.'); }, type === 'init' ? 180000 : 300000);
      pending.set(id, { resolve, reject, onProgress: opts.onProgress, signal: opts.signal, cleanup, timer });
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      try { worker.postMessage({ id, type, ...payload }); }
      catch (error) { pending.delete(id); clearTimeout(timer); cleanup(); reject(error); }
      if (opts.signal?.aborted) onAbort();
    });
  }
  function activate(options) {
    const opts = options || {};
    if (removing || activation || state.enabled) return Promise.resolve();
    const token = ++epoch, abort = new AbortController(); controller = abort;
    update({ status: 'downloading', enabled: false, progress: 0, message: 'Preparando almacenamiento local…' });
    const task = (async () => {
      try {
        await ensureOfflineSupport(abort.signal); current(token);
        await ensureRuntime(token, abort.signal, !!opts.onlyCached); current(token);
        await prepareModel(abort.signal, opts, token); current(token);
        update({ status: 'loading', installed: true, hasModel: true, hasDownload: true, progress: 1,
          message: 'Cargando Qwen en la memoria del dispositivo; puede tardar…' });
        startEngine();
        await send('init', {}, { signal: abort.signal }); current(token);
        S()?.setSetting('qwenEnabled', true);
        update({ status: 'ready', enabled: true, message: 'Qwen activo en este dispositivo · personaje, tutor y asistente personal.' });
        // Es una solicitud opcional, no debe bloquear la activación ni su cancelación.
        // El navegador puede denegarla y seguir eliminando datos por cuota.
        try { Promise.resolve(navigator.storage?.persist?.()).catch(() => {}); } catch (_) { /* opcional */ }
      } catch (error) {
        if (token !== epoch) return;
        stopEngine(); S()?.setSetting('qwenEnabled', false);
        let cached = {};
        try { cached = await inventory(); } catch (_) { /* conservar estado conocido */ }
        if (token !== epoch) return;
        update({ ...cached, enabled: false, status: 'error', message: `No se pudo activar Qwen: ${error.message}` });
      } finally { if (token === epoch) controller = null; }
    })();
    activation = task;
    task.finally(async () => {
      if (activation !== task) return;
      activation = null;
      if (token === epoch || removing || state.status !== 'cancelling') return;
      const cached = await inventory().catch(() => null);
      if (token !== epoch && !removing && !activation && state.status === 'cancelling') {
        update({ ...(cached || {}), status: 'inactive', message: cached ? inventoryMessage(cached) : 'Qwen desactivado.' });
      }
    });
    return task;
  }
  function deactivate() {
    ++epoch; controller?.abort(); controller = null;
    stopEngine(); S()?.setSetting('qwenEnabled', false);
    if (!removing) update({ status: activation ? 'cancelling' : 'inactive', enabled: false,
      message: activation ? 'Cancelando Qwen; espera a que termine…' :
        state.installed ? 'Qwen desactivado. La descarga sigue guardada en este navegador.' : 'Qwen desactivado.' });
  }
  async function removeDownload() {
    if (removing) return;
    removing = true; deactivate();
    update({ status: 'removing', enabled: false, message: 'Eliminando Qwen del almacenamiento…' });
    try {
      if (activation) await activation;
      const remove = () => typeof caches !== 'undefined' ? caches.delete(CFG.cache) : Promise.resolve();
      if (navigator.locks?.request) await navigator.locks.request(CFG.cache, { mode: 'exclusive' }, remove);
      else await remove();
      update({ status: 'inactive', installed: false, hasModel: false, hasDownload: false, progress: 0,
        message: 'Descarga de Qwen eliminada. Tus libros no se borraron.' });
    } catch (error) { update({ status: 'error', message: `No se pudo eliminar Qwen: ${error.message}` }); }
    finally { removing = false; }
  }
  function generate(prompt, options) {
    if (!state.enabled || state.status !== 'ready') return Promise.reject(new Error('Qwen no está activo.'));
    return send('generate', { prompt }, { signal: options?.signal,
      onProgress: detail => options?.onToken?.(detail.text || '') });
  }
  async function init() {
    const store = S();
    // Cancelar al principio una activación pendiente para que no sobrescriba
    // los ajustes del respaldo o del reset cuando termine su descarga/carga.
    store.on('brain:importing', () => { if (activation && !state.enabled) deactivate(); });
    store.on('system:resetting', options => {
      if ((activation && !state.enabled) || (options?.keepSettings === false && state.enabled)) {
        const restore = options?.keepSettings !== false && store.getSetting('qwenEnabled', false);
        deactivate();
        if (restore) store.setSetting('qwenEnabled', true, { persist: false });
      }
    });
    function reconcile() {
      if (!store.getSetting('qwenEnabled', false)) {
        if (state.enabled || activation) deactivate();
        return;
      }
      if (state.enabled) return;
      const token = epoch, previous = activation;
      void (async () => {
        if (previous) await previous;
        if (token !== epoch || removing || activation || state.enabled || !store.getSetting('qwenEnabled', false)) return;
        const cached = await inventory();
        if (token !== epoch || removing || activation || state.enabled || !store.getSetting('qwenEnabled', false)) return;
        update({ ...cached, message: inventoryMessage(cached) });
        // Un respaldo nunca autoriza una descarga externa implícita.
        if (cached.installed) void activate({ onlyCached: true });
        else store.setSetting('qwenEnabled', false);
      })().catch(error => { if (token === epoch) update({ status: 'error', message: `No se pudo revisar Qwen: ${error.message}` }); });
    }
    ['brain:imported', 'system:reset'].forEach(event => store.on(event, reconcile));
    const token = epoch, cached = await inventory();
    if (token !== epoch) return;
    update({ ...cached, message: inventoryMessage(cached) });
    // Nunca iniciar una descarga externa al abrir o restaurar un respaldo.
    if (cached.installed && store.getSetting('qwenEnabled', false)) void activate({ onlyCached: true });
    else if (!cached.installed && store.getSetting('qwenEnabled', false)) store.setSetting('qwenEnabled', false);
  }
  root.NCQwenModel = { init, activate, deactivate, removeDownload, generate, info, isDownloaded };
})(typeof window !== 'undefined' ? window : globalThis);
