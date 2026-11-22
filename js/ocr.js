/** OCR español optativo. Solo el motor fijo viaja al worker como código;
 * imágenes y pesos se transfieren como datos. No necesita servidor de OCR. */
(function (root) {
  'use strict';
  const PACK = 'vendor/ocr/es-lstm-6.1.2.js';
  const MAX_PIXELS = 3_000_000, MAX_SIDE = 2600;
  let loading;
  function size(w, h, scale = 1) {
    if (![w, h, scale].every(n => Number.isFinite(n) && n > 0)) throw Error('La imagen no tiene dimensiones válidas.');
    const s = Math.min(scale, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
    return { width: Math.max(1, Math.floor(w * s)), height: Math.max(1, Math.floor(h * s)), scale: s };
  }
  const aborted = () => new DOMException('Lectura cancelada', 'AbortError');
  function check(signal) { if (signal?.aborted) throw aborted(); }
  // Abandonar la espera no cancela la carga compartida para otros documentos.
  function waitFor(promise, signal) {
    if (!signal) return promise;
    check(signal);
    return new Promise((resolve, reject) => {
      const cancel = () => reject(aborted());
      signal.addEventListener('abort', cancel, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    });
  }
  function assets() {
    if (root.NCOcrAssets) return Promise.resolve(root.NCOcrAssets);
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = new URL(PACK, document.baseURI).href;
      if (/^https?:/.test(script.src) && root.origin !== 'null') script.integrity = 'sha384-nTVXvQNnuOpq3o6gU9/fwJa58bOJt4SkZNaDV9vpSdOmktsE+7JavSt7TvdOq5U4';
      script.onload = () => { script.remove(); root.NCOcrAssets ? resolve(root.NCOcrAssets) : reject(Error('Paquete OCR local incompleto.')); };
      script.onerror = () => { script.remove(); reject(Error('El motor OCR no está disponible. Abre la app con conexión una vez y usa OCR, o conserva la carpeta vendor/ocr al abrirla desde disco.')); };
      document.head.appendChild(script);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  // Función autocontenida, ejecutada exclusivamente en un worker clásico local.
  function workerMain() {
    let module, api;
    self.onmessage = async ({ data }) => {
      try {
        if (data.wasm) {
          module = await TesseractCore({ wasmBinary: data.wasm, TesseractProgress() {} });
          module.FS.writeFile('/spa.traineddata', data.spa);
          api = new module.TessBaseAPI();
          if (api.Init(null, 'spa', 1) !== 0) throw Error('No se pudo preparar el idioma español.');
          self.postMessage({ ready: true });
        } else {
          module.FS.writeFile('/input', new Uint8Array(data.png));
          try {
            if (api.SetImageFile(1, 0) !== 0 || api.Recognize(null) !== 0) throw Error('No se pudo reconocer esta imagen.');
            self.postMessage({ text: api.GetUTF8Text().trim() });
          } finally { api.Clear(); module.FS.unlink('/input'); }
        }
      } catch (err) { self.postMessage({ error: err.message || 'Fallo del motor OCR.' }); }
    };
  }
  async function open(signal) {
    check(signal);
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') throw Error('El OCR requiere Workers y WebAssembly.');
    const pack = await waitFor(assets(), signal); check(signal);
    const url = URL.createObjectURL(new Blob([pack.glue, '\n;(', workerMain.toString(), ')();'], { type: 'text/javascript' }));
    let worker, pending, closed = false;
    function close(error = aborted()) {
      if (closed) return;
      closed = true; worker?.terminate(); URL.revokeObjectURL(url);
      signal?.removeEventListener('abort', cancel);
      if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
    }
    const cancel = () => close();
    function send(data, transfer) {
      check(signal);
      if (closed || pending) throw Error('Motor OCR no disponible.');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => close(Error('El OCR tardó demasiado. Prueba con un recorte más pequeño.')), 90000);
        pending = { resolve, reject, timer }; worker.postMessage(data, transfer);
      });
    }
    try {
      worker = new Worker(url); signal?.addEventListener('abort', cancel, { once: true });
      worker.onerror = () => close(Error('No se pudo ejecutar el motor OCR local.'));
      worker.onmessage = ({ data }) => {
        if (!pending) return;
        const p = pending; pending = null; clearTimeout(p.timer);
        if (data.error) p.reject(Error(data.error)); else p.resolve(data);
      };
      const decode = s => {
        const bytes = atob(s), out = new Uint8Array(bytes.length);
        for (let i = 0; i < out.length; i++) out[i] = bytes.charCodeAt(i);
        return out;
      };
      const wasm = decode(pack.wasm), spa = decode(pack.spa);
      await send({ wasm, spa }, [wasm.buffer, spa.buffer]);
      return { close, async read(canvas) {
        check(signal);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('No se pudo leer el lienzo.')), 'image/png'));
        const png = await blob.arrayBuffer(); return (await send({ png }, [png])).text;
      } };
    } catch (error) { close(); throw error; }
  }
  function canvasFor(dim) {
    const c = document.createElement('canvas'); c.width = dim.width; c.height = dim.height; return c;
  }
  async function pdfCanvas(page, signal) {
    check(signal);
    const base = page.getViewport({ scale: 1 }), dim = size(base.width, base.height, 2.5);
    const canvas = canvasFor(dim);
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: dim.scale }), background: '#ffffff' });
    const cancel = () => task.cancel(); signal?.addEventListener('abort', cancel, { once: true });
    try { await task.promise; check(signal); return canvas; }
    catch (error) { canvas.width = canvas.height = 0; throw error; }
    finally { signal?.removeEventListener('abort', cancel); }
  }
  async function imageCanvas(file, signal) {
    check(signal);
    const url = URL.createObjectURL(file), img = new Image();
    try {
      img.src = url; await waitFor(img.decode(), signal); check(signal);
      const c = canvasFor(size(img.naturalWidth, img.naturalHeight));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally { img.removeAttribute('src'); URL.revokeObjectURL(url); }
  }
  const api = { size, open, pdfCanvas, imageCanvas };
  root.NCOCR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
