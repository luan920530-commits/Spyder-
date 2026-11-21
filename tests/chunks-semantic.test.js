const test = require('node:test');
const assert = require('node:assert/strict');
const Chunks = require('../js/chunks');
const R = require('../js/retrieval');
const E = require('../js/embeddings');
const C = require('../js/character');
const Semantic = require('../js/semantic-clusters');

function originalDoc() {
  return { id: 'doc', name: 'libro.pdf', pages: [
    { pageNum: 1, sourcePage: 2, section: 'Introducción', sentences: [
      { id: 'a', text: 'Primera oración sobre memoria.' },
      { id: 'b', text: 'Segunda oración sobre neuronas.' },
      { id: 'c', text: 'Tercera oración con una explicación.' },
      { id: 'd', text: 'Cuarta oración con una conclusión.' },
      { id: 'e', section: 'Otro tema', text: 'Un fragmento de otra sección.' }
    ] },
    { pageNum: 2, sourcePage: 3, section: 'Introducción', sentences: [
      { id: 'f', text: 'Texto de la página física siguiente.' }
    ] }
  ] };
}

test('ventanas de 2–3 oraciones solapadas mantienen anclas, secciones y páginas físicas', () => {
  const doc = originalDoc(), chunks = Chunks.fromDocument(doc);
  assert.deepEqual(chunks.map(c => c.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(chunks.map(c => c.parts.map(p => p.id)), [
    ['a', 'b'], ['a', 'b', 'c'], ['b', 'c', 'd'], ['c', 'd'], ['e'], ['f']
  ]);
  assert.ok(chunks[1].contextText.startsWith('Introducción\nPrimera oración'));
  assert.equal(chunks[1].sourceText, 'Segunda oración sobre neuronas.');
  assert.equal(chunks[1].sourcePage, 2);
  assert.equal(chunks[5].sourcePage, 3);
  assert.equal(doc.pages[0].sentences[1].text, 'Segunda oración sobre neuronas.', 'el visor conserva la oración original');
  chunks[1].harvested = true;
  assert.equal(doc.pages[0].sentences[1].harvested, true);
  const restored = Chunks.fromDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(restored.map(c => [c.id, c.text, c.sourcePage]), chunks.map(c => [c.id, c.text, c.sourcePage]));
  assert.equal(restored[1].harvested, true);
});

test('el contexto elimina solapamientos por ID y las exclusiones recortan vecinas sin perder el ancla permitida', () => {
  const doc = { id: 'd', name: 'd.txt', pages: [{ pageNum: 1, section: 'Notas', sentences: [
    { id: 's1', text: 'La memoria comienza aquí.' },
    { id: 's2', text: 'La memoria continúa en esta oración.' },
    { id: 's3', text: 'La naranja aparece en esta oración prohibida.' },
    { id: 's4', text: 'La memoria continúa más adelante.' },
    { id: 's5', text: 'El final contiene otra explicación.' }
  ] }] };
  const chunks = Chunks.fromDocument(doc), index = R.rebuildFrom(chunks);
  const context = R.buildContext(index, [{ sentence: chunks[1], score: 2 }, { sentence: chunks[3], score: 1 }], { window: 0 });
  assert.deepEqual(context.map(c => c.sentenceIds), [['s1', 's2', 's3'], ['s4', 's5']]);
  assert.equal(context.map(c => c.text).join(' ').match(/naranja/g).length, 1);
  assert.equal(context[1].id, 's4');
  const filters = R.parseQuery('memoria -naranja').filters;
  E.indexAll(index);
  const projected = R.projectExclusions(index, filters);
  assert.notEqual(projected, index);
  const safePos = projected.posById.get('s5');
  assert.equal(projected.vectors.get(safePos), index.vectors.get(index.posById.get('s5')), 'se reutiliza un vector determinista intacto');
  assert.equal(projected.vectors.has(projected.posById.get('s2')), false, 'un fragmento recortado se debe reindexar');
  E.indexAll(projected);
  assert.ok(projected.vectors.has(projected.posById.get('s2')));
  assert.ok(projected.sentences.some(c => c.id === 's2'), 'no se pierde una ancla válida por una vecina excluida');
  assert.ok(!projected.posById.has('s3'));
  assert.ok(projected.sentences.every(c => !c.text.includes('naranja')));
  const hits = R.search(projected, 'memoria -naranja', { fuzzy: false, diversify: false }).hits;
  const safe = R.buildContext(projected, hits, { window: 1, filters });
  assert.ok(safe.length);
  assert.ok(safe.every(c => !c.text.includes('naranja')));
  assert.equal(R.projectExclusions(index, R.parseQuery('memoria -noaparece').filters), index);
});

test('un contexto excesivo prioriza la oración ancla y solo declara las partes realmente incluidas', () => {
  const doc = { id: 'd', name: 'largo.txt', pages: [{ pageNum: 1, sentences: [
    { id: 'previous', text: 'Vecina muy extensa '.repeat(30) },
    { id: 'anchor', text: 'La cita ancla contiene la evidencia.' },
    { id: 'next', text: 'Vecina corta.' }
  ] }] };
  const chunks = Chunks.fromDocument(doc), index = R.rebuildFrom(chunks);
  const context = R.buildContext(index, [{ sentence: chunks[1], score: 1 }], { window: 0, maxChars: 80 });
  assert.equal(context[0].id, 'anchor');
  assert.match(context[0].text, /La cita ancla contiene la evidencia/);
  assert.deepEqual(context[0].sentenceIds, ['anchor', 'next']);
  assert.ok(context[0].text.length <= 80);
  assert.ok(!context[0].text.includes('Vecina muy extensa'));
  const largeAnchor = Chunks.fromDocument({ id: 'e', name: 'largo.txt', pages: [{ pageNum: 1,
    sentences: [{ id: 'long', text: 'Ancla '.repeat(2000) }] }] });
  const truncated = R.buildContext(R.rebuildFrom(largeAnchor), [{ sentence: largeAnchor[0], score: 1 }], { maxChars: 40 });
  assert.deepEqual(truncated[0].sentenceIds, ['long']);
  assert.ok(truncated[0].text.length <= 40);
  assert.match(truncated[0].text, /^Ancla /);
});

test('el personaje detecta la mención y continúa por el ancla original, sin repetir vecinas', () => {
  const doc = { id: 'book', name: 'book.txt', pages: [{ pageNum: 1, sentences: [
    { id: 'one', text: 'Luna guardó la llave de plata.' },
    { id: 'two', text: 'Después abrió la puerta del jardín.' },
    { id: 'three', text: 'La lluvia cubrió el camino.' }
  ] }] };
  const index = R.rebuildFrom(Chunks.fromDocument(doc));
  assert.deepEqual(C.profile(index, doc.id, 'Luna').mentions, [0]);
  const first = C.respond({ question: '¿Qué hizo con la llave?', doc, name: 'Luna', index });
  assert.equal(first.chunks[0].id, 'one');
  const history = [{ mode: 'conversacion', character: first.character, sources: [{ sentenceId: 'one' }] }];
  const next = C.respond({ question: '¿Y después?', doc, name: 'Luna', index, history });
  assert.equal(next.chunks[0].id, 'two');
  assert.match(next.reply.excerpt, /puerta del jardín/);
  assert.doesNotMatch(next.reply.excerpt, /llave de plata/);
});

test('los centroides usan coseno de vectores, no roles; valores inválidos y temas lejanos no se mezclan', () => {
  const c = Semantic.createClusterer({ maxTopics: 2 });
  assert.equal(c.add('a1', [1, 0, 0], 'Gatos dormidos'), true);
  assert.equal(c.add('a2', [.98, .05, 0], 'Felinos duermen'), true);
  assert.equal(c.add('b1', [0, 1, 0], 'Galaxias distantes'), true);
  assert.equal(c.add('b2', [.02, .99, 0], 'Estrellas y galaxias'), true);
  assert.equal(c.topicId('a1'), c.topicId('a2'));
  assert.equal(c.topicId('b1'), c.topicId('b2'));
  assert.notEqual(c.topicId('a1'), c.topicId('b1'));
  assert.equal(c.add('unrelated', [0, 0, 1], 'Finanzas'), true);
  assert.equal(c.topicId('unrelated'), Semantic.OTHER);
  assert.equal(c.add('invalid', [NaN, 0, 0], 'inválido'), false);
  assert.equal(c.add('zero', [0, 0, 0], 'inválido'), false);
  assert.equal(c.add('wrong-dimension', [1, 0], 'inválido'), false);
  assert.equal(c.add('a1', [0, 1, 0], 'duplicado'), false);
  assert.deepEqual(c.list().map(t => t.count), [2, 2, 1]);
  c.clear(); assert.equal(c.size(), 0); assert.deepEqual(c.list(), []);
});
