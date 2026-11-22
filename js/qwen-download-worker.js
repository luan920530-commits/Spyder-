/* Descarga y verifica el GGUF en streaming, sin transferir libros ni preguntas. */
'use strict';
importScripts('./qwen-config.js', '../vendor/sha256/sha256.min.js');
const CFG = self.NCQwenConfig;
const BASE = new URL('../', self.location.href);
const KEY = new URL(CFG.modelPath, BASE).href;
let controller = null;

const abortError = () => new DOMException('Cancelado', 'AbortError');
function check(signal) { if (signal.aborted) throw abortError(); }
function progress(phase, loaded) {
  self.postMessage({ progress: { phase, loaded, total: CFG.bytes } });
}
function withLock(signal, operation) {
  return navigator.locks?.request
    ? navigator.locks.request(CFG.cache, { mode: 'exclusive', signal }, operation)
    : operation();
}

async function verifyCached(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const hash = self.sha256.create(); let count = 0, last = 0;
  try {
    while (true) {
      check(signal);
      const { done, value } = await reader.read();
      check(signal);
      if (done) break;
      count += value.byteLength;
      if (count > CFG.bytes) return false;
      hash.update(value);
      if (Date.now() - last > 150) { progress('verifying', count); last = Date.now(); }
    }
    return count === CFG.bytes && hash.hex() === CFG.sha256;
  } finally {
    if (signal.aborted || count > CFG.bytes) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function prepare({ onlyCached, file }, signal) {
  return withLock(signal, async () => {
    check(signal);
    const cache = await caches.open(CFG.cache);
    const old = await cache.match(KEY);
    check(signal);
    if (old) {
      progress('verifying', 0);
      const valid = await verifyCached(old, signal);
      check(signal);
      if (valid) return { downloaded: true };
      await cache.delete(KEY);
      check(signal);
      // «Activar» una copia presente no debe disparar una descarga de 397 MB
      // inesperada. El usuario puede iniciar otra descarga o importar un archivo.
      if (!file) throw new Error('El archivo local está dañado. Descárgalo de nuevo o importa el GGUF.');
    }
    if (onlyCached) throw new Error('Qwen aún no está descargado en este navegador.');

    let stream;
    if (file) {
      if (file.size !== CFG.bytes) throw new Error('El archivo elegido no tiene el tamaño de Qwen3 Q4_K_M esperado.');
      stream = file.stream();
      progress('importing', 0);
    } else {
      let response;
      try {
        response = await fetch(CFG.url, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
      } catch (error) {
        if (signal.aborted) throw abortError();
        throw new Error('No se pudo conectar con Hugging Face. Comprueba la conexión o importa el archivo GGUF.');
      }
      if (!response.ok || !response.body) throw new Error(`No se pudo descargar el modelo (HTTP ${response.status}).`);
      stream = response.body;
      progress('downloading', 0);
    }
    const hash = self.sha256.create();
    let count = 0, last = 0, streamError = null;
    const phase = file ? 'importing' : 'downloading';
    const transform = new TransformStream({
      transform(chunk, sink) {
        try {
          check(signal);
          count += chunk.byteLength;
          if (count > CFG.bytes) throw new Error('El archivo recibido supera el tamaño esperado.');
          hash.update(chunk);
          if (Date.now() - last > 150) { progress(phase, count); last = Date.now(); }
          sink.enqueue(chunk);
        } catch (error) { streamError = error; throw error; }
      },
      flush() {
        try {
          check(signal);
          if (count !== CFG.bytes) throw new Error('La descarga está incompleta. Vuelve a intentarlo.');
          if (hash.hex() !== CFG.sha256) throw new Error('La comprobación SHA-256 falló. El archivo no se activará.');
          progress(phase, count);
        } catch (error) { streamError = error; throw error; }
      }
    });
    try {
      // Cache.put solo publica la entrada cuando termina el stream verificado.
      // No se construye un ArrayBuffer de 397 MB en la interfaz.
      const body = stream.pipeThrough(transform, { signal });
      await cache.put(KEY, new Response(body, { headers: { 'Content-Type': 'application/octet-stream' } }));
      check(signal);
    } catch (error) {
      await cache.delete(KEY).catch(() => {});
      if (signal.aborted) throw abortError();
      if (streamError) throw streamError;
      if (error?.name === 'QuotaExceededError') throw new Error('No hay espacio suficiente para guardar el modelo.');
      throw new Error(`No se pudo guardar el modelo: ${error?.message || error}`);
    }
    return { downloaded: true };
  });
}

self.onmessage = event => {
  const data = event.data || {};
  if (data.type === 'cancel') { controller?.abort(); return; }
  if (data.type !== 'prepare' || controller) return;
  const current = new AbortController(); controller = current;
  prepare(data, current.signal).then(
    result => self.postMessage({ id: data.id, result }),
    error => self.postMessage({ id: data.id, error: error?.message || String(error), name: error?.name || 'Error' })
  ).finally(() => { if (controller === current) controller = null; });
};
