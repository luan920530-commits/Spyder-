const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');

function makeHarness(options = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="doc-dropzone"><div id="doc-content">
      <span class="sentence-block" data-sid="s1"><span class="word-span">Una</span> <span class="word-span">frase</span> <span class="word-span">real.</span></span>
      <span class="sentence-block" data-sid="s2"><span class="word-span">Otra</span> <span class="word-span">frase.</span></span>
    </div></div><div id="arena-stage"></div><canvas id="spider-canvas"></canvas>
    <button id="btn-mitosis"></button><button id="btn-toggle-spiders"></button>
    <input type="checkbox" id="chk-auto-page" checked><span id="stat-spiders"></span>
  </body>`, { url: 'https://local.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, callbacks = [], events = [];
  let now = 0, scroll = 0, reduced = options.reduced !== false;
  const shape = { doc: { left: 10, top: 30, width: 300, height: 250 }, arena: { left: 330, top: 20, width: 500, height: 450 } };
  const rect = r => ({ left: r.left, top: r.top - scroll, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top - scroll + r.height });
  Object.defineProperty(w, 'scrollY', { configurable: true, get: () => scroll });
  w.document.getElementById('doc-dropzone').getBoundingClientRect = () => rect(shape.doc);
  w.document.getElementById('arena-stage').getBoundingClientRect = () => rect(shape.arena);
  [...w.document.querySelectorAll('.word-span')].forEach((el, i) => {
    el.getBoundingClientRect = () => rect({ left: 40 + i * 30, top: 60, width: 25, height: 15 });
    el.getClientRects = () => [el.getBoundingClientRect()];
  });
  w.requestAnimationFrame = cb => { callbacks.push(cb); return callbacks.length; };
  w.setInterval = () => 1;
  w.matchMedia = () => ({ matches: reduced }); // modo accesible: fases sin movimiento prolongado
  const drawing = { webLines: [], webStrokes: 0 };
  const ctx = { measureText: text => ({ width: String(text).length * 6 }), createRadialGradient: () => ({ addColorStop() {} }) };
  ['arc', 'beginPath', 'clip', 'closePath', 'ellipse', 'fill', 'fillRect', 'fillText', 'rect', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform', 'strokeRect', 'translate'].forEach(name => { ctx[name] = () => {}; });
  ctx.clearRect = () => { drawing.webLines = []; };
  ctx.moveTo = (x, y) => { ctx.start = [x, y]; };
  ctx.lineTo = (x, y) => { ctx.end = [x, y]; };
  ctx.stroke = () => {
    if (ctx.strokeStyle === '#83cce0') { drawing.webStrokes++; drawing.webLines.push([ctx.start, ctx.end]); }
  };
  w.HTMLCanvasElement.prototype.getContext = () => ctx;

  const sentences = [
    { id: 's1', docId: 'd1', docName: 'd.txt', pageNum: 1, text: 'Una frase real.' },
    { id: 's2', docId: 'd1', docName: 'd.txt', pageNum: 1, text: 'Otra frase.' }
  ];
  const listeners = new Map();
  const store = {
    state: { allSentences: sentences, claimedTargets: new Set(), activeDocId: 'd1', activePage: 1,
      autoNavigationPausedUntil: 0, patterns: [], vault: [] },
    on(type, cb) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(cb); },
    emit(type, payload) { events.push({ type, payload }); for (const cb of listeners.get(type) || []) cb(payload); },
    getSetting(key, fallback) { return key === 'reduceMotion' ? reduced : fallback; },
    getActiveDoc() { return this.state.activeDocId ? { id: this.state.activeDocId } : null; },
    getSentence(id) { return this.state.allSentences.find(s => s.id === id) || null; },
    setActiveDoc(id, page) { this.state.activeDocId = id; this.state.activePage = page; this.emit('doc:pageChanged', { docId: id, pageNum: page }); },
    setActivePage(page) { this.state.activePage = page; this.emit('doc:pageChanged', { docId: this.state.activeDocId, pageNum: page }); },
    addPattern(pattern) { this.state.patterns.push(pattern); }
  };
  w.NeuralStore = store;
  w.DocViewer = { getSentenceElement: id => [...w.document.querySelectorAll('.sentence-block')].find(el => el.dataset.sid === id) || null, toast() {} };
  w.NeuralGraph = { getHubScreenPos: () => { const r = rect(shape.arena); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, highlightPath() {} };
  w.KimiAuxModel = { trainOnPattern() {} };
  w.NCMemory = { vaultAdd() {}, consolidate() {} };
  for (const name of ['util', 'spider-visual', 'spider-paths', 'spiders']) w.eval(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'));
  w.SpiderEngine.init();
  function tick(count = 1, step = 50) {
    for (let i = 0; i < count; i++) {
      const cb = callbacks.shift(); assert.ok(cb, 'el bucle debe programar el siguiente frame');
      now += step; cb(now);
    }
  }
  return { dom, w, store, sentences, events, shape, drawing, tick,
    setScroll: value => { scroll = value; }, setReduced: value => { reduced = value; } };
}

test('ciclo escanea palabras, transporta y entrega una vez; repetir no duplica', () => {
  const h = makeHarness();
  try {
    // Un clic explícito selecciona el pasaje que debe animarse.
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    assert.equal(h.store.state.claimedTargets.size, 1);
    h.tick();
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'EXTRAER_DATOS');
    assert.ok(h.w.document.querySelector('[data-sid="s1"].sentence-scanning'));
    h.tick();
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'ARRASTRAR_A_RED');
    assert.equal(h.w.document.querySelectorAll('.word-scanning,.word-scanned,.sentence-scanning').length, 0);
    h.tick(2);
    assert.equal(h.store.state.patterns.length, 1);
    assert.equal(h.sentences[0].harvested, true);
    assert.equal(h.store.state.claimedTargets.size, 0);
    const lifecycle = h.events.filter(e => e.type.startsWith('spider:') && ['spider:scanStart', 'spider:extracted', 'spider:delivered'].includes(e.type));
    assert.deepEqual(lifecycle.map(e => e.type), ['spider:scanStart', 'spider:extracted', 'spider:delivered']);
    assert.equal(lifecycle[1].payload.sentenceId, 's1');
    assert.equal(lifecycle[2].payload.fresh, true);
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    h.tick(4);
    assert.equal(h.store.state.patterns.length, 1);
    assert.equal(h.events.filter(e => e.type === 'spider:delivered').at(-1).payload.fresh, false);
  } finally { h.dom.window.close(); }
});

test('pausa conserva la fase y cambio de página o reset libera resaltado y reservas', () => {
  const h = makeHarness();
  try {
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    h.tick();
    h.w.document.getElementById('btn-toggle-spiders').click();
    const before = h.w.SpiderEngine.getStatus().spiders[0];
    h.tick(100);
    assert.equal(h.w.SpiderEngine.getStatus().paused, true);
    assert.deepEqual(h.w.SpiderEngine.getStatus().spiders[0], before);
    assert.equal(h.store.state.patterns.length, 0);
    h.store.state.activePage = 2;
    h.store.emit('doc:pageChanged', { docId: 'd1', pageNum: 2 });
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'IDLE');
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.w.document.querySelectorAll('.word-scanning,.word-scanned,.sentence-scanning').length, 0);
    h.store.state.allSentences = [];
    h.store.emit('system:reset');
    assert.equal(h.w.SpiderEngine.getStatus().paused, false);
    assert.equal(h.w.document.getElementById('btn-toggle-spiders').getAttribute('aria-label'), 'Pausar enjambre');
    assert.equal(h.w.SpiderEngine.getStatus().spiders.length, 1);
  } finally { h.dom.window.close(); }
});

test('quitar arañas o documentos cancela las reservas sin entregar datos borrados', () => {
  const h = makeHarness();
  try {
    h.w.SpiderEngine.setSpiderCount(2);
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[1] });
    assert.equal(h.store.state.claimedTargets.size, 2);
    h.w.SpiderEngine.setSpiderCount(1);
    assert.equal(h.store.state.claimedTargets.has('s2'), false);
    assert.equal(h.store.state.claimedTargets.has('s1'), true);
    h.tick(2);
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'ARRASTRAR_A_RED');
    h.store.state.allSentences = [];
    h.store.emit('doc:removed', { docId: 'd1' });
    h.tick(3);
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.store.state.patterns.length, 0);
  } finally { h.dom.window.close(); }
});

test('desplazamiento y redimensionado mantienen posiciones vinculadas al panel', () => {
  const h = makeHarness();
  try {
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    h.tick(); // sobre la primera palabra
    h.w.document.getElementById('btn-toggle-spiders').click();
    const before = h.w.SpiderEngine.getStatus().spiders[0];
    h.setScroll(40); h.tick();
    const scrolled = h.w.SpiderEngine.getStatus().spiders[0];
    assert.equal(scrolled.y, before.y - 40);
    h.shape.doc.width = 450; h.shape.doc.height = 300;
    h.tick();
    const resized = h.w.SpiderEngine.getStatus().spiders[0];
    const expectedX = h.shape.doc.left + (before.x - 10) / 300 * 450;
    assert.ok(Math.abs(resized.x - expectedX) < .01);
  } finally { h.dom.window.close(); }
});

test('despacho desde la red reserva pasajes reales sin interrumpir ni duplicar tareas', () => {
  const h = makeHarness();
  try {
    h.w.SpiderEngine.setSpiderCount(2);
    const result = h.w.SpiderEngine.dispatchFromNetwork({ cluster: 'AGT-02', x: 500, y: 250 });
    assert.equal(result.sent, 2);
    assert.equal(result.reason, 'sent');
    const assigned = h.w.SpiderEngine.getStatus().spiders;
    const dispatch = h.events.find(event => event.type === 'spiders:dispatched');
    assert.equal(dispatch.payload.source, 'network');
    assert.equal(dispatch.payload.count, assigned.length);
    assert.deepEqual(Array.from(dispatch.payload.spiderIds).sort(), Array.from(assigned, spider => spider.id).sort());
    assert.equal(assigned[1].phase, 'IR_A_PALABRA', 'se prioriza la especialidad elegida cuando está libre');
    assert.equal(new Set(assigned.map(sp => sp.sentenceId)).size, 2);
    assert.equal(h.store.state.claimedTargets.size, 2);
    const again = h.w.SpiderEngine.dispatchFromNetwork({ cluster: 'AGT-01' });
    assert.equal(again.sent, 0);
    assert.equal(again.reason, 'busy');
    assert.equal(h.events.filter(event => event.type === 'spiders:dispatched').length, 1, 'no hay onda por un despacho fallido');
    assert.deepEqual(h.w.SpiderEngine.getStatus().spiders, assigned);
    h.tick(8);
    assert.equal(h.store.state.patterns.length, 2);
    assert.equal(new Set(h.store.state.patterns.map(pattern => pattern.sentenceId)).size, 2);
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.w.SpiderEngine.dispatchFromNetwork().reason, 'complete');
  } finally { h.dom.window.close(); }
});

test('el despacho respeta pausa, AUTO, navegación retenida y ausencia de texto', () => {
  const h = makeHarness();
  try {
    h.w.document.getElementById('btn-toggle-spiders').click();
    assert.equal(h.w.SpiderEngine.dispatchFromNetwork().reason, 'paused');
    assert.equal(h.store.state.claimedTargets.size, 0);
    h.w.document.getElementById('btn-toggle-spiders').click();
    h.store.state.allSentences = [{ id: 'page2', docId: 'd1', pageNum: 2, text: 'Un pasaje de otra página.' }];
    h.w.document.getElementById('chk-auto-page').checked = false;
    assert.equal(h.w.SpiderEngine.dispatchFromNetwork().reason, 'unavailable');
    assert.equal(h.store.state.activePage, 1);
    h.w.document.getElementById('chk-auto-page').checked = true;
    h.store.state.autoNavigationPausedUntil = Date.now() + 30000;
    assert.equal(h.w.SpiderEngine.dispatchFromNetwork().reason, 'unavailable');
    assert.equal(h.store.state.claimedTargets.size, 0);
    h.store.state.autoNavigationPausedUntil = 0;
    assert.equal(h.w.SpiderEngine.dispatchFromNetwork().sent, 1);
    assert.equal(h.store.state.activePage, 2);
    assert.equal(h.store.state.claimedTargets.has('page2'), true);
    h.store.state.activePage = 1;
    h.store.emit('doc:pageChanged', { docId: 'd1', pageNum: 1 });
    assert.equal(h.store.state.claimedTargets.size, 0);
    h.store.state.allSentences = [];
    assert.equal(h.w.SpiderEngine.dispatchFromNetwork().reason, 'no-document');
  } finally { h.dom.window.close(); }
});

test('cada gesto despacha como máximo tres arañas libres y conserva los claims previos', () => {
  const h = makeHarness();
  try {
    h.store.state.allSentences = Array.from({ length: 6 }, (_, i) => ({
      id: 'real-' + i, docId: 'd1', docName: 'd.txt', pageNum: 1, text: 'Un pasaje auténtico número ' + i
    }));
    h.w.SpiderEngine.setSpiderCount(5);
    assert.equal(h.w.SpiderEngine.dispatchFromNetwork({ cluster: 'AGT-03' }).sent, 3);
    const first = h.w.SpiderEngine.getStatus().spiders.filter(sp => sp.sentenceId);
    assert.equal(first.length, 3);
    assert.ok(first.some(sp => sp.cluster === 'AGT-03'));
    assert.equal(h.w.SpiderEngine.dispatchFromNetwork({ cluster: 'AGT-02' }).sent, 2);
    const all = h.w.SpiderEngine.getStatus().spiders;
    assert.equal(new Set(all.map(sp => sp.sentenceId)).size, 5);
    assert.equal(h.store.state.claimedTargets.size, 5);
    first.forEach(previous => assert.equal(all.find(sp => sp.id === previous.id).sentenceId, previous.sentenceId));
  } finally { h.dom.window.close(); }
});

test('en reposo recorren el viewport y tejen solo trazos decorativos, sin alterar datos reales', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    // Secuencia reproducible para cubrir el viewport en vez de depender del azar.
    let seed = 391;
    h.w.Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    h.w.SpiderEngine.setSpiderCount(3);
    const x = [], y = [];
    for (let i = 0; i < 150; i++) {
      h.tick(20);
      for (const sp of h.w.SpiderEngine.getStatus().spiders) { x.push(sp.x); y.push(sp.y); }
    }
    assert.ok(Math.max(...x) - Math.min(...x) > h.w.innerWidth * .60, 'el paseo debe alcanzar zonas alejadas en horizontal');
    assert.ok(Math.max(...y) - Math.min(...y) > h.w.innerHeight * .60, 'el paseo debe alcanzar zonas alejadas en vertical');
    assert.ok(x.every(n => n >= 0 && n <= h.w.innerWidth));
    assert.ok(y.every(n => n >= 0 && n <= h.w.innerHeight));
    assert.ok(h.drawing.webStrokes > 100, 'se deben dibujar hilos de telaraña');
    assert.equal(h.store.state.patterns.length, 0);
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.events.filter(e => ['spider:scanStart', 'spider:extracted', 'spider:delivered'].includes(e.type)).length, 0);
    assert.ok(h.w.SpiderEngine.getStatus().spiders.every(sp => sp.phase === 'IDLE' && sp.sentenceId === null));
  } finally { h.dom.window.close(); }
});

test('pausa, pestaña oculta y movimiento reducido congelan el paseo y el tejido', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    let seed = 2025;
    h.w.Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    h.tick(300);
    assert.ok(h.drawing.webStrokes > 0);
    h.w.document.getElementById('btn-toggle-spiders').click();
    const paused = h.w.SpiderEngine.getStatus().spiders;
    const pausedWeb = JSON.stringify(h.drawing.webLines);
    h.tick(80);
    assert.deepEqual(h.w.SpiderEngine.getStatus().spiders, paused);
    assert.equal(JSON.stringify(h.drawing.webLines), pausedWeb);
    // Un reposo pertenece al viewport aunque la página se desplace.
    h.setScroll(80); h.tick();
    assert.deepEqual(h.w.SpiderEngine.getStatus().spiders, paused);
    h.w.document.getElementById('btn-toggle-spiders').click();
    h.setReduced(true);
    const reduced = h.w.SpiderEngine.getStatus().spiders;
    const reducedWeb = JSON.stringify(h.drawing.webLines);
    h.tick(80);
    assert.deepEqual(h.w.SpiderEngine.getStatus().spiders, reduced);
    assert.equal(JSON.stringify(h.drawing.webLines), reducedWeb);
    h.setReduced(false);
    Object.defineProperty(h.w.document, 'hidden', { configurable: true, value: true });
    h.tick(60);
    assert.deepEqual(h.w.SpiderEngine.getStatus().spiders, reduced);
    Object.defineProperty(h.w.document, 'hidden', { configurable: true, value: false });
    h.tick(40);
    assert.notDeepEqual(h.w.SpiderEngine.getStatus().spiders, reduced);
  } finally { h.dom.window.close(); }
});

test('un trabajo real interrumpe el tejido y conserva su reserva y fuente', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    let seed = 77;
    h.w.Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    h.tick(350);
    assert.ok(h.drawing.webStrokes > 0);
    h.store.state.allSentences = [h.sentences[0]];
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    assert.equal(h.store.state.claimedTargets.has('s1'), true);
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'IR_A_PALABRA');
    h.tick();
    assert.equal(h.drawing.webLines.length, 0, 'los hilos ficticios desaparecen mientras se procesa texto');
    h.setReduced(true);
    h.tick(5);
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.store.state.patterns.length, 1);
    assert.equal(h.store.state.patterns[0].sentenceId, 's1');
    assert.equal(h.store.state.patterns[0].text, h.sentences[0].text);
    assert.equal(h.events.filter(e => e.type === 'spider:delivered').length, 1);
    h.store.state.allSentences = [];
    h.setReduced(false);
    const before = h.w.SpiderEngine.getStatus().spiders[0];
    h.tick(40);
    assert.notDeepEqual(h.w.SpiderEngine.getStatus().spiders[0], before, 'el paseo se reanuda al terminar');
    assert.equal(h.store.state.patterns.length, 1, 'el reposo no añade patrones');
  } finally { h.dom.window.close(); }
});

test('la cosecha automática tiene prioridad sobre el reposo y el redimensionado mantiene la araña en pantalla', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    let seed = 551;
    h.w.Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    h.tick(100);
    assert.ok(h.drawing.webStrokes > 0);
    h.w.innerWidth = 320; h.w.innerHeight = 560;
    h.tick();
    let sp = h.w.SpiderEngine.getStatus().spiders[0];
    assert.ok(sp.x >= 0 && sp.x <= 320 && sp.y >= 0 && sp.y <= 560);
    h.store.state.allSentences = [h.sentences[0]];
    h.tick(8);
    sp = h.w.SpiderEngine.getStatus().spiders[0];
    assert.ok(['IR_A_PALABRA', 'EXTRAER_DATOS', 'ARRASTRAR_A_RED'].includes(sp.phase));
    assert.equal(sp.sentenceId, 's1');
    assert.equal(h.store.state.claimedTargets.has('s1'), true);
    assert.equal(h.drawing.webLines.length, 0);
    assert.equal(h.store.state.patterns.length, 0);
  } finally { h.dom.window.close(); }
});

test('los despachos automáticos y por pasaje identifican solo a las arañas realmente asignadas', () => {
  const auto = makeHarness();
  try {
    auto.tick();
    const event = auto.events.find(e => e.type === 'spiders:dispatched' && e.payload.source === 'auto');
    const assigned = auto.w.SpiderEngine.getStatus().spiders.filter(sp => sp.sentenceId);
    assert.ok(event);
    assert.equal(event.payload.count, 1);
    assert.deepEqual(Array.from(event.payload.spiderIds), Array.from(assigned, sp => sp.id));
  } finally { auto.dom.window.close(); }
  const manual = makeHarness();
  try {
    manual.store.emit('spider:dispatchToSentence', { sentence: manual.sentences[0] });
    const event = manual.events.find(e => e.type === 'spiders:dispatched' && e.payload.source === 'sentence');
    const assigned = manual.w.SpiderEngine.getStatus().spiders.filter(sp => sp.sentenceId);
    assert.ok(event);
    assert.equal(event.payload.count, 1);
    assert.deepEqual(Array.from(event.payload.spiderIds), Array.from(assigned, sp => sp.id));
    manual.store.emit('spider:dispatchToSentence', { sentence: manual.sentences[0] });
    assert.equal(manual.events.filter(e => e.type === 'spiders:dispatched').length, 1);
  } finally { manual.dom.window.close(); }
});
