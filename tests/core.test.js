const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/util');
const R = require('../js/retrieval');
const E = require('../js/embeddings');
const A = require('../js/analysis');
const SRS = require('../js/srs');
const P = require('../js/parsers');
const golden = require('./golden/corpus.json');

function hybrid(index, query, options = {}) {
  const parsed = R.parseQuery(query);
  index.queryVectorCache = { [query]: E.embedOne(parsed.cleaned) };
  return R.search(index, query, { queryConcepts: E.concepts(parsed.cleaned), ...options });
}

test('normalización, aritmética segura y markdown escapan contenido', () => {
  assert.equal(U.evaluateArithmetic('.5 + ,5'), 1);
  assert.equal(U.evaluateArithmetic('4 + ...2'), null);
  assert.equal(U.stem('definición'), U.stem('definicion'));
  assert.equal(U.stem('redes'), U.stem('red'));
  assert.equal(U.evaluateArithmetic('2+3*4'), 14);
  assert.equal(U.evaluateArithmetic('sqrt(16)+1'), 5);
  assert.equal(U.evaluateArithmetic('1/0'), null);
  assert.equal(U.evaluateArithmetic('alert(1)'), null);
  const html = U.safeMarkdown('**hola** <img src=x onerror=alert(1)> [1]');
  assert.match(html, /<strong>hola<\/strong>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.equal(U.isHeading('## Resultados'), true);
  assert.equal(U.isHeading('2. Conceptos principales'), true);
});

test('índice, filtros exactos, exclusión, erratas y ventana de contexto', () => {
  const sentences = [
    { id: 'a', docId: 'd1', docName: 'uno.txt', pageNum: 1, text: 'La sinapsis transmite señales entre neuronas mediante neurotransmisores.' },
    { id: 'b', docId: 'd1', docName: 'uno.txt', pageNum: 1, text: 'El axón conduce impulsos eléctricos desde la neurona.' },
    { id: 'c', docId: 'd1', docName: 'uno.txt', pageNum: 2, text: 'La sinapsis eléctrica usa una conexión directa.' },
    { id: 'd', docId: 'd2', docName: 'otro.txt', pageNum: 1, text: 'El consenso Raft usa un líder para replicar registros.' }
  ];
  const index = R.rebuildFrom(sentences); E.indexAll(index);
  assert.equal(R.stats(index).sentences, 4);
  assert.deepEqual(hybrid(index, '=doc:uno =pag:2 sinapsis', { diversify: false }).hits.map(h => h.sentence.id), ['c']);
  assert.deepEqual(hybrid(index, 'sinapsis -eléctrica', { diversify: false }).hits.map(h => h.sentence.id), ['a']);
  assert.deepEqual(hybrid(index, '"sinapsis eléctrica"', { diversify: false }).hits.map(h => h.sentence.id), ['c']);
  assert.equal(hybrid(index, '=doc:uno inexistentezaragoza').hits.length, 0);
  assert.ok(hybrid(index, 'sinapssis', { diversify: false }).hits.some(h => h.sentence.id === 'a'));
  const context = R.buildContext(index, [{ sentence: sentences[0], score: 1 }], { window: 1 });
  assert.match(context[0].text, /axón/);
  assert.doesNotMatch(context[0].text, /Raft/);
});

test('vector local y RRF encuentran un alias sin coincidencia léxica', () => {
  const index = R.rebuildFrom([
    { id: 'lat', docId: 'd', docName: 'd', pageNum: 1, text: 'La latencia media alcanza doce milisegundos.' },
    { id: 'bio', docId: 'd', docName: 'd', pageNum: 2, text: 'La mitocondria produce energía celular.' }
  ]);
  E.indexAll(index);
  const result = hybrid(index, 'demora', { diversify: false });
  assert.equal(result.hits[0].sentence.id, 'lat');
  assert.ok(result.hits[0].dense > 0);
  const v = E.embedOne('sinapsis neuronal');
  assert.ok(Math.abs(U.cosine(v, v) - 1) < 1e-6);
});

test('MiniLM reordena candidatos, exige señal más fuerte para los puramente semánticos y respeta filtros', () => {
  const index = R.rebuildFrom([
    { id: 'cat', docId: 'pets', docName: 'pets.txt', pageNum: 1, text: 'A cat sleeps on the sofa.' },
    { id: 'tree', docId: 'nature', docName: 'nature.txt', pageNum: 2, text: 'A tree grows in the garden.' }
  ]);
  const search = (query, scores) => R.search(index, query, { neuralScores: new Map(scores), diversify: false, fuzzy: false });
  assert.equal(search('feline napping couch', [['cat', .57], ['tree', .43]]).hits.length, 0);
  const semantic = search('feline napping couch', [['cat', .59], ['tree', .43]]);
  assert.deepEqual(semantic.hits.map(hit => hit.sentence.id), ['cat']);
  assert.equal(semantic.neuralUsed, true);
  assert.equal(semantic.neuralOnly, true);
  const lexical = search('cat', [['cat', .45]]);
  assert.equal(lexical.hits[0].neural, .45);
  assert.equal(lexical.neuralOnly, false);
  assert.equal(search('=doc:nature feline', [['cat', .99]]).hits.length, 0);
  assert.equal(search('feline -sofa', [['cat', .99]]).hits.length, 0);
});

test('verificación diferencia referencias válidas, débiles y fuera de rango', () => {
  const sources = [{ text: 'La sinapsis transmite señales neuronales entre neuronas.' }];
  const result = R.verifyCitations('La sinapsis transmite señales neuronales [1].\nOtro asunto [2].', sources);
  assert.equal(result.cited[0].supported, true);
  assert.deepEqual(result.unverified, [2]);
  assert.deepEqual(R.verifyCitations('La inflación sube [1].', sources).weak, [1]);
});

test('contradicciones numéricas detectadas y etiquetadas como posibles', () => {
  const claims = [
    { id: 'a', docName: 'a', pageNum: 1, text: 'La latencia de consulta del sistema es de 12 milisegundos.' },
    { id: 'b', docName: 'b', pageNum: 1, text: 'La latencia de consulta del sistema es de 40 milisegundos.' }
  ];
  const result = A.detectContradictions(claims);
  assert.ok(result.some(c => c.type === 'numeric' && c.a.value === 12 && c.b.value === 40));
});

test('tarjetas SRS conservan programación, lapsos y exportación CSV', () => {
  let card = SRS.newCard({ front: 'Pregunta', back: 'Respuesta con "comillas"', due: 1000 });
  card = SRS.review(card, 'good', 1000);
  assert.equal(card.box, 1);
  assert.ok(card.due > 1000);
  card = SRS.review(card, 'again', 2000);
  assert.equal(card.box, 0);
  assert.equal(card.lapses, 1);
  assert.match(SRS.ankiCsv([card]), /""comillas""/);
});

test('set dorado: recall@5 y preguntas trampa', () => {
  const index = R.rebuildFrom(golden.sentences); E.indexAll(index);
  let found = 0, n = 0, traps = 0, answeredTraps = 0;
  for (const item of golden.questions) {
    const hits = hybrid(index, item.query, { k: 5 }).hits;
    if (item.expected) { n++; if (hits.some(h => h.sentence.id === item.expected)) found++; }
    else { traps++; if (hits.length) answeredTraps++; }
  }
  assert.equal(n, 72);
  assert.equal(traps, 8);
  assert.ok(found / n >= 0.85, `recall@5=${found}/${n}`);
  assert.equal(answeredTraps, 0);
});

test('quiz propone opciones distintas del texto y la paginación conserva secciones', () => {
  const items = A.quizItems(golden.sentences, { n: 5, minLen: 35 });
  assert.ok(items.length >= 3);
  items.forEach(item => {
    assert.equal(new Set(item.options.map(U.normalize)).size, 4);
    assert.ok(item.options.includes(item.answer));
    assert.ok(item.prompt.includes('________'));
  });
  const pages = P.paginate('# Primera\nUna frase suficientemente clara.\n\n## Segunda\nOtra frase para estudiar.', 'd', 'nota');
  assert.equal(pages.length, 2);
  assert.equal(pages[1].section, 'Segunda');
  assert.match(P.parseHTMLText('<script>alert(1)</script><p>Dato &lt;seguro&gt;</p>'), /Dato <seguro>/);
  assert.doesNotMatch(P.parseHTMLText('<script>alert(1)</script><p>Texto</p>'), /alert/);
});
