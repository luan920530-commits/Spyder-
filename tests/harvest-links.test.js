const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/harvest-links');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, until, wait } = require('./support/dom.cjs');

const sentence = (id, sourceText, text = sourceText) => ({ id, sourceText, text });
const pairIds = edges => Array.from(edges, e => [e.sourceSentenceId, e.targetSentenceId].sort().join(':')).sort();
function documentOf(id, texts) {
  return { id, name: `${id}.txt`, pages: texts.map((text, i) => ({ pageNum: i + 1, sourcePage: i + 11,
    text, sentences: [{ id: `${id}-${i}`, text }] })) };
}
function harvest(S, id, cluster = 'AGT-01') {
  const s = S.getSentence(id);
  return S.addPattern({ cluster, label: H.label(s.sourceText), text: s.text, pageNum: s.pageNum, sentenceId: id });
}

test('las afinidades usan las oraciones citadas, exigen evidencia léxica y conservan sus dos anclas', () => {
  const texts = [
    sentence('a', 'Las neuronas transmiten impulsos eléctricos mediante sinapsis.'),
    sentence('b', 'Las neuronas reciben impulsos eléctricos de otras células.'),
    sentence('c', 'Los volcanes liberan lava caliente en la montaña.', 'Las neuronas reciben impulsos eléctricos de otras células.'),
    sentence('d', 'Las neuronas crecen durante el desarrollo temprano.'),
    sentence('empty', '', 'Las neuronas reciben impulsos eléctricos.'),
    sentence('numbers', '2025 2026 y 2030')
  ];
  const byId = new Map(texts.map(s => [s.id, s])), model = H.create(id => byId.get(id));
  model.add({ id: 'node-a', sentenceIds: ['a'] });
  assert.equal(model.suggest('b')[0].nodeId, 'node-a');
  assert.deepEqual(model.suggest('b')[0].shared, ['neuronas', 'impulsos', 'electricos']);
  assert.equal(model.suggest('c').length, 0, 'una vecina solapada no es evidencia del ancla');
  assert.equal(model.suggest('d').length, 0, 'una sola palabra no basta');
  assert.equal(model.suggest('empty').length, 0, 'un ancla vacía no hereda el texto de su ventana');
  assert.equal(model.suggest('numbers').length, 0, 'los números aislados no construyen una afinidad');
  model.add({ id: 'node-b', sentenceIds: ['b'] });
  model.add({ id: 'node-c', sentenceIds: ['c'] });
  model.add({ id: 'node-same-source', sentenceIds: ['a'] });
  assert.deepEqual(pairIds(model.edges()), ['a:b', 'a:b'], 'dos nodos distintos pueden citar la misma frase, nunca se enlaza una cita consigo misma');
  assert.ok(model.edges().every(e => e.sourceSentenceId !== e.targetSentenceId && e.kind === 'affinity'));
  assert.equal(H.label('El sistema de neuronas transmite impulsos eléctricos.'), 'neuronas transmite impulsos');
  assert.equal(H.label('el de y'), 'el de y');
});

test('la búsqueda y las conexiones por nueva cosecha están acotadas y no dependen del rol', () => {
  const sources = new Map(), model = H.create(id => sources.get(id));
  for (let i = 0; i < 600; i++) {
    const id = `s${String(i).padStart(4, '0')}`;
    sources.set(id, sentence(id, 'Las neuronas transmiten impulsos eléctricos mediante sinapsis químicas.'));
    const added = model.add({ id: `n${i}`, cluster: `AGT-0${i % 4 + 1}`, sentenceIds: [id] });
    assert.ok(added.length <= H.MAX_LINKS);
  }
  assert.ok(model.edges().length <= 600 * H.MAX_LINKS);
  assert.equal(new Set(model.edges().map(e => e.key)).size, model.edges().length);
  const newest = sentence('new', 'Las neuronas reciben impulsos eléctricos en sus sinapsis.'); sources.set('new', newest);
  assert.equal(model.suggest('new').length, H.MAX_LINKS);
  assert.ok(model.suggest('new').every(m => m.shared.length >= 2 && m.score >= H.MIN_SCORE));
  const before = model.edges().length; model.add({ id: 'n0', sentenceIds: ['s0000'] });
  assert.equal(model.edges().length, before, 'reprocesar un nodo no duplica conexiones');
  const many = Array.from({ length: 40 }, (_, i) => `missing-${i}`);
  model.add({ id: 'without-sources', sentenceIds: many });
  assert.equal(model.connections('without-sources').length, 0);
});

test('cosechas nuevas y respaldos antiguos: fuentes, votos negativos, borrado y restauración', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true); t.after(() => dom.window.close());
  const S = w.NeuralStore; S.setSetting('autoHarvest', false);
  const a = documentOf('biologia', ['Las neuronas transmiten impulsos eléctricos mediante sinapsis.',
    'Las neuronas reciben impulsos eléctricos de otras células.']);
  const b = documentOf('otro', ['Los volcanes liberan lava caliente en la montaña.',
    'Las neuronas propagan impulsos eléctricos entre células.']);
  S.addDocument(a); S.addDocument(b);
  const first = harvest(S, 'biologia-0', 'AGT-01');
  const second = harvest(S, 'biologia-1', 'AGT-03');
  const third = harvest(S, 'otro-0', 'AGT-02');
  const fourth = harvest(S, 'otro-1', 'AGT-04');
  assert.notEqual(first.id, second.id);
  assert.ok(pairIds(S.harvestEdges()).includes('biologia-0:biologia-1'));
  assert.ok(pairIds(S.harvestEdges()).includes('biologia-0:otro-1'), 'hay afinidades entre documentos y roles');
  assert.equal(S.harvestConnections(third.id).length, 0, 'no se conecta el texto ajeno');
  assert.equal(S.state.links.filter(l => l.kind === 'affinity').length, 0, 'las hipótesis son derivadas, no enlaces guardados');
  assert.ok(S.rateRelation('biologia-0', 'biologia-1', false));
  assert.ok(!pairIds(S.harvestEdges()).includes('biologia-0:biologia-1'));
  assert.ok(!Array.from(S.harvestCandidates('biologia-1')).some(m => m.sentenceId === 'biologia-0'));
  const backup = await S.exportBrain();
  assert.ok(!backup.data.links.some(l => l.kind === 'affinity'));
  await S.init();
  assert.ok(!pairIds(S.harvestEdges()).includes('biologia-0:biologia-1'), 'el voto negativo persiste');
  assert.ok(S.rateRelation('biologia-0', 'biologia-1', true));
  assert.ok(pairIds(S.harvestEdges()).includes('biologia-0:biologia-1'));
  await S.importBrain(backup);
  assert.ok(!pairIds(S.harvestEdges()).includes('biologia-0:biologia-1'));
  assert.ok(S.clearRelations('biologia'));
  assert.ok(pairIds(S.harvestEdges()).includes('biologia-0:biologia-1'));
  S.removeDocument('otro');
  assert.ok(S.harvestEdges().every(e => ![e.sourceSentenceId, e.targetSentenceId].some(id => id.startsWith('otro-'))));
  S.addDocument(b);
  assert.ok(!pairIds(S.harvestEdges()).some(p => p.includes('otro-1')), 'reutilizar IDs no rescata nodos eliminados');
  await S.importBrain(backup);
  S.removeNode(first.id);
  assert.ok(S.harvestEdges().every(e => e.source !== first.id && e.target !== first.id));
  // Un respaldo antiguo con nodos y citas, pero sin afinidades serializadas.
  await S.importBrain({ data: { docs: [a], nodes: [
    { id: 'legacy-a', label: 'Primero', cluster: 'AGT-01', sentenceIds: ['biologia-0'] },
    { id: 'legacy-b', label: 'Segundo', cluster: 'AGT-02', sentenceIds: ['biologia-1'] }
  ], links: [], patterns: [] } });
  assert.deepEqual(pairIds(S.harvestEdges()), ['biologia-0:biologia-1']);
  assert.deepEqual(errors, []);
});

test('reconstrucción por lotes admite entregas y cancela el trabajo anterior al borrar el documento', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory()); t.after(() => dom.window.close());
  const S = w.NeuralStore; S.setSetting('autoHarvest', false);
  if (!w.SpiderEngine.getStatus().paused) w.document.getElementById('btn-toggle-spiders').click();
  const texts = Array.from({ length: 350 }, (_, i) => `Las neuronas transmiten impulsos eléctricos en sinapsis, ejemplo ${i}.`);
  const doc = documentOf('grande', texts);
  const nodes = texts.slice(0, -1).map((text, i) => ({ id: `node-${i}`, label: `Concepto ${i}`, text,
    cluster: 'AGT-01', sentenceIds: [`grande-${i}`] }));
  await S.importBrain({ data: { docs: [doc], nodes, links: [], patterns: [], settings: { autoHarvest: false } } });
  assert.equal(S.harvestInfo().indexing, true, 'el corpus no se procesa todo en un único turno');
  const added = harvest(S, 'grande-349');
  assert.ok(S.harvestConnections(added.id).length > 0, 'se puede entregar durante la reconstrucción');
  await until(() => !S.harvestInfo().indexing, 10000);
  assert.equal(S.harvestInfo().indexed, 350);
  assert.ok(S.harvestEdges().length <= 350 * H.MAX_LINKS);
  // También cancelar mientras hay una reconstrucción antigua aún pendiente.
  S.addDocument(documentOf('temporal', ['Texto independiente de prueba.']));
  assert.equal(S.harvestInfo().indexing, true);
  S.removeDocument('grande');
  await wait(100);
  assert.equal(S.harvestEdges().length, 0);
  assert.equal(S.harvestInfo().indexing, false);
  assert.deepEqual(errors, []);
});

test('borrar un documento poda las citas de un nodo histórico mixto y reconstruye sus afinidades restantes', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true); t.after(() => dom.window.close());
  const S = w.NeuralStore; S.setSetting('autoHarvest', false);
  if (!w.SpiderEngine.getStatus().paused) w.document.getElementById('btn-toggle-spiders').click();
  const old = documentOf('descartado', [
    'Las neuronas transmiten impulsos eléctricos mediante sinapsis.',
    'Las neuronas reciben impulsos eléctricos de otras células.'
  ]);
  const kept = documentOf('conservado', [
    'Una variable almacena un valor para el programa.',
    'El programa modifica el valor de una variable.'
  ]);
  await S.importBrain({ data: { docs: [old, kept], nodes: [
    { id: 'mixto', label: 'Concepto histórico', cluster: 'AGT-01', sentenceIds: ['descartado-0', 'conservado-0'] },
    { id: 'borrado', label: 'Impulsos', cluster: 'AGT-02', sentenceIds: ['descartado-1'] },
    { id: 'estable', label: 'Variable', cluster: 'AGT-03', sentenceIds: ['conservado-1'] }
  ], links: [], patterns: [], settings: { autoHarvest: false } } });
  assert.deepEqual(pairIds(S.harvestEdges()), ['conservado-0:conservado-1', 'descartado-0:descartado-1']);
  S.removeDocument('descartado');
  const mixed = S.state.nodes.find(node => node.id === 'mixto');
  assert.deepEqual(Array.from(mixed.sentenceIds), ['conservado-0']);
  assert.equal(S.state.nodes.some(node => node.id === 'borrado'), false);
  assert.deepEqual(pairIds(S.harvestEdges()), ['conservado-0:conservado-1']);
  assert.equal(S.harvestConnections('mixto')[0].targetSentenceId, 'conservado-0');
  S.addDocument(old);
  assert.deepEqual(pairIds(S.harvestEdges()), ['conservado-0:conservado-1'], 'reutilizar el ID no revive la cita podada');
  await S.savePersistent(); await S.init();
  assert.deepEqual(pairIds(S.harvestEdges()), ['conservado-0:conservado-1']);
  assert.deepEqual(errors, []);
});

test('si se agregan anclas a un nodo existente, se reconstruye el índice de sus citas actuales', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory()); t.after(() => dom.window.close());
  const S = w.NeuralStore; S.setSetting('autoHarvest', false);
  if (!w.SpiderEngine.getStatus().paused) w.document.getElementById('btn-toggle-spiders').click();
  const doc = documentOf('citas', [
    'Las neuronas transmiten impulsos eléctricos mediante sinapsis.',
    'Una variable almacena un valor para el programa.',
    'El programa modifica el valor de una variable.'
  ]);
  S.addDocument(doc);
  const first = S.addPattern({ cluster: 'AGT-01', label: 'Etiqueta', text: S.getSentence('citas-0').text,
    pageNum: 1, sentenceId: 'citas-0' });
  // Simula la modificación in situ de un nodo histórico que el índice de
  // patrones ya había visto. La nueva ancla se incorpora al volver a cosechar.
  first.sentenceIds.splice(0, 1, 'citas-1');
  const reused = S.addPattern({ cluster: 'AGT-01', label: 'Etiqueta', text: S.getSentence('citas-0').text,
    pageNum: 1, sentenceId: 'citas-0' });
  assert.equal(reused.id, first.id);
  assert.deepEqual(Array.from(first.sentenceIds), ['citas-1', 'citas-0']);
  const match = S.harvestCandidates('citas-2').find(candidate => candidate.nodeId === first.id);
  assert.equal(match.sentenceId, 'citas-1');
  const related = harvest(S, 'citas-2');
  assert.deepEqual(pairIds(S.harvestConnections(related.id)), ['citas-1:citas-2']);
  assert.deepEqual(errors, []);
});
