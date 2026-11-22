const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../vendor/fsrs/ts-fsrs.umd.js');
const srs = require('../js/srs');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, byText } = require('./support/dom.cjs');
const t0 = Date.UTC(2025, 4, 10, 12), day = srs.DAY;

test('las cuatro valoraciones y los repasos sucesivos reproducen ts-fsrs incluso tras serializar las fechas', () => {
  assert.equal(typeof Date.prototype.scheduler, 'undefined', 'el bundle no instala atajos globales');
  const engine = F.fsrs({ enable_fuzz: false });
  let card = srs.newCard({ id: 'a', front: 'Mi pregunta', back: 'Mi respuesta', sourcePage: 23, due: t0 });
  let reference = F.createEmptyCard(t0), time = t0;
  for (const g of ['hard', 'good', 'easy', 'again', 'hard', 'good', 'easy']) {
    const saved = JSON.stringify(card);
    const next = srs.review(card, g, time), grade = srs.GRADES.indexOf(g) + 1;
    reference = engine.next(reference, time, grade).card;
    assert.equal(JSON.stringify(card), saved, 'calificar no muta la tarjeta anterior');
    assert.equal(next.due, +reference.due); assert.equal(next.fsrs.stability, reference.stability);
    assert.equal(next.fsrs.difficulty, reference.difficulty); assert.equal(next.fsrs.state, reference.state);
    assert.equal(next.fsrs.reps, reference.reps); assert.equal(next.fsrs.lapses, reference.lapses);
    assert.equal(next.lastReview, time); assert.equal(next.sourcePage, 23); assert.equal(next.front, 'Mi pregunta');
    card = JSON.parse(JSON.stringify(next)); time = card.due;
  }
  assert.equal(card.reps, 7); assert.equal(card.lapses, 1); assert.equal(card.history.length, 7);
  assert.equal(srs.dueLabel({ due: t0 + 3600000 }, t0), '1 h');
});

test('migración al calificar: respeta edición, caja, citas, historial y el intervalo de una tarjeta antigua', () => {
  const old = { id: 'custom', front: 'Pregunta editada', back: 'Respuesta manual', docName: 'Atlas', pageNum: 1, sourcePage: 24,
    reps: 15, lapses: 2, box: 4, due: t0, interval: 20, lastReview: t0 - 20 * day, history: [{ grade: 'good', at: t0 - 20 * day, box: 3 }] };
  const snapshot = JSON.stringify(old);
  assert.deepEqual(srs.sessionPlan([old], 5, t0 - 1).ids, []); assert.equal(JSON.stringify(old), snapshot);
  const rated = srs.review(old, 'good', t0);
  assert.equal(rated.reps, 16); assert.equal(rated.box, 5); assert.equal(rated.lapses, 2);
  assert.equal(rated.front, old.front); assert.deepEqual(rated.history[0], old.history[0]); assert.equal(rated.lastReview, t0);
  assert.ok(rated.due > t0 + day); assert.equal(rated.fsrs.state, F.State.Review);
  assert.equal(JSON.stringify(old), snapshot); assert.match(srs.ankiCsv([rated]), /Respuesta manual \[Pág 24\] · Atlas/);
  // Un respaldo sin datos suficientes y un reloj que retrocede no rompen la revisión.
  const partial = srs.review({ id: 'b', fsrs: { version: 1, state: -17, stability: -1 }, due: t0, reps: 2 }, 'again', t0);
  assert.equal(partial.reps, 3); assert.ok(partial.due > t0);
  assert.ok(srs.review(rated, 'hard', t0 - day).due > t0 - day);
});

test('plan acotado: repasos vencidos antes de nuevas, sin duplicados ni adelantos; hoy cuenta tarjetas distintas', () => {
  const now = new Date(2025, 2, 27, 12).getTime();
  const deck = [{ id: 'later', due: now + 60000, reps: 8, lastReview: now - 100 }, { id: 'new1', due: now - day },
    { id: 'overdue2', reps: 9, due: now, lastReview: now - day }, { id: 'new2', due: now }, { id: 'overdue1', reps: 3, due: now - 50 },
    { id: 'later', due: now + 10, reps: 6, lastReview: now }, { id: 'next', due: now + 42 }];
  const before = JSON.stringify(deck);
  assert.deepEqual(srs.sessionPlan(deck, 3, now), { ids: ['overdue1', 'overdue2', 'new1'], due: 4, fresh: 2, reviewedToday: 1, next: now + 42 });
  assert.equal(JSON.stringify(deck), before);
  assert.ok(!srs.sessionPlan(deck, 5, now + 41).ids.includes('next'));
  assert.ok(srs.sessionPlan(deck, 10, now + 42).ids.includes('next'));
  assert.equal(srs.sessionPlan(Array.from({ length: 50 }, (_, i) => ({ id: 'x'+i })), Infinity, now).ids.length, 5);
});

async function student(t) {
  const { w, dom, errors } = await createApp(new IDBFactory());
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const $ = s => w.document.querySelector(s), bot = name => $(`[data-bot="${name}"]`).click();
  $('#btn-toggle-spiders').click(); $('[data-workspace="study"]').click(); bot('plan');
  const S = w.NeuralStore, click = text => byText(w, '#bot-stage button', text).click();
  const set = (id, val) => { $(id).value = val; $(id).dispatchEvent(new w.Event('change')); };
  function add(id, texts) { S.addDocument({ id, name: 'Apuntes.pdf', pages: texts.map((text, i) => ({ pageNum: i + 1, sourcePage: 20 + i, sentences: [{ text, id: id + '-' + i }] })) }); }
  return { w, S, $, click, set, bot, add };
}

test('sesión por ID de documento: prepara solo el cupo, conserva el intento al cambiar de herramienta y respalda solo las calificaciones', async t => {
  const { w, S, $, click, set, bot, add } = await student(t);
  assert.ok($('#review-start').disabled); assert.ok(byText(w, '#bot-stage button', 'Elegir archivo'));
  const texts = ['La mediana corresponde al valor central de la muestra.', 'El promedio usa todos los valores del conjunto.', 'La dispersión describe cuánto varían los datos.', 'Un intervalo expresa un rango de valores.'];
  add('stats', texts); add('other', ['La biblioteca contiene relatos antiguos.']);
  set('#review-size', '3'); set('#review-doc', 'stats'); click('Preparar hasta 3');
  assert.equal(S.state.cards.length, 3); assert.ok(S.state.cards.every(c => c.docId === 'stats'));
  click('Empezar repaso'); assert.match($('#review-task').textContent, /1 de 3/); assert.equal($('.grade-buttons'), null);
  $('#review-draft').value = 'mi borrador privado'; $('#review-draft').dispatchEvent(new w.Event('input'));
  bot('guide'); bot('plan'); assert.equal($('#review-draft').value, 'mi borrador privado'); click('Mostrar respuesta');
  assert.equal($('.review-attempt').textContent, 'Tu intento: mi borrador privado'); assert.equal($('.review-turn .source-link').textContent, 'Apuntes.pdf · pág. 20');
  assert.equal(S.state.cards[0].reps, 0); click('Otra vez'); assert.equal($('#review-draft').value, '');
  const rest = S.state.cards.slice(1).map(c => c.due);
  click('Terminar por ahora'); assert.match($('.review-summary').textContent, /1 de 3/); assert.match($('.review-summary .source-link').textContent, /pág. 20/);
  click('Volver a mi plan'); assert.match($('.review-today').textContent, /: 1\./); assert.match($('.review-next').textContent, /2 nuevas/);
  assert.deepEqual(S.state.cards.slice(1).map(c => c.due), rest);
  const backup = JSON.parse(JSON.stringify(await S.exportBrain())); assert.ok(!JSON.stringify(backup).includes('mi borrador privado'));
  const due = S.state.cards[0].due; assert.ok(due > S.state.cards[0].lastReview); assert.equal(backup.data.settings.reviewSessionSize, 3);
  await S.resetAll({ keepSettings: false }); assert.ok(!$('.review-turn')); await S.importBrain(backup);
  assert.equal($('#review-size').value, '3'); assert.equal(S.state.cards[0].due, due); assert.equal(S.state.cards[0].fsrs.reps, 1);
  click('Empezar repaso'); assert.match($('.study-card-front').textContent, /promedio|valores del conjunto/); S.removeDocument('stats');
  assert.ok(!$('.review-turn')); assert.ok($('#review-start').disabled); assert.match($('#bot-stage').textContent, /Se retiró un documento/);
  assert.equal(S.state.cards.length, 0); await S.flush();
});

test('una calificación en Tarjetas no se duplica en Mi repaso; un mazo al día indica cuándo volver', async t => {
  const { S, $, click, bot, add } = await student(t);
  add('mapa', ['Los mapas representan caminos y accidentes geográficos.']);
  click('Preparar hasta 5'); click('Empezar repaso'); bot('flashcards'); click('Mostrar respuesta'); click('Fácil');
  const original = JSON.stringify(S.state.cards);
  bot('plan'); assert.match($('.review-summary').textContent, /Calificaste 0 de 1/);
  assert.match($('.review-summary').textContent, /No se calificaron dos veces/);
  click('Volver a mi plan'); assert.match($('.review-next').textContent, /Al día. Próximo repaso/); assert.ok($('#review-start').disabled);
  click('Preparar hasta 5'); assert.match($('#bot-stage').textContent, /No hay más pasajes/);
  assert.equal(JSON.stringify(S.state.cards), original); await S.flush();
});

test('guardar una pregunta durante un repaso conserva el intento y ofrece después solo las preguntas del libro elegido', async t => {
  const { w, S, $, click, set, add } = await student(t);
  add('primero', ['La brújula señala el norte magnético.']); add('otro', ['La mediana indica el valor central.']);
  click('Preparar hasta 5'); set('#review-doc', 'primero'); click('Empezar repaso');
  $('#review-draft').value = 'aún pensando'; $('#review-draft').dispatchEvent(new w.Event('input'));
  const H = w.NCHighlights, page = H.indexPage(S.getActiveDoc(), 1), quote = 'valor central', start = page.text.indexOf(quote);
  const card = S.addQuestion(H.anchor(page, { start, end: start + quote.length, quote }), '¿Qué indica la mediana?');
  S.emit('study:openReview', { docId: card.docId, authored: true }); assert.equal($('#review-draft').value, 'aún pensando');
  click('Terminar por ahora'); click('Volver a mi plan'); assert.equal($('#review-doc').value, 'otro'); assert.ok($('#review-mine').checked);
  assert.match($('.review-next').textContent, /1 nueva/); assert.equal(byText(w, '#bot-stage button', 'Preparar hasta'), undefined);
  $('#review-mine').click(); assert.match($('.review-next').textContent, /2 nuevas/); $('#review-mine').click();
  click('Empezar repaso'); assert.equal($('.study-card-front').textContent, card.front); assert.equal(card.reps, 0); await S.flush();
});
