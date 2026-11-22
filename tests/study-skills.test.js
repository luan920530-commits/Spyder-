const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../js/study-skills');
const SRS = require('../js/srs');

const sources = [
  ['a', 'La brújula marca el norte.'], ['b', 'La cartografía representa el terreno.'],
  ['c', 'Los paralelos indican la latitud.'], ['d', 'La leyenda describe los símbolos.']
].map(([id, sourceText]) => ({ id, docId: 'libro', docName: 'Atlas.pdf', pageNum: 2, sourcePage: 9,
  sourceText, text: 'Ventana de recuperación con oraciones vecinas. ' + sourceText }));
const other = { ...sources[0], docId: 'otro', id: 'otro-1', sourceText: 'Contenido de otra edición.' };

test('recuerdo activo usa el ancla literal y aísla dos libros homónimos; nunca inventa ejercicios', () => {
  const items = K.plan([other, ...sources, sources[0]], 'libro', 'recall');
  assert.deepEqual(items.map(i => i.source.id), ['a', 'b', 'c']);
  assert.equal(items[0].prompt, 'La ________ marca el norte.');
  assert.deepEqual(K.compare(items[0], 'recall', '  BRUJULA. '), { ok: true });
  assert.deepEqual(K.compare(items[0], 'recall', 'norte'), { ok: false });
  assert.equal(K.compare(items[0], 'recall', '  '), null);
  assert.deepEqual(K.plan([other], 'libro', 'recall'), []);
  assert.deepEqual(K.plan([{ ...sources[0], sourceText: '' }], 'libro', 'recall'), []);
  assert.equal(K.plan([sources[0], sources[0]], 'libro', 'recall').length, 1);
});

test('tutor prioriza dificultad y pistas, luego material sin practicar; cada habilidad conserva su historial', () => {
  const runs = [{ docId: 'libro', skill: 'recall', turns: [
    { sentenceId: 'a', ok: true, hint: false }, { sentenceId: 'c', ok: false, hint: false }, { sentenceId: 'b', ok: true, hint: true }
  ] }];
  assert.deepEqual(K.plan(sources, 'libro', 'recall', runs).map(i => i.source.id), ['c', 'b', 'd']);
  const explain = K.plan(sources, 'libro', 'explain', runs);
  assert.equal(explain[0].source.id, 'a');
  for (const response of ['No marca el norte.', 'Una paráfrasis sin coincidencias.']) {
    assert.equal(K.compare(explain[0], 'explain', response).ok, null, 'ni coincidencia ni ausencia de vocabulario dictan una nota');
  }
  assert.ok(K.compare(explain[0], 'explain', 'No marca el norte.').shared.includes('norte'));
});

test('guía, tarjetas y CSV usan la página física y no una respuesta de la oración vecina', () => {
  const sample = K.sample(sources, 2);
  assert.deepEqual(sample.map(s => s.id), ['a', 'd']);
  assert.equal(sample[0].text, sources[0].sourceText);
  const fields = K.cardFields(sources[0]);
  assert.equal(fields.front, 'Completa: La ________ marca el norte.');
  assert.equal(fields.back, 'brújula\n\nLa brújula marca el norte.');
  assert.match(SRS.ankiCsv([fields]), /\[Pág 9\] · Atlas\.pdf/);
  const legacy = { ...fields, sourcePage: undefined };
  assert.match(SRS.ankiCsv([legacy], () => sources[0]), /\[Pág 9\]/);
  assert.match(SRS.ankiCsv([legacy]), /\[Pág 2\]/, 'un documento sin página física mantiene su numeración');
  assert.equal(K.cardFields({ sourceText: '2 + 2 = 4' }), null);
  assert.equal(K.cardFields({ sourceText: '2 + 2 = 4' }, true).back, '2 + 2 = 4');
});
