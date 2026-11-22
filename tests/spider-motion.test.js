const test = require('node:test');
const assert = require('node:assert/strict');
const motion = require('../js/spider-motion');

function runRoute(dt) {
  const spider = { x: 0, y: 0, angle: 0, speed: 0 };
  const route = [{ x: 100, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 120 }];
  let elapsed = 0, crossedStraight = false, turnedInPlace = false, slowed = false;
  while (route.length && elapsed < 10) {
    const previous = { ...spider }, result = motion.step(spider, route, dt, { maxSpeed: 150 });
    elapsed += dt;
    assert.ok(result.distance <= 150 * dt + .02);
    assert.ok(result.turn <= 5 * dt + 1e-8);
    assert.ok(spider.x >= 0 && spider.x <= 150 && spider.y >= 0 && spider.y <= 120);
    assert.ok(Math.abs(spider.y) < 1e-6 || Math.abs(spider.x - 150) < 1e-6, 'no debe cortar la esquina');
    if (previous.x < 100 && spider.x >= 100) crossedStraight = spider.speed > 100;
    if (spider.x > 140 && spider.x < 150 && spider.speed < previous.speed) slowed = true;
    if (result.turn > .01 && result.distance === 0) turnedInPlace = true;
  }
  assert.equal(route.length, 0);
  assert.deepEqual({ x: spider.x, y: spider.y, speed: spider.speed }, { x: 150, y: 120, speed: 0 });
  assert.ok(crossedStraight, 'un portal recto no obliga a parar');
  assert.ok(slowed, 'frena antes de la esquina');
  assert.ok(turnedInPlace, 'gira gradualmente en vez de deslizarse por la esquina');
  return elapsed;
}

test('el recorrido acelera y frena, respeta las esquinas y es estable entre frecuencias', () => {
  const t30 = runRoute(1 / 30), t60 = runRoute(1 / 60), t120 = runRoute(1 / 120);
  assert.ok(Math.max(t30, t60, t120) - Math.min(t30, t60, t120) < .12);
});

test('el escáner alcanza cada palabra y conserva velocidad si la siguiente sigue en línea', () => {
  const spider = { x: 0, y: 0, angle: 0, speed: 0 };
  let result;
  for (let i = 0; i < 300; i++) {
    const route = [{ x: 80, y: 0 }, { x: 160, y: 0 }];
    result = motion.step(spider, route, 1 / 60, { maxSpeed: 150, stopAtFirst: true });
    if (result.reached) {
      assert.equal(spider.x, 80, 'no puede saltarse el centro de la palabra');
      assert.equal(route.length, 1);
      assert.ok(spider.speed > 100, 'la siguiente palabra está en línea');
      break;
    }
  }
  assert.equal(result.reached, 1);
  const route = [{ x: 80, y: 0 }, { x: 80, y: 50 }];
  result = motion.step(spider, route, 1 / 60, { stopAtFirst: true });
  assert.equal(result.reached, 1);
  assert.equal(spider.speed, 0, 'una esquina requiere reducir la velocidad');
});

test('el giro escoge el arco corto incluso al cruzar ±π y no mueve un reloj detenido', () => {
  const spider = { x: 0, y: 0, angle: Math.PI - .02, speed: 0 };
  const target = { x: -100, y: -2 }, route = [target];
  const before = { ...spider };
  motion.step(spider, route, 0);
  assert.deepEqual(spider, before);
  const result = motion.step(spider, route, .016);
  assert.ok(result.turn < .05, 'no recorre casi una vuelta completa');
  assert.ok(Math.abs(motion.angleDelta(spider.angle, Math.atan2(target.y, target.x))) < .001);
  assert.ok(spider.x < 0);
});
