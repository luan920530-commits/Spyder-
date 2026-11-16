const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..');
const scripts = ['util', 'retrieval', 'analysis', 'srs', 'db', 'embeddings', 'store', 'local-model', 'parsers', 'memory', 'providers', 'rag', 'kimi-aux-model', 'viewer', 'neural-graph', 'spider-paths', 'spiders', 'eval', 'brain-rag', 'study-bots', 'app'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fn()) return; await wait(20); }
  throw new Error('Tiempo agotado esperando condición');
}
function canvasContext() {
  const ctx = { createRadialGradient: () => ({ addColorStop() {} }), measureText: text => ({ width: String(text).length * 6 }) };
  ['arc', 'beginPath', 'bezierCurveTo', 'clearRect', 'clip', 'closePath', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo', 'rect', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform', 'stroke', 'strokeRect', 'translate'].forEach(name => { ctx[name] = () => {}; });
  return ctx;
}
async function createApp(indexedDB) {
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
