const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/character');
const R = require('../js/retrieval');
const P = require('../js/parsers');

function corpus() {
  const sentences = [
    { id: 'a1', docId: 'book-a', docName: 'novela.pdf', pageNum: 1, sourcePage: 2, text: 'Luna guardó la llave de plata en una caja azul.' },
    { id: 'a2', docId: 'book-a', docName: 'novela.pdf', pageNum: 1, sourcePage: 2, text: 'Después abrió la puerta del jardín secreto.' },
    { id: 'a3', docId: 'book-a', docName: 'novela.pdf', pageNum: 2, sourcePage: 3, text: 'La sombra cubrió las flores del jardín.' },
    { id: 'a4', docId: 'book-a', docName: 'novela.pdf', pageNum: 2, sourcePage: 3, text: 'Luna descubrió una carta junto al río.' },
    // La ID contiene la del primer libro para comprobar que el filtro es exacto.
    { id: 'b1', docId: 'book-a-extra', docName: 'otra.pdf', pageNum: 1, sourcePage: 1, text: 'Luna guardó la llave de oro en una estación espacial.' }
  ];
  return { index: R.rebuildFrom(sentences), doc: { id: 'book-a', name: 'novela.pdf' }, name: 'Luna' };
}

test('requiere seleccionar libro y nombre y comprueba nombres completos sin falsos positivos', () => {
  const { index, doc } = corpus();
  assert.equal(C.respond({ question: 'hola' }).intent, 'setup');
  assert.equal(C.respond({ question: 'hola', index, doc }).intent, 'setup');
  assert.equal(C.respond({ question: 'hola', index, doc, name: 'Nadie' }).intent, 'missing-character');
  assert.equal(C.mentions('Anastasia abrió la puerta.', 'Ana'), false);
  assert.equal(C.mentions('ANA María miró el río.', 'Ana Maria'), true);
  assert.equal(C.mentions('Se acercó a Luna.', 'lúna'), true);
  assert.equal(C.mentions('Se acercó a Lunares.', 'Luna'), false);
});

test('el personaje usa solo el libro seleccionado y no inventa evidencia', () => {
  const context = corpus();
  const greeting = C.respond({ ...context, question: 'Hola' });
  assert.equal(greeting.intent, 'greeting');
  assert.match(greeting.text, /versión sencilla de Luna/);
  assert.equal(greeting.chunks.length, 0);
  const result = C.respond({ ...context, question: '¿Qué pasó con la llave?' });
  assert.equal(result.intent, 'character-search');
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].docId, 'book-a');
  assert.equal(result.chunks[0].sourcePage, 2);
  assert.match(result.reply.excerpt, /llave de plata/);
  assert.doesNotMatch(result.text, /llave de oro/);
  assert.match(result.reply.excerptLabel, /narración o diálogo de otra persona/);
  assert.deepEqual(result.citations.used, [1]);
  assert.equal(result.citations.allValid, true);
  const noEvidence = C.respond({ ...context, question: '¿Qué opinas de la estación espacial?' });
  assert.equal(noEvidence.chunks.length, 0);
  assert.match(noEvidence.text, /No encontré|No quiero inventar/);
});

test('continuación usa el último pasaje del mismo personaje y libro', () => {
  const context = corpus();
  const first = C.respond({ ...context, question: 'Háblame de ti' });
  const history = [{ mode: 'conversacion', character: first.character, sources: [{ sentenceId: first.chunks[0].id }] }];
  const next = C.respond({ ...context, question: '¿Qué pasó después?', history });
  assert.equal(next.chunks[0].id, 'a2');
  assert.equal(next.chunks[0].sourcePage, 2);
  const again = C.respond({ ...context, question: '¿Qué pasó después?', history: [...history,
    { mode: 'conversacion', character: next.character, sources: [{ sentenceId: next.chunks[0].id }] }] });
  assert.equal(again.chunks[0].id, 'a3');
  assert.equal(again.chunks[0].sourcePage, 3);
  const otherName = C.respond({ ...context, name: 'Otra', question: '¿Y después?', history });
  assert.equal(otherName.intent, 'missing-character');
  const noHistory = C.respond({ ...context, question: '¿Y después?', history: [{ ...history[0], character: { name: 'Luna', docId: 'book-a-extra' } }] });
  assert.equal(noHistory.chunks.length, 0);
  assert.match(noHistory.text, /Primero pregúntame/);
  const finalHistory = [{ mode: 'conversacion', character: first.character, sources: [{ sentenceId: 'a4' }] }];
  assert.match(C.respond({ ...context, question: '¿Y después?', history: finalHistory }).text, /No hay otro pasaje/);
});

test('acompañamiento y crisis usan respuestas fijas sin atribuir citas ni depender del libro', () => {
  const empathy = C.respond({ question: 'Me siento muy sola y estoy triste' });
  assert.equal(empathy.intent, 'emotional');
  assert.match(empathy.text, /confianza/i);
  assert.equal(empathy.chunks.length, 0);
  for (const question of ['Me quiero morir', 'Estoy pensando en suicidarme', 'Tengo pensamientos suicidas', 'Me he hecho daño']) {
    const crisis = C.respond({ question });
    assert.equal(crisis.intent, 'crisis');
    assert.match(crisis.text, /emergencias/);
    assert.match(crisis.text, /confianza/);
    assert.equal(crisis.chunks.length, 0);
  }
  const dependence = C.respond({ ...corpus(), question: 'Solo te tengo a ti' });
  assert.equal(dependence.intent, 'emotional');
  assert.match(dependence.text, /fuera de esta pantalla/);
  assert.notEqual(C.respond({ ...corpus(), question: '¿Por qué Luna está triste en la novela?' }).intent, 'emotional');
});

test('los fragmentos largos conservan el término buscado y el texto del documento', () => {
  const text = 'Luna ' + 'bosque '.repeat(90) + 'llave luminosa en la torre. ' + 'nubes '.repeat(50);
  const excerpt = C.excerpt(text, C.topicTerms('llave', 'Luna'));
  assert.ok(excerpt.length <= 362);
  assert.match(excerpt, /llave luminosa/);
  assert.ok(text.includes(excerpt.replace(/^…|…$/g, '')));
});

test('una cita de personaje al final de una oración enorme está incluida en su fuente limitada', () => {
  const text = 'Luna camina. ' + 'bosque '.repeat(1400) + 'La llave luminosa está en la torre. ' + 'nubes '.repeat(100);
  const doc = { id: 'book', name: 'libro.pdf', pages: [{ pageNum: 1, sourcePage: 7, sentences: [{ id: 'long', text }] }] };
  const chunks = require('../js/chunks').fromDocument(doc);
  const result = C.respond({ question: '¿Qué pasó con la llave?', doc, name: 'Luna', index: R.rebuildFrom(chunks) });
  assert.equal(result.chunks[0].id, 'long');
  assert.equal(result.chunks[0].sourcePage, 7);
  assert.match(result.chunks[0].text, /llave luminosa/);
  assert.deepEqual(result.chunks[0].sentenceIds, ['long']);
  assert.equal(result.citations.allSupported, true);
});

test('una lectura cancelada no vuelve a agregar un libro después de un reset', async () => {
  const previous = global.NeuralStore;
  const added = [];
  global.NeuralStore = { addDocument: doc => added.push(doc) };
  let finish;
  const file = { name: 'novela.txt', text: () => new Promise(resolve => { finish = resolve; }) };
  const abort = new AbortController();
  try {
    const reading = P.handleFiles([file], { signal: abort.signal });
    abort.abort(); finish('Luna visita el jardín secreto.');
    const results = await reading;
    assert.equal(results[0].cancelled, true);
    assert.equal(added.length, 0);
  } finally { global.NeuralStore = previous; }
});
