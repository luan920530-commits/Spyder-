const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/highlights');
const L = require('../js/passage-links');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, until } = require('./support/dom.cjs');

function atlas(docId = 'atlas') {
  return { id: docId, name: 'Apuntes.txt', pages: [
    ['Atlas incluye luna blanca.', 'Atlas indica clima frío.'],
    ['Atlas registra canto largo.', 'Lago contiene agua dulce.', 'Lago tiene peces rojos.'],
    ['Lago cubre rocas grises.', 'Triángulo equilátero.']
  ].map((lines, p) => ({ pageNum: p + 1, sourcePage: 7 + 2*p, text: lines.join(' '), sentences: lines.map((text, i) => ({ id: `${docId}:${p}:${i}`, text })) })) };
}

test('selector literal: segunda ocurrencia, Unicode, límites y anclas a ambos lados de una selección', () => {
  const doc = { id: 'A', name: 'a.pdf', pages: [{ sourcePage: 8, sentences: [
    { id: 'uno', text: '📖 Valor central, valor central.' }, { id: 'dos', text: 'Vale más aquí.' }
  ] }] };
  const page = H.indexPage(doc, 1), quote = 'central. Vale', start = page.text.indexOf(quote);
  const a = H.anchor(page, { start: start-1, end: start + quote.length + 1, quote: ` ${quote} ` });
  assert.deepEqual([a.sentenceId, a.selector.endSentenceId, a.sourcePage, a.selector.start, a.selector.quote], ['uno','dos',8,start,quote]);
  assert.deepEqual(H.resolve(page, a), a);
  for (const variant of [{ docId: 'B' }, { pageNum: 8 }, { sourcePage: 1 }, { sentenceId: 'otro' }, { selector: { ...a.selector, endSentenceId: 'otro' } }]) assert.equal(H.resolve(page, { ...a, ...variant }), null);
  for (const sel of [{ start: -1, end: 2, quote: 'XX' }, { start: NaN, end: 1, quote: 'X' }, { ...a.selector, quote: 'otra frase' }]) assert.equal(H.anchor(page, sel), null);
  doc.pages[0].sentences[1].sourcePage = 10;
  assert.equal(H.resolve(H.indexPage(doc, 1), a), null, 'no cruzar dos páginas físicas');
  assert.equal(H.indexPage({ ...doc, mediaType: 'image' }, 1), null);
  const long = 'x'.repeat(1201); doc.pages[0].sentences[0].text = long;
  assert.equal(H.anchor(H.indexPage(doc, 1), { start: 0, end: long.length, quote: long }), null);
});

test('un voto modifica pesos y también invierte el orden en un par NO visto, sin palabras ni anclas compartidas con el ejemplo', () => {
  const model = L.create(atlas()), [a,b,c,d,e,f] = ['0:0','0:1','1:0','1:1','1:2','2:0'].map(s => 'atlas:'+s);
  const ranked = id => model.suggest(id).map(l => l.id), baseline = model.info().weights;
  assert.deepEqual(ranked(a), [b,c]); assert.deepEqual(ranked(d), [e,f]);
  assert.equal(model.pair(a,d), null); assert.equal(model.pair(a,a), null); assert.deepEqual(model.suggest('atlas:2:1'), []);
  const before = model.pair(a,b).score, vote = { docId: 'atlas', a, b, useful: false };
  model.fit([vote]); assert.notDeepEqual(model.info().weights, baseline); assert.ok(model.pair(a,b).score < before);
  assert.deepEqual(ranked(d), [f,e]); assert.equal(model.pair(d,f).vote, null);
  model.fit([{ ...vote, useful: true }]); assert.ok(model.pair(a,b).score > before); assert.deepEqual(ranked(d), [e,f]);
  model.fit([{ ...vote, docId: 'otra' }]); assert.deepEqual(model.info().weights, baseline);
});

test('preguntas y modelo por ID: duplicados, correcciones, respaldo validado, aislamiento, olvido y restauración', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory()); t.after(() => dom.window.close());
  const S = w.NeuralStore; S.addDocument(atlas('otro')); const doc = S.addDocument(atlas());
  const page = H.indexPage(doc, 1), start = page.text.indexOf('luna');
  const a = H.anchor(page, { start, end: start + 4, quote: 'luna' });
  const card = S.addQuestion(a, '¿Qué incluye?'); assert.ok(card); assert.equal(card.back, 'luna');
  assert.equal(S.addQuestion(a, '¿Qué incluye?'), card); assert.equal(S.addQuestion(a, '  '), null);
  S.setActiveDoc('otro', 1); assert.equal(S.addQuestion(a, 'fuente equivocada'), null);
  const order = id => Array.from(S.relatedPassages(id), l => l.id);
  const held = 'atlas:1:1', baseline = order(held), isolated = order('otro:1:1');
  assert.ok(!S.rateRelation('atlas:0:0','otro:0:1',true)); assert.ok(!S.rateRelation('atlas:0:0',held,true));
  assert.ok(!S.rateRelation('atlas:0:0','atlas:0:1',1)); assert.ok(S.rateRelation('atlas:0:0','atlas:0:1',true));
  assert.ok(!S.rateRelation('atlas:0:1','atlas:0:0',true)); assert.ok(S.rateRelation('atlas:0:1','atlas:0:0',false));
  const learned = order(held); assert.notDeepEqual(learned, baseline); assert.deepEqual(order('otro:1:1'), isolated);
  const backup = await S.exportBrain(); assert.equal(backup.data.relationVotes.length, 1);
  assert.deepEqual(Object.keys(backup.data.relationVotes[0]).sort(), ['a','b','docId','useful']);
  await S.flush(); await S.init(); assert.deepEqual(order(held), learned); assert.equal(S.state.cards[0].selector.start, start);
  for (const mutate of [o => o.cards[0].selector.start++, o => { o.relationVotes[0].useful = 'yes'; }, o => { o.relationVotes[0].a = 'otro:0:0'; }]) {
    const bad = JSON.parse(JSON.stringify(backup)); mutate(bad.data); await assert.rejects(S.importBrain(bad), /Respaldo inválido/);
    assert.deepEqual(order(held), learned); assert.equal(S.state.cards[0].front, card.front);
  }
  S.removeDocument('atlas'); assert.equal(S.state.cards.length, 0); assert.equal(S.state.relationVotes.length, 0); assert.equal(order(held).length, 0);
  S.addDocument(atlas()); assert.deepEqual(order(held), baseline, 'reutilizar IDs no rescata preferencias eliminadas');
  await S.importBrain(backup); assert.deepEqual(order(held), learned); assert.equal(S.state.cards[0].back, 'luna');
  await S.resetAll({ keepMemory: true }); assert.equal(S.state.cards.length, 0); assert.equal(S.state.relationVotes.length, 0); assert.deepEqual(order(held), []);
  await S.importBrain({ data: { docs: [atlas()] } }); assert.deepEqual(order(held), baseline, 'un respaldo anterior no hereda ejemplos');
  assert.deepEqual(errors, []);
});

test('varias oraciones y solapes: foco preciso tras cambiar de libro/página; cerrar o retirar el libro descarta el borrador', async t => {
  const { dom, w } = await createApp(new IDBFactory()); t.after(() => dom.window.close());
  const S = w.NeuralStore, d = w.document; S.addDocument(atlas('otro')); const doc = S.addDocument(atlas());
  S.setActivePage(2); const page = H.indexPage(doc, 2);
  function save(quote) { const start = page.text.indexOf(quote); return S.addQuestion(H.anchor(page, { start, end: start + quote.length, quote }), 'Completa: '+quote[0]); }
  save('canto largo. Lago'); const card = save('largo. Lago contiene'); S.setActiveDoc('otro', 1);
  w.NCQuestionUI.showSource(card); await until(() => d.activeElement.matches('mark.quote-focus'));
  assert.equal([...d.querySelectorAll('mark.quote-focus')].map(n => n.textContent).join(''), card.back);
  assert.equal(d.querySelector('#doc-content').textContent, page.text);
  assert.equal(d.querySelector('#doc-content .word-span mark').closest('.word-span').textContent, 'canto');
  S.removeQuestion(card.id); await until(() => !d.querySelector('mark.quote-focus')); assert.equal([...d.querySelectorAll('mark')].map(n=>n.textContent).join(''), 'canto largo. Lago');
  d.getElementById('btn-question').click(); assert.ok(d.getElementById('question-dialog').open);
  d.getElementById('question-front').value = 'BORRADOR SIN GUARDAR'; S.removeDocument('atlas');
  assert.ok(!d.getElementById('question-dialog').open); assert.equal(d.getElementById('question-front').value, '');
  assert.doesNotMatch(JSON.stringify(await S.exportBrain()), /BORRADOR SIN GUARDAR/);
});

test('la ventana de entrenamiento excluye el ejemplo antiguo también en un modelo previamente consultado', async t => {
  const { dom, w } = await createApp(new IDBFactory()); t.after(() => dom.window.close());
  const S = w.NeuralStore, sentences = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, text: `Mapa con registro número ${i}.` }));
  const docs = [atlas(), { id: 'muchos', name: 'Mapas', pages: [{ sentences }] }], votes = [{ docId: 'atlas', a: 'atlas:0:0', b: 'atlas:0:1', useful: false }];
  for (let i = 0; i < 25; i++) for (let j = i+1; j < 25; j++) votes.push({ docId: 'muchos', a: `s${i}`, b: `s${j}`, useful: true });
  await S.importBrain({ data: { docs, relationVotes: votes.slice(0, L.MAX_VOTES) } });
  assert.equal(S.relatedPassages('atlas:1:1')[0].id, 'atlas:2:0');
  const next = votes[L.MAX_VOTES]; assert.ok(S.rateRelation(next.a, next.b, next.useful));
  assert.equal(S.state.relationVotes.length, L.MAX_VOTES); assert.equal(S.relatedPassages('atlas:1:1')[0].id, 'atlas:1:2');
  const otherCount = S.state.relationVotes.length; assert.equal(S.clearRelations('atlas'), false); assert.equal(S.state.relationVotes.length, otherCount);
  assert.ok(S.clearRelations('muchos')); assert.equal(S.state.relationVotes.length, 0);
});
