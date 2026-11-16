const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..');
const scripts = ['util', 'retrieval', 'analysis', 'srs', 'db', 'embeddings', 'store', 'local-model', 'parsers', 'memory', 'providers', 'rag', 'kimi-aux-model', 'viewer', 'spider-visual', 'neural-graph', 'spider-paths', 'spiders', 'eval', 'brain-rag', 'study-bots', 'app'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fn()) return; await wait(20); }
  throw new Error('Tiempo agotado esperando condición');
}
function canvasContext() {
  const gradient = () => ({ addColorStop() {} });
  const ctx = { createRadialGradient: gradient, createLinearGradient: gradient, measureText: text => ({ width: String(text).length * 6 }) };
  ['arc', 'beginPath', 'bezierCurveTo', 'quadraticCurveTo', 'clearRect', 'clip', 'closePath', 'ellipse', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo', 'rect', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform', 'stroke', 'strokeRect', 'translate'].forEach(name => { ctx[name] = () => {}; });
  return ctx;
}
async function createApp(indexedDB, withD3 = false) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'https://local.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  const w = dom.window;
  Object.defineProperty(w, 'indexedDB', { value: indexedDB, configurable: true });
  w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  w.confirm = () => true;
  w.URL.createObjectURL = () => 'blob:https://local.test/fake';
  w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = canvasContext;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  if (withD3) w.eval(fs.readFileSync(path.join(root, 'vendor', 'd3', 'd3.min.js'), 'utf8'));
  for (const name of scripts) w.eval(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'));
  await until(() => w.document.documentElement.dataset.appReady === 'true');
  return { dom, w, errors };
}
function byText(w, selector, text) {
  return [...w.document.querySelectorAll(selector)].find(x => x.textContent.includes(text));
}

test('resumen global respeta filtros y no reintroduce texto excluido por contexto', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    w.document.getElementById('btn-toggle-spiders').click();
    w.NeuralStore.addDocument({ id: 'a', name: 'uno.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'a', text: 'La biología estudia los seres vivos y sus relaciones.' },
      { id: 'b', text: 'La biología marina estudia peces y océanos.' }
    ] }] });
    w.NeuralStore.addDocument({ id: 'b', name: 'dos.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'c', text: 'La química estudia los materiales y sus propiedades.' }
    ] }, { pageNum: 2, sentences: [
      { id: 'd', text: 'La química analiza reacciones entre diferentes sustancias.' }
    ] }] });
    const summary = await w.NCRag.ask('Resume el documento =doc:uno -marina');
    assert.ok(summary.sources.length);
    assert.ok(summary.sources.every(source => source.docName === 'uno.txt' && !source.text.includes('marina')));
    const page = await w.NCRag.ask('Resume el documento =doc:dos =pag:2');
    assert.ok(page.sources.length);
    assert.ok(page.sources.every(source => source.docName === 'dos.txt' && source.pageNum === 2));
    const absent = await w.NCRag.ask('Resume el documento =doc:inexistente');
    assert.equal(absent.sources.length, 0);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('el chat identifica evidencia exclusivamente semántica y conserva el fallback', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    w.document.getElementById('btn-toggle-spiders').click();
    w.document.getElementById('btn-load-demo').click();
    const id = w.NeuralStore.state.allSentences[0].id;
    w.NCLocalModel.info = () => ({ enabled: true });
    w.NCLocalModel.scores = async () => new w.Map([[id, .95]]);
    const semantic = await w.NCRag.ask('xyzzyplugh quasar');
    assert.equal(semantic.sources.length, 1);
    assert.match(semantic.text, /solo por similitud semántica/i);
    assert.ok(semantic.trace.some(line => line.includes('MiniLM ONNX')));
    w.NCLocalModel.scores = async () => { throw new Error('inferencia interrumpida'); };
    const fallback = await w.NCRag.ask('xyzzyplugh quasar');
    assert.equal(fallback.sources.length, 0);
    assert.ok(!fallback.trace.some(line => line.includes('MiniLM ONNX')));
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('flujo de interfaz: demo, XSS, chat, estudio y restauración local', async () => {
  const db = new IDBFactory();
  const first = await createApp(db), { w } = first;
  try {
    assert.equal(w.document.getElementById('agents-panel').classList.contains('hidden'), false);
    assert.equal(w.document.getElementById('panel-brain').classList.contains('hidden'), true);
    assert.doesNotMatch(w.document.body.textContent, /no hay comentarios todavía|haz clic en cualquier lugar del lienzo/i);
    w.document.getElementById('btn-load-demo').click();
    assert.equal(w.NeuralStore.state.docs.length, 2);
    assert.equal(w.NeuralStore.state.docs[0].pages.length, 3);
    w.document.getElementById('btn-mitosis').click();
    assert.equal(w.SpiderEngine.getStatus().spiders.length, 2);
    w.document.getElementById('btn-toggle-spiders').click();
    assert.equal(w.SpiderEngine.getStatus().paused, true);
    w.document.getElementById('btn-toggle-spiders').click();
    assert.equal(w.SpiderEngine.getStatus().paused, false);
    w.document.querySelector('[data-workspace="chat"]').click();
    assert.equal(w.document.getElementById('panel-brain').classList.contains('hidden'), false);
    assert.equal(w.document.getElementById('agents-panel').classList.contains('hidden'), true);
    const input = w.document.getElementById('chat-input');
    input.value = '¿Qué es una red neuronal?';
    w.document.getElementById('chat-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => w.NeuralStore.state.chat.length === 1);
    assert.match(w.NeuralStore.state.chat[0].text, /neurona artificial/i);
    assert.ok(w.document.querySelector('.cite-ref'));
    w.document.querySelector('.answer-body .cite-ref').click();
    assert.ok(w.NeuralStore.state.autoNavigationPausedUntil > Date.now(), 'una cita debe permanecer visible ante el avance automático');
    assert.equal(w.NeuralStore.state.activeDocId, w.NeuralStore.state.chat[0].sources[0].docId);
    w.document.querySelector('[aria-label="Respuesta útil"]').click();
    assert.equal(w.NeuralStore.state.feedback.length, 1);

    w.document.getElementById('btn-paste-modal').click();
    w.document.getElementById('paste-title').value = '<img src=x onerror="window.pwned=1">';
    w.document.getElementById('paste-body').value = 'Evidencia única <img src=x onerror="window.pwned=1"> que debe mostrarse como texto.';
    w.document.getElementById('btn-confirm-paste').click();
    await wait(50);
    input.value = 'evidencia única';
    w.document.getElementById('chat-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => w.NeuralStore.state.chat.length === 2);
    assert.equal(w.pwned, undefined);
    assert.equal(w.document.querySelectorAll('img[src="x"]').length, 0);
    assert.match(w.document.getElementById('chat-messages').textContent, /<img/);
    w.NeuralStore.addPattern({ cluster: 'AGT-01', label: '<img src=x onerror="window.pwned=1">',
      text: 'El ticker contiene <img src=x onerror="window.pwned=1">.', pageNum: 1, sentenceId: w.NeuralStore.state.allSentences.at(-1).id });
    w.NCMemory.vaultAdd({ phrase: '<img src=x onerror="window.pwned=1">', detail: 'Nota local' });
    assert.equal(w.document.querySelectorAll('img[src="x"]').length, 0);
    assert.match(w.document.getElementById('ticker-list').textContent, /<img/);

    w.document.querySelector('[data-workspace="study"]').click();
    assert.equal(w.document.getElementById('tab-bots').classList.contains('active'), true);
    w.document.querySelector('[data-bot="flashcards"]').click();
    byText(w, '#bot-stage button', 'Generar').click();
    assert.ok(w.NeuralStore.state.cards.length > 0);
    byText(w, '#bot-stage button', 'Mostrar respuesta').click();
    byText(w, '#bot-stage button', 'Bien').click();
    assert.ok(w.NeuralStore.state.cards.some(c => c.box === 1));
    w.document.querySelector('[data-bot="quiz"]').click();
    byText(w, '#bot-stage button', 'Crear quiz').click();
    for (let i = 0; i < 5; i++) {
      w.document.querySelector('.quiz-option').click();
      byText(w, '#bot-stage button', i === 4 ? 'Terminar y guardar' : 'Siguiente').click();
    }
    assert.equal(w.NeuralStore.state.quizRuns.length, 1);
    w.document.querySelector('[data-bot="metrics"]').click();
    byText(w, '#bot-stage button', 'Evaluar corpus').click();
    await until(() => w.NeuralStore.state.evalRuns.length === 1);
    assert.match(w.document.getElementById('eval-results').textContent, /recall@5/);
    w.document.getElementById('btn-close-brain').click();
    assert.equal(w.document.getElementById('agents-panel').classList.contains('hidden'), false);
    await w.NeuralStore.savePersistent();
    assert.deepEqual(first.errors, []);
  } finally { first.dom.window.close(); }
  const second = await createApp(db);
  try {
    assert.equal(second.w.NeuralStore.state.docs.length, 3);
    assert.equal(second.w.NeuralStore.state.chat.length, 2);
    assert.equal(second.w.NeuralStore.state.feedback.length, 1);
    assert.ok(second.w.NeuralStore.state.cards.some(c => c.box === 1));
    assert.equal(second.w.NeuralStore.state.quizRuns.length, 1);
    assert.equal(second.w.NeuralStore.state.evalRuns.length, 1);
    assert.equal(second.w.document.querySelectorAll('img[src="x"]').length, 0);
    assert.deepEqual(second.errors, []);
  } finally { second.dom.window.close(); }
});

test('la red responde a puntero y teclado sin activar controles ni insertar nombres como HTML', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const stage = w.document.getElementById('arena-stage');
    stage.getBoundingClientRect = () => ({ left: 10, top: 20, right: 610, bottom: 420, width: 600, height: 400 });
    const mouse = (type, x, y) => new w.MouseEvent(type, { bubbles: true, clientX: x + 10, clientY: y + 20 });
    stage.dispatchEvent(mouse('pointermove', 114, 184));
    assert.match(w.document.getElementById('swarm-tip').textContent, /REINA · NC-00/);
    stage.dispatchEvent(mouse('click', 350, 200));
    assert.match(w.document.getElementById('swarm-feedback').textContent, /Carga un documento/);
    stage.dispatchEvent(new w.Event('pointerleave'));
    assert.ok(w.document.getElementById('swarm-tip').classList.contains('hidden'));

    w.document.getElementById('btn-toggle-spiders').click();
    w.NeuralStore.addDocument({ id: 'safe-doc', name: '<img src=x onerror="window.pwned=1">', pages: [{ pageNum: 1, text: 'Texto real.', sentences: [{ id: 'safe-sentence', text: 'Texto real.' }] }] });
    const status = w.SpiderEngine.getStatus;
    w.SpiderEngine.getStatus = () => ({ paused: false, spiders: [{ id: 'SPDR-01', role: 'DEF-AI', phase: 'EXTRAER_DATOS', cluster: 'AGT-01', x: 430, y: 270, sentenceId: 'safe-sentence' }] });
    stage.dispatchEvent(mouse('pointermove', 420, 250));
    assert.match(w.document.getElementById('swarm-tip').textContent, /<img/);
    assert.equal(w.document.querySelectorAll('#swarm-tip img').length, 0);
    assert.equal(w.pwned, undefined);
    w.SpiderEngine.getStatus = status;

    const calls = [];
    w.SpiderEngine.dispatchFromNetwork = options => { calls.push(options); return { sent: 1, reason: 'sent' }; };
    w.document.querySelector('.cluster-pill').click();
    w.document.querySelector('.arena-tools').dispatchEvent(mouse('click', 500, 20));
    w.document.getElementById('btn-close-inspector').click();
    assert.equal(calls.length, 0);
    stage.dispatchEvent(mouse('click', 360, 200));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cluster, 'AGT-01', 'el filtro activo se usa como preferencia');
    assert.match(w.document.getElementById('swarm-feedback').textContent, /1 araña enviada a pasajes reales/);
    stage.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    stage.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    assert.equal(calls.length, 3);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la preferencia de movimiento también se aplica al restaurar o reiniciar ajustes', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    w.NeuralStore.setSetting('reduceMotion', true);
    assert.ok(w.document.documentElement.classList.contains('motion-reduced'));
    const backup = JSON.parse(JSON.stringify(await w.NeuralStore.exportBrain()));
    w.NeuralStore.setSetting('reduceMotion', false);
    assert.equal(w.document.documentElement.classList.contains('motion-reduced'), false);
    await w.NeuralStore.importBrain(backup);
    assert.ok(w.document.documentElement.classList.contains('motion-reduced'));
    assert.equal(w.document.getElementById('cfg-reduced').checked, true);
    await w.NeuralStore.resetAll({ keepSettings: false });
    assert.equal(w.document.documentElement.classList.contains('motion-reduced'), false);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('nodos D3 mantienen inspector, citas y filtros; hubs y teclado no duplican el despacho', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true);
  try {
    w.document.getElementById('btn-toggle-spiders').click();
    const stage = w.document.getElementById('arena-stage');
    stage.getBoundingClientRect = () => ({ left: 10, top: 20, right: 610, bottom: 420, width: 600, height: 400 });
    w.NeuralStore.addDocument({ id: 'doc-d3', name: 'fuente.txt', pages: [{ pageNum: 1, text: 'La biología estudia los seres vivos.',
      sentences: [{ id: 'sentence-d3', text: 'La biología estudia los seres vivos.' }] }] });
    w.NeuralStore.addPattern({ cluster: 'AGT-01', label: 'Biología', text: 'La biología estudia los seres vivos.', pageNum: 1, sentenceId: 'sentence-d3' });
    w.NeuralStore.addPattern({ cluster: 'AGT-02', label: 'Relación', text: 'Las células se relacionan entre sí.', pageNum: 1, sentenceId: 'sentence-d3' });
    let dispatches = 0;
    w.SpiderEngine.dispatchFromNetwork = () => { dispatches++; return { sent: 0, reason: 'paused' }; };
    const groups = [...w.document.querySelectorAll('g.node-group')];
    const node = groups.find(el => el.__data__.label === 'Biología');
    const other = groups.find(el => el.__data__.label === 'Relación');
    const hub = groups.find(el => el.__data__.id === 'AGT-02');
    assert.ok(node && other && hub);
    node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 250, clientY: 200 }));
    assert.equal(dispatches, 0);
    assert.equal(w.document.getElementById('node-inspector').classList.contains('hidden'), false);
    assert.equal(w.document.getElementById('insp-label').textContent, 'Biología');
    w.document.querySelector('#insp-citations button').click();
    assert.equal(w.NeuralStore.state.activeDocId, 'doc-d3');
    assert.ok(w.NeuralStore.state.autoNavigationPausedUntil > Date.now());
    w.document.getElementById('btn-close-inspector').click();
    node.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(w.document.getElementById('node-inspector').classList.contains('hidden'), false);
    assert.equal(dispatches, 0);
    w.document.querySelector('.cluster-pill.c-def').click();
    assert.equal(node.querySelector('.node-circle').getAttribute('opacity'), '1');
    assert.equal(other.querySelector('.node-circle').getAttribute('opacity'), '0.18');
    hub.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    assert.equal(dispatches, 1);
    assert.match(w.document.getElementById('swarm-feedback').textContent, /pausado/i);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
