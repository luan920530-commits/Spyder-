const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const root = path.join(__dirname, '..');
const scripts = ['util', 'retrieval', 'analysis', 'srs', 'db', 'embeddings', 'store', 'local-model', 'qwen-config', 'qwen-prompt', 'qwen-model', 'parsers', 'memory', 'providers', 'character', 'rag', 'kimi-aux-model', 'viewer', 'spider-visual', 'neural-graph', 'spider-paths', 'spiders', 'eval', 'brain-rag', 'study-bots', 'app'];
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
async function createApp(indexedDB, withD3 = false, reducedMotion = true) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'https://local.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  const w = dom.window;
  Object.defineProperty(w, 'indexedDB', { value: indexedDB, configurable: true });
  w.matchMedia = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} });
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

test('los errores de ingesta y avisos parciales se leen completos sin ejecutar contenido', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore, notice = w.document.getElementById('ingest-message');
    w.document.getElementById('btn-toggle-spiders').click();
    S.emit('ingest:progress', { phase: 'error', name: '<img src=x onerror=alert(1)>.pdf', error: 'El PDF requiere una contraseña.' });
    assert.equal(notice.classList.contains('hidden'), false);
    assert.match(notice.textContent, /requiere una contraseña/);
    assert.equal(notice.querySelector('img'), null);
    w.DocViewer.render();
    assert.match(notice.textContent, /requiere una contraseña/, 'el error persiste al redibujar el visor');
    S.emit('ingest:progress', { phase: 'parse', name: 'parcial.pdf' });
    assert.equal(notice.classList.contains('hidden'), true);
    S.addDocument({ id: 'pdf', name: 'parcial.pdf', type: 'pdf', method: 'PDF.js local',
      ingestWarnings: ['Lectura parcial: no se pudieron extraer las páginas PDF 2.'],
      pages: [{ pageNum: 1, sourcePage: 3, text: 'Texto real de la tercera página.',
        sentences: [{ id: 'pdf-s1', pageNum: 1, sourcePage: 3, text: 'Texto real de la tercera página.' }] }] });
    await until(() => notice.textContent.includes('Lectura parcial'));
    assert.equal(notice.classList.contains('hidden'), false);
    assert.match(w.document.getElementById('doc-section').textContent, /PDF pág\. 3/);
    S.addPattern({ cluster: 'AGT-01', label: 'Texto real', text: 'Texto real de la tercera página.', pageNum: 1, sentenceId: 'pdf-s1' });
    assert.match(w.document.getElementById('ticker-list').textContent, /\[Pág 3\]/, 'el registro muestra la página física citada');
    const answer = await w.NCRag.ask('tercera =pag:3');
    assert.ok(answer.sources.some(source => source.sentenceId === 'pdf-s1' && source.sourcePage === 3 && source.pageNum === 1));
    S.setActivePage(1);
    await until(() => notice.textContent.includes('Lectura parcial'));
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('modo personaje guía la configuración, limita fuentes al libro y recuerda la posición local', async () => {
  const db = new IDBFactory();
  const first = await createApp(db), { w } = first;
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    w.document.querySelector('[data-workspace="chat"]').click();
    const mode = w.document.getElementById('mode-select');
    mode.value = 'conversacion'; mode.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.equal(w.document.getElementById('character-setup').classList.contains('hidden'), false);
    assert.match(w.document.getElementById('character-setup').textContent, /sube el PDF de un libro/i);
    assert.equal(w.document.getElementById('study-quick-actions').classList.contains('hidden'), true);
    assert.equal(w.document.getElementById('character-quick-actions').classList.contains('hidden'), false);
    let answer = await w.BrainRAG.send('Hola');
    assert.equal(answer.intent, 'setup');
    assert.match(answer.text, /sube un libro/i);
    S.addDocument({ id: 'novela', name: 'novela.pdf', type: 'pdf', pages: [
      { pageNum: 1, sourcePage: 2, text: 'Luna guardó la llave azul. Después abrió la puerta.', sentences: [
        { id: 'n1', sourcePage: 2, text: 'Luna guardó la llave azul en una caja.' },
        { id: 'n2', sourcePage: 2, text: 'Después abrió la puerta del jardín.' },
        { id: 'n3', sourcePage: 2, text: 'Luna guarda evidencia <img src=x onerror="window.pwned=1"> [7] de su viaje.' }
      ] }
    ] });
    S.addDocument({ id: 'novela-extra', name: 'otro.pdf', type: 'pdf', pages: [
      { pageNum: 1, sourcePage: 1, text: 'Luna guardó una llave roja.', sentences: [{ id: 'o1', sourcePage: 1, text: 'Luna guardó la llave roja en otro universo.' }] }
    ] });
    const book = w.document.getElementById('character-book');
    assert.equal(book.options.length, 3);
    book.value = 'novela'; book.dispatchEvent(new w.Event('change', { bubbles: true }));
    const name = w.document.getElementById('character-name');
    name.value = 'Luna'; name.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.match(w.document.getElementById('character-status').textContent, /Listo/);
    answer = await w.BrainRAG.send('¿Qué hizo con la llave?');
    assert.equal(answer.mode, 'conversacion');
    assert.equal(answer.sources.length, 1);
    assert.equal(answer.sources[0].docId, 'novela');
    assert.equal(answer.sources[0].sourcePage, 2);
    assert.match(answer.text, /llave azul/);
    assert.doesNotMatch(answer.text, /llave roja/);
    const cite = [...w.document.querySelectorAll('.msg-ai')].at(-1).querySelector('.character-excerpt .cite-ref');
    assert.ok(cite); cite.click();
    assert.equal(S.state.activeDocId, 'novela');
    assert.equal(S.state.activePage, 1);
    assert.ok(S.state.autoNavigationPausedUntil > Date.now());
    answer = await w.BrainRAG.send('¿Y después?');
    assert.equal(answer.sources[0].sentenceId, 'n2');
    assert.match(answer.text, /puerta del jardín/);

    const beforeVault = S.state.vault.length, beforeFeedback = S.state.feedback.length;
    answer = await w.BrainRAG.send('Me siento sola y necesito hablar');
    assert.equal(answer.intent, 'emotional');
    assert.equal(answer.sources.length, 0);
    assert.equal(S.state.vault.length, beforeVault);
    assert.equal(S.state.feedback.length, beforeFeedback);
    assert.equal([...w.document.querySelectorAll('.msg-ai')].at(-1).querySelector('[aria-label="Respuesta útil"]'), null);
    answer = await w.BrainRAG.send('Aprende que un secreto es íntimo');
    assert.equal(S.state.consolidatedMemory.length, 0, 'conversación no ejecuta el comando de memoria');
    answer = await w.BrainRAG.send('evidencia');
    const rendered = [...w.document.querySelectorAll('.msg-ai')].at(-1);
    assert.match(rendered.querySelector('.character-excerpt').textContent, /<img/);
    assert.match(rendered.querySelector('.character-excerpt').textContent, /\[7\]/);
    assert.equal(rendered.querySelectorAll('.character-excerpt .cite-ref').length, 1, 'los corchetes del libro no son citas');
    assert.equal(w.document.querySelectorAll('img[src="x"]').length, 0);
    assert.equal(w.pwned, undefined);
    assert.deepEqual(first.errors, []);
    const backup = await S.exportBrain();
    assert.equal(backup.data.settings.characterDocId, 'novela');
    assert.ok(backup.data.chat.some(entry => entry.question === 'Me siento sola y necesito hablar'));
    assert.equal(backup.data.docs.length, 2);
    await S.savePersistent();
  } finally { first.dom.window.close(); }
  const second = await createApp(db);
  try {
    const w2 = second.w, S = w2.NeuralStore;
    w2.document.querySelector('[data-workspace="chat"]').click();
    assert.equal(w2.document.getElementById('mode-select').value, 'conversacion');
    assert.equal(w2.document.getElementById('character-book').value, 'novela');
    assert.equal(w2.document.getElementById('character-name').value, 'Luna');
    assert.ok(w2.document.querySelector('.character-excerpt .cite-ref'));
    assert.equal(w2.document.querySelectorAll('img[src="x"]').length, 0);
    const next = await w2.BrainRAG.send('¿Y después?');
    assert.equal(next.sources.length, 0, 'el pasaje siguiente pertenece a otro libro y no debe mostrarse');
    w2.document.getElementById('btn-clear-chat').click();
    assert.equal(S.state.chat.length, 0);
    assert.equal(S.state.docs.length, 2, 'borrar chat no elimina los libros');
    assert.equal(S.state.feedback.length, 0);
    await S.savePersistent();
    const cleared = await createApp(db);
    try {
      assert.equal(cleared.w.NeuralStore.state.chat.length, 0, 'el historial permanece borrado al recargar');
      assert.equal(cleared.w.NeuralStore.state.docs.length, 2);
    } finally { cleared.dom.window.close(); }
    S.removeDocument('novela');
    assert.equal(S.getSetting('characterDocId'), '');
    assert.equal(w2.document.getElementById('character-book').value, '');
    await S.resetAll({ keepSettings: true });
    assert.equal(S.getSetting('characterName'), '');
    assert.equal(w2.document.getElementById('character-name').value, '');
    assert.deepEqual(second.errors, []);
  } finally { second.dom.window.close(); }
});

test('la carga desde conversación selecciona el libro solo al terminar y muestra errores', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('mode', 'conversacion');
    S.setSetting('autoHarvest', false);
    const input = w.document.getElementById('character-file');
    let calls = 0;
    w.DocParsers.handleFiles = async (files, options) => {
      calls++;
      assert.equal(files[0].name, 'novela.pdf');
      assert.equal(options.signal.aborted, false);
      options.onProgress({ phase: 'parse', name: files[0].name });
      options.onProgress({ phase: 'pdf-page', page: 1, limit: 2, name: files[0].name });
      const doc = S.addDocument({ id: 'subido', name: files[0].name, type: 'pdf', ingestWarnings: ['Lectura parcial.'],
        pages: [{ pageNum: 1, text: 'Luna camina.', sentences: [{ id: 'subido-1', text: 'Luna camina.' }] }] });
      return [{ ok: true, doc }];
    };
    Object.defineProperty(input, 'files', { configurable: true, value: [new w.File(['PDF'], 'novela.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await until(() => S.getSetting('characterDocId') === 'subido');
    assert.equal(calls, 1);
    assert.equal(w.document.getElementById('character-book').value, 'subido');
    assert.match(w.document.getElementById('character-status').textContent, /Lectura parcial/);
    Object.defineProperty(input, 'files', { configurable: true, value: [new w.File(['x'], 'mal.exe')] });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.match(w.document.getElementById('character-status').textContent, /Selecciona un libro/);
    assert.equal(calls, 1);
    assert.equal(S.getSetting('characterDocId'), 'subido');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('reset e importación cancelan al inicio las lecturas lentas y restauran la selección correcta', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore, fileInput = w.document.getElementById('character-file');
    S.setSetting('mode', 'conversacion');
    S.setSetting('autoHarvest', false);
    const originalHandle = w.DocParsers.handleFiles;
    let signal, finishText;
    w.DocParsers.handleFiles = (files, options) => { signal = options.signal; return originalHandle(files, options); };
    function startSlowUpload() {
      const file = { name: 'lento.txt', text: () => new Promise(resolve => { finishText = resolve; }) };
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
      fileInput.dispatchEvent(new w.Event('change', { bubbles: true }));
      assert.ok(signal && !signal.aborted);
      assert.equal(fileInput.disabled, true);
    }
    startSlowUpload();
    const originalClear = w.NCDB.clearAll;
    let releaseClear, clearStarted = false;
    w.NCDB.clearAll = async () => { clearStarted = true; await new Promise(resolve => { releaseClear = resolve; }); return originalClear(); };
    const reset = S.resetAll({ keepSettings: true });
    assert.equal(signal.aborted, true, 'no se espera a la operación asíncrona de reset');
    await until(() => clearStarted);
    finishText('Luna no debe reaparecer después del reset.');
    await until(() => !fileInput.disabled);
    assert.equal(S.state.docs.length, 0);
    releaseClear(); await reset;
    w.NCDB.clearAll = originalClear;

    startSlowUpload();
    const originalImport = w.NCDB.importAll;
    let releaseImport, importStarted = false;
    w.NCDB.importAll = async (...args) => { importStarted = true; await new Promise(resolve => { releaseImport = resolve; }); return originalImport(...args); };
    const backup = { data: { docs: [{ id: 'restaurado', name: 'restaurado.txt', pages: [
      { pageNum: 1, text: 'Mara encontró un mapa.', sentences: [{ id: 'rest-1', text: 'Mara encontró un mapa.' }] }
    ] }], settings: { mode: 'conversacion', characterDocId: 'restaurado', characterName: 'Mara', autoHarvest: false }, chat: [] } };
    const importing = S.importBrain(backup);
    assert.equal(signal.aborted, true, 'se cancela antes de comenzar a sustituir el respaldo');
    await until(() => importStarted);
    finishText('Luna no debe mezclarse con el respaldo.');
    await until(() => !fileInput.disabled);
    assert.equal(S.state.docs.length, 0);
    releaseImport(); await importing;
    w.NCDB.importAll = originalImport;
    assert.equal(S.state.docs.length, 1);
    assert.equal(S.state.docs[0].id, 'restaurado');
    assert.equal(w.document.getElementById('character-book').value, 'restaurado');
    assert.equal(w.document.getElementById('character-name').value, 'Mara');
    const reply = await w.BrainRAG.send('Háblame de ti');
    assert.equal(reply.sources[0].docId, 'restaurado');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la red anima a la reina y solo envía destellos a los destinatarios del despacho', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), false, false);
  try {
    const S = w.NeuralStore, frames = [], waves = [];
    const draw = w.NCSpiderVisual.draw, drawWave = w.NCSpiderVisual.drawCommandWave;
    w.NCSpiderVisual.draw = (ctx, options) => { if (options.queen) frames.push({ phase: options.phase, weaving: options.weaving }); return draw(ctx, options); };
    w.NCSpiderVisual.drawCommandWave = (ctx, options) => {
      waves.push(Array.from(options.targets, target => target.id));
      return drawWave(ctx, options);
    };
    let paused = false;
    w.SpiderEngine.getStatus = () => ({ paused, spiders: [
      { id: 'ocupada-de-antes', phase: 'EXTRAER_DATOS', x: 100, y: 100 },
      { id: 'destinataria', phase: 'IR_A_PALABRA', x: 150, y: 140 },
      { id: 'libre', phase: 'IDLE', x: 200, y: 150 }
    ] });
    await until(() => frames.length >= 2);
    assert.ok(frames.every(frame => frame.weaving));
    assert.ok(frames.at(-1).phase > frames[0].phase);
    S.emit('spiders:dispatched', { count: 0, spiderIds: ['destinataria'] });
    await wait(80); assert.equal(waves.length, 0);
    S.emit('spiders:dispatched', { count: 1, source: 'network', spiderIds: ['destinataria'] });
    await until(() => waves.length > 0);
    assert.deepEqual(waves[0], ['destinataria']);
    assert.equal(S.state.patterns.length, 0);
    assert.equal(S.state.claimedTargets.size, 0);

    paused = true; S.emit('spiders:paused', { paused });
    const stoppedPhase = frames.at(-1).phase, stoppedWaves = waves.length;
    S.emit('spiders:dispatched', { count: 1, spiderIds: ['ocupada-de-antes'] });
    await wait(100);
    assert.equal(frames.at(-1).phase, stoppedPhase);
    assert.equal(waves.length, stoppedWaves);
    paused = false; S.emit('spiders:paused', { paused });
    await until(() => frames.at(-1).phase > stoppedPhase);
    assert.equal(waves.length, stoppedWaves, 'la onda no se reproduce con retraso al reanudar');
    S.setSetting('reduceMotion', true);
    const reducedPhase = frames.at(-1).phase, reducedWaves = waves.length;
    S.emit('spiders:dispatched', { count: 1, spiderIds: ['ocupada-de-antes'] });
    await wait(100);
    assert.equal(frames.at(-1).phase, reducedPhase);
    assert.equal(waves.length, reducedWaves);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('Qwen usa solo el libro seleccionado, conserva historial aislado y etiqueta lo generado', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore, prompts = [];
    const status = { status: 'ready', enabled: true, installed: true, hasModel: true, hasDownload: true, progress: 1, message: 'Qwen activo.' };
    w.NCQwenModel.info = () => status;
    w.NCQwenModel.generate = async (prompt, options) => {
      prompts.push(prompt); options.onToken?.('Escribiendo');
      return 'Encontré la llave. <img src=x onerror="window.pwned=1">';
    };
    S.addDocument({ id: 'libro-a', name: 'azul.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'a1', text: 'Luna guardó la llave azul en una caja.' },
      { id: 'a2', text: 'Después abrió una puerta antigua.' }
    ] }] });
    S.addDocument({ id: 'libro-b', name: 'rojo.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'b1', text: 'Luna guardó la llave roja en Marte.' }
    ] }] });
    S.setSetting('mode', 'conversacion'); S.setSetting('characterDocId', 'libro-a'); S.setSetting('characterName', 'Luna');
    S.emit('qwen:status', status);
    assert.equal(w.document.getElementById('character-engine-badge').textContent, 'QWEN LOCAL');
    let answer = await w.BrainRAG.send('¿Qué pasó con la llave azul?');
    assert.equal(answer.provider, 'qwen-local'); assert.equal(answer.sources[0].docId, 'libro-a');
    assert.match(prompts[0], /llave azul/); assert.doesNotMatch(prompts[0], /llave roja|Marte/);
    assert.match(prompts[0], /\/no_think/); assert.ok(prompts[0].endsWith('<|im_start|>assistant\n<think>\n\n</think>\n\n'));
    const rendered = [...w.document.querySelectorAll('.msg-ai')].at(-1);
    assert.match(rendered.textContent, /Qwen local/); assert.match(rendered.textContent, /puede inventar/);
    assert.match(rendered.textContent, /no verifica/); assert.equal(w.document.querySelectorAll('img[src="x"]').length, 0);
    assert.equal(w.pwned, undefined); assert.ok(rendered.querySelector('.character-excerpt .cite-ref'));
    answer = await w.BrainRAG.send('¿Y después?');
    assert.equal(answer.provider, 'qwen-local'); assert.match(prompts[1], /Qué pasó con la llave azul/);
    assert.equal(answer.sources[0].docId, 'libro-a');
    const count = prompts.length;
    answer = await w.BrainRAG.send('Me quiero morir');
    assert.equal(answer.intent, 'crisis'); assert.equal(answer.provider, 'internal'); assert.equal(prompts.length, count);
    S.setSetting('characterDocId', 'libro-b');
    answer = await w.BrainRAG.send('¿Qué hizo con la llave roja?');
    assert.equal(answer.sources[0].docId, 'libro-b'); assert.match(prompts.at(-1), /Marte/);
    assert.doesNotMatch(prompts.at(-1), /llave azul/);
    assert.ok(S.state.chat.some(entry => entry.provider === 'qwen-local' && entry.model === 'Qwen3-0.6B Q4_K_M'));
    S.state.chat = [];
    answer = await w.BrainRAG.send('¿Qué opinas de la estación espacial?');
    assert.equal(answer.provider, 'qwen-local'); assert.equal(answer.sources.length, 0);
    assert.match(answer.text, /No se encontró un fragmento/); assert.match(prompts.at(-1), /No hay fragmentos recuperados/);
    const beforeContinuation = prompts.length;
    answer = await w.BrainRAG.send('¿Y después?');
    assert.equal(answer.provider, 'internal'); assert.match(answer.text, /Primero pregúntame/);
    assert.equal(prompts.length, beforeContinuation);
    const long = 'Luna ' + 'bosque '.repeat(90) + 'llave luminosa en la torre. ' + 'nubes '.repeat(50);
    S.addDocument({ id: 'libro-c', name: 'largo.txt', pages: [{ pageNum: 1, sentences: [{ id: 'c1', text: long }] }] });
    S.setSetting('characterDocId', 'libro-c');
    answer = await w.BrainRAG.send('¿Qué hizo con la llave luminosa?');
    assert.match(answer.characterReply.excerpt, /llave luminosa/); assert.match(prompts.at(-1), /llave luminosa en la torre/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('cambiar de personaje o borrar el chat cancela Qwen sin guardar respuestas tardías', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    w.NCQwenModel.info = () => ({ enabled: true, status: 'ready' });
    let signal, release;
    w.NCQwenModel.generate = (_prompt, opts) => new Promise(resolve => { signal = opts.signal; release = resolve; });
    S.addDocument({ id: 'novela', name: 'novela.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'luna', text: 'Luna guardó una llave azul.' }
    ] }] });
    S.setSetting('mode', 'conversacion'); S.setSetting('characterDocId', 'novela'); S.setSetting('characterName', 'Luna');
    let pending = w.BrainRAG.send('llave'); await until(() => !!signal);
    S.setSetting('characterName', 'Otro'); assert.equal(signal.aborted, true);
    release('Respuesta tardía'); assert.equal(await pending, null); assert.equal(S.state.chat.length, 0);
    S.setSetting('characterName', 'Luna'); signal = null;
    pending = w.BrainRAG.send('llave'); await until(() => !!signal);
    w.document.getElementById('btn-clear-chat').click(); assert.equal(signal.aborted, true);
    release('No debe reaparecer'); assert.equal(await pending, null); assert.equal(S.state.chat.length, 0);
    assert.doesNotMatch(w.document.getElementById('chat-messages').textContent, /No debe reaparecer/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('un error al generar con Qwen informa del fallo y conserva la respuesta y la cita por reglas', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    w.NCQwenModel.info = () => ({ enabled: true, status: 'ready' });
    w.NCQwenModel.generate = async () => { throw new Error('memoria insuficiente'); };
    S.addDocument({ id: 'libro', name: 'libro.txt', pages: [{ pageNum: 1, sentences: [
      { id: 's1', text: 'Luna guardó la llave en una caja.' }
    ] }] });
    S.setSetting('mode', 'conversacion'); S.setSetting('characterDocId', 'libro'); S.setSetting('characterName', 'Luna');
    const answer = await w.BrainRAG.send('¿Dónde está la llave?');
    assert.equal(answer.provider, 'internal'); assert.equal(answer.fallback, true);
    assert.match(answer.text, /Qwen no pudo generar.*memoria insuficiente/i);
    assert.match(answer.text, /llave en una caja/); assert.equal(answer.sources[0].docId, 'libro');
    const rendered = [...w.document.querySelectorAll('.msg-ai')].at(-1);
    assert.match(rendered.textContent, /Continúo con reglas locales/);
    assert.ok(rendered.querySelector('.character-excerpt .cite-ref'));
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
