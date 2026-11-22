const test = require('node:test');
const assert = require('node:assert/strict');
const paths = require('../js/spider-paths');

const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('trayectos entre paneles horizontales y verticales usan corredores en ambos sentidos', () => {
  const doc = box(10, 30, 200, 300), arena = box(230, 20, 500, 450);
  const p = paths.portals(doc, arena, { x: 80, y: 200 }, 5);
  assert.equal(p.direction, 'horizontal');
  assert.deepEqual(p.doc, { x: 198, y: 205 });
  assert.deepEqual(p.arena, { x: 242, y: 205 });
  assert.ok(p.bridge.right > p.bridge.left && p.bridge.bottom > p.bridge.top);
  assert.deepEqual(paths.route(doc, arena, { x: 80, y: 200 }, true, 5), [p.arena, p.doc, { x: 80, y: 200 }]);
  const reversed = paths.portals(arena, doc, { x: 400, y: 200 });
  assert.equal(reversed.direction, 'horizontal');
  assert.ok(reversed.doc.x > reversed.arena.x);

  const above = box(10, 30, 350, 160), below = box(10, 210, 350, 300);
  const v = paths.portals(above, below, { x: 999, y: 100 });
  assert.equal(v.direction, 'vertical');
  assert.equal(v.doc.x, 348);
  assert.ok(v.doc.y < v.arena.y);
  const reverseVertical = paths.portals(below, above, { x: 150, y: 400 });
  assert.equal(reverseVertical.direction, 'vertical');
  assert.ok(reverseVertical.doc.y > reverseVertical.arena.y);
  assert.deepEqual(paths.route(above, below, { x: 150, y: 320 }, false),
    [paths.portals(above, below, { x: 150, y: 320 }).doc, paths.portals(above, below, { x: 150, y: 320 }).arena, { x: 150, y: 320 }]);
});

test('distribución diagonal no crea un corredor inválido', () => {
  const doc = box(0, 0, 100, 100), arena = box(200, 200, 150, 150), target = { x: 40, y: 30 };
  assert.equal(paths.portals(doc, arena, target).direction, 'direct');
  assert.deepEqual(paths.route(doc, arena, target, true), [target]);
});

test('avance consume distancias sin saltos ni desbordamientos', () => {
  const point = { x: 0, y: 0 }, queue = [{ x: 3, y: 0 }, { x: 3, y: 4 }];
  let result = paths.advance(point, queue, 5);
  assert.deepEqual(point, { x: 3, y: 2 });
  assert.equal(result.done, false);
  assert.ok(Math.abs(result.angle - Math.PI / 2) < 1e-8);
  result = paths.advance(point, queue, 100);
  assert.deepEqual(point, { x: 3, y: 4 });
  assert.equal(result.done, true);
  assert.equal(queue.length, 0);
  const fixed = { x: 1, y: 1 };
  assert.equal(paths.advance(fixed, [{ x: 1, y: 1 }], -1).done, true);
  assert.deepEqual(fixed, { x: 1, y: 1 });
});
