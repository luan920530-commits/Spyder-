const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, until } = require('./support/dom.cjs');

function add(S, id, label, relatedTarget) {
  const s = S.getSentence(id);
  return S.addPattern({ cluster: 'AGT-01', label, text: s.text, pageNum: s.pageNum, sentenceId: id, relatedTarget });
}

test('la afinidad cita el extremo correcto al dividir nodos históricos por tema y sobrevive a la órbita', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true); t.after(() => dom.window.close());
  const S = w.NeuralStore, d = w.document; S.setSetting('autoHarvest', false);
  S.addDocument({ id: 'libro', name: 'temas.txt', pages: [
    { pageNum: 1, sourcePage: 11, sentences: [{ id: 'a', text: 'Las neuronas transmiten impulsos eléctricos mediante sinapsis.' }] },
    { pageNum: 2, sourcePage: 12, sentences: [{ id: 'b', text: 'Las neuronas reciben impulsos eléctricos de otras células.' }] },
    { pageNum: 3, sourcePage: 13, sentences: [{ id: 'c', text: 'Los volcanes liberan lava caliente en la montaña.' }] },
    { pageNum: 4, sourcePage: 14, sentences: [{ id: 'd', text: 'Las estrellas forman galaxias muy distantes.' }] }
  ] });
  const legacy = { id: 'legacy', cluster: 'AGT-01', label: 'Antiguo mixto', text: 'Antiguo', sentenceIds: ['a', 'c'], pageNums: [1,3] };
  S.state.nodes.push(legacy); S.emit('brain:imported');
  const b = add(S, 'b', 'Impulsos eléctricos');
  const other = add(S, 'd', 'Galaxias distantes');
  S.addLink(b.id, other.id, 'synaptic');
  const original = S.harvestConnections(b.id)[0];
  assert.equal(original.target, 'legacy'); assert.equal(original.targetSentenceId, 'a');
  const lines = () => [...d.querySelectorAll('line[data-kind="affinity"]')];
  assert.equal(lines().length, 1);
  const circle = [...d.querySelectorAll('g.node-group')].find(n => n.__data__.id === b.id);
  circle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.match(d.getElementById('insp-connection-list').textContent, /Afinidad.*neuronas.*impulsos.*electricos/s);
  assert.match(d.getElementById('insp-connection-list').textContent, /temas\.txt · pág\. 11/);
  assert.match(d.getElementById('insp-connection-list').textContent, /temas\.txt · pág\. 12/);
  assert.match(d.getElementById('insp-connections').textContent, /contradictorias/);
  let sources = d.querySelectorAll('#insp-connection-list .affinity-connection .source-link');
  assert.match(sources[0].textContent, /^Esta cita:/); assert.match(sources[0].title, /neuronas reciben/);
  assert.match(sources[1].textContent, /^Cita vecina:/); assert.match(sources[1].title, /neuronas transmiten/);
  // Al entrar desde el otro extremo, «esta» sigue siendo la cita inspeccionada.
  d.querySelector('#insp-connection-list .affinity-connection .citation-chip').click();
  sources = d.querySelectorAll('#insp-connection-list .affinity-connection .source-link');
  assert.match(sources[0].title, /neuronas transmiten/); assert.match(sources[1].title, /neuronas reciben/);
  d.querySelector('#insp-connection-list .affinity-connection .citation-chip').click();

  // Vectores simulados: la vista por temas nunca debe reemplazar el enlace
  // léxico por la pertenencia a un centroide ni asignarlo al ancla volcánica.
  w.NCSemantic.info = () => ({ active: true, indexed: 4, total: 4, modelEnabled: true });
  w.NCSemantic.topics = () => [
    { id: 'SEM-1', number: 1, label: 'Tema uno', color: '#38dcff' },
    { id: 'SEM-2', number: 2, label: 'Tema dos', color: '#a78bfa' }
  ];
  w.NCSemantic.topicId = id => id === 'a' ? 'SEM-1' : 'SEM-2';
  w.NCSemantic.preferenceWeights = () => new w.Map();
  S.emit('semantic:updated');
  assert.equal(lines().length, 1);
  const edge = lines()[0].__data__;
  assert.equal(edge.source.id, b.id); assert.equal(edge.target.id, 'legacy::SEM-1');
  assert.deepEqual(Array.from(edge.target.sentenceIds), ['a']);
  assert.ok([...d.querySelectorAll('line[data-kind="synaptic"]')].some(n => n.__data__.source.id === b.id && n.__data__.target.id === other.id),
    'una relación guardada sin división ambigua también se conserva');
  d.getElementById('btn-orbit').click();
  assert.equal(d.getElementById('btn-orbit').getAttribute('aria-pressed'), 'true');
  assert.equal(lines()[0].__data__.target.id, 'legacy::SEM-1');
  await until(() => d.querySelector(`g.node-group[aria-label^="Inspeccionar"]`).getAttribute('transform').includes('scale('));
  const details = d.getElementById('insp-connections'), focused = d.querySelector('#insp-connection-list .source-link');
  details.open = true; focused.focus();
  S.emit('node:added', { node: b, isNew: false });
  assert.equal(d.activeElement.dataset.connectionFocus, focused.dataset.connectionFocus, 'un refresco conserva el foco en la fuente');
  assert.ok(S.rateRelation('a', 'b', false));
  assert.equal(lines().length, 0);
  assert.equal(d.activeElement, details.querySelector('summary'), 'si se retira la afinidad el foco vuelve al resumen');
  assert.doesNotMatch(d.getElementById('insp-connection-list').textContent, /Palabras afines/,
    'el inspector abierto se actualiza al retirar el vínculo');
  assert.ok(S.clearRelations('libro')); assert.equal(lines().length, 1);
  assert.deepEqual(errors, []);
});

test('un vecino fuera de página se hace visible para la entrega sin interrumpir búsqueda ni paginación', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true); t.after(() => dom.window.close());
  const S = w.NeuralStore, d = w.document; S.setSetting('autoHarvest', false);
  const rows = Array.from({ length: 44 }, (_, i) => {
    const letters = String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + i % 26);
    return { id: `f${i}`, text: `termino${letters} materia${letters}` };
  });
  rows.push({ id: 'target', text: 'Las neuronas transmiten impulsos eléctricos mediante sinapsis.' });
  rows.push({ id: 'incoming', text: 'Las neuronas reciben impulsos eléctricos de otras células.' });
  S.addDocument({ id: 'pages', name: 'pages.txt', pages: rows.map((s, i) => ({ pageNum: i + 1, text: s.text, sentences: [s] })) });
  rows.slice(0, 45).forEach((s, i) => add(S, s.id, `Etiqueta ${i}`));
  assert.equal(d.getElementById('graph-page').textContent, '1–40 / 45');
  const matching = S.harvestCandidates('incoming'); assert.equal(matching.length, 1);
  const target = w.NeuralGraph.beginDelivery('reader', 'incoming');
  assert.equal(target.nodeId, matching[0].nodeId);
  assert.ok(w.NeuralGraph.getDeliveryScreenPos('reader'));
  assert.match(d.getElementById('harvest-affinity-status').textContent, /1 fuera de página/);
  const incoming = add(S, 'incoming', 'Nuevo impulso', target);
  w.NeuralGraph.endDelivery('reader');
  assert.equal(d.getElementById('graph-page').textContent, '1–40 / 46');
  assert.match(d.getElementById('harvest-affinity-status').textContent, /2 fuera de página/);
  const links = [...d.querySelectorAll('line[data-kind="affinity"]')];
  assert.ok(links.some(n => [n.__data__.source.id, n.__data__.target.id].includes(incoming.id)));
  const search = d.getElementById('graph-search'); search.value = 'sin coincidencias'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await until(() => d.getElementById('graph-page').textContent === '0–0 / 0');
  assert.equal(w.NeuralGraph.beginDelivery('filtered', 'incoming'), null, 'una búsqueda explícita no se altera');
  assert.doesNotMatch(d.getElementById('harvest-affinity-status').textContent, /fuera de página/);
  assert.deepEqual(errors, []);
});

test('un voto negativo durante el trayecto invalida el destino y no añade el vínculo rechazado', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true); t.after(() => dom.window.close());
  const S = w.NeuralStore; S.setSetting('autoHarvest', false);
  S.addDocument({ id: 'votos', name: 'votos.txt', pages: [
    { sentences: [{ id: 'va', text: 'Las neuronas transmiten impulsos eléctricos mediante sinapsis.' }] },
    { sentences: [{ id: 'vb', text: 'Las neuronas reciben impulsos eléctricos de otras células.' }] }
  ] });
  const existing = add(S, 'va', 'Impulsos');
  const target = w.NeuralGraph.beginDelivery('en-vuelo', 'vb');
  assert.equal(target.nodeId, existing.id); assert.ok(w.NeuralGraph.getDeliveryScreenPos('en-vuelo'));
  assert.ok(S.rateRelation('va', 'vb', false));
  assert.equal(w.NeuralGraph.getDeliveryScreenPos('en-vuelo'), null);
  const incoming = add(S, 'vb', 'Células', target);
  assert.equal(S.harvestConnections(incoming.id).length, 0);
  w.NeuralGraph.endDelivery('en-vuelo');
  assert.deepEqual(errors, []);
});

test('sin D3, la vista textual conserva las explicaciones y la navegación a las dos fuentes', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), false); t.after(() => dom.window.close());
  const S = w.NeuralStore, d = w.document; S.setSetting('autoHarvest', false);
  S.addDocument({ id: 'texto', name: 'texto.txt', pages: [
    { pageNum: 1, sourcePage: 7, sentences: [{ id: 'fa', text: 'Una variable almacena un valor para el programa.' }] },
    { pageNum: 2, sourcePage: 8, sentences: [{ id: 'fb', text: 'El programa modifica el valor de una variable.' }] }
  ] });
  add(S, 'fa', 'Variable'); add(S, 'fb', 'Programa');
  const button = [...d.querySelectorAll('#graph-fallback .fallback-node')].find(n => n.textContent.includes('Programa'));
  assert.ok(button); button.click();
  const row = d.querySelector('#insp-connection-list .affinity-connection');
  assert.match(row.textContent, /variable.*valor.*programa|programa.*valor.*variable/);
  assert.equal(row.querySelectorAll('.source-link').length, 2);
  row.querySelectorAll('.source-link')[1].click();
  assert.equal(S.state.activePage, 1);
  assert.deepEqual(errors, []);
});

test('el destino afín sigue la cámara y los efectos de reposo usan solo enlaces existentes', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true); t.after(() => dom.window.close());
  const S = w.NeuralStore, G = w.NeuralGraph, d = w.document;
  S.setSetting('autoHarvest', false);
  if (!w.SpiderEngine.getStatus().paused) d.getElementById('btn-toggle-spiders').click();
  const rect = { left: 20, top: 30, width: 600, height: 450, right: 620, bottom: 480 };
  d.getElementById('arena-stage').getBoundingClientRect = d.getElementById('neural-svg').getBoundingClientRect = () => rect;
  S.addDocument({ id: 'orbita', name: 'orbita.txt', pages: [
    { sentences: [{ id: 'oa', text: 'Las neuronas transmiten impulsos eléctricos mediante sinapsis.' }] },
    { sentences: [{ id: 'ob', text: 'Las neuronas reciben impulsos eléctricos de otras células.' }] },
    { sentences: [{ id: 'oc', text: 'Las neuronas propagan impulsos eléctricos entre células.' }] }
  ] });
  const a = add(S, 'oa', 'Neurona'); const b = add(S, 'ob', 'Impulsos'); G.recenter();
  const stored = JSON.stringify([S.state.nodes, S.state.links, S.state.patterns, S.harvestEdges()]);
  const idle = G.getIdleTarget(b.id, rect);
  assert.ok(idle.links.some(point => point.id === a.id), 'la chispa decorativa sigue una arista ámbar realmente visible');
  assert.equal(JSON.stringify([S.state.nodes, S.state.links, S.state.patterns, S.harvestEdges()]), stored, 'consultar el reposo no crea datos');

  const chosen = G.beginDelivery('lectora', 'oc'); assert.ok(chosen);
  const group = () => [...d.querySelectorAll('g.node-group')].find(g => g.__data__.id === chosen.nodeId);
  const expected = () => {
    const p = group().getAttribute('transform').match(/translate\(([^,]+),([^\)]+)\)/).slice(1).map(Number);
    return { x: rect.left + p[0], y: rect.top + p[1] };
  };
  assert.deepEqual({ ...G.getDeliveryScreenPos('lectora') }, expected());
  d.getElementById('btn-orbit').click(); await until(() => group().getAttribute('transform').includes('scale('));
  assert.deepEqual({ ...G.getDeliveryScreenPos('lectora') }, expected());
  const before = group().getAttribute('transform'); d.querySelector('[data-orbit-key="ArrowLeft"]').click();
  await until(() => group().getAttribute('transform') !== before);
  assert.deepEqual({ ...G.getDeliveryScreenPos('lectora') }, expected());
  G.setClusterFilter('AGT-02'); assert.equal(G.getDeliveryScreenPos('lectora'), null, 'un filtro puede ocultar el destino durante el trayecto');
  G.setClusterFilter('AGT-02'); assert.ok(G.getDeliveryScreenPos('lectora'));
  G.endDelivery('lectora');
  assert.equal(JSON.stringify([S.state.nodes, S.state.links, S.state.patterns, S.harvestEdges()]), stored, 'la cámara y el viaje no crean datos');
  assert.deepEqual(errors, []);
});

test('en una red densa la última entrega conserva su propio hilo visible dentro de la cota', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true); t.after(() => dom.window.close());
  const S = w.NeuralStore, d = w.document; S.setSetting('autoHarvest', false);
  if (!w.SpiderEngine.getStatus().paused) d.getElementById('btn-toggle-spiders').click();
  const sentences = Array.from({ length: 45 }, (_, i) => ({ id: `dense-${i}`,
    text: `Las neuronas transmiten impulsos eléctricos mediante sinapsis químicas especializadas. Registro ${i}.` }));
  sentences.push({ id: 'dense-new', text: 'Las neuronas transmiten señales de volcanes, galaxias, mares, cascadas y plantas.' });
  S.addDocument({ id: 'dense', name: 'dense.txt', pages: sentences.map((s, i) => ({ pageNum: i + 1, text: s.text, sentences: [s] })) });
  sentences.slice(0, -1).forEach((s, i) => add(S, s.id, `Concepto ${i}`));
  const target = w.NeuralGraph.beginDelivery('densidad', 'dense-new'); assert.ok(target);
  const added = add(S, 'dense-new', 'Última entrega', target); w.NeuralGraph.endDelivery('densidad');
  const expected = edge => edge.kind === 'affinity' && [edge.source?.id || edge.source, edge.target?.id || edge.target].includes(added.id) &&
    [edge.source?.id || edge.source, edge.target?.id || edge.target].includes(target.nodeId);
  const unprioritized = w.NCGraphProjection.project(S.state.nodes, S.state.links.concat(S.harvestEdges()),
    { limit: 40, edgeLimit: 90, pins: [added.id, target.nodeId] });
  assert.ok(!unprioritized.links.some(expected), 'la arista reciente de baja puntuación se perdería solo ordenando por puntuación');
  const displayed = [...d.querySelectorAll('line[data-kind="affinity"]')].map(line => line.__data__);
  assert.ok(displayed.some(expected), 'se reserva espacio para la pareja entregada');
  assert.ok(d.querySelectorAll('line.graph-link').length <= 90);
  assert.deepEqual(errors, []);
});
