/* Runtime GGUF aislado: el worker interno de wllama ejecuta llama.cpp/WASM. */
'use strict';
importScripts('./qwen-config.js');
const CFG = self.NCQwenConfig;
const BASE = new URL('../', self.location.href);
let llama = null, generating = null;
const aborted = () => new DOMException('Generación cancelada', 'AbortError');

async function initialize() {
  if (llama) throw new Error('Qwen ya está inicializado.');
  const response = await (await caches.open(CFG.cache)).match(new URL(CFG.modelPath, BASE).href);
  if (!response) throw new Error('No se encontró el modelo guardado.');
  const model = await response.blob();
  if (model.size !== CFG.bytes) throw new Error('El modelo local está incompleto.');
  const { Wllama } = await import('../vendor/wllama/wllama.mjs');
  const logger = {
    debug() {}, log() {}, warn() {},
    error(event) {
      if (event && (event.type === 'error' || event.name === 'Error')) {
        self.postMessage({ fatal: event.message || 'El motor WASM se detuvo.' });
      }
    }
  };
  llama = new Wllama({ 'single-thread/wllama.wasm': new URL('../vendor/wllama/wllama.wasm', self.location.href).href },
    { suppressNativeLog: true, logger });
  // CPU de un solo hilo para no exigir cabeceras COOP/COEP ni WebGPU.
  await llama.loadModel([model], { n_ctx: CFG.context, n_batch: 64, n_threads: 1 });
  return { context: CFG.context };
}

async function generate(id, prompt) {
  if (!llama) throw new Error('Qwen no está activo.');
  if (generating) throw new Error('Ya hay una generación en curso.');
  const current = new AbortController(); generating = { id, controller:current };
  try {
    const tokens = await llama.tokenize(String(prompt || ''), true);
    if (current.signal.aborted) throw aborted();
    if (tokens.length + CFG.predict + 8 > CFG.context) {
      throw new Error('La conversación excede el contexto disponible. Prueba una pregunta más corta o borra el chat.');
    }
    let last = 0;
    const result = await llama.createCompletion(prompt, {
      nPredict: CFG.predict,
      abortSignal: current.signal,
      sampling: { temp: 0.7, top_p: 0.8, top_k: 20, penalty_repeat: 1.05 },
      onNewToken(_token, _piece, text) {
        if (!current.signal.aborted && Date.now() - last > 100) {
          last = Date.now(); self.postMessage({ id, progress: { text } });
        }
      }
    });
    if (current.signal.aborted) throw aborted();
    return result;
  } finally { if (generating?.controller === current) generating = null; }
}

self.onmessage = event => {
  const { id, type, prompt } = event.data || {};
  if (type === 'cancel') { if (generating && generating.id === id) generating.controller.abort(); return; }
  const operation = type === 'init' ? initialize() : type === 'generate' ? generate(id, prompt) : Promise.reject(new Error('Operación desconocida.'));
  Promise.resolve(operation).then(
    result => self.postMessage({ id, result }),
    error => self.postMessage({ id, error: error?.message || String(error), name: error?.name || 'Error' })
  );
};
