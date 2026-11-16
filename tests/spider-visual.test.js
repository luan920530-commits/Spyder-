const test = require('node:test');
const assert = require('node:assert/strict');
const visual = require('../js/spider-visual');

function recordingContext() {
  const calls = [];
  const ctx = { calls, createRadialGradient: () => ({ addColorStop() {} }) };
  for (const name of ['save', 'restore', 'translate', 'rotate', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillRect', 'ellipse', 'arc', 'closePath']) {
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
