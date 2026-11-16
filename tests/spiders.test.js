const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');

function makeHarness() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="doc-dropzone"><div id="doc-content">
      <span class="sentence-block" data-sid="s1"><span class="word-span">Una</span> <span class="word-span">frase</span> <span class="word-span">real.</span></span>
      <span class="sentence-block" data-sid="s2"><span class="word-span">Otra</span> <span class="word-span">frase.</span></span>
    </div></div><div id="arena-stage"></div><canvas id="spider-canvas"></canvas>
    <button id="btn-mitosis"></button><button id="btn-toggle-spiders"></button>
    <input type="checkbox" id="chk-auto-page" checked><span id="stat-spiders"></span>
  </body>`, { url: 'https://local.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, callbacks = [], events = [];
  let now = 0, scroll = 0;
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
  w.matchMedia = () => ({ matches: true }); // modo accesible: fases sin movimiento prolongado
  const ctx = { measureText: text => ({ width: String(text).length * 6 }), createRadialGradient: () => ({ addColorStop() {} }) };
  ['arc', 'beginPath', 'clearRect', 'clip', 'closePath', 'ellipse', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo', 'rect', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform', 'stroke', 'strokeRect', 'translate'].forEach(name => { ctx[name] = () => {}; });
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
    getSetting(key, fallback) { return key === 'reduceMotion' ? true : fallback; },
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
  return { dom, w, store, sentences, events, shape, tick, setScroll: value => { scroll = value; } };
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
    assert.equal(assigned[1].phase, 'IR_A_PALABRA', 'se prioriza la especialidad elegida cuando está libre');
    assert.equal(new Set(assigned.map(sp => sp.sentenceId)).size, 2);
    assert.equal(h.store.state.claimedTargets.size, 2);
    const again = h.w.SpiderEngine.dispatchFromNetwork({ cluster: 'AGT-01' });
    assert.equal(again.sent, 0);
    assert.equal(again.reason, 'busy');
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
