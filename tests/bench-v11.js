#!/usr/bin/env node
// Benchmark de la ruta real híbrida. Las latencias dependen del equipo y del corpus.
const U = require('../js/util');
const R = require('../js/retrieval');
const E = require('../js/embeddings');
const size = Number(process.argv[2] || 20000);
const texts = [
  'La red neuronal artificial aplica pesos sinápticos y aprende con descenso de gradiente.',
  'El protocolo de consenso Raft elige un líder cuando falla un nodo del registro replicado.',
  'Un índice invertido recupera documentos locales y mejora la latencia de búsqueda.',
  'La fotosíntesis convierte la luz solar en energía química y libera oxígeno.',
  'La repetición espaciada organiza tarjetas y repasos para reforzar la memoria.',
  'La entropía aumenta durante procesos irreversibles en un sistema aislado.',
  'La inflación describe el aumento sostenido del nivel general de precios.',
  'La mitocondria produce ATP durante la respiración celular.'
];
const sentences = Array.from({ length: size }, (_, i) => ({
  id: 's' + i, docId: 'd' + Math.floor(i / 100), docName: 'documento-' + Math.floor(i / 100),
  pageNum: 1 + (i % 10), text: texts[i % texts.length] + ' Registro ' + i + '.'
}));
const start = performance.now();
const index = R.rebuildFrom(sentences);
E.indexAll(index);
const buildMs = performance.now() - start;
const queries = [
  'red neuronal gradiente', 'protocolo consenso Raft', 'indice invertido latencia',
  'fotosintesis energia solar', 'repeticion espaciada tarjetas', 'entropia proceso aislado',
  'inflacion precios', 'mitocondria respiracion celular'
];
const durations = [];
for (let i = 0; i < 80; i++) {
  const q = queries[i % queries.length], parsed = R.parseQuery(q);
  index.queryVectorCache = { [q]: E.embedOne(parsed.cleaned) };
  const t = performance.now();
  R.search(index, q, { k: 5, queryConcepts: E.concepts(parsed.cleaned) });
  if (i >= 8) durations.push(performance.now() - t);
}
console.log(JSON.stringify({
  sentences: size, indexAndVectorsMs: Math.round(buildMs), vectors: index.vectors.size,
  samples: durations.length, p50Ms: +U.percentile(durations, 50).toFixed(2),
  p95Ms: +U.percentile(durations, 95).toFixed(2), note: 'Corpus sintético repetitivo; mida su propio corpus y dispositivo.'
}, null, 2));
