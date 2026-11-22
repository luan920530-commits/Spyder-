const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, byText, until } = require('./support/dom.cjs');

async function setup(t, workspace = 'study') {
  const { dom, w, errors } = await createApp(new IDBFactory());
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const $ = s => w.document.querySelector(s), click = text => byText(w, workspace === 'network' ? '#tutor-stage button' : '#bot-stage button', text).click();
  $('#btn-toggle-spiders').click(); $(`[data-workspace="${workspace}"]`).click();
  return { w, S: w.NeuralStore, $, click };
}

test('CONTRASTAR recupera la discrepancia de la demo con sus fuentes sin anular filtros; calculadora en español', async t => {
  const { w, $ } = await setup(t);
  $('#btn-load-demo').click();
  const prompt = $('[data-prompt^="Detecta contradicciones"]').dataset.prompt;
  // Aunque se haya elegido otro modo y la expansión aprendida añada términos,
  // el acceso rápido contrasta el conjunto, no busca «documento» como tema.
  w.KimiAuxModel.getAssociatedConcepts = () => [{ word: 'artificial' }];
  $('#mode-select').value = 'socratico'; $('#mode-select').dispatchEvent(new w.Event('change'));
  $('[data-prompt^="Detecta contradicciones"]').click();
  await until(() => w.NeuralStore.state.chat.length === 1);
  assert.equal(w.NeuralStore.state.chat[0].mode, 'critico');
  assert.match(w.NeuralStore.state.chat[0].text, /12 ms frente a 40 ms/);
  assert.equal(w.NeuralStore.getSetting('mode'), 'socratico', 'el botón no cambia la preferencia');
  $('#mode-select').value = 'auto'; $('#mode-select').dispatchEvent(new w.Event('change'));
  const result = await w.NCRag.ask(prompt);
  assert.match(result.text, /12 ms frente a 40 ms/);
  assert.ok(result.sources.some(s => s.docName === 'Arquitectura_IA_Demo.txt'));
  assert.ok(result.sources.some(s => s.docName === 'Informe_Contraste_2025.md'));
  assert.ok(result.citations.allValid && result.citations.used.length >= 2);
  const restricted = await w.NCRag.ask(prompt + ' =doc:Informe =pag:2');
  assert.doesNotMatch(restricted.text, /Arquitectura_IA_Demo|12 ms frente a 40 ms/);
  assert.ok(restricted.sources.length && restricted.sources.every(s => s.docName === 'Informe_Contraste_2025.md' && s.pageNum === 2));
  for (const q of ['¿Cuánto es 7 + 3?', 'Cuánto vale 2,5 * 4', 'calcula sqrt(100)']) {
    const math = await w.NCRag.ask(q);
    assert.equal(math.mode, 'math'); assert.match(math.text, /= 10\*\*/); assert.equal(math.sources.length, 0);
  }
  assert.notEqual(w.NCRag.detectIntent('¿Cuánto vale la latencia del sistema?'), 'math');
});

test('guía conserva el borrador entre herramientas y quiz no puntúa material retirado ni deja su temporizador', async t => {
  const { w, S, $, click } = await setup(t);
  $('#btn-load-demo').click(); $('[data-bot="guide"]').click();
  $('#guide-editor').value = 'Mi esquema editado'; $('#guide-editor').dispatchEvent(new w.Event('input'));
  $('[data-bot="quiz"]').click(); $('#quiz-timed').checked = true; click('Crear quiz'); assert.ok($('.quiz-option'));
  $('[data-bot="guide"]').click(); assert.equal($('#guide-editor').value, 'Mi esquema editado');
  w.confirm = () => false; click('Regenerar'); assert.equal($('#guide-editor').value, 'Mi esquema editado');
  w.confirm = () => true; click('Regenerar'); assert.notEqual($('#guide-editor').value, 'Mi esquema editado');
  let cancelled = 0; const clear = w.clearInterval.bind(w); w.clearInterval = id => { cancelled++; clear(id); };
  S.removeDocument(S.state.docs[0].id);
  $('[data-bot="quiz"]').click(); assert.equal($('.quiz-option'), null); assert.ok(cancelled > 0);
  assert.match($('#bot-stage').textContent, /Se retiró material/);
  w.StudyBots.finishQuiz(); assert.equal(S.state.quizRuns.length, 0);
});

test('generación por lotes alcanza el pasaje 501 y Ver todas permite navegar sin alterar las fechas SRS', async t => {
  const { w, S, $, click } = await setup(t);
  const sentences = Array.from({ length: 501 }, (_, i) => ({ id: 's' + i, text: `La estación registra la temperatura del día ${i}.` }));
  S.addDocument({ id: 'largo', name: 'cuaderno.pdf', pages: [{ pageNum: 1, sourcePage: 27, sentences }] });
  assert.equal(w.StudyBots.generateCards(), 500); assert.equal(w.StudyBots.generateCards(), 1);
  assert.equal(w.StudyBots.generateCards(), 0); assert.equal(S.state.cards.at(-1).sentenceId, 's500');
  const before = S.state.cards.map(c => c.due).join(',');
  $('[data-bot="flashcards"]').click(); click('Ver todas'); assert.equal(byText(w, '#bot-stage button', 'Anterior').disabled, true);
  const first = $('.study-card-front').textContent; click('Siguiente'); assert.notEqual($('.study-card-front').textContent, first);
  click('Anterior'); assert.equal($('.study-card-front').textContent, first); assert.equal(S.state.cards.map(c => c.due).join(','), before);
  await S.savePersistent();
});

test('explicación: oculta el original, mantiene el intento entre pestañas y solo registra la autoevaluación', async t => {
  const { w, S, $, click } = await setup(t, 'network');
  assert.match($('#tutor-stage').textContent, /necesita al menos un pasaje/);
  const text = 'Una brújula se orienta por el campo magnético.';
  S.addDocument({ id: 'atlas', name: 'atlas.pdf', pages: [{ pageNum: 1, sourcePage: 7, sentences: [{ id: 'aguja', text }] }] });
  $('#tutor-skill').value = 'explain'; $('#tutor-skill').dispatchEvent(new w.Event('change'));
  click('Empezar práctica'); assert.equal($('.tutor-turn blockquote').textContent, text);
  click('Ocultar y explicar'); assert.equal($('.tutor-turn blockquote'), null); assert.equal(byText(w, '.tutor-form button', 'Comparar con la fuente').disabled, true);
  const answer = 'Mi explicación personal del norte';
  $('#tutor-answer').value = answer; $('#tutor-answer').dispatchEvent(new w.Event('input'));
  $('#open-review').click(); assert.equal($('#tutor-stage').classList.contains('hidden'), true);
  $('[data-workspace="chat"]').click(); $('[data-workspace="study"]').click();
  assert.equal($('#panel-analysis').classList.contains('hidden'), true); assert.equal($('[data-bot="guide"]').getAttribute('aria-pressed'), 'true');
  $('#study-open-tutor').click(); assert.equal($('#tutor-stage').classList.contains('hidden'), false);
  assert.equal($('[data-workspace="network"]').getAttribute('aria-pressed'), 'true'); assert.equal($('#tutor-answer').value, answer);
  click('Dame una pista'); click('Comparar con la fuente');
  assert.equal($('#tutor-feedback').textContent, 'Compara las ideas'); assert.equal(S.state.tutorRuns.length, 0);
  click('Necesito repasarla'); assert.equal(S.state.tutorRuns.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(S.state.tutorRuns[0].turns)), [{ sentenceId: 'aguja', ok: false, hint: true }]);
  click('Añadir pendientes'); assert.equal(S.state.cards[0].sourcePage, 7); assert.ok(byText(w, '#tutor-stage button', 'Añadir pendientes').disabled);
  const backup = await S.exportBrain(); assert.doesNotMatch(JSON.stringify(backup), /Mi explicación personal/);
  click('Practicar solo los pendientes'); assert.equal($('.tutor-turn blockquote').textContent, text);
  await S.resetAll(); assert.ok(!$('.tutor-turn')); assert.equal(S.state.tutorRuns.length, 0);
  await S.importBrain(backup); assert.equal(S.state.tutorRuns.length, 1); assert.match($('#tutor-stage').textContent, /Última práctica/);
  const bad = { data: { tutorRuns: [{ skill: 'explain', turns: null }] } };
  await assert.rejects(S.importBrain(bad), /progreso del tutor/);
  assert.equal(S.state.tutorRuns.length, 1); assert.equal(S.state.docs.length, 1);
  click('Empezar práctica'); S.removeDocument('atlas'); assert.ok(!$('.tutor-turn')); assert.equal(S.state.tutorRuns.length, 0);
  assert.equal(S.state.cards.length, 0);
  delete backup.data.tutorRuns; await S.importBrain(backup);
  assert.equal(S.state.docs.length, 1); assert.equal(S.state.tutorRuns.length, 0, 'los respaldos anteriores siguen funcionando');
});

test('respaldo antiguo: repara la tarjeta generada con la vecina sin sobreescribir repasos ni tarjetas personalizadas', async t => {
  const { S, w } = await setup(t);
  S.addDocument({ id: 'atlas', name: 'atlas.pdf', pages: [{ pageNum: 1, sourcePage: 9, sentences: [
    { id: 'ancla', text: 'Los mapas señalan rutas en papel.' }, { id: 'vecina', text: 'La cartografía digital representa coordenadas geográficas.' }
  ] }] });
  const backup = await S.exportBrain();
  const legacy = sid => {
    const source = S.getSentence(sid), term = w.NCAnalysis.pickAnswerTerm(source.text);
    return { id: 'fc-' + sid, sentenceId: sid, docName: source.docName, pageNum: 1,
      front: 'Completa: ' + source.text.replace(term, '________'), back: `${term}\n\n${source.text}`, box: 4, due: 123456, reps: 7 };
  };
  const custom = { ...legacy('vecina'), front: 'Mi pregunta editada' };
  backup.data.cards = [legacy('ancla'), custom]; delete backup.data.tutorRuns;
  await S.importBrain(backup);
  const [fixed, untouched] = S.state.cards;
  assert.equal(fixed.front, 'Completa: Los mapas ________ rutas en papel.'); assert.doesNotMatch(fixed.back, /cartografía/);
  assert.equal(fixed.sourcePage, 9); assert.equal(fixed.box, 4); assert.equal(fixed.due, 123456); assert.equal(fixed.reps, 7);
  assert.deepEqual({ ...untouched }, custom); assert.equal(S.state.tutorRuns.length, 0);
  await S.flush();
});

test('tutor con texto corto: alternativa sin preguntas inventadas, balance acotado y sin referencias huérfanas', async t => {
  const { $, S, click } = await setup(t, 'network');
  S.addDocument({ id: 'nota', name: 'nota.txt', pages: [{ pageNum: 1, sentences: [{ id: 's', text: '2 + 2 = 4' }] }] });
  click('Empezar práctica'); assert.match($('#tutor-stage').textContent, /Prueba «Explicación propia»/); assert.equal($('#tutor-answer'), null);
  const run = { docId: 'nota', skill: 'explain', at: 1, answer: 'NO GUARDAR', turns: [{ sentenceId: 's', ok: false, hint: false, draft: 'NO GUARDAR' }] };
  assert.equal(S.recordTutorRun({ ...run, docId: 'otro' }), false);
  assert.equal(S.recordTutorRun({ ...run, turns: [...run.turns, ...run.turns] }), false);
  const backup = await S.exportBrain();
  backup.data.tutorRuns = Array.from({ length: 55 }, (_, i) => ({ ...run, at: i }));
  await S.importBrain(backup);
  assert.equal(S.state.tutorRuns.length, 50); assert.equal(S.state.tutorRuns[0].at, 5);
  assert.equal(S.recordTutorRun({ ...run, at: 55 }), true); assert.equal(S.state.tutorRuns[0].at, 6);
  assert.doesNotMatch(JSON.stringify((await S.exportBrain()).data.tutorRuns), /NO GUARDAR/);
  backup.data.docs = []; await S.importBrain(backup); assert.equal(S.state.tutorRuns.length, 0);
});

test('una sustitución fallida cancela la sesión antigua y permite volver a practicar con los documentos intactos', async t => {
  const { $, w, S, click } = await setup(t, 'network');
  $('#btn-load-demo').click(); const backup = await S.exportBrain();
  click('Empezar práctica'); assert.ok($('#tutor-answer'));
  w.NCDB.importAll = async () => { throw new Error('cuota insuficiente'); };
  const pending = S.importBrain(backup);
  assert.match($('#tutor-stage').textContent, /Actualizando/); assert.equal($('#tutor-answer'), null);
  await assert.rejects(pending, /cuota insuficiente/);
  assert.equal(S.state.docs.length, 2); assert.equal(S.state.tutorRuns.length, 0);
  click('Empezar práctica'); assert.ok($('#tutor-answer')); assert.ok(!$('.tutor-result'));
});

test('Contrastar explicita el alcance de la muestra en libros largos y respeta el filtro al calcularlo', async t => {
  const { w, S } = await setup(t);
  const passage = 'El cuaderno conserva observaciones cualitativas del terreno.';
  S.addDocument({ id: 'atlas', name: 'atlas.txt', pages: Array.from({ length: 151 }, (_, i) => ({ pageNum: i + 1,
    sentences: Array.from({ length: 10 }, (_, j) => ({ id: `s${i}-${j}`, text: passage })) })) });
  const q = 'Detecta contradicciones en el documento';
  assert.match((await w.NCRag.ask(q, { mode: 'critico' })).text, /muestra de 1500 de 1510 oraciones/);
  assert.doesNotMatch((await w.NCRag.ask(q + ' =pag:151', { mode: 'critico' })).text, /muestra de 1500/);
  await S.flush();
});

test('reset durante OCR: ni la lectura tardía ni su aviso se mezclan con el siguiente corpus', async t => {
  const { w, S, $ } = await setup(t); let finish, signal;
  w.NCOCR.imageCanvas = async () => ({});
  w.NCOCR.open = async s => { signal = s; return { close() {}, read: () => new Promise(resolve => { finish = resolve; }) }; };
  const file = { name: 'foto.png', size: 8, slice: () => ({ arrayBuffer: async () => Uint8Array.from([137,80,78,71,13,10,26,10]).buffer }) };
  Object.defineProperty($('#ocr-file'), 'files', { value: [file] }); $('#ocr-file').dispatchEvent(new w.Event('change'));
  await until(() => !!finish); assert.ok($('#ocr-file').disabled);
  await S.resetAll(); assert.equal(signal.aborted, true);
  finish('Texto tardío'); await until(() => !$('#ocr-file').disabled);
  assert.equal($('#ocr-status').textContent, ''); assert.deepEqual([...S.state.docs], []);
});
