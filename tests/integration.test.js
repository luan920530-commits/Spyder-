const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, until } = require('./support/dom.cjs');
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

test('el chat responde la pregunta literal sobre cláusula penal con fichas y citas verificables', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore, q = 'Qué es una cláusula penal y cuál es su finalidad';
    S.setSetting('autoHarvest', false);
    S.setSetting('searchScope', 'both');
    w.document.querySelector('[data-workspace="chat"]').click();
    w.document.getElementById('chat-input').value = q;
    w.document.getElementById('chat-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => w.document.querySelector('#chat-messages article.msg-ai'));
    const answer = S.state.chat.at(-1), article = w.document.querySelector('#chat-messages article.msg-ai');
    assert.equal(answer.question, q);
    assert.deepEqual(Array.from(answer.sources, source => source.knowledgeId), ['kb:clausula-penal', 'kb:clausula-penal-funciones']);
    assert.ok(answer.sources.every(source => source.origin === 'knowledge' && source.legal && source.reviewed === '2026-11-16'));
    assert.ok(answer.citations.allValid && answer.citations.allSupported);
    assert.match(article.textContent, /dar o hacer algo.*incumple o retrasa/);
    assert.match(article.textContent, /estima anticipadamente los perjuicios/);
    assert.match(article.textContent, /pacto expreso e inequívoco/);
    assert.doesNotMatch(article.textContent, /El material no explicita limitaciones/);
    assert.match(article.textContent, /El análisis automático no identifica todas las condiciones o excepciones/);
    assert.match(article.textContent, /Revisión 2026-11-16.*no sustituye asesoría jurídica/);
    assert.equal(article.querySelector('.sources-details').open, false);
    article.querySelector('.answer-body .cite-ref').click();
    assert.equal(article.querySelector('.sources-details').open, true);
    const rows = article.querySelectorAll('.source-list li');
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /Código Civil colombiano.*2026-11-16|2026-11-16.*Código Civil colombiano/);
    assert.equal(rows[0].querySelector('a').href, 'https://www.cancilleria.gov.co/sites/default/files/Normograma/docs/codigo_civil_pr049.htm');
    assert.equal(rows[1].querySelector('a').href, 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=21359');
    const md = w.NCRag.toMarkdown(answer);
    assert.match(md, /2026-11-16/); assert.match(md, /cancilleria\.gov\.co/); assert.match(md, /funcionpublica\.gov\.co/);
    assert.equal(S.state.docs.length, 0); assert.equal(S.state.allSentences.length, 0); assert.equal(S.state.vault.length, 0);

    const purpose = await w.NCRag.ask('¿Para qué sirve una cláusula penal?', { scope: 'knowledge' });
    assert.match(purpose.text, /no un castigo por un delito/);
    assert.match(purpose.text, /pacto expreso e inequívoco/);
    assert.ok(purpose.citations.allValid && purpose.citations.allSupported);
    const docs = await w.NCRag.ask(q, { scope: 'documents' });
    assert.equal(docs.sources.length, 0); assert.match(docs.text, /Sin evidencia suficiente/);
    for (const filtered of ['cláusula penal =doc:privado', 'cláusula penal =pag:1', '¿Cuál es la pena por un delito?', '¿Qué es una cláusula penal en México?']) {
      const result = await w.NCRag.ask(filtered, { scope: 'both' });
      assert.equal(result.sources.length, 0, filtered); assert.match(result.text, /Sin evidencia suficiente/);
    }
    S.addDocument({ id: 'mexico', name: 'apunte-mexico.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'mexico-s', text: 'Apunte privado sobre la cláusula penal en México para una consulta de prueba.' }
    ] }] });
    const privateAnswer = await w.NCRag.ask('¿Qué es una cláusula penal en México?', { scope: 'both' });
    assert.ok(privateAnswer.sources.some(source => source.origin === 'document' && source.docId === 'mexico'));
    assert.ok(privateAnswer.sources.every(source => source.origin === 'document'), 'el filtro de fichas no descarta documentos pertinentes');
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
