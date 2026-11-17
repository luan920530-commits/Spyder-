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
  ['arc', 'beginPath', 'clip', 'closePath', 'ellipse', 'fill', 'fillRect', 'fillText', 'quadraticCurveTo', 'rect', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform', 'strokeRect', 'translate'].forEach(name => { ctx[name] = () => {}; });
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
  for (const name of ['util', 'spider-visual', 'spider-paths', 'spider-motion', 'spiders']) w.eval(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'));
  w.SpiderEngine.init();
  function tick(count = 1, step = 50) {
    for (let i = 0; i < count; i++) {
      const cb = callbacks.shift(); assert.ok(cb, 'el bucle debe programar el siguiente frame');
      now += step; cb(now);
    }
  }
  return { dom, w, store, sentences, events, shape, drawing, ctx, tick,
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
    const x = [], y = [], cells = new Set();
    for (let i = 0; i < 150; i++) {
      h.tick(20);
      for (const sp of h.w.SpiderEngine.getStatus().spiders) {
        x.push(sp.x); y.push(sp.y);
        cells.add(`${Math.min(3, Math.floor(sp.x / h.w.innerWidth * 4))}:${Math.min(2, Math.floor(sp.y / h.w.innerHeight * 3))}`);
      }
    }
    assert.ok(Math.max(...x) - Math.min(...x) > h.w.innerWidth * .60, 'el paseo debe alcanzar zonas alejadas en horizontal');
    assert.ok(Math.max(...y) - Math.min(...y) > h.w.innerHeight * .60, 'el paseo debe alcanzar zonas alejadas en vertical');
    assert.equal(cells.size, 12, 'el enjambre recorre las doce zonas de la pantalla');
    assert.ok(x.every(n => n >= 0 && n <= h.w.innerWidth));
    assert.ok(y.every(n => n >= 0 && n <= h.w.innerHeight));
    assert.ok(h.drawing.webStrokes > 100, 'se deben dibujar hilos de telaraña');
    assert.equal(h.store.state.patterns.length, 0);
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.events.filter(e => ['spider:scanStart', 'spider:extracted', 'spider:delivered'].includes(e.type)).length, 0);
    assert.ok(h.w.SpiderEngine.getStatus().spiders.every(sp => sp.phase === 'IDLE' && sp.sentenceId === null));
  } finally { h.dom.window.close(); }
});

test('una sola araña en reposo puede recorrer las doce zonas del viewport', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    h.w.Math.random = () => .5;
    const cells = new Set();
    for (let i = 0; i < 260; i++) {
      h.tick(20);
      const sp = h.w.SpiderEngine.getStatus().spiders[0];
      cells.add(`${Math.min(3, Math.floor(sp.x / h.w.innerWidth * 4))}:${Math.min(2, Math.floor(sp.y / h.w.innerHeight * 3))}`);
    }
    assert.equal(cells.size, 12);
    assert.equal(h.store.state.patterns.length, 0);
  } finally { h.dom.window.close(); }
});

test('en reposo visita y masajea nodos reales sin crear datos; pausa y reducción congelan el gesto', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    let present = true, lastDraw = null;
    const node = frame => ({ id: 'concepto-real', x: frame.left + 250, y: frame.top + 200,
      links: [{ id: 'hub-real', x: frame.left + 180, y: frame.top + 100 }] });
    h.w.NeuralGraph.getIdleTargets = frame => present ? [node(frame)] : [];
    h.w.NeuralGraph.getIdleTarget = (id, frame) => present && id === 'concepto-real' ? node(frame) : null;
    const draw = h.w.NCSpiderVisual.draw;
    h.w.NCSpiderVisual.draw = (ctx, options) => { lastDraw = { ...options }; return draw(ctx, options); };
    const arcs = [];
    h.ctx.arc = (x, y, radius) => { arcs.push({ x, y, radius }); };
    let ticks = 0;
    while (h.w.SpiderEngine.getStatus().spiders[0].idleActivity !== 'massage' && ticks++ < 400) h.tick();
    assert.ok(ticks < 400, 'la araña llega al nodo, se orienta y empieza el masaje');
    const status = h.w.SpiderEngine.getStatus().spiders[0];
    assert.equal(status.phase, 'IDLE');
    assert.equal(status.idleNodeId, 'concepto-real');
    assert.equal(lastDraw.massaging, true);
    assert.equal(lastDraw.massageWeight, 0, 'el gesto empieza en la postura de marcha');
    assert.ok(arcs.some(arc => arc.x === 580 && arc.y === 220 && arc.radius >= 4), 'la onda nace sobre el nodo del grafo');
    const phase = lastDraw.massagePhase;
    h.tick(8);
    assert.ok(lastDraw.massagePhase > phase, 'las patas alternan mientras presionan');
    assert.equal(lastDraw.massageWeight, 1, 'la presión entra gradualmente y llega a su amplitud completa');
    assert.ok(Math.hypot(h.w.SpiderEngine.getStatus().spiders[0].x - status.x, h.w.SpiderEngine.getStatus().spiders[0].y - status.y) < .1);

    h.w.document.getElementById('btn-toggle-spiders').click();
    const paused = h.w.SpiderEngine.getStatus(), pausedPhase = lastDraw.massagePhase;
    h.tick(50);
    assert.deepEqual(h.w.SpiderEngine.getStatus(), paused);
    assert.equal(lastDraw.massagePhase, pausedPhase);
    h.setScroll(80); h.tick();
    assert.equal(lastDraw.massaging, false, 'no se dibuja el contacto en un nodo que se desplazó');
    assert.deepEqual(h.w.SpiderEngine.getStatus(), paused, 'la araña pausada permanece en el viewport');
    h.setScroll(0); h.tick();
    assert.equal(lastDraw.massaging, true);
    h.w.document.getElementById('btn-toggle-spiders').click();
    h.setReduced(true); h.tick();
    const reduced = h.w.SpiderEngine.getStatus(), reducedPhase = lastDraw.massagePhase;
    h.tick(50);
    assert.deepEqual(h.w.SpiderEngine.getStatus(), reduced);
    assert.equal(lastDraw.massagePhase, reducedPhase);
    h.setReduced(false); present = false; h.tick();
    assert.notEqual(h.w.SpiderEngine.getStatus().spiders[0].idleActivity, 'massage', 'se abandona un nodo eliminado o filtrado');
    assert.equal(h.store.state.patterns.length, 0);
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.events.filter(event => ['spider:scanStart', 'spider:extracted', 'spider:delivered'].includes(event.type)).length, 0);
  } finally { h.dom.window.close(); }
});

test('la transición del masaje se completa sin saltos al entrar, pausar y salir', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    const node = frame => ({ id: 'nodo', x: frame.left + 250, y: frame.top + 200, links: [] });
    h.w.NeuralGraph.getIdleTargets = frame => [node(frame)];
    h.w.NeuralGraph.getIdleTarget = (id, frame) => id === 'nodo' ? node(frame) : null;
    let lastDraw;
    const draw = h.w.NCSpiderVisual.draw;
    h.w.NCSpiderVisual.draw = (ctx, options) => { lastDraw = { ...options }; return draw(ctx, options); };
    let ticks = 0;
    while (h.w.SpiderEngine.getStatus().spiders[0].idleActivity !== 'massage' && ticks++ < 400) h.tick();
    assert.ok(ticks < 400);
    assert.equal(lastDraw.massageWeight, 0);
    h.tick();
    assert.ok(lastDraw.massageWeight > 0 && lastDraw.massageWeight < 1);
    const pausedWeight = lastDraw.massageWeight;
    h.w.document.getElementById('btn-toggle-spiders').click(); h.tick(20);
    assert.equal(lastDraw.massageWeight, pausedWeight, 'la transición no avanza mientras está pausada');
    h.w.document.getElementById('btn-toggle-spiders').click();
    const weights = [pausedWeight];
    while (h.w.SpiderEngine.getStatus().spiders[0].idleActivity === 'massage' && weights.length < 100) {
      h.tick(); weights.push(lastDraw.massageWeight);
    }
    assert.ok(weights.includes(1));
    assert.equal(weights.at(-1), 0);
    assert.ok(weights.at(-2) < .1, 'el gesto vuelve gradualmente a la marcha');
    weights.forEach((weight, index) => {
      if (index) assert.ok(Math.abs(weight - weights[index - 1]) < .23, 'la mezcla cambia suavemente entre cuadros');
    });
  } finally { h.dom.window.close(); }
});

test('alterna visitas a distintos nodos con recorridos por el resto de la pantalla', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    h.w.Math.random = () => .25;
    const points = frame => [
      { id: 'uno', x: frame.left + 150, y: frame.top + 180, links: [] },
      { id: 'dos', x: frame.left + 300, y: frame.top + 200, links: [] }
    ];
    h.w.NeuralGraph.getIdleTargets = frame => points(frame);
    h.w.NeuralGraph.getIdleTarget = (id, frame) => points(frame).find(node => node.id === id) || null;
    let first = null, second = null, travelled = false;
    for (let i = 0; i < 1400; i++) {
      h.tick();
      const spider = h.w.SpiderEngine.getStatus().spiders[0];
      if (spider.idleActivity === 'massage' && !first) first = spider.idleNodeId;
      if (first && spider.idleActivity === 'travel') travelled = true;
      if (travelled && spider.idleActivity === 'massage' && spider.idleNodeId !== first) { second = spider.idleNodeId; break; }
    }
    assert.ok(first && second && first !== second);
    assert.equal(travelled, true);
    assert.equal(h.store.state.patterns.length, 0);
  } finally { h.dom.window.close(); }
});

test('si el nodo se desplaza, la araña vuelve a acercarse antes de seguir masajeando', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    let shift = 0;
    const point = frame => ({ id: 'movil', x: frame.left + 200 + shift, y: frame.top + 200, links: [] });
    h.w.NeuralGraph.getIdleTargets = frame => [point(frame)];
    h.w.NeuralGraph.getIdleTarget = (id, frame) => id === 'movil' ? point(frame) : null;
    let ticks = 0;
    while (h.w.SpiderEngine.getStatus().spiders[0].idleActivity !== 'massage' && ticks++ < 400) h.tick();
    assert.ok(ticks < 400);
    const before = h.w.SpiderEngine.getStatus().spiders[0];
    shift = 80; h.tick();
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].idleActivity, 'node-travel');
    ticks = 0;
    while (h.w.SpiderEngine.getStatus().spiders[0].idleActivity !== 'massage' && ticks++ < 400) h.tick();
    assert.ok(ticks < 400);
    const after = h.w.SpiderEngine.getStatus().spiders[0];
    assert.ok(after.x - before.x > 70);
    assert.equal(after.idleNodeId, 'movil');
    assert.equal(h.store.state.patterns.length, 0);
  } finally { h.dom.window.close(); }
});

test('una tarea real interrumpe el masaje sin alterar la reserva ni la fuente', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    const point = frame => ({ id: 'real', x: frame.left + 250, y: frame.top + 200, links: [] });
    h.w.NeuralGraph.getIdleTargets = frame => [point(frame)];
    h.w.NeuralGraph.getIdleTarget = (id, frame) => id === 'real' ? point(frame) : null;
    let ticks = 0;
    while (h.w.SpiderEngine.getStatus().spiders[0].idleActivity !== 'massage' && ticks++ < 400) h.tick();
    assert.ok(ticks < 400);
    h.store.state.allSentences = [h.sentences[0]];
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    h.tick();
    const sp = h.w.SpiderEngine.getStatus().spiders[0];
    assert.equal(sp.phase, 'IR_A_PALABRA');
    assert.equal(sp.sentenceId, 's1');
    assert.equal(sp.idleActivity, null);
    assert.equal(h.store.state.claimedTargets.has('s1'), true);
    assert.equal(h.store.state.patterns.length, 0);
    h.setReduced(true); h.tick(6);
    assert.equal(h.store.state.patterns.length, 1);
    assert.equal(h.store.state.patterns[0].sentenceId, 's1');
    assert.equal(h.store.state.claimedTargets.size, 0);
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

test('el escaneo normal sigue palabras y saltos de línea sin saltar, incluso con scroll interno', () => {
  const h = makeHarness({ reduced: false });
  try {
    const zone = h.w.document.getElementById('doc-dropzone');
    const words = [...h.w.document.querySelectorAll('[data-sid="s1"] .word-span')];
    const geometry = [{ x: 40, y: 60, width: 25 }, { x: 220, y: 60, width: 30 }, { x: 40, y: 320, width: 40 }];
    words.forEach((word, i) => {
      word.getBoundingClientRect = () => {
        const { x, y, width } = geometry[i], top = y - zone.scrollTop;
        return { left: x, right: x + width, top, bottom: top + 15, width, height: 15 };
      };
      word.getClientRects = () => [word.getBoundingClientRect()];
    });
    h.store.state.allSentences = [h.sentences[0]];
    let latest, cargoLine;
    const draw = h.w.NCSpiderVisual.draw;
    h.w.NCSpiderVisual.draw = (ctx, options) => {
      const sp = h.w.SpiderEngine.getStatus().spiders[0];
      latest = { ...sp, angle: options.angle, legPhase: options.phase, motion: options.motion, time: options.time };
      return draw(ctx, options);
    };
    h.ctx.quadraticCurveTo = (cx, cy, x, y) => { cargoLine = { x, y }; };
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    for (let i = 0; i < 600 && h.w.SpiderEngine.getStatus().spiders[0].scanIndex < 0; i++) h.tick();
    assert.equal(latest.phase, 'EXTRAER_DATOS');
    assert.equal(latest.scanIndex, 0);
    assert.equal(words[0].classList.contains('word-scanning'), true);

    h.w.document.getElementById('btn-toggle-spiders').click();
    const before = { ...latest };
    zone.scrollTop = 30; h.tick();
    assert.equal(latest.y, before.y - 30, 'el lector sigue el texto cuando se desplaza el visor');
    assert.equal(latest.angle, before.angle);
    assert.equal(latest.legPhase, before.legPhase);
    h.store.emit('spider:queryVisual', { nodeIds: [] }); h.tick(5);
    assert.equal(latest.legPhase, before.legPhase);
    assert.equal(latest.angle, before.angle, 'una consulta no gira una araña pausada');
    assert.equal(h.store.state.claimedTargets.has('s1'), true);
    h.w.document.getElementById('btn-toggle-spiders').click();

    const visited = new Set([0]);
    let previous = { ...latest }, previousScroll = zone.scrollTop, observedAutoScroll = false;
    for (let i = 0; i < 1000 && latest.phase === 'EXTRAER_DATOS'; i++) {
      h.tick();
      const scrollDelta = zone.scrollTop - previousScroll;
      if (scrollDelta) observedAutoScroll = true;
      const distance = Math.hypot(latest.x - previous.x, latest.y - previous.y + scrollDelta);
      const angle = Math.abs(h.w.NCSpiderMotion.angleDelta(previous.angle, latest.angle));
      assert.ok(distance <= 150 * .05 + .02, `salto entre palabras: ${distance}`);
      assert.ok(angle <= 5 * .05 + 1e-8, `giro brusco: ${angle}`);
      if (distance < 1e-7 && angle < 1e-7) assert.equal(latest.legPhase, previous.legPhase, 'sin avance ni giro no hay paso');
      else assert.ok(latest.legPhase > previous.legPhase, 'el paso sigue el movimiento');
      if (latest.phase === 'EXTRAER_DATOS' && latest.scanIndex !== previous.scanIndex) {
        visited.add(latest.scanIndex);
        const r = words[latest.scanIndex].getBoundingClientRect();
        assert.ok(Math.abs(latest.x - (r.left + r.width / 2)) < .02);
        assert.ok(Math.abs(latest.y - (r.top + r.height / 2)) < .02);
        assert.ok(words[latest.scanIndex].classList.contains('word-scanning'));
      }
      previous = { ...latest }; previousScroll = zone.scrollTop;
    }
    assert.deepEqual([...visited], [0, 1, 2]);
    assert.ok(observedAutoScroll, 'se revela la palabra de la siguiente línea');
    assert.equal(latest.phase, 'ARRASTRAR_A_RED');
    assert.equal(h.w.document.querySelectorAll('.word-scanning,.word-scanned').length, 0);
    assert.equal(h.store.state.claimedTargets.has('s1'), true);

    // La cápsula solo existe durante una entrega real, sigue al cuerpo y se congela en pausa.
    let followed = 0, lagged = false;
    for (let i = 0; i < 20 && latest.phase === 'ARRASTRAR_A_RED'; i++) {
      cargoLine = null; h.tick();
      if (latest.phase !== 'ARRASTRAR_A_RED') break;
      assert.ok(cargoLine);
      const x = cargoLine.x, y = cargoLine.y + 8;
      assert.ok(Math.hypot(x, y) <= 46.01);
      if (Math.hypot(x + Math.cos(latest.angle) * 28, y + Math.sin(latest.angle) * 28) > .2) lagged = true;
      followed++;
    }
    assert.ok(followed > 2 && lagged, 'la carga acompaña el giro con retardo, sin desprenderse');
    h.w.document.getElementById('btn-toggle-spiders').click();
    const stopped = { ...latest }, line = { ...cargoLine };
    h.tick(20);
    assert.deepEqual(latest, stopped);
    assert.deepEqual(cargoLine, line);
    h.w.document.getElementById('btn-toggle-spiders').click();
    for (let i = 0; i < 1000 && !h.sentences[0].harvested; i++) h.tick();
    assert.equal(h.store.state.patterns.length, 1);
    assert.equal(h.store.state.patterns[0].sentenceId, 's1');
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.events.filter(e => e.type === 'spider:delivered').length, 1);
  } finally { h.dom.window.close(); }
});

test('una araña despachada desde el paseo regresa visible al panel antes de entrar al corredor', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [];
    let seed = 103;
    h.w.Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    let current;
    for (let i = 0; i < 5000; i++) {
      h.tick(); current = h.w.SpiderEngine.getStatus().spiders[0];
      if (current.x > 850 || current.y > 490) break;
    }
    assert.ok(current.x > 850 || current.y > 490, 'la araña debe estar fuera de los paneles');
    let clipped = false, stack = [], latest;
    h.ctx.save = () => stack.push(clipped);
    h.ctx.restore = () => { clipped = stack.pop() || false; };
    h.ctx.clip = () => { clipped = true; };
    const draw = h.w.NCSpiderVisual.draw;
    h.w.NCSpiderVisual.draw = (ctx, options) => { latest = { clipped, angle: options.angle, phase: options.phase }; return draw(ctx, options); };
    h.store.state.allSentences = [h.sentences[0]];
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    h.tick();
    assert.equal(latest.clipped, false, 'el regreso desde reposo permanece visible');
    assert.equal(h.store.state.claimedTargets.has('s1'), true);
    h.w.document.getElementById('btn-toggle-spiders').click();
    const paused = h.w.SpiderEngine.getStatus().spiders[0], pose = { ...latest };
    h.setScroll(40); h.tick(10);
    assert.deepEqual(h.w.SpiderEngine.getStatus().spiders[0], paused, 'la aproximación pertenece al viewport hasta entrar al panel');
    assert.deepEqual(latest, pose);
    h.w.document.getElementById('btn-toggle-spiders').click();
    let entered = false;
    for (let i = 0; i < 1000 && !entered; i++) { h.tick(); entered = latest.clipped; }
    assert.ok(entered, 'la tarea entra al área limitada antes de escanear');
    for (let i = 0; i < 1000 && !h.sentences[0].harvested; i++) h.tick();
    assert.equal(h.store.state.patterns.length, 1);
    assert.equal(h.store.state.claimedTargets.size, 0);
  } finally { h.dom.window.close(); }
});

test('un escaneo largo que sigue avanzando no pierde la reserva al superar 30 segundos', () => {
  const h = makeHarness({ reduced: false });
  try {
    const element = h.w.document.querySelector('[data-sid="s1"]');
    element.replaceChildren();
    const terms = Array.from({ length: 18 }, (_, i) => 'palabra' + (i + 1));
    h.sentences[0].text = terms.join(' ');
    terms.forEach((term, i) => {
      const word = h.w.document.createElement('span');
      word.className = 'word-span'; word.textContent = term;
      const left = i % 2 ? 260 : 40;
      word.getBoundingClientRect = () => ({ left, right: left + 20, top: 60, bottom: 75, width: 20, height: 15 });
      word.getClientRects = () => [word.getBoundingClientRect()]; element.appendChild(word);
    });
    h.store.state.allSentences = [h.sentences[0]];
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    let longScan = false;
    for (let i = 0; i < 2000 && !h.sentences[0].harvested; i++) {
      h.tick();
      if (i > 650 && h.w.SpiderEngine.getStatus().spiders[0].phase === 'EXTRAER_DATOS') {
        longScan = true;
        assert.equal(h.store.state.claimedTargets.has('s1'), true);
      }
    }
    assert.ok(longScan, 'la geometría obliga a escanear durante más de 30 segundos');
    assert.equal(h.events.filter(e => e.type === 'spider:scanStart').length, 1, 'no cancela ni reinicia una tarea en marcha');
    assert.equal(h.events.filter(e => e.type === 'spider:extracted').length, 1);
    assert.equal(h.events.filter(e => e.type === 'spider:delivered').length, 1);
    assert.equal(h.store.state.patterns.length, 1);
    assert.equal(h.store.state.claimedTargets.size, 0);
  } finally { h.dom.window.close(); }
});

test('una tarea sin elemento y sin progreso sigue liberando su reserva por tiempo de espera', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [h.sentences[0]];
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    h.w.document.querySelector('[data-sid="s1"]').remove();
    let cancelled = false;
    for (let i = 0; i < 700; i++) {
      h.tick();
      if (h.w.SpiderEngine.getStatus().spiders[0].phase === 'IDLE') { cancelled = true; break; }
    }
    assert.ok(cancelled);
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.store.state.patterns.length, 0);
  } finally { h.dom.window.close(); }
});

test('una caída de fotogramas usa subpasos acotados sin ralentizar ni saltar el recorrido', () => {
  const regular = makeHarness({ reduced: false }), slow = makeHarness({ reduced: false });
  try {
    const sample = h => {
      let pose = null, steps = [];
      const draw = h.w.NCSpiderVisual.draw, step = h.w.NCSpiderMotion.step;
      h.w.NCSpiderVisual.draw = (ctx, o) => { pose = { angle: o.angle, phase: o.phase }; return draw(ctx, o); };
      h.w.NCSpiderMotion.step = (sp, route, dt, o) => { steps.push(dt); return step(sp, route, dt, o); };
      h.store.state.allSentences = [h.sentences[0]];
      h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
      h.tick();
      const initial = { ...pose }; steps = [];
      return { pose: () => pose, initial, steps: () => steps };
    };
    const a = sample(regular), b = sample(slow);
    regular.tick(3, 50); slow.tick(1, 150);
    const first = regular.w.SpiderEngine.getStatus().spiders[0], second = slow.w.SpiderEngine.getStatus().spiders[0];
    assert.ok(Math.abs(first.x - second.x) < 1e-7 && Math.abs(first.y - second.y) < 1e-7);
    assert.ok(Math.abs(a.pose().angle - b.pose().angle) < 1e-7);
    assert.ok(Math.abs((a.pose().phase - a.initial.phase) - (b.pose().phase - b.initial.phase)) < 1e-7);
    assert.equal(b.steps().length, 3);
    assert.ok(b.steps().every(dt => dt <= .05));
    const before = { ...second }; slow.tick(1, 10000);
    const after = slow.w.SpiderEngine.getStatus().spiders[0];
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) <= 190 * .15 + .02, 'una interrupción larga no provoca un salto');
    assert.equal(regular.store.state.claimedTargets.has('s1'), true);
    assert.equal(slow.store.state.claimedTargets.has('s1'), true);
  } finally { regular.dom.window.close(); slow.dom.window.close(); }
});

test('con pocos fotogramas cada palabra escaneada se muestra al menos una vez', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.store.state.allSentences = [h.sentences[0]];
    const words = [...h.w.document.querySelectorAll('[data-sid="s1"] .word-span')];
    words.forEach((word, i) => {
      const left = 40 + i * 3;
      word.getBoundingClientRect = () => ({ left, right: left + 2, top: 60, bottom: 75, width: 2, height: 15 });
      word.getClientRects = () => [word.getBoundingClientRect()];
    });
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      h.tick(1, 150);
      const sp = h.w.SpiderEngine.getStatus().spiders[0];
      if (sp.phase === 'EXTRAER_DATOS' && sp.scanIndex >= 0) seen.add(sp.scanIndex);
      if (h.events.some(event => event.type === 'spider:extracted')) break;
    }
    assert.deepEqual([...seen], [0, 1, 2]);
    assert.equal(h.events.filter(event => event.type === 'spider:extracted').length, 1);
  } finally { h.dom.window.close(); }
});

test('cambio de página y redimensionado durante un escaneo normal liberan la página anterior y permiten entregar la nueva', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.w.document.getElementById('chk-auto-page').checked = false;
    h.w.SpiderEngine.setSpiderCount(3);
    let scanning;
    for (let i = 0; i < 1000; i++) {
      h.tick();
      scanning = h.w.SpiderEngine.getStatus().spiders.find(sp => sp.phase === 'EXTRAER_DATOS' && sp.scanIndex === 0);
      if (scanning) break;
    }
    assert.ok(scanning, 'debe comenzar la lectura real de la primera página');
    const oldElement = h.w.document.querySelector(`[data-sid="${scanning.sentenceId}"]`);
    assert.ok(oldElement.classList.contains('sentence-scanning'));
    h.w.document.getElementById('btn-toggle-spiders').click();
    const paused = h.w.SpiderEngine.getStatus(); h.tick(20);
    assert.deepEqual(h.w.SpiderEngine.getStatus(), paused);
    h.w.document.getElementById('btn-toggle-spiders').click();

    const next = { id: 's-page2', docId: 'd1', docName: 'd.txt', pageNum: 2,
      text: 'Una página nueva también debe llegar a la red.' };
    h.store.state.allSentences.push(next);
    h.store.setActivePage(2);
    assert.equal(h.store.state.claimedTargets.has(scanning.sentenceId), false);
    assert.equal(oldElement.classList.contains('sentence-scanning'), false);
    assert.equal(oldElement.querySelectorAll('.word-scanning,.word-scanned').length, 0);

    const element = h.w.document.createElement('span');
    element.className = 'sentence-block'; element.dataset.sid = next.id;
    next.text.split(' ').forEach((text, i) => {
      const word = h.w.document.createElement('span'); word.className = 'word-span'; word.textContent = text;
      const left = 40 + (i % 4) * 48, top = 60 + Math.floor(i / 4) * 32;
      word.getBoundingClientRect = () => ({ left, right: left + 25, top, bottom: top + 15, width: 25, height: 15 });
      word.getClientRects = () => [word.getBoundingClientRect()]; element.appendChild(word);
    });
    h.w.document.getElementById('doc-content').replaceChildren(element);
    Object.assign(h.shape.doc, { width: 250, height: 220 });
    Object.assign(h.shape.arena, { left: 280, width: 420, height: 380 });
    for (let i = 0; i < 1400 && !next.harvested; i++) h.tick();

    assert.equal(next.harvested, true, 'la nueva página vuelve a escanearse y entregarse');
    assert.deepEqual(h.store.state.patterns.map(p => p.sentenceId), ['s-page2']);
    assert.equal(h.events.filter(e => e.type === 'spider:scanStart' && e.payload.sentenceId === 's-page2').length, 1);
    assert.equal(h.events.filter(e => e.type === 'spider:delivered' && e.payload.sentenceId === 's-page2').length, 1);
    assert.equal(h.store.state.claimedTargets.size, 0);
  } finally { h.dom.window.close(); }
});

test('una araña que espera al escáner ocupado conserva su reserva mientras la otra avanza', () => {
  const h = makeHarness({ reduced: false });
  try {
    const element = h.w.document.querySelector('[data-sid="s1"]');
    element.replaceChildren();
    const terms = Array.from({ length: 18 }, (_, i) => 'palabra' + (i + 1));
    h.sentences[0].text = terms.join(' ');
    terms.forEach((term, i) => {
      const word = h.w.document.createElement('span');
      word.className = 'word-span'; word.textContent = term;
      const left = i % 2 ? 260 : 40;
      word.getBoundingClientRect = () => ({ left, right: left + 20, top: 60, bottom: 75, width: 20, height: 15 });
      word.getClientRects = () => [word.getBoundingClientRect()]; element.appendChild(word);
    });
    h.w.SpiderEngine.setSpiderCount(2);
    // Se reserva solo la primera frase inicialmente, para iniciar su escaneo
    // antes de que la segunda araña intente acceder al mismo visor.
    h.store.state.allSentences = [h.sentences[0]];
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    for (let i = 0; i < 1000 && h.w.SpiderEngine.getStatus().spiders[0].scanIndex < 0; i++) h.tick();
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'EXTRAER_DATOS');
    h.store.state.allSentences.push(h.sentences[1]);
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[1] });
    let longWait = false;
    for (let i = 0; i < 1600 && !h.sentences[1].harvested; i++) {
      h.tick();
      const spiders = h.w.SpiderEngine.getStatus().spiders;
      if (spiders[0].phase === 'EXTRAER_DATOS') {
        if (i > 700) longWait = true;
        assert.equal(spiders[1].sentenceId, 's2', 'no debe abandonar el objetivo mientras el escáner avanza');
        assert.equal(h.store.state.claimedTargets.has('s2'), true);
      }
    }
    assert.ok(longWait, 'la espera duró más de 30 segundos mientras avanzaba el escáner');
    assert.deepEqual(h.store.state.patterns.map(p => p.sentenceId).sort(), ['s1', 's2']);
    assert.equal(h.events.filter(e => e.type === 'spider:scanStart' && e.payload.sentenceId === 's2').length, 1);
    assert.equal(h.store.state.claimedTargets.size, 0);
  } finally { h.dom.window.close(); }
});

test('un escáner bloqueado libera su reserva y la araña que espera puede continuar', () => {
  const h = makeHarness({ reduced: false });
  try {
    h.w.document.getElementById('chk-auto-page').checked = false;
    h.w.SpiderEngine.setSpiderCount(2);
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    for (let i = 0; i < 1000 && h.w.SpiderEngine.getStatus().spiders[0].scanIndex < 0; i++) h.tick();
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'EXTRAER_DATOS');
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[1] });
    const words = h.w.document.querySelectorAll('[data-sid="s1"] .word-span');
    words[1].getClientRects = () => [];
    words[1].getBoundingClientRect = () => null; // No es posible alcanzar la siguiente palabra.
    // Evita nuevas reservas automáticas para observar solo las dos originales.
    h.store.getActiveDoc = () => null;
    for (let i = 0; i < 900 && h.store.state.claimedTargets.size; i++) h.tick();
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.ok(h.w.SpiderEngine.getStatus().spiders.every(sp => sp.phase === 'IDLE'));
    assert.deepEqual(h.store.state.patterns.map(p => p.sentenceId), ['s2'], 'se entrega solo la frase que pudo leerse');
    assert.equal(h.events.filter(e => e.type === 'spider:delivered').length, 1);
    assert.equal(h.w.document.querySelectorAll('.word-scanning,.sentence-scanning').length, 0);
  } finally { h.dom.window.close(); }
});

test('un fragmento solapado escanea sus oraciones originales sin duplicar el visor', () => {
  const h = makeHarness();
  try {
    const first = h.sentences[0], second = h.sentences[1];
    first.sourceText = first.text;
    first.parts = [{ id: first.id, text: first.text }, { id: second.id, text: second.text }];
    first.text = first.parts.map(part => part.text).join(' ');
    first.contextText = 'Sección\n' + first.text; first.section = 'Sección';
    h.store.state.allSentences = [first];
    h.store.emit('spider:dispatchToSentence', { sentence: first });
    h.tick();
    assert.equal(h.w.document.querySelectorAll('.sentence-scanning').length, 2);
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'EXTRAER_DATOS');
    h.tick();
    assert.equal(h.w.document.querySelectorAll('.sentence-scanning,.word-scanned,.word-scanning').length, 0);
    h.tick(2);
    assert.equal(h.store.state.patterns[0].text, 'Una frase real. Otra frase.');
    assert.equal(h.store.state.patterns[0].section, 'Sección');
    assert.equal(h.store.state.claimedTargets.size, 0);
  } finally { h.dom.window.close(); }
});

test('la guía vectorial espera en pausa, prioriza el primer hit y puede cancelarse sin reservas', () => {
  const h = makeHarness();
  try {
    h.sentences.forEach(sentence => { sentence.harvested = true; });
    h.w.document.getElementById('btn-toggle-spiders').click();
    h.store.emit('spider:queryStart', { requestId: 'q1' });
    h.store.emit('spider:queryVisual', { requestId: 'q1', method: 'minilm', hits: [
      { sentence: h.sentences[1], neural: .91 }, { sentence: h.sentences[0], neural: .75 }
    ] });
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'IDLE');
    assert.ok(h.events.some(e => e.type === 'spiders:queryGuidance' && e.payload.paused && e.payload.pending === 2));
    h.tick(5);
    h.w.document.getElementById('btn-toggle-spiders').click();
    h.tick();
    const sp = h.w.SpiderEngine.getStatus().spiders[0];
    assert.equal(sp.sentenceId, 's2');
    assert.ok(h.events.some(e => e.type === 'spiders:dispatched' && e.payload.source === 'query' && e.payload.method === 'minilm'));
    h.store.emit('spider:queryCancelled', { requestId: 'q1' });
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].phase, 'IDLE');
    assert.equal(h.store.state.claimedTargets.size, 0);
    assert.equal(h.w.document.querySelectorAll('.sentence-scanning,.word-scanning').length, 0);
    assert.equal(h.store.state.patterns.length, 0);
  } finally { h.dom.window.close(); }
});

test('una consulta no interrumpe otra lectura ni salta AUTO para buscar un candidato remoto', () => {
  const h = makeHarness();
  try {
    h.w.SpiderEngine.setSpiderCount(2);
    h.w.document.getElementById('chk-auto-page').checked = false;
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    const remote = { id: 'remote', docId: 'd2', docName: 'otro.txt', pageNum: 1, text: 'Un pasaje lejano.' };
    h.store.state.allSentences.push(remote);
    h.store.emit('spider:queryVisual', { requestId: 'q2', method: 'minilm', hits: [
      { sentence: remote, neural: .95 }, { sentence: h.sentences[1], neural: .8 }
    ] });
    const spiders = h.w.SpiderEngine.getStatus().spiders;
    assert.equal(spiders[0].sentenceId, 's1');
    assert.equal(spiders[1].sentenceId, 's2');
    assert.equal(h.store.state.activeDocId, 'd1');
    assert.equal(h.store.state.claimedTargets.has('remote'), false);
    h.store.emit('spider:queryCancelled', { requestId: 'q2' });
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].sentenceId, 's1');
    assert.equal(h.w.SpiderEngine.getStatus().spiders[1].phase, 'IDLE');
    assert.deepEqual([...h.store.state.claimedTargets], ['s1']);
  } finally { h.dom.window.close(); }
});

test('al seleccionar un tema semántico, el despacho filtra por tema y no por rol AGT', () => {
  const h = makeHarness();
  try {
    h.w.NCSemantic = { topicId: id => id === 's1' ? 'SEM-1' : 'SEM-2' };
    const destinations = [];
    h.w.NeuralGraph.getHubScreenPos = id => { destinations.push(id); return { x: 580, y: 245 }; };
    const result = h.w.SpiderEngine.dispatchFromNetwork({ cluster: 'SEM-2' });
    assert.equal(result.sent, 1);
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].sentenceId, 's2');
    assert.equal(h.w.SpiderEngine.getStatus().spiders[0].cluster, 'AGT-01');
    h.tick(4);
    assert.ok(destinations.includes('SEM-2'));
    assert.equal(h.store.state.patterns[0].sentenceId, 's2');
  } finally { h.dom.window.close(); }
});

test('borrar el chat libera la guía incluso después de responder, sin interrumpir una lectura manual', () => {
  const h = makeHarness();
  try {
    h.w.SpiderEngine.setSpiderCount(2);
    h.store.emit('spider:dispatchToSentence', { sentence: h.sentences[0] });
    h.store.emit('spider:queryVisual', { requestId: 'ya-respondida', method: 'local', hits: [
      { sentence: h.sentences[1], neural: 0 }
    ] });
    assert.deepEqual(Array.from(h.w.SpiderEngine.getStatus().spiders, s => s.sentenceId), ['s1', 's2']);
    h.store.emit('chat:clearing');
    const spiders = h.w.SpiderEngine.getStatus().spiders;
    assert.equal(spiders[0].sentenceId, 's1');
    assert.equal(spiders[1].phase, 'IDLE');
    assert.deepEqual([...h.store.state.claimedTargets], ['s1']);
    h.tick(4);
    assert.equal(h.store.state.patterns[0].sentenceId, 's1');
    assert.ok(!h.store.state.patterns.some(p => p.sentenceId === 's2'));
  } finally { h.dom.window.close(); }
});
