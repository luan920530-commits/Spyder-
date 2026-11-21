#!/usr/bin/env node
/**
 * NEURAL COMMAND // AI SPIDER OS
 * tests/bench-bm25.js — Benchmark sin dependencias del motor de recuperación.
 *
 * Compara la implementación ACTUAL (js/brain-rag.js, bm25Search) con la
 * PROPUESTA (índice invertido + normalización + stems) sobre corpus sintéticos.
 *
 * Uso:  node tests/bench-bm25.js [maxOraciones]
 */

// ─────────────────────────────────────────────────────────────────────────────
// Copia fiel de js/brain-rag.js (tokenize / expandQueryTerms / bm25Search)
// ─────────────────────────────────────────────────────────────────────────────
function tokenizeActual(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

const SEMANTIC_SYNONYMS = {
  latencia: ['tiempo', 'respuesta', 'milisegundos', 'ms', 'velocidad'],
  tiempo: ['latencia', 'milisegundos', 'ms'],
  red: ['neuronal', 'grafo', 'nodos', 'sinapsis'],
  error: ['fallo', 'fallos', 'bizantinos', 'tolerancia'],
  fallo: ['error', 'tolerancia', 'consenso'],
  resumen: ['síntesis', 'conclusión', 'tesis']
};

function expandQueryTerms(terms) {
  const expanded = new Set(terms);
  terms.forEach(t => { if (SEMANTIC_SYNONYMS[t]) SEMANTIC_SYNONYMS[t].forEach(s => expanded.add(s)); });
  return Array.from(expanded);
}

function bm25Actual(query, sentences, topK = 4) {
  const qTerms = expandQueryTerms(tokenizeActual(query));
  if (!qTerms.length || !sentences.length) return [];
  const avgLen = sentences.reduce((a, s) => a + s.text.length, 0) / sentences.length || 1;
  const k1 = 1.5, b = 0.75;
  const scored = sentences.map(s => {
    const sTerms = tokenizeActual(s.text);
    let score = 0;
    qTerms.forEach(qt => {
      const tf = sTerms.filter(t => t === qt).length;
      if (tf > 0) {
        // ↓ aquí está el O(N²·Q): df se recalcula sobre TODO el corpus
        const df = sentences.filter(x => x.text.toLowerCase().includes(qt)).length || 1;
        const idf = Math.log((sentences.length - df + 0.5) / (df + 0.5) + 1);
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (s.text.length / avgLen))));
      }
    });
    return { sentence: s, score };
  });
  return scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
}

// ─────────────────────────────────────────────────────────────────────────────
// Propuesta: normalización + stem + índice invertido (js/retrieval.js)
// ─────────────────────────────────────────────────────────────────────────────
const STOPWORDS = new Set(('el la los las un una unos unas de del al y o en con por para que se su sus ' +
  'como es son fue era sobre entre hasta desde hacia mediante durante mas pero sin no si este esta ' +
  'estos estas ese esa donde cuando cual cuales tambien puede pueden tiene tienen cada todo toda ' +
  'todos todas').split(' '));

const normalize = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function stem(w) {
  const t = normalize(w).replace(/[^a-z0-9]/g, '');
  if (t.length <= 4) return t;
  return t
    .replace(/(aciones|iciones|amiento|imiento|idades|adores)$/, '')
    .replace(/(acion|icion|mente|ador|ante|encia|ancia|able|ible|idad|ismo|ista)$/, '')
    .replace(/(ando|iendo|aron|ieron|aban|adas|idos|es|os|as|a|o|e)$/, '');
}

function tokenizeNuevo(text) {
  return normalize(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w)).map(stem);
}

function buildIndex(sentences) {
  const df = new Map(), postings = new Map(), lens = new Float64Array(sentences.length);
  sentences.forEach((s, i) => {
    const toks = tokenizeNuevo(s.text);
    lens[i] = toks.length;
    const seen = new Set();
    for (const t of toks) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = new Map()));
      p.set(i, (p.get(i) || 0) + 1);
      if (!seen.has(t)) { seen.add(t); df.set(t, (df.get(t) || 0) + 1); }
    }
  });
  const avgdl = lens.reduce((a, b) => a + b, 0) / (sentences.length || 1);
  return { sentences, df, postings, lens, avgdl, N: sentences.length };
}

function searchIndex(index, query, topK = 4) {
  const { df, postings, lens, avgdl, N } = index;
  const k1 = 1.5, b = 0.75, scores = new Map();
  for (const t of tokenizeNuevo(query)) {
    const p = postings.get(t);
    if (!p) continue;
    const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
    for (const [i, tf] of p) {
      const denom = tf + k1 * (1 - b + b * lens[i] / avgdl);
      scores.set(i, (scores.get(i) || 0) + idf * (tf * (k1 + 1)) / denom);
    }
  }
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, topK)
    .map(([i, score]) => ({ sentence: index.sentences[i], score }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpus sintético (mismo estilo que el demo de js/parsers.js)
// ─────────────────────────────────────────────────────────────────────────────
const BASE = [
  'La red neuronal artificial es un modelo computacional que minimiza la función de pérdida en 94.2% de los casos tras 50 épocas de entrenamiento supervisado.',
  'El protocolo de consenso Raft garantiza la tolerancia a fallos bizantinos y elige un nuevo líder en menos de 150 milisegundos cuando un nodo falla.',
  'La arquitectura del sistema define sinapsis y grafos semánticos persistentes que permiten indexar conocimiento universitario sin servidores en la nube.',
  'En resumen, el procesamiento offline-first reduce la latencia de consulta a 12 ms y protege la privacidad académica al 100%.'
];

function makeCorpus(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 's' + i,
    pageNum: 1 + Math.floor(i / 8),
    text: BASE[i % BASE.length] + ' Variante ' + i + '.'
  }));
}

function time(fn, reps = 1) {
  const t = process.hrtime.bigint();
  for (let r = 0; r < reps; r++) fn();
  return Number(process.hrtime.bigint() - t) / 1e6 / reps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ejecución
// ─────────────────────────────────────────────────────────────────────────────
const QUERY = '¿cuál es la latencia del protocolo de consenso distribuido?';
const sizes = (process.argv[2] ? [Number(process.argv[2])] : [200, 1000, 3000, 8000, 15000]);

console.log('\nNEURAL COMMAND // benchmark del motor de recuperación');
console.log('query: "' + QUERY + '"\n');
console.log('oraciones │  actual (BM25 O(N²)) │  propuesto (índice) │ speedup │ resultados');
console.log('──────────┼──────────────────────┼─────────────────────┼─────────┼───────────');

const results = [];
for (const n of sizes) {
  const corpus = makeCorpus(n);
  const tActual = time(() => bm25Actual(QUERY, corpus, 4));
  const index = buildIndex(corpus);                       // coste de indexación (una vez)
  const tIndex = time(() => searchIndex(index, QUERY, 4));
  const speedup = tActual / Math.max(tIndex, 0.001);
  const hits = searchIndex(index, QUERY, 4).length;
  results.push({ n, tActual, tIndex, speedup });
  console.log(
    String(n).padStart(9) + ' │' +
    (tActual.toFixed(1) + ' ms').padStart(21) + ' │' +
    (tIndex.toFixed(2) + ' ms').padStart(20) + ' │' +
    (speedup.toFixed(0) + '×').padStart(8) + ' │' +
    String(hits).padStart(10)
  );
}

// Sensibilidad a acentos / morfología (donde el motor actual devuelve 0)
const corpusAcc = makeCorpus(50);
const indexAcc = buildIndex(corpusAcc);
const casos = ['definicion de sinapsis', 'definición de sinapsis', 'redes neuronales', 'epocas de entrenamiento'];
console.log('\nsensibilidad lingüística (50 oraciones):');
console.log('consulta                        │ actual │ propuesto');
console.log('────────────────────────────────┼────────┼───────────');
for (const q of casos) {
  console.log(q.padEnd(32) + '│' + String(bm25Actual(q, corpusAcc, 4).length).padStart(7) + ' │' +
    String(searchIndex(indexAcc, q, 4).length).padStart(10));
}

const last = results[results.length - 1];
console.log(`\nConclusión: a ${last.n} oraciones la consulta actual bloquea ${last.tActual.toFixed(0)} ms; ` +
  `el índice propuesto tarda ${last.tIndex.toFixed(2)} ms (${last.speedup.toFixed(0)}× más rápido).`);
console.log('Nota: el motor actual es además insensible a paráfrasis; la capa densa (fase 2) cubre eso.\n');
