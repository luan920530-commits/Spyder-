#!/usr/bin/env node
// Índice de afinidades sobre anclas sintéticas; sin DOM, modelo ONNX ni pintura.
const U = require('../js/util');
const H = require('../js/harvest-links');
const count = Number(process.argv[2] || 20000);
if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error('Indica entre 1 y 100000 cosechas.');
const examples = [
  'Una variable almacena un valor para el programa durante la ejecución.',
  'Las neuronas transmiten impulsos eléctricos mediante sinapsis químicas.',
  'La fotosíntesis transforma la luz solar en energía química para las plantas.',
  'Las tarjetas organizan el repaso espaciado para recordar conceptos.',
  'Un índice invertido busca documentos mediante sus términos normalizados.',
  'La inflación describe el aumento sostenido de precios en una economía.',
  'El casco protege la cabeza durante el trabajo en una obra.',
  'Los volcanes liberan lava caliente durante una erupción.'
];
const sources = new Map();
for (let i = 0; i < count; i++) sources.set('s' + i, { id: 's' + i, sourceText: examples[i % examples.length] + ` Registro ${i}.` });
const model = H.create(id => sources.get(id));
const timings = [], start = performance.now();
for (let i = 0; i < count; i++) {
  const began = performance.now(); model.add({ id: 'n' + i, sentenceIds: ['s' + i] });
  if (i >= Math.min(100, count / 2)) timings.push(performance.now() - began);
}
const total = performance.now() - start;
const queries = [], query = { id: 'consulta', sourceText: 'La variable modifica el valor de un programa.' }; sources.set(query.id, query);
for (let i = 0; i < 100; i++) {
  const began = performance.now(); model.suggest(query.id);
  if (i >= 10) queries.push(performance.now() - began);
}
const round = value => +value.toFixed(3);
if (model.edges().length > count * H.MAX_LINKS) throw new Error('La cota de aristas fue superada.');
console.log(JSON.stringify({
  cosechas: count, afinidades: model.edges().length, reconstruccionMs: round(total),
  adicionMs: { samples: timings.length, p50: round(U.percentile(timings, 50)), p95: round(U.percentile(timings, 95)) },
  consultaMs: { samples: queries.length, p50: round(U.percentile(queries, 50)), p95: round(U.percentile(queries, 95)) },
  nota: 'Corpus sintético repetitivo en Node; sin IndexedDB, DOM, pintura, lotes asíncronos ni MiniLM. No predice tiempos en un dispositivo físico.'
}, null, 2));
