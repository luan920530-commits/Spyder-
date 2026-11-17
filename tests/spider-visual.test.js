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

// Recupera los trazos realmente enviados al lienzo, no solo la pose calculada.
function drawnLegs(options) {
  const ctx = recordingContext(), paths = [];
  visual.draw(ctx, options);
  let current = [];
  for (const call of ctx.calls) {
    if (call[0] === 'beginPath') current = [];
    else if (call[0] === 'stroke') {
      if (current.length === 8 && current.every((part, i) => part[0] === (i % 2 ? 'lineTo' : 'moveTo'))) paths.push(current);
    } else if (['moveTo', 'lineTo', 'quadraticCurveTo', 'arc', 'ellipse', 'closePath'].includes(call[0])) current.push(call);
  }
  assert.equal(paths.length, 6, 'se dibujan tres segmentos por cada lado');
  return Array.from({ length: 8 }, (_, index) => {
    const side = Math.floor(index / 4), leg = index % 4;
    const segment = n => paths[side * 3 + n].slice(leg * 2, leg * 2 + 2).map(call => ({ x: call[1], y: call[2] }));
    const upper = segment(0), middle = segment(1), lower = segment(2);
    assert.deepEqual(upper[1], middle[0]);
    assert.deepEqual(middle[1], lower[0]);
    return { knee: upper[1], ankle: middle[1], foot: lower[1] };
  });
}

function diameter(points) {
  let maximum = 0;
  for (let i = 0; i < points.length; i++) for (let j = 0; j < i; j++) {
    maximum = Math.max(maximum, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
  }
  return maximum;
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

test('los pies en apoyo permanecen anclados al avanzar y alternan en grupos de cuatro', () => {
  const size = 10, cycle = visual.gaitCycleDistance(size), tau = Math.PI * 2;
  const before = visual.pose({ size, phase: .08 * tau, motion: 1 });
  const after = visual.pose({ size, phase: .14 * tau, motion: 1 });
  const displacement = .06 * cycle;
  before.legs.forEach((leg, i) => {
    assert.ok(leg.stance && after.legs[i].stance);
    assert.ok(Math.abs(leg.foot.x - (displacement + after.legs[i].foot.x)) < 1e-8, 'el pie apoyado no debe deslizarse');
    assert.ok(Math.abs(leg.foot.y - after.legs[i].foot.y) < 1e-8);
  });
  const a = visual.pose({ size, phase: .30 * tau, motion: 1 }).legs;
  const b = visual.pose({ size, phase: .80 * tau, motion: 1 }).legs;
  assert.equal(a.filter(leg => !leg.stance).length, 4);
  assert.equal(b.filter(leg => !leg.stance).length, 4);
  a.forEach((leg, i) => assert.notEqual(leg.stance, b[i].stance));
  const still = visual.pose({ size, phase: .80 * tau, motion: 0 });
  assert.ok(still.legs.every(leg => leg.stance && leg.lift === 0), 'al detenerse se posan las patas');
  assert.ok(still.legs.every((leg, i) => Math.abs(leg.foot.x - b[i].foot.x) < 1e-8), 'frenar no desplaza la huella longitudinal');
});

test('la reina tira de un hilo a la vez y los extremos son los puntos suministrados de su red', () => {
  const tau = Math.PI * 2, positions = [0.04, .29, .54, .79];
  const movingLegs = positions.map(p => {
    const legs = visual.pose({ queen: true, weaving: true, size: 20, phase: p * tau }).legs;
    assert.equal(legs.filter(leg => leg.tension > .01).length, 1);
    assert.ok(legs.filter(leg => leg.stance).length >= 6);
    const pulling = legs.find(leg => leg.tension > .01);
    const repositioning = legs.find(leg => (leg.index === 0 || leg.index === 3) && !leg.stance);
    if (repositioning) assert.notEqual(repositioning.side, pulling.side, 'se sostiene también por el lado opuesto');
    return pulling;
  });
  assert.equal(new Set(movingLegs.map(leg => `${leg.side}:${leg.index}`)).size, 4);
  const anchors = [{ x: 8, y: -20 }, { x: -11, y: -23 }, { x: 12, y: 21 }, { x: -9, y: 24 }];
  const ctx = recordingContext();
  visual.draw(ctx, { queen: true, weaving: true, size: 20, phase: 1, threadAnchors: anchors });
  assert.deepEqual(ctx.calls.filter(call => call[0] === 'quadraticCurveTo').map(call => ({ x: call[3], y: call[4] })), anchors);
});

test('la reina anima las ocho patas por turnos con apoyos y trayectorias continuas', () => {
  const size = 20, baseline = visual.pose({ queen: true, weaving: true, size, phase: 0 }).legs;
  const distances = new Array(8).fill(0), plantedFlex = new Array(8).fill(0), movingOuter = new Set();
  let previous = null;
  for (let frame = 0; frame <= 400; frame++) {
    const phase = frame / 400 * Math.PI * 2;
    const legs = visual.pose({ queen: true, weaving: true, size, phase }).legs;
    assert.ok(legs.filter(leg => leg.stance).length >= 6, 'no quedan más de dos patas sin apoyo');
    assert.ok([-1, 1].every(side => legs.filter(leg => leg.side === side && leg.stance).length >= 3));
    const outer = legs.filter(leg => (leg.index === 0 || leg.index === 3) && !leg.stance);
    const thread = legs.filter(leg => (leg.index === 1 || leg.index === 2) && !leg.stance);
    assert.ok(outer.length <= 1 && thread.length <= 1);
    if (outer.length && thread.length) assert.notEqual(outer[0].side, thread[0].side);
    for (const [i, leg] of legs.entries()) {
      const distance = Math.hypot(leg.foot.x - baseline[i].foot.x, leg.foot.y - baseline[i].foot.y);
      distances[i] = Math.max(distances[i], distance);
      if (leg.stance) {
        assert.ok(distance < 1e-8, 'el pie no se desliza mientras sostiene el cuerpo');
        plantedFlex[i] = Math.max(plantedFlex[i], Math.hypot(leg.knee.x - baseline[i].knee.x, leg.knee.y - baseline[i].knee.y));
      }
      if (previous) assert.ok(Math.hypot(leg.foot.x - previous[i].foot.x, leg.foot.y - previous[i].foot.y) < size * .025);
      if ((leg.index === 0 || leg.index === 3) && !leg.stance && leg.lift > .01) movingOuter.add(`${leg.side}:${leg.index}`);
      for (const point of [leg.root, leg.knee, leg.ankle, leg.foot]) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert.ok(Math.hypot(point.x, point.y) < size * 4);
      }
    }
    previous = legs;
  }
  assert.equal(movingOuter.size, 4, 'también se recolocan las cuatro patas exteriores');
  assert.ok(distances.every(distance => distance >= size * .299 && distance < size * .39), 'las ocho patas dan pasos visibles sin saltos grandes');
  for (const index of [0, 3, 4, 7]) {
    assert.ok(distances[index] > size * .36, `el paso exterior ${index} debe ser perceptible`);
    assert.ok(plantedFlex[index] > size * .22, `la rodilla exterior ${index} también flexiona entre pasos`);
  }
  for (const edge of [.015, .235, .25, .265, .485, .5, .515, .735, .75, .765, .985, 1]) {
    const left = visual.pose({ queen: true, weaving: true, size, phase: (edge - 1e-7) * Math.PI * 2 }).legs;
    const right = visual.pose({ queen: true, weaving: true, size, phase: (edge + 1e-7) * Math.PI * 2 }).legs;
    left.forEach((leg, i) => {
      assert.ok(Math.hypot(leg.foot.x - right[i].foot.x, leg.foot.y - right[i].foot.y) < .001);
      assert.ok(Math.abs(leg.lift - right[i].lift) < .001);
    });
  }
});

test('los ocho trazos dibujados de la reina se mueven visiblemente en ventanas cortas', () => {
  // Tamaño aproximado real en móvil; también se comprueba el tamaño de escritorio.
  for (const size of [15, 30]) {
    const frames = Array.from({ length: 301 }, (_, frame) => drawnLegs({
      queen: true, weaving: true, size, phase: frame / 30 * 2.6, time: frame / 30
    }));
    for (let start = 0; start + 45 < frames.length; start += 5) {
      for (let leg = 0; leg < 8; leg++) {
        const samples = frames.slice(start, start + 46).map(frame => frame[leg]);
        const motion = Math.max(diameter(samples.map(sample => sample.knee)), diameter(samples.map(sample => sample.foot)));
        assert.ok(motion > size * .2, `la pata dibujada ${leg} parece rígida desde el cuadro ${start}: ${motion}px`);
      }
    }
  }
});

test('las patas delanteras alternan la presión al masajear y el resto sostiene a la araña', () => {
  const first = visual.pose({ size: 10, phase: 1, massaging: true, massagePhase: Math.PI / 2 });
  const second = visual.pose({ size: 10, phase: 1, massaging: true, massagePhase: 3 * Math.PI / 2 });
  const a = first.legs.filter(leg => leg.index === 0), b = second.legs.filter(leg => leg.index === 0);
  assert.equal(a.length, 2);
  assert.ok(a[0].tension > .99 && a[1].tension < .01);
  assert.ok(b[0].tension < .01 && b[1].tension > .99);
  assert.notDeepEqual(a[0].foot, b[0].foot);
  const ctx = recordingContext();
  visual.draw(ctx, { size: 20, queen: true, angle: .8, headAngle: -.3 });
  const rotations = ctx.calls.filter(call => call[0] === 'rotate').map(call => call[1]);
  assert.equal(rotations[0], .8, 'el cuerpo gira alrededor de su posición');
  assert.equal(rotations.at(-1), -.3, 'la cabeza gira por separado sobre el cuello');
  assert.equal(ctx.calls.filter(call => call[0] === 'save').length, ctx.calls.filter(call => call[0] === 'restore').length);
});

test('durante el masaje se dibujan y reajustan las ocho patas sin deslizar los apoyos', () => {
  for (const size of [7, 10.6]) {
    const options = { size, phase: 1, motion: 0 }, baseline = visual.pose(options).legs;
    const poses = [], rendered = [], stepped = new Set();
    for (let frame = 0; frame <= 65; frame++) {
      const poseOptions = { ...options, massaging: true, massagePhase: frame / 30 * 8 };
      const legs = visual.pose(poseOptions).legs;
      poses.push(legs); rendered.push(drawnLegs(poseOptions));
      assert.ok(legs.filter(leg => leg.stance).length >= 5, 'solo dos delanteras y un apoyo se levantan a la vez');
      assert.ok([-1, 1].every(side => legs.filter(leg => leg.side === side && leg.stance).length >= 2));
      legs.forEach((leg, index) => {
        if (leg.index > 0 && leg.stance) assert.deepEqual(leg.foot, baseline[index].foot, 'el pie apoyado no se desliza');
        if (leg.index > 0 && !leg.stance) stepped.add(`${leg.side}:${leg.index}`);
        if (frame) assert.ok(Math.hypot(leg.foot.x - poses[frame - 1][index].foot.x,
          leg.foot.y - poses[frame - 1][index].foot.y) < size * .19, 'los pasos no saltan entre cuadros');
      });
    }
    assert.equal(stepped.size, 6, 'se recolocan todas las patas de apoyo');
    for (let index = 0; index < 8; index++) {
      const motion = diameter(rendered.map(frame => frame[index].foot));
      assert.ok(motion > size * .35, `el pie dibujado ${index} se mueve demasiado poco: ${motion}px`);
    }
  }
});

test('el gesto de masaje entra y sale desde la postura de marcha sin saltos', () => {
  const options = { size: 10, phase: 1.7, motion: .8, time: 2 };
  const still = visual.pose(options), initial = visual.pose({ ...options, massaging: true, massagePhase: 2.4, massageWeight: 0 });
  assert.deepEqual(initial, still, 'peso cero conserva exactamente la postura previa');
  let previous = initial.legs;
  for (let step = 1; step <= 100; step++) {
    const legs = visual.pose({ ...options, massaging: true, massagePhase: 2.4, massageWeight: step / 100 }).legs;
    legs.forEach((leg, index) => {
      for (const point of ['knee', 'ankle', 'foot']) {
        assert.ok(Math.hypot(leg[point].x - previous[index][point].x, leg[point].y - previous[index][point].y) < options.size * .04);
      }
    });
    previous = legs;
  }
});

test('la geometría de las articulaciones es finita y continua al apoyar y levantar', () => {
  const tau = Math.PI * 2, size = 10;
  for (let p = 0; p < 1; p += .01) {
    const legs = visual.pose({ size, phase: p * tau, motion: 1 }).legs;
    assert.equal(legs.length, 8);
    for (const leg of legs) {
      for (const point of [leg.root, leg.knee, leg.ankle, leg.foot]) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert.ok(Math.hypot(point.x, point.y) < size * 4);
      }
    }
  }
  for (const edge of [.68, 1]) {
    const left = visual.pose({ size, phase: (edge - .000001) * tau, motion: 1 }).legs[0];
    const right = visual.pose({ size, phase: (edge + .000001) * tau, motion: 1 }).legs[0];
    assert.ok(Math.hypot(left.foot.x - right.foot.x, left.foot.y - right.foot.y) < .001);
  }
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
