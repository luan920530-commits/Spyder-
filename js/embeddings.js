/**
 * Representación vectorial local, determinista y sin descargas.
 *
 * Es una proyección compacta de palabras, raíces y familias de sinónimos; NO es
 * un modelo neuronal preentrenado. Se reconstruye a partir de los documentos
 * guardados. Las coincidencias vectoriales se combinan con BM25 mediante RRF.
 */
(function (root, factory) {
  const U = typeof module !== 'undefined' && module.exports ? require('./util.js') : root.NCUtil;
  const api = factory(U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCEmbeddings = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';
  const DIMS = 192;
  const MODEL = 'proyeccion-local-v1';
  const MODELS = [{ id: MODEL, label: 'Proyección local de palabras y conceptos', dims: DIMS }];
  // Familias pequeñas y explícitas: no se pretende cubrir todos los sinónimos.
  const families = [
    ['latencia', 'demora', 'retardo', 'retraso', 'latency'],
    ['definicion', 'definir', 'concepto', 'significado'],
    ['resumen', 'sintesis', 'sumario'],
    ['error', 'fallo', 'falla', 'averia', 'failure'],
    ['rapidez', 'velocidad', 'rendimiento'],
    ['memoria', 'almacenamiento', 'persistencia', 'memory'],
    ['estudio', 'aprendizaje', 'aprender', 'learning'],
    ['prueba', 'evaluacion', 'examen'],
    ['documento', 'archivo', 'texto'],
    ['cerebro', 'encefalo'],
    ['neurona', 'neuronas'],
    ['ia', 'inteligencia', 'artificial'],
    ['tiempo', 'duracion'],
    ['medicion', 'medida', 'metrica'],
    ['privacidad', 'confidencialidad'],
    ['seguridad', 'proteccion'],
    ['aumento', 'incremento', 'crecimiento'],
    ['reduccion', 'disminucion'],
    ['translation', 'traduccion'],
    ['network', 'red']
  ];
  const canonical = new Map();
  families.forEach(group => {
    const key = U.stem(group[0]);
    group.forEach(w => canonical.set(U.stem(w), key));
  });

  function concepts(text) {
    return Array.from(new Set(U.tokens(text).map(t => canonical.get(t) || t)));
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function feature(vector, key, weight) {
    const h = hash(key);
    vector[h % DIMS] += (h & 0x10000 ? -1 : 1) * weight;
  }
  function normalizeVec(arr) {
    let norm = 0;
    for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
    norm = Math.sqrt(norm);
    const out = new Float32Array(arr.length);
    if (norm) for (let i = 0; i < arr.length; i++) out[i] = arr[i] / norm;
    return out;
  }
  function embedOne(text) {
    const vector = new Float32Array(DIMS);
    const terms = Array.from(new Set(U.tokens(text)));
    for (const t of terms) {
      feature(vector, 'c:' + (canonical.get(t) || t), 2.8);
      feature(vector, 'w:' + t, 1.0);
      if (t.length >= 5) {
        const padded = '^' + t + '$';
        for (let i = 0; i < padded.length - 2; i++) feature(vector, 'g:' + padded.slice(i, i + 3), 0.18);
      }
    }
    return normalizeVec(vector);
  }
  function indexAll(index) {
    if (!index) return 0;
    let added = 0;
    if (!index.concepts) index.concepts = [];
    for (let i = 0; i < index.sentences.length; i++) {
      if (index.vectors.has(i)) continue;
      index.concepts[i] = new Set(concepts(index.sentences[i].text));
      index.vectors.set(i, embedOne(index.sentences[i].text));
      added++;
    }
    return added;
  }
  async function indexCorpus(index, db, opts) {
    const o = opts || {};
    let added = 0;
    if (!index.concepts) index.concepts = [];
    for (let i = 0; i < index.sentences.length; i++) {
      if (!index.vectors.has(i)) { index.concepts[i] = new Set(concepts(index.sentences[i].text)); index.vectors.set(i, embedOne(index.sentences[i].text)); added++; }
      if (o.onProgress && (i % 250 === 0 || i === index.sentences.length - 1)) {
        o.onProgress({ done: i + 1, total: index.sentences.length });
      }
      if (i && i % 500 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return { added, dims: DIMS, model: MODEL };
  }
  async function embed(texts) { return (texts || []).map(embedOne); }
  async function embedQuery(index, query) {
    const vector = embedOne(query);
    if (!index.queryVectorCache) index.queryVectorCache = Object.create(null);
    index.queryVectorCache[query] = vector;
    return vector;
  }
  async function hydrate(index) { return indexAll(index); }
  async function clearCache() { /* vectores derivados: se reconstruyen desde los documentos */ }
  function info() { return { available: true, model: MODEL, dims: DIMS, models: MODELS, supported: true }; }
  return { MODELS, DIMS, embedOne, embed, concepts, indexAll, indexCorpus, embedQuery, hydrate, clearCache, normalizeVec, info };
});
