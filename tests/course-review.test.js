const test = require('node:test');
const assert = require('node:assert/strict');
const example = require('../js/course-example');
const review = require('../js/course-review');
const skills = require('../js/study-skills');

test('banco de curso: propuestas reproducibles del tutor/quiz frente a referencias, sin dictámenes de fábrica', () => {
  const state = review.open(example);
  assert.equal(state.reviews.size, 0); assert.equal(state.cases.length, 6);
  assert.match(state.bank.license, /CC BY 4.0/);
  assert.deepEqual(review.open(structuredClone(example)).cases, state.cases);
  for (const [i, p] of state.cases.entries()) {
    const ref = state.bank.items[i]; assert.ok(ref.reference && ref.explanation && ref.question);
    const turn = skills.exercise({ id: ref.id, text: ref.passage }, 'recall');
    assert.equal(p.recall.prompt, turn.prompt); assert.equal(p.recall.answer, turn.answer);
    assert.equal(p.quiz.answer, turn.answer); assert.equal(new Set([p.quiz.answer, ...p.quiz.distractors]).size, 4);
    assert.ok(p.quiz.distractors.every(d => state.bank.items.some(it => it.passage.toLowerCase().includes(d.toLowerCase()))));
  }
});

test('solo un dictamen explícito cuenta; el informe vincula las opciones concretas con el caso y comprueba su vigencia al reabrir', () => {
  const state = review.open(example), p = state.cases[2];
  const entry = { cloze: 'si', distractors: 'no', guidance: 'no', note: 'Comparar la lista repetida con el doble de cada elemento.' };
  assert.throws(() => review.verdict({ ...entry, note: ' ' }, p), /orientación/);
  assert.throws(() => review.verdict({ ...entry, cloze: '' }, p), /criterio/);
  state.reviews.set(p.id, review.verdict(entry, p));
  const output = review.report(state); assert.equal(output.summary.reviewed, 1); assert.equal(output.summary.total, 6);
  assert.deepEqual(output.summary.distractors, { positive: 0, rated: 1 }); assert.equal(output.cases.filter(c => c.verdict === null).length, 5);
  assert.deepEqual(review.report(review.open(JSON.parse(JSON.stringify(output)))), output);
  output.cases[2].proposal.quiz.distractors.pop(); assert.throws(() => review.open(output), /propuestas cambiaron/);
});

test('importación acotada: procedencia obligatoria, IDs únicos, sin opciones inventadas ni denominador ficticio', () => {
  const one = { ...example, items: [{ ...example.items[0], passage: '2 + 2 = 4' }] };
  const state = review.open(one), p = state.cases[0]; assert.equal(p.recall, null); assert.equal(p.quiz, null);
  assert.throws(() => review.verdict({ cloze: 'si', distractors: 'si', guidance: 'si', note: '' }, p), /criterio/);
  state.reviews.set(p.id, review.verdict({ cloze: 'ausente', distractors: 'ausente', guidance: 'si', note: '' }, p));
  assert.deepEqual(review.summary(state).cloze, { positive: 0, rated: 0 });
  for (const bank of [null, { ...example, source: '' }, { ...example, items: [] }, { ...one, items: Array(25).fill(one.items[0]) },
    { ...one, items: [...one.items, ...one.items] }, { ...one, items: [{ ...one.items[0], explanation: 0 }] }]) assert.throws(() => review.open(bank));
});
