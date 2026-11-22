const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const orbit = require('../js/orbit');
const { createApp, until } = require('./support/dom.cjs');

test('cámara XYZ: una pareja delante/detrás se separa al girar, con perspectiva, inclinación y zoom acotado', () => {
  const c = orbit.camera(), front = orbit.surface(.5, .5), back = orbit.surface(0, .5);
  const frame = () => c.frame(600, 450), initial = frame(), views = () => [front, back].map(frame().project);
  let [a,b] = views(); assert.ok(Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8);
  assert.ok(a.z > b.z && a.scale > b.scale); c.turn(Math.PI/2, 0); [a,b] = views();
  assert.ok(a.x > initial.cx + 100 && b.x < initial.cx - 100 && Math.abs(a.scale - b.scale) < 1e-8);
  c.turn(-Math.PI/2, 1e3); [a,b] = views(); assert.ok(a.y > b.y + 100);
  c.magnify(10); assert.equal(c.zoom, 1.3); c.magnify(-10); assert.equal(c.zoom, .7);
  c.reset(); assert.equal(c.zoom, 1); assert.deepEqual(frame().project(front), initial.project(front));
  assert.equal(frame(), frame()); assert.notEqual(frame().cx, c.frame(300, 500).cx);
});

test('en órbita, enlaces, inspección y destinos de arañas siguen la proyección; mover la cámara no cambia el corpus ni despacha', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true, true);
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const $ = s => w.document.querySelector(s), S = w.NeuralStore, G = w.NeuralGraph, stage = $('#arena-stage');
  const rect = { left: 20, top: 30, width: 600, height: 450, right: 620, bottom: 480 };
  stage.getBoundingClientRect = $('#neural-svg').getBoundingClientRect = () => rect;
  $('#btn-toggle-spiders').click();
  S.addDocument({ id: 'atlas', name: 'Atlas.pdf', pages: [{ pageNum: 1, sourcePage: 9, sentences: [{ id: 's', text: 'La cartografía representa caminos.' }] }] });
  const a = S.addPattern({ cluster: 'AGT-01', label: 'Mapa', pageNum: 1, text: 'La cartografía representa caminos.', sentenceId: 's' });
  G.recenter();
  const group = id => Array.from(w.document.querySelectorAll('.node-group')).find(n => n.__data__.id === id);
  const node = group(a.id), hub = group('AGT-01');
  const pos = n => n.getAttribute('transform').match(/translate\(([^,]+),([^\)]+)\)/).slice(1).map(Number);
  const transform = () => hub.getAttribute('transform');
  const stored = () => JSON.stringify([S.state.nodes, S.state.links, S.state.patterns, S.state.cards, S.state.tutorRuns]);
  const old = stored(), flat = transform(), dispatches = [];
  w.SpiderEngine.dispatchFromNetwork = payload => { dispatches.push(payload); return { sent: 0, reason: 'paused' }; };
  $('#btn-orbit').click(); await until(() => transform().includes('scale('));
  assert.equal($('#btn-orbit').getAttribute('aria-pressed'), 'true'); assert.equal(w.document.activeElement, stage);
  function pointer(kind, target, x, y, detail = 0) {
    const ev = new w.MouseEvent(kind, { clientX: x, clientY: y, button: 0, detail, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'pointerId', { value: 4 }); target.dispatchEvent(ev);
  }
  const upright = transform();
  pointer('pointerdown', hub, 100, 110); pointer('pointermove', hub, 140, 132); pointer('pointerup', hub, 140, 132); pointer('click', hub, 140, 132, 1);
  await until(() => transform() !== upright); assert.equal(dispatches.length, 0);
  assert.ok(!stage.classList.contains('orbit-dragging'));
  const [hx, hy] = pos(hub), [nx, ny] = pos(node);
  assert.deepEqual({ ...G.getHubScreenPos('AGT-01') }, { x: rect.left + hx, y: rect.top + hy });
  const idle = G.getIdleTarget(a.id, rect);
  assert.equal(idle.x, rect.left + nx); assert.equal(idle.y, rect.top + ny);
  const neighbor = idle.links.find(p => p.id === 'AGT-01'); assert.equal(neighbor.x, hx + rect.left); assert.equal(neighbor.y, hy + rect.top);
  const link = Array.from(w.document.querySelectorAll('.graph-link')).find(l => l.__data__.target.id === a.id);
  assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map(k => +link.getAttribute(k)), [hx, hy, nx, ny]);
  assert.equal(stored(), old);
  pointer('pointerdown', node, 100, 100); pointer('pointerup', node, 102, 99); pointer('click', node, 102, 99, 1);
  assert.equal($('#insp-label').textContent, 'Mapa'); assert.match($('#insp-citations').textContent, /Atlas.pdf · Pág 9/); assert.equal(dispatches.length, 0);
  $('#btn-close-inspector').click();
  hub.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual({ ...dispatches[0] }, { x: hx + rect.left, y: hy + rect.top, cluster: 'AGT-01' });
  const rotated = transform(); hub.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  await until(() => transform() !== rotated); assert.equal(dispatches.length, 1);
  pointer('pointerdown', node, 150, 110); pointer('pointermove', node, 180, 130); pointer('pointercancel', node, 180, 130);
  assert.ok(!stage.classList.contains('orbit-dragging')); assert.equal(dispatches.length, 1);
  G.setClusterFilter('AGT-02'); assert.equal(G.getIdleTarget(a.id, rect), null); G.setClusterFilter('AGT-02');
  $('[data-orbit-key="+"]').click(); assert.equal($('#orbit-zoom').textContent, '110 %');
  $('#btn-center-net').click(); await until(() => transform() === upright); assert.equal($('#orbit-zoom').textContent, '100 %');
  $('#btn-orbit').click(); await until(() => transform() === flat); assert.ok($('#orbit-controls').hidden);
});

test('sin D3 no se ofrece una cámara inoperante y la red conserva su alternativa textual', async t => {
  const { dom, w, errors } = await createApp(new IDBFactory(), false);
  t.after(() => dom.window.close()); assert.equal(w.document.querySelector('#btn-orbit').disabled, true);
  assert.match(w.document.querySelector('#graph-fallback').textContent, /D3 no disponible/); assert.deepEqual(errors, []);
});
