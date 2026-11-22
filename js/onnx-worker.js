/* Inferencia de embeddings aislada en un worker. Nunca accede a modelos remotos. */
'use strict';
const MODEL_CACHE = 'neural-spider-model-v1';
let pipelineInstance = null;
let queue = Promise.resolve();

async function initialize(id) {
  const { pipeline, env } = await import('../vendor/transformers/transformers.min.js');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = new URL('../models/', self.location.href).href;
  env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers/', self.location.href).href;
  // Sin aislamiento especial ni hilos externos: también funciona en instalaciones estáticas.
  env.backends.onnx.wasm.numThreads = 1;
  env.useBrowserCache = false;
  if (typeof caches !== 'undefined') {
    env.useCustomCache = true;
    env.customCache = await caches.open(MODEL_CACHE);
  }
  pipelineInstance = await pipeline('feature-extraction', 'minilm', {
    quantized: true,
    local_files_only: true,
    progress_callback: info => self.postMessage({ id, progress: { status: info.status, file: info.file, progress: info.progress } })
  });
  // El modelo original está recomendado para oraciones y párrafos cortos.
  // El pipeline trunca a este límite, evitando tensores enormes en archivos largos.
  pipelineInstance.tokenizer.model_max_length = 256;
  return { dimensions: 384 };
}

async function embed(texts) {
  if (!pipelineInstance) throw new Error('El modelo local no está activo.');
  if (!Array.isArray(texts) || !texts.length) return [];
  const output = await pipelineInstance(texts, { pooling: 'mean', normalize: true });
  const dimensions = output.dims[output.dims.length - 1];
  if (!dimensions || output.data.length !== texts.length * dimensions) throw new Error('Dimensiones de embeddings inesperadas.');
  return texts.map((_, i) => new Float32Array(output.data.slice(i * dimensions, (i + 1) * dimensions)));
}

self.onmessage = event => {
  const { id, type, texts } = event.data || {};
  queue = queue.then(async () => {
    const result = type === 'init' ? await initialize(id) : type === 'embed' ? await embed(texts) : null;
    if (result == null) throw new Error('Operación de modelo desconocida.');
    const transfer = Array.isArray(result) ? result.map(vector => vector.buffer) : [];
    self.postMessage({ id, result }, transfer);
  }).catch(error => self.postMessage({ id, error: error?.message || String(error) }));
};
