const test = require('node:test');
const assert = require('node:assert/strict');
const visual = require('../js/spider-visual');

function recordingContext() {
  const calls = [];
  const ctx = { calls, createRadialGradient: () => ({ addColorStop() {} }) };
  for (const name of ['save', 'restore', 'translate', 'rotate', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'stroke', 'fill', 'fillRect', 'ellipse', 'arc', 'closePath']) {
    ctx[name] = (...args) => calls.push([name, ...args]);
  }
  return ctx;
}

test('la reina y las arañas comparten ocho patas articuladas y cuerpos segmentados', () => {
  const queen = recordingContext(), worker = recordingContext();
  visual.draw(queen, { x: 20, y: 30, size: 20, color: '#bee8ff', core: '#ff5ab4', queen: true });
  visual.draw(worker, { x: 40, y: 50, size: 8, phase: 1, moving: true });
  assert.equal(queen.calls.filter(call => call[0] === 'ellipse').length, 5); // abdomen, tórax y anillos
  assert.equal(worker.calls.filter(call => call[0] === 'ellipse').length, 2);
  assert.ok(worker.calls.filter(call => call[0] === 'lineTo').length >= 18); // dos segmentos por pata y palpos
  assert.equal(queen.calls.filter(call => call[0] === 'save').length, queen.calls.filter(call => call[0] === 'restore').length);
  assert.notDeepEqual(queen.calls.find(call => call[0] === 'translate'), worker.calls.find(call => call[0] === 'translate'));
});

test('el paso articula las patas y la postura inmóvil es determinista', () => {
  const still = recordingContext(), stillAgain = recordingContext(), moving = recordingContext();
  visual.draw(still, { size: 10, time: 0 });
  visual.draw(stillAgain, { size: 10, time: 0 });
  visual.draw(moving, { size: 10, phase: 1, moving: true });
  assert.deepEqual(still.calls, stillAgain.calls);
  assert.notDeepEqual(still.calls.find(call => call[0] === 'lineTo'), moving.calls.find(call => call[0] === 'lineTo'));
});

test('la reina teje con ocho patas articuladas y cuatro hilos en fases repetibles', () => {
  const first = recordingContext(), next = recordingContext(), still = recordingContext();
  visual.draw(first, { size: 20, queen: true, weaving: true, phase: .2 });
  visual.draw(next, { size: 20, queen: true, weaving: true, phase: 1.5 });
  visual.draw(still, { size: 20, queen: true, weaving: true, phase: .2 });
  assert.equal(first.calls.filter(call => call[0] === 'quadraticCurveTo').length, 4);
  assert.equal(first.calls.filter(call => call[0] === 'lineTo').slice(0, 16).length, 16);
  assert.notDeepEqual(first.calls.filter(call => call[0] === 'lineTo').slice(0, 16), next.calls.filter(call => call[0] === 'lineTo').slice(0, 16));
  assert.deepEqual(first.calls, still.calls, 'si se congela la fase, se conserva la postura');
});

test('la señal de mando dibuja ondas expansivas sin despachar tareas', () => {
  const early = recordingContext(), late = recordingContext();
  visual.drawCommandWave(early, { x: 10, y: 20, maxRadius: 100, progress: .1 });
  visual.drawCommandWave(late, { x: 10, y: 20, maxRadius: 100, progress: .8 });
  const earlyRadii = early.calls.filter(call => call[0] === 'arc').map(call => call[3]);
  const lateRadii = late.calls.filter(call => call[0] === 'arc').map(call => call[3]);
  assert.equal(earlyRadii.length, 2);
  assert.ok(lateRadii[0] > earlyRadii[0]);
  assert.equal(early.calls.filter(call => call[0] === 'save').length, early.calls.filter(call => call[0] === 'restore').length);
});

test('los destellos de mando recorren solo las coordenadas de destinatarios suministrados', () => {
  const ctx = recordingContext();
  visual.drawCommandWave(ctx, { x: 10, y: 20, maxRadius: 100, progress: .5,
    targets: [{ id: 'una', x: 110, y: 60 }, { id: 'otra', x: 30, y: 120 }, { x: NaN, y: 0 }] });
  const arcs = ctx.calls.filter(call => call[0] === 'arc');
  assert.equal(arcs.length, 4, 'dos anillos y dos destinos válidos');
  assert.deepEqual(arcs[2].slice(1, 4), [60, 40, 2.4]);
  assert.deepEqual(arcs[3].slice(1, 4), [20, 70, 2.4]);
});
