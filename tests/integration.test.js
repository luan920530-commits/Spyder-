const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createApp } = require('./support/dom.cjs');
const U = require('../js/util.js');

test('las flexiones comunes se indexan igual que sus singulares', () => {
  for (const [singular, plural] of [['variable', 'variables'], ['latencia', 'latencias'], ['dato', 'datos'], ['casa', 'casas']]) {
    assert.equal(U.stem(singular), U.stem(plural), `${singular}/${plural}`);
  }
});

const documentWithRelatedPassages = () => ({ id: 'libro', name: 'Cuaderno.txt', pages: [{ pageNum: 1, sentences: [
  { id: 'a', text: 'Una variable guarda un valor y permite cambiar ese valor durante un programa.' },
  { id: 'b', text: 'El programa consulta el valor de una variable antes de cambiarlo.' },
  { id: 'c', text: 'Una variable puede contener un número durante la ejecución del programa.' },
  { id: 'd', text: 'El valor de una variable tiene un tipo en algunos lenguajes de programación.' }
] }] });

test('saludo, base educativa, órdenes de memoria y tutor documental conservan sus ámbitos', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('searchScope', 'knowledge');
    const educational = await w.NCRag.ask('Hola, ¿qué dice Aprende.org sobre las variables?');
    assert.equal(educational.question, 'Hola, ¿qué dice Aprende.org sobre las variables?');
    assert.equal(educational.sources[0].knowledgeId, 'kb:educacion-variable');
    assert.match(educational.text, /Una variable permite asociar un nombre con un dato/);
    assert.ok(educational.sources.every(source => source.origin === 'knowledge'));
    assert.equal(S.state.consolidatedMemory.length, 0);
    const portal = await w.NCRag.ask('Hola, Aprende SST alturas');
    assert.notEqual(portal.intent, 'learn');
    assert.equal(portal.sources[0].knowledgeId, 'kb:educacion-alturas');
    const learn = await w.NCRag.ask('Hola, aprende que el examen es el jueves');
    assert.equal(learn.intent, 'learn');
    assert.equal(S.state.consolidatedMemory.at(-1).fact, 'el examen es el jueves');
    S.addDocument(documentWithRelatedPassages());
    S.setSetting('mode', 'tutor');
    assert.ok(w.document.getElementById('knowledge-controls').classList.contains('hidden'));
    const tutor = await w.NCRag.ask('Hola, ¿qué dice el documento sobre las variables?', { dialogueScope: 'libro' });
    assert.equal(tutor.mode, 'tutor');
    assert.ok(tutor.sources.length);
    assert.ok(tutor.sources.every(source => source.origin === 'document' && source.docId === 'libro' && Number.isInteger(source.offset)));
    assert.doesNotMatch(tutor.text, /examen es el jueves/);
    S.setSetting('mode', 'auto');
    assert.ok(!w.document.getElementById('knowledge-controls').classList.contains('hidden'));
    const stillLocal = await w.NCRag.ask('variables');
    assert.ok(stillLocal.sources.every(source => source.origin === 'knowledge'));
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('los vínculos de estudio y la cámara se superponen al grafo paginado sin alterar el grafo persistido', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true);
  try {
    const S = w.NeuralStore, $ = id => w.document.getElementById(id);
    S.setSetting('autoHarvest', false);
    S.addDocument(documentWithRelatedPassages());
    const nodes = Array.from({ length: 85 }, (_, i) => ({ id: `n${i}`, cluster: 'AGT-01',
      label: `Concepto ${i}`, text: `Contenido ${i}`, weight: 1, sentenceIds: i === 84 ? ['a'] : [] }));
    const links = nodes.map(node => ({ key: `hub>${node.id}`, source: 'AGT-01', target: node.id, kind: 'hierarchy' }));
    S.state.nodes.push(...nodes); S.state.links.push(...links);
    const before = JSON.stringify({ nodes, links });
    S.emit('brain:imported');
    assert.equal($('graph-page').textContent, '1–40 / 85');
    $('btn-study-links').click();
    assert.equal($('btn-study-links').getAttribute('aria-pressed'), 'true');
    assert.ok(w.document.querySelectorAll('line[data-kind="study"]').length > 0);
    assert.ok(w.document.querySelectorAll('#neural-svg .node-group').length <= 48);
    $('btn-orbit').click();
    assert.equal($('btn-orbit').getAttribute('aria-pressed'), 'true');
    $('graph-next').click();
    assert.equal($('graph-page').textContent, '41–80 / 85');
    assert.ok(w.document.querySelectorAll('line[data-kind="study"]').length > 0);
    assert.ok(w.document.querySelectorAll('#neural-svg .node-group').length <= 48);
    $('link-compare').click();
    assert.match($('insp-relations').textContent, /Vínculos|relacionad/i);
    $('btn-center-net').click();
    assert.equal($('btn-orbit').getAttribute('aria-pressed'), 'true');
    assert.equal(JSON.stringify({ nodes, links }), before);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('respaldo y restauración conservan el progreso nuevo junto a las cosechas, sin exportar el perfil personal', async () => {
  const db = new IDBFactory(), first = await createApp(db);
  try {
    const S = first.w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument(documentWithRelatedPassages());
    S.addPattern({ cluster: 'AGT-01', label: 'Variable', text: 'Una variable guarda un valor.', sentenceId: 'a' });
    assert.equal(S.rateRelation('a', 'b', true), true);
    assert.equal(S.recordTutorRun({ docId: 'libro', skill: 'recall', at: 1234,
      turns: [{ sentenceId: 'a', ok: false, hint: true }] }), true);
    await S.savePersonal({ ...S.state.personal, profile: { alias: 'PRIVADO', note: 'Nota personal', tone: 'practical' } });
    assert.equal(await S.savePersistent(), true);
    const backup = await S.exportBrain();
    assert.equal(backup.data.patterns.length, 1);
    assert.equal(backup.data.relationVotes.length, 1);
    assert.equal(backup.data.tutorRuns.length, 1);
    assert.doesNotMatch(JSON.stringify(backup), /PRIVADO|Nota personal|companionPrivate/);
    backup.data.companionPrivate = { profile: { alias: 'AJENO' } };
    await S.importBrain(backup);
    assert.equal(S.state.personal.profile.alias, 'PRIVADO');
    assert.equal(S.state.patterns.length, 1);
    assert.equal(S.state.relationVotes.length, 1);
    assert.equal(S.state.tutorRuns.length, 1);
    assert.deepEqual(first.errors, []);
  } finally { first.dom.window.close(); }
  const second = await createApp(db);
  try {
    const state = second.w.NeuralStore.state;
    assert.equal(state.personal.profile.alias, 'PRIVADO');
    assert.equal(state.patterns.length, 1);
    assert.equal(state.relationVotes.length, 1);
    assert.equal(state.tutorRuns.length, 1);
    assert.equal(second.w.SpiderEngine.getStatus().paused, true, 'la preferencia de no cosechar se respeta al restaurar');
    assert.deepEqual(second.errors, []);
  } finally { second.dom.window.close(); }
});
