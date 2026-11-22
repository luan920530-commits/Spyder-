const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, wait, until, byText } = require('./support/dom.cjs');

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
    node.focus();
    node.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const inspector = w.document.getElementById('node-inspector');
    assert.equal(inspector.getAttribute('role'), 'region');
    assert.equal(inspector.getAttribute('aria-labelledby'), 'insp-label');
    assert.equal(w.document.activeElement, inspector, 'el teclado lleva el foco al inspector');
    inspector.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(inspector.classList.contains('hidden'), true);
    assert.equal(w.document.activeElement, node, 'cerrar devuelve el foco al concepto');
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
    w.document.getElementById('btn-close-inspector').click();
    node.focus(); node.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    w.NeuralStore.removeNode(node.__data__.originId || node.__data__.id);
    assert.equal(inspector.classList.contains('hidden'), true, 'no queda un inspector de un nodo eliminado');
    assert.equal(w.document.activeElement, stage, 'si el nodo ya no existe, el foco vuelve a la red');
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
        sentences: [{ id: 'pdf-s1', pageNum: 1, sourcePage: 3, text: 'Texto real de la tercera página.' }] },
        { pageNum: 2, sourcePage: 4, text: '', sentences: [] }] });
    await until(() => notice.textContent.includes('Lectura parcial'));
    assert.equal(notice.classList.contains('hidden'), false);
    assert.match(w.document.getElementById('doc-section').textContent, /PDF pág\. 3/);
    S.addPattern({ cluster: 'AGT-01', label: 'Texto real', text: 'Texto real de la tercera página.', pageNum: 1, sentenceId: 'pdf-s1' });
    assert.match(w.document.getElementById('ticker-list').textContent, /\[Pág 3\]/, 'el registro muestra la página física citada');
    const answer = await w.NCRag.ask('tercera =pag:3');
    assert.ok(answer.sources.some(source => source.sentenceId === 'pdf-s1' && source.sourcePage === 3 && source.pageNum === 1));
    assert.match(w.NCRag.toMarkdown(answer), /Pág 3/, 'la exportación también usa la página PDF física');
    S.setActivePage(2);
    await until(() => w.document.getElementById('doc-content').textContent.includes('La página 4 del PDF no tiene texto extraíble'));
    assert.equal(S.getActiveDoc().pages[1].text, '', 'el aviso no se introduce en el texto del PDF');
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

test('los destinos del masaje corresponden a nodos y enlaces visibles del grafo real', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true, true);
  try {
    const S = w.NeuralStore, graph = w.NeuralGraph, stage = w.document.getElementById('arena-stage');
    stage.getBoundingClientRect = () => ({ left: 10, top: 20, right: 610, bottom: 420, width: 600, height: 400 });
    const a = S.addPattern({ cluster: 'AGT-01', label: 'Árbol', text: 'Texto uno.', pageNum: 1 });
    const b = S.addPattern({ cluster: 'AGT-02', label: 'Estrella', text: 'Texto dos.', pageNum: 1 });
    graph.recenter();
    const rect = stage.getBoundingClientRect(), before = JSON.stringify({ nodes: S.state.nodes, links: S.state.links, patterns: S.state.patterns });
    const targets = graph.getIdleTargets(rect);
    assert.deepEqual(new Set(targets.map(point => point.id)), new Set([a.id, b.id]));
    const selected = graph.getIdleTarget(a.id, rect);
    const group = [...w.document.querySelectorAll('.node-group')].find(el => el.__data__.id === a.id);
    const match = group.getAttribute('transform').match(/^translate\(([^,]+),([^\)]+)\)$/);
    assert.ok(match);
    assert.ok(Math.abs(selected.x - (rect.left + Number(match[1]))) < 1e-7);
    assert.ok(Math.abs(selected.y - (rect.top + Number(match[2]))) < 1e-7);
    assert.ok(selected.links.some(link => link.id === 'AGT-01'), 'la chispa usa un enlace existente');
    selected.x = -999; selected.links[0].x = -999;
    assert.notEqual(graph.getIdleTarget(a.id, rect).x, -999, 'las posiciones expuestas son copias');
    assert.equal(JSON.stringify({ nodes: S.state.nodes, links: S.state.links, patterns: S.state.patterns }), before);

    graph.setClusterFilter('AGT-02');
    assert.deepEqual(Array.from(graph.getIdleTargets(rect), point => point.id), [b.id]);
    assert.equal(graph.getIdleTarget(a.id, rect), null, 'no se visita un nodo ocultado por el filtro');
    S.removeNode(b.id);
    assert.equal(graph.getIdleTarget(b.id, rect), null, 'no se conserva un destino eliminado');
    assert.equal(graph.getIdleTargets({ left: -2000, top: -2000, width: 600, height: 400 }).length, 0);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la red anima a la reina y solo envía destellos a los destinatarios del despacho', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), false, false);
  try {
    const S = w.NeuralStore, frames = [], waves = [];
    const draw = w.NCSpiderVisual.draw, drawWave = w.NCSpiderVisual.drawCommandWave;
    let points = [], instrumented = false;
    w.NCSpiderVisual.draw = (ctx, options) => {
      if (options.queen) {
        if (!instrumented) {
          instrumented = true;
          const clear = ctx.clearRect, line = ctx.lineTo;
          ctx.clearRect = (...args) => { points = []; return clear(...args); };
          ctx.lineTo = (x, y) => { points.push([x, y]); return line(x, y); };
        }
        const outer = w.NCSpiderVisual.pose(options).legs.filter(leg => leg.index === 0 || leg.index === 3);
        frames.push({ phase: options.phase, weaving: options.weaving, x: options.x, y: options.y, angle: options.angle,
          size: options.size, outer: Array.from(outer, leg => ({ x: leg.foot.x, y: leg.foot.y })),
          anchors: Array.from(options.threadAnchors, anchor => ({ x: anchor.x, y: anchor.y })), points: points.slice() });
      }
      return draw(ctx, options);
    };
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
    await until(() => frames.length >= 3);
    await until(() => frames.slice(1).some(frame => frame.outer.some((foot, i) =>
      Math.hypot(foot.x - frames[0].outer[i].x, foot.y - frames[0].outer[i].y) > frame.size * .05)));
    assert.ok(frames.every(frame => frame.weaving && frame.angle === 0 && frame.anchors.length === 4));
    assert.ok(frames.at(-1).phase > frames[0].phase);
    const connected = frames.slice(1).find(frame => frame.anchors.every(anchor => frame.points.some(([x, y]) =>
      Math.abs(x - frame.x - anchor.x) < 1e-7 && Math.abs(y - frame.y - anchor.y) < 1e-7)));
    assert.ok(connected, 'los cuatro hilos terminan en vértices dibujados de la telaraña');
    assert.ok(frames.slice(1).some(frame => frame.anchors.some((anchor, i) =>
      Math.hypot(anchor.x - frames[0].anchors[i].x, anchor.y - frames[0].anchors[i].y) > 1e-5)), 'el hilo se tensa con el tejido');
    S.emit('spiders:dispatched', { count: 0, spiderIds: ['destinataria'] });
    await wait(80); assert.equal(waves.length, 0);
    S.emit('spiders:dispatched', { count: 1, source: 'network', spiderIds: ['destinataria'] });
    await until(() => waves.length > 0);
    assert.deepEqual(waves[0], ['destinataria']);
    assert.equal(S.state.patterns.length, 0);
    assert.equal(S.state.claimedTargets.size, 0);

    paused = true; S.emit('spiders:paused', { paused });
    const stoppedPhase = frames.at(-1).phase, stoppedFeet = frames.at(-1).outer, stoppedWaves = waves.length;
    S.emit('spiders:dispatched', { count: 1, spiderIds: ['ocupada-de-antes'] });
    await wait(100);
    assert.equal(frames.at(-1).phase, stoppedPhase);
    assert.deepEqual(frames.at(-1).outer, stoppedFeet);
    assert.equal(waves.length, stoppedWaves);
    paused = false; S.emit('spiders:paused', { paused });
    await until(() => frames.at(-1).phase > stoppedPhase);
    assert.equal(waves.length, stoppedWaves, 'la onda no se reproduce con retraso al reanudar');
    S.setSetting('reduceMotion', true);
    const reducedPhase = frames.at(-1).phase, reducedFeet = frames.at(-1).outer, reducedWaves = waves.length;
    S.emit('spiders:dispatched', { count: 1, spiderIds: ['ocupada-de-antes'] });
    await wait(100);
    assert.equal(frames.at(-1).phase, reducedPhase);
    assert.deepEqual(frames.at(-1).outer, reducedFeet);
    assert.equal(waves.length, reducedWaves);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la reina mira el puntero en toda la ventana y gira anclada sin soltar los hilos', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), false, false);
  try {
    const S = w.NeuralStore, stage = w.document.getElementById('arena-stage'), frames = [];
    stage.getBoundingClientRect = () => ({ left: 10, top: 20, right: 610, bottom: 420, width: 600, height: 400 });
    const draw = w.NCSpiderVisual.draw;
    let points = [], instrumented = false;
    w.NCSpiderVisual.draw = (ctx, options) => {
      if (options.queen) {
        if (!instrumented) {
          instrumented = true;
          const clear = ctx.clearRect, line = ctx.lineTo;
          ctx.clearRect = (...args) => { points = []; return clear(...args); };
          ctx.lineTo = (x, y) => { points.push([x, y]); return line(x, y); };
        }
        frames.push({ x: options.x, y: options.y, angle: options.angle, headAngle: options.headAngle, phase: options.phase,
          anchors: Array.from(options.threadAnchors, anchor => ({ x: anchor.x, y: anchor.y })), points: points.slice() });
      }
      return draw(ctx, options);
    };
    await until(() => frames.length >= 2);
    const initial = frames.at(-1), qx = 10 + initial.x, qy = 20 + initial.y;
    // El evento ocurre sobre otro panel, no sobre el lienzo de la red.
    w.document.getElementById('doc-dropzone').dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: qx, clientY: qy - 180 }));
    await until(() => Math.abs(frames.at(-1).angle + Math.PI / 2) < .04);
    assert.ok(frames.some(frame => Math.abs(frame.headAngle) > .1), 'la cabeza se adelanta al cuerpo');
    assert.ok(frames.every(frame => frame.x === initial.x && frame.y === initial.y), 'el centro no se desplaza al girar');
    const rotated = frames.at(-1), c = Math.cos(rotated.angle), s = Math.sin(rotated.angle);
    assert.ok(rotated.anchors.every(anchor => rotated.points.some(([x, y]) =>
      Math.abs(x - (rotated.x + anchor.x * c - anchor.y * s)) < 1e-7 &&
      Math.abs(y - (rotated.y + anchor.x * s + anchor.y * c)) < 1e-7)), 'los cuatro hilos siguen anclados a vértices dibujados');

    const getStatus = w.SpiderEngine.getStatus;
    w.SpiderEngine.getStatus = () => ({ paused: false, spiders: [{ id: 'activa', phase: 'EXTRAER_DATOS', cluster: 'AGT-01', x: 250, y: 250 }] });
    w.document.getElementById('btn-mitosis').dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: qx + 300, clientY: qy + 120 }));
    await until(() => Math.abs(frames.at(-1).angle - Math.atan2(120, 300)) < .04);
    w.SpiderEngine.getStatus = getStatus;

    w.document.getElementById('btn-toggle-spiders').click();
    const paused = frames.at(-1);
    w.document.getElementById('btn-mitosis').dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: qx + 400, clientY: qy }));
    await wait(100);
    assert.equal(frames.at(-1).angle, paused.angle);
    assert.equal(frames.at(-1).headAngle, paused.headAngle);
    assert.equal(frames.at(-1).phase, paused.phase);
    w.document.getElementById('btn-toggle-spiders').click();
    await until(() => Math.abs(frames.at(-1).angle) < .04);

    S.setSetting('reduceMotion', true);
    const reduced = frames.at(-1);
    w.document.getElementById('btn-mitosis').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: qx, clientY: qy + 160 }));
    await wait(100);
    assert.equal(frames.at(-1).angle, reduced.angle);
    assert.equal(frames.at(-1).headAngle, reduced.headAngle);
    S.setSetting('reduceMotion', false);
    await until(() => Math.abs(frames.at(-1).angle - Math.PI / 2) < .04);
    const delta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
    const move = y => w.document.getElementById('doc-dropzone').dispatchEvent(new w.MouseEvent('pointermove', {
      bubbles: true, clientX: qx - 100, clientY: qy + y
    }));
    move(1);
    await until(() => Math.abs(delta(frames.at(-1).angle, Math.atan2(1, -100))) < .01);
    const beforeWrap = frames.at(-1).angle, index = frames.length;
    move(-1);
    await until(() => Math.abs(delta(frames.at(-1).angle, Math.atan2(-1, -100))) < .01);
    assert.ok(frames.slice(index).every(frame => Math.abs(delta(beforeWrap, frame.angle)) < .1), 'el giro cruza ±π por el arco corto');
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

function installSemanticVectors(w, vectors) {
  const S = w.NeuralStore;
  let enabled = true;
  w.NCLocalModel.info = () => ({ enabled, status: enabled ? 'ready' : 'inactive', indexed: enabled ? vectors.size : 0 });
  w.NCLocalModel.vectorSnapshot = ids => [...(ids || vectors.keys())]
    .filter(id => vectors.has(id) && S.state.index.posById.has(id))
    .map(id => ({ id, vector: new w.Float32Array(vectors.get(id)) }));
  S.emit('model:status', { enabled: true, status: 'ready' });
  S.emit('model:vectorsChanged', { added: [...vectors.keys()] });
  return {
    disable() { enabled = false; S.emit('model:status', { enabled: false, status: 'inactive' }); },
    enable() { enabled = true; S.emit('model:status', { enabled: true, status: 'ready' }); S.emit('settings:changed', { key: 'embedEnabled', value: true }); }
  };
}

test('D3 agrupa por vectores, separa nodos históricos mezclados y vuelve a roles sin MiniLM', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true);
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'doc', name: 'temas.txt', pages: [
      { pageNum: 1, sentences: [{ id: 'cat1', text: 'Los gatos descansan sobre el sofá.' }] },
      { pageNum: 2, sentences: [{ id: 'cat2', text: 'Los felinos duermen durante el día.' }] },
      { pageNum: 3, sentences: [{ id: 'star', text: 'Las galaxias contienen estrellas distantes.' }] }
    ] });
    const a = S.addPattern({ cluster: 'AGT-01', label: 'Concepto', text: 'Gatos', pageNum: 1, sentenceId: 'cat1' });
    const b = S.addPattern({ cluster: 'AGT-01', label: 'Concepto', text: 'Estrellas', pageNum: 3, sentenceId: 'star' });
    assert.notEqual(a.id, b.id, 'una etiqueta igual no debe fusionar fuentes distintas');
    const legacy = { id: 'legacy-node', cluster: 'AGT-01', label: 'Antiguo', text: 'Gatos', weight: 2,
      color: '#00f0ff', pageNums: [1, 3], sentenceIds: ['cat1', 'star'] };
    S.state.nodes.push(legacy);
    S.emit('node:added', { node: legacy, isNew: true, pattern: { cluster: 'AGT-01', text: 'Gatos', pageNum: 1, sentenceId: 'cat1' } });
    const fake = installSemanticVectors(w, new Map([['cat1', [1, 0, 0]], ['cat2', [.98, .03, 0]], ['star', [0, 1, 0]]]));
    await until(() => w.NCSemantic.info().indexed === 3 && w.document.getElementById('graph-grouping').textContent.includes('TEMAS MINILM'));
    const groups = () => [...w.document.querySelectorAll('g.node-group')];
    const nodeA = groups().find(el => el.__data__.id === a.id), nodeB = groups().find(el => el.__data__.id === b.id);
    assert.ok(nodeA && nodeB);
    assert.equal(nodeA.__data__.cluster, 'AGT-01'); assert.equal(nodeB.__data__.cluster, 'AGT-01');
    assert.notEqual(nodeA.__data__.topicId, nodeB.__data__.topicId);
    // Con agrupación semántica, la cámara proyecta centros reales de tema,
    // no los hubs de agente retenidos en el store.
    w.document.getElementById('btn-orbit').click();
    const topic = groups().find(el => el.__data__.id === nodeA.__data__.topicId);
    await until(() => topic.getAttribute('transform').includes('scale('));
    const projected = topic.getAttribute('transform').match(/translate\(([^,]+),([^\)]+)\)/);
    assert.deepEqual({ ...w.NeuralGraph.getHubScreenPos(nodeA.__data__.topicId) }, { x: +projected[1], y: +projected[2] });
    const semanticLinks = [...w.document.querySelectorAll('line.graph-link')];
    const linkA = semanticLinks.find(el => el.__data__.target.id === a.id);
    assert.equal(linkA.getAttribute('stroke'), nodeA.__data__.color, 'el enlace usa el color de su tema');
    const split = groups().filter(el => el.__data__.originId === 'legacy-node');
    assert.equal(split.length, 2);
    assert.deepEqual(split.map(el => [...el.__data__.sentenceIds]).sort(), [['cat1'], ['star']]);
    const stars = split.find(el => el.__data__.sentenceIds.includes('star'));
    assert.match(stars.__data__.text, /galaxias/);
    stars.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.match(w.document.getElementById('insp-cluster').textContent, /Tema .*AGT-01/);
    assert.match(w.document.getElementById('insp-text').textContent, /galaxias/);
    w.document.querySelector('#insp-citations button').click();
    assert.equal(S.state.activePage, 3);
    w.document.querySelector(`[data-cluster="${nodeA.__data__.topicId}"]`).click();
    assert.equal(nodeA.querySelector('.node-circle').getAttribute('opacity'), '1');
    assert.equal(nodeB.querySelector('.node-circle').getAttribute('opacity'), '0.18');
    assert.equal(linkA.getAttribute('opacity'), '1');
    assert.equal(semanticLinks.find(el => el.__data__.target.id === b.id).getAttribute('opacity'), '0.15');
    S.setSetting('embedEnabled', false);
    await until(() => w.document.getElementById('graph-grouping').textContent.includes('VECTORES EN AJUSTES'));
    S.setSetting('embedEnabled', true);
    await until(() => w.document.getElementById('graph-grouping').textContent.includes('TEMAS MINILM'));
    fake.disable();
    await until(() => w.document.getElementById('graph-grouping').textContent.includes('POR AGENTE'));
    assert.ok(w.document.querySelector('.cluster-pill[data-cluster="AGT-01"]'));
    assert.ok(!groups().some(el => el.__data__.isSemantic));
    assert.equal(groups().filter(el => el.__data__.id === 'legacy-node').length, 1);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('un episodio negativo cambia el peso de otros pasajes del tema y sobrevive al respaldo sin revivir fuentes borradas', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true);
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'rated', name: 'rated.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'rated-id', text: 'Una fuente sobre memoria y conexiones.' }
    ] }] });
    S.addDocument({ id: 'search', name: 'search.txt', pages: [
      { pageNum: 1, sentences: [{ id: 'similar', text: 'La señal de memoria y redes describe el informe alfa especial.' }] },
      { pageNum: 2, sentences: [{ id: 'different', text: 'La señal de memoria y redes describe el informe beta especial.' }] }
    ] });
    const fake = installSemanticVectors(w, new Map([['rated-id', [1, 0, 0]], ['similar', [.99, .04, 0]], ['different', [0, 1, 0]]]));
    await until(() => w.NCSemantic.info().indexed === 3);
    const query = '=doc:search señal memoria redes informe';
    const rank = () => S.search(query, { k: 1, fuzzy: false, diversify: false, expand: false,
      neuralScores: new w.Map([['similar', .9], ['different', .89]]) }).hits[0]?.sentence.id;
    assert.equal(rank(), 'similar');
    const before = S.state.feedback.length;
    w.KimiAuxModel.recordNegativeEpisode('Respuesta equivocada sin fuentes');
    assert.equal(S.state.feedback.length, before, 'sin IDs no se adivina una fuente');
    w.KimiAuxModel.recordNegativeEpisode('Respuesta equivocada', { question: 'otra consulta distinta', sentenceIds: ['rated-id'] });
    assert.equal(S.state.feedback.length, before + 1);
    let weights = w.NCSemantic.preferenceWeights(S.state.feedback);
    assert.ok(w.NCSemantic.preferenceFor('similar', weights) < 0);
    assert.equal(w.NCSemantic.preferenceFor('different', weights), 0);
    assert.equal(rank(), 'different', 'el ajuste actúa antes de cortar el top-1 y también sobre otra fuente del tema');
    const backup = JSON.parse(JSON.stringify(await S.exportBrain()));
    await S.resetAll({ keepSettings: false });
    assert.equal(S.state.feedback.length, 0);
    if (!w.SpiderEngine.getStatus().paused) w.document.getElementById('btn-toggle-spiders').click();
    await S.importBrain(backup);
    await until(() => w.NCSemantic.info().indexed === 3);
    assert.equal(S.state.feedback.length, 1);
    assert.equal(rank(), 'different', 'la preferencia se reconstruye a partir de IDs persistidos');
    fake.disable();
    assert.equal(rank(), 'similar', 'sin MiniLM no se inventa agrupación temática');
    fake.enable();
    await until(() => w.NCSemantic.info().indexed === 3);
    assert.equal(rank(), 'different');
    S.removeDocument('rated');
    await until(() => w.NCSemantic.info().indexed === 2);
    weights = w.NCSemantic.preferenceWeights(S.state.feedback);
    assert.equal(w.NCSemantic.preferenceFor('similar', weights), 0);
    assert.deepEqual([...S.state.feedback[0].sentenceIds], []);
    assert.equal(rank(), 'similar');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('el botón NO registra todas las fuentes citadas una sola vez y no atribuye temas sin fuente', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'rated', name: 'rated.txt', pages: [
      { pageNum: 1, sentences: [{ id: 'a', text: 'Gatos en un sillón.' }] },
      { pageNum: 2, sentences: [{ id: 'b', text: 'Aves en el bosque.' }] },
      { pageNum: 3, sentences: [{ id: 'c', text: 'Estrellas en el espacio.' }] }
    ] });
    installSemanticVectors(w, new Map([['a', [1, 0, 0]], ['b', [0, 1, 0]], ['c', [0, 0, 1]]]));
    await until(() => w.NCSemantic.info().indexed === 3);
    const sources = ['a', 'b', 'c'].map((id, i) => ({ sentenceId: id, docId: 'rated', docName: 'rated.txt', pageNum: i + 1, text: id }));
    const answer = { question: 'Una pregunta', text: 'Respuesta incorrecta [1] y [3].', mode: 'examen', provider: 'internal',
      sources, citations: { used: [1, 3], weak: [], unverified: [] }, nodeIds: [], vaultIds: [] };
    const article = w.BrainRAG.renderAnswer(answer);
    article.querySelector('[aria-label="Respuesta poco útil"]').click();
    assert.equal(S.state.feedback.length, 1, 'el episodio auxiliar no duplica el feedback del botón');
    assert.deepEqual([...S.state.feedback[0].sentenceIds], ['a', 'c']);
    const weights = w.NCSemantic.preferenceWeights(S.state.feedback);
    assert.ok(w.NCSemantic.preferenceFor('a', weights) < 0);
    assert.equal(w.NCSemantic.preferenceFor('b', weights), 0);
    assert.ok(w.NCSemantic.preferenceFor('c', weights) < 0);
    assert.equal(w.KimiAuxModel.isPenalized('Respuesta incorrecta [1] y [3].'), true);
    article.querySelector('[aria-label="Respuesta poco útil"]').click();
    assert.equal(S.state.feedback.length, 1);
    S.removeDocument('rated');
    const oldAnswer = w.BrainRAG.renderAnswer(answer);
    oldAnswer.querySelector('[aria-label="Respuesta útil"]').click();
    assert.deepEqual([...S.state.feedback.at(-1).sentenceIds], [], 'el historial no puede valorar una fuente eliminada');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('excluir una vecina invalida su vector original para evitar evidencia neural contaminada', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'doc', name: 'd.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'safe', text: 'La biología estudia a los seres vivos.' },
      { id: 'excluded', text: 'La biología marina estudia los océanos.' }
    ] }] });
    const scores = new w.Map([['safe', .99], ['excluded', .98]]);
    const phantom = S.search('palabrainexistente -marina', { fuzzy: false, expand: false, neuralScores: scores });
    assert.equal(phantom.hits.length, 0, 'no se reutiliza un vector que incluía marina');
    const lexical = S.search('biología -marina', { fuzzy: false, expand: false, neuralScores: scores });
    assert.equal(lexical.contextIndex, phantom.contextIndex, 'se reutiliza la misma proyección mientras no cambia el corpus');
    assert.equal(lexical.hits[0].sentence.id, 'safe');
    assert.equal(lexical.hits[0].neural, 0);
    assert.doesNotMatch(lexical.hits[0].sentence.text, /marina/);
    S.addDocument({ id: 'heading', name: 'heading.txt', pages: [{ pageNum: 1, section: 'Biología marina',
      sentences: [{ id: 'heading-id', text: 'Un texto sin el término descartado.' }] }] });
    const titleOnly = S.search('palabrainexistente -marina', { fuzzy: false, expand: false,
      neuralScores: new w.Map([['heading-id', .99]]) });
    assert.notEqual(titleOnly.contextIndex, lexical.contextIndex, 'un documento nuevo invalida la proyección');
    assert.equal(titleOnly.hits.length, 0, 'el título también entró al vector y puede contaminarlo');
    const answer = await w.NCRag.ask('¿Qué estudia la biología? -marina');
    assert.ok(answer.sources.length);
    assert.ok(answer.sources.every(source => !source.text.includes('marina')));
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('reset durante la inferencia pendiente cancela respuesta y despachos tardíos', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'doc', name: 'd.txt', pages: [{ pageNum: 1, sentences: [{ id: 's', text: 'Texto real sobre galaxias.' }] }] });
    let release;
    w.NCLocalModel.info = () => ({ enabled: true, status: 'ready' });
    w.NCLocalModel.scores = () => new Promise(resolve => { release = resolve; });
    const events = [];
    S.on('spiders:dispatched', event => events.push(event));
    const pending = w.BrainRAG.send('Consulta galáctica');
    await until(() => !!release);
    await S.resetAll({ keepSettings: false });
    release(new w.Map([['s', .99]]));
    assert.equal(await pending, null);
    assert.equal(S.state.chat.length, 0);
    assert.equal(S.state.claimedTargets.size, 0);
    assert.equal(events.filter(event => event.source === 'query').length, 0);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('el chat dirige a los hits filtrados con guía local explícita cuando MiniLM falla', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true);
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'doc', name: 'd.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'safe', text: 'La biología estudia a los seres vivos.' },
      { id: 'excluded', text: 'La biología marina estudia peces y océanos.' }
    ] }] });
    w.NCLocalModel.info = () => ({ enabled: true, status: 'ready' });
    w.NCLocalModel.scores = async () => { throw new Error('modelo interrumpido'); };
    const visual = [], dispatches = [], notices = [];
    S.on('spider:queryVisual', event => visual.push(event));
    S.on('spiders:dispatched', event => dispatches.push({ ...event,
      targets: Array.from(w.SpiderEngine.getStatus().spiders, spider => spider.sentenceId) }));
    S.on('spiders:queryGuidance', event => notices.push(event));
    const answer = await w.BrainRAG.send('¿Qué estudia biología? -marina');
    assert.ok(answer.sources.length);
    assert.ok(visual[0].hits.length);
    assert.equal(visual[0].method, 'local');
    assert.ok(visual[0].hits.every(hit => hit.sentence.id === 'safe' && !hit.sentence.text.includes('marina')));
    assert.ok(notices.some(event => event.method === 'local' && event.paused));
    assert.match(w.document.getElementById('swarm-feedback').textContent, /Guía local/);
    assert.equal(S.state.claimedTargets.size, 0);
    w.document.getElementById('btn-toggle-spiders').click();
    await until(() => dispatches.some(event => event.source === 'query'));
    const dispatched = dispatches.find(event => event.source === 'query');
    assert.equal(dispatched.method, 'local');
    assert.equal(dispatched.targets[0], 'safe', 'se comprueba el destino en el momento del despacho');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('borrar el chat cancela una guía ya despachada y la respuesta del proveedor pendiente', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'doc', name: 'd.txt', pages: [{ pageNum: 1, sentences: [{ id: 's', text: 'La memoria conecta señales neuronales.' }] }] });
    S.getSentence('s').harvested = true;
    w.document.getElementById('btn-toggle-spiders').click();
    let release;
    w.NCProviders.register({ id: 'slow-test', complete: () => new Promise(resolve => { release = resolve; }) });
    S.setSetting('provider', 'slow-test');
    const pending = w.BrainRAG.send('¿Cómo funciona la memoria?');
    await until(() => !!release);
    assert.equal(S.state.claimedTargets.has('s'), true, 'la lectura se despacha antes de terminar la respuesta');
    assert.equal(w.SpiderEngine.getStatus().spiders[0].sentenceId, 's');
    w.document.getElementById('btn-clear-chat').click();
    assert.equal(S.state.claimedTargets.size, 0);
    assert.equal(w.SpiderEngine.getStatus().spiders[0].phase, 'IDLE');
    release({ text: 'Una respuesta tardía [1]' });
    assert.equal(await pending, null);
    assert.equal(S.state.chat.length, 0);
    assert.equal(S.state.patterns.length, 0);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('exclusiones y filtros también se aplican a contradicciones, memorias y sugerencias', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'uno', name: 'uno.pdf', pages: [{ pageNum: 1, sourcePage: 4, sentences: [
      { id: 'a', text: 'La latencia de consulta del sistema es de 12 milisegundos.' },
      { id: 'b', text: 'La explicación de esta medición es local.' }
    ] }] });
    S.addDocument({ id: 'dos', name: 'dos.pdf', pages: [{ pageNum: 1, sourcePage: 7, sentences: [
      { id: 'c', text: 'La latencia de consulta del sistema marina es de 40 milisegundos.' }
    ] }] });
    w.NCMemory.addFact('La latencia marina secreta se anotó en la memoria personal.');
    const all = await w.NCRag.ask('Critica la latencia de consulta');
    assert.match(all.text, /Contradicciones entre fuentes/);
    assert.match(all.text, /Pág 4/);
    assert.match(all.text, /Pág 7/);
    const excluded = await w.NCRag.ask('Critica la latencia de consulta -marina');
    assert.doesNotMatch(excluded.text, /marina|40 milisegundos/i);
    assert.doesNotMatch(excluded.text, /Contradicciones entre fuentes/);
    assert.ok(excluded.sources.every(source => !source.text.includes('marina')));
    const limited = await w.NCRag.ask('Critica la latencia de consulta =doc:uno');
    assert.doesNotMatch(limited.text, /marina|40 milisegundos/i);
    assert.doesNotMatch(limited.text, /Recuerdo guardado por ti/);
    const noResult = await w.NCRag.ask('palabrainexistente =doc:uno -marina');
    assert.equal(noResult.sources.length, 0);
    assert.doesNotMatch(noResult.text.split('Términos que sí aparecen en el corpus:')[1] || '', /marina/i);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('los compositores nunca recuperan texto descartado del objeto ancla', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const chunk = { index: 1, id: 'safe', text: 'La evidencia conservada es local.', sentence: { text: 'TEXTO DESCARTADO Y AJENO.' },
      pageNum: 1, docName: 'd.txt' };
    for (const mode of ['examen', 'redaccion', 'socratico']) {
      const output = w.NCRag.composeExtractive({ mode, question: 'Explica la evidencia', chunks: [chunk] });
      assert.doesNotMatch(output, /DESCARTADO/);
      assert.match(output, /evidencia/i);
    }
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la decoración reduce su frecuencia ante un bloqueo y la recupera cuando el navegador se estabiliza', async () => {
  const clock = {}, { dom, errors } = await createApp(new IDBFactory(), false, false, clock);
  try {
    for (let i = 0; i < 10; i++) clock.tick(50);
    const normal = clock.sphereDraws;
    assert.ok(normal >= 8, 'la animación normal se dibuja con frecuencia');
    clock.tick(300); // una caída prolongada de fotogramas activa el modo liviano
    const beforeLimited = clock.sphereDraws;
    for (let i = 0; i < 12; i++) clock.tick(50);
    assert.ok(clock.sphereDraws - beforeLimited <= 5, 'se espacian los dibujos decorativos');
    for (let i = 0; i < 360; i++) clock.tick(16.7);
    const beforeRecovery = clock.sphereDraws;
    for (let i = 0; i < 20; i++) clock.tick(34);
    assert.ok(clock.sphereDraws - beforeRecovery >= 10, 'tras varios segundos fluidos se restaura la frecuencia');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la simulación pagina copias sin alterar los nodos ni los extremos persistidos', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true);
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'fuente', name: 'fuente.txt', pages: [{ pageNum: 1,
      sentences: [{ id: 's', text: 'El último concepto tiene una fuente real.' }] }] });
    const nodes = Array.from({ length: 85 }, (_, i) => ({ id: `n${i}`, cluster: 'AGT-01',
      label: `Concepto ${i}`, text: `Contenido ${i}`, weight: 1, sentenceIds: i === 84 ? ['s'] : [] }));
    const links = nodes.map(node => ({ key: `hub>${node.id}`, source: 'AGT-01', target: node.id, kind: 'hierarchy' }));
    links.push({ key: 'n84>n0', source: 'n84', target: 'n0', kind: 'synaptic' });
    S.state.nodes.push(...nodes); S.state.links.push(...links);
    const before = JSON.stringify({ nodes, links });
    S.emit('brain:imported');
    assert.equal(w.document.getElementById('graph-page').textContent, '1–40 / 85');
    assert.equal(w.document.querySelectorAll('#neural-svg .node-group').length, 44);
    w.document.getElementById('graph-next').click();
    assert.equal(w.document.getElementById('graph-page').textContent, '41–80 / 85');
    w.document.getElementById('graph-next').click();
    assert.equal(w.document.getElementById('graph-page').textContent, '81–85 / 85');
    const last = [...w.document.querySelectorAll('#neural-svg .node-group')].find(el => el.__data__.id === 'n84');
    last.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert.equal(w.document.getElementById('insp-label').textContent, 'Concepto 84');
    assert.match(w.document.getElementById('insp-citations').textContent, /fuente.txt/);
    assert.match(w.document.getElementById('insp-connection-list').textContent, /Concepto 0/);
    [...w.document.querySelectorAll('#insp-connection-list button')].find(button => button.textContent.includes('Concepto 0')).click();
    assert.equal(w.document.getElementById('insp-label').textContent, 'Concepto 0');
    assert.equal(JSON.stringify({ nodes, links }), before, 'D3 no escribe posiciones ni cambia extremos del store');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('una cita espera el render del visor y respeta una navegación manual intermedia', async () => {
  const clock = {}, { dom, w, errors } = await createApp(new IDBFactory(), false, true, clock);
  try {
    clock.tick(16);
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'lento', name: 'lento.txt', pages: [
      { pageNum: 1, text: 'Primera fuente.', sentences: [{ id: 'primera', text: 'Primera fuente.' }] },
      { pageNum: 2, text: 'Última fuente.', sentences: [{ id: 'ultima', text: 'Última fuente.' }] }
    ] });
    clock.tick(16);
    const answer = { question: 'Prueba', text: 'La última fuente [1].', mode: 'examen', provider: 'internal',
      sources: [{ origin: 'document', docId: 'lento', docName: 'lento.txt', pageNum: 2, sentenceId: 'ultima', text: 'Última fuente.' }] };
    const article = w.BrainRAG.renderAnswer(answer), citation = article.querySelector('.answer-body .cite-ref');
    citation.click();
    S.setActivePage(1); // una navegación explícita posterior invalida la cita pendiente
    await wait(150);
    clock.tick(16);
    assert.equal(S.state.activePage, 1);
    assert.equal(w.document.querySelector('.sentence-active'), null);
    citation.click();
    await wait(150); // el rAF no ha dibujado todavía, aunque ya pasaron 100 ms
    assert.equal(w.document.querySelector('[data-sid="ultima"]'), null);
    clock.tick(16);
    assert.equal(S.state.activePage, 2);
    assert.equal(w.document.querySelector('[data-sid="ultima"]').classList.contains('sentence-active'), true);
    assert.ok(S.state.autoNavigationPausedUntil > Date.now());
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('un concepto con muchas citas pagina sin perder la última fuente ni construir todos los botones', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    const pages = Array.from({ length: 25 }, (_, i) => ({ pageNum: i + 1, sourcePage: i + 1,
      text: `Texto de la fuente ${i + 1}.`, sentences: [{ id: `cita-${i + 1}`, text: `Texto de la fuente ${i + 1}.` }] }));
    S.addDocument({ id: 'muchas-citas', name: 'muchas.txt', pages });
    S.state.nodes.push({ id: 'popular', cluster: 'AGT-01', label: 'Concepto popular',
      sentenceIds: pages.map((_, i) => `cita-${i + 1}`).concat('fuente-eliminada') });
    S.state.nodes.push(...pages.map((_, i) => ({ id: `vecino-${i + 1}`, cluster: 'AGT-01', label: `Vecino ${i + 1}`, sentenceIds: [] })));
    S.state.links.push(...pages.map((_, i) => ({ source: 'popular', target: `vecino-${i + 1}`, kind: 'synaptic' })));
    S.emit('brain:imported');
    const openPopular = () => [...w.document.querySelectorAll('#graph-fallback .fallback-node')].find(button => button.textContent.includes('Concepto popular')).click();
    openPopular();
    const status = w.document.getElementById('insp-citation-status');
    assert.equal(status.textContent, 'Citas 1–12 / 25');
    assert.equal(w.document.querySelectorAll('#insp-citations button').length, 12);
    assert.equal(w.document.getElementById('insp-citation-prev').disabled, true);
    w.document.getElementById('insp-citation-next').click();
    assert.equal(status.textContent, 'Citas 13–24 / 25');
    const citationPage = w.document.getElementById('insp-citation-page');
    citationPage.value = '999'; citationPage.dispatchEvent(new w.Event('change'));
    assert.equal(citationPage.value, '3', 'el salto se limita a la última página');
    assert.equal(status.textContent, 'Citas 25–25 / 25');
    assert.equal(w.document.querySelectorAll('#insp-citations button').length, 1);
    assert.equal(w.document.getElementById('insp-citation-next').disabled, true);
    const connectionPage = w.document.getElementById('insp-connection-page');
    connectionPage.value = '3'; connectionPage.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(w.document.getElementById('insp-connection-status').textContent, '25–25 / 25');
    assert.match(w.document.getElementById('insp-connection-list').textContent, /Vecino 25/);
    w.document.querySelector('#insp-connection-list button').click();
    assert.equal(w.document.getElementById('insp-label').textContent, 'Vecino 25');
    openPopular();
    citationPage.value = '3'; citationPage.dispatchEvent(new w.Event('change'));
    w.document.querySelector('#insp-citations button').click();
    assert.equal(S.state.activeDocId, 'muchas-citas');
    assert.equal(S.state.activePage, 25, 'la última cita abre su página original');
    assert.equal(S.state.nodes.find(node => node.id === 'popular').sentenceIds.length, 26, 'la paginación no modifica las citas guardadas');
    assert.equal(S.state.links.filter(link => link.source === 'popular').length, 25, 'no se eliminan relaciones');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la proyección semántica se reutiliza al paginar y se invalida cuando cambian los datos', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory(), true);
  try {
    await wait(180); // agotar el aviso semántico inicial
    const S = w.NeuralStore, assignments = new Map();
    let calls = 0;
    w.NCSemantic.info = () => ({ active: true, indexed: 70, total: 70, modelEnabled: true });
    w.NCSemantic.topics = () => [
      { id: 'SEM-1', number: 1, label: 'Tema 1', color: '#38dcff' },
      { id: 'SEM-2', number: 2, label: 'Tema 2', color: '#a78bfa' }
    ];
    w.NCSemantic.topicId = id => { calls++; return assignments.get(id) || 'SEM-1'; };
    w.NCSemantic.preferenceWeights = () => new w.Map();
    S.state.nodes.push(...Array.from({ length: 70 }, (_, i) => ({ id: `cached-${i}`, cluster: 'AGT-01',
      label: `Concepto ${i}`, text: `Texto ${i}`, sentenceIds: [`s-${i}`] })));
    S.emit('node:removed', { nodeId: 'ninguno' });
    const initial = calls;
    assert.ok(initial >= 70);
    w.document.getElementById('graph-next').click();
    w.document.getElementById('graph-prev').click();
    assert.equal(calls, initial, 'paginación reutiliza los temas derivados');
    assignments.set('s-0', 'SEM-2');
    S.emit('semantic:updated');
    await until(() => calls > initial);
    w.NeuralGraph.setClusterFilter('SEM-2');
    assert.equal(w.document.getElementById('graph-page').textContent, '1–1 / 1');
    assert.ok([...w.document.querySelectorAll('#neural-svg .node-group')].some(el => el.__data__.id === 'cached-0' && el.__data__.topicId === 'SEM-2'));
    S.state.nodes = S.state.nodes.filter(node => node.id !== 'cached-0');
    S.emit('node:removed', { nodeId: 'cached-0' });
    assert.equal(w.document.getElementById('graph-page').textContent, '0–0 / 0');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la vista textual sin D3 pagina y abre el inspector de cada concepto', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.state.nodes.push(...Array.from({ length: 45 }, (_, i) => ({ id: `fallback-${i}`, cluster: 'AGT-01',
      label: `Concepto ${i}`, text: `Texto ${i}`, sentenceIds: [] })));
    S.emit('brain:imported');
    assert.equal(w.document.querySelectorAll('#graph-fallback button.fallback-node').length, 40);
    w.document.getElementById('graph-next').click();
    assert.equal(w.document.querySelectorAll('#graph-fallback button.fallback-node').length, 5);
    const first = w.document.querySelector('#graph-fallback button.fallback-node');
    first.focus(); first.click();
    const inspector = w.document.getElementById('node-inspector');
    assert.equal(w.document.getElementById('insp-label').textContent, 'Concepto 40');
    assert.equal(inspector.classList.contains('hidden'), false);
    assert.equal(w.document.activeElement, inspector);
    w.document.getElementById('btn-close-inspector').click();
    assert.equal(w.document.activeElement, first);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la vista de texto sin D3 se actualiza con nodos, temas y eliminación', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore, fallback = w.document.getElementById('graph-fallback');
    S.setSetting('autoHarvest', false);
    S.addDocument({ id: 'd', name: 'd.txt', pages: [{ pageNum: 1,
      sentences: [{ id: 's', text: 'Un fragmento real sobre planetas.' }] }] });
    S.addPattern({ cluster: 'AGT-01', label: 'Planetas', text: 'Un fragmento real sobre planetas.', pageNum: 1, sentenceId: 's' });
    assert.match(fallback.textContent, /AGT-01.*Planetas/);
    installSemanticVectors(w, new Map([['s', [1, 0]]]));
    await until(() => /Tema 1/.test(fallback.textContent));
    assert.match(fallback.textContent, /Tema 1.*Planetas/);
    S.removeDocument('d');
    await until(() => !fallback.textContent.includes('Planetas'));
    assert.match(fallback.textContent, /D3 no disponible/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('los compositores distinguen fichas locales, fuentes originales y documentos', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const chunks = Array.from({ length: 3 }, (_, i) => ({ id: `kb:${i}`, index: i + 1,
      knowledgeId: `kb:${i}`, docId: `kb:${i}`, pageNum: null, text: `El sistema mejora la prevención número ${i}.`,
      sentence: { sourceUrl: 'https://local.test/misma-norma' } }));
    const same = w.NCRag.composeExtractive({ question: 'Critica', mode: 'critico', chunks });
    assert.doesNotMatch(same, /una sola página/);
    assert.match(same, /diversidad de fuentes/);
    chunks[2].sentence.sourceUrl = 'https://local.test/otra-norma';
    const distinct = w.NCRag.composeExtractive({ question: 'Critica', mode: 'critico', chunks });
    assert.doesNotMatch(distinct, /diversidad de fuentes/);
    const summary = w.NCRag.composeExtractive({ question: 'Resume', mode: 'resumen', chunks });
    assert.match(summary, /3 de la base local/);
    assert.doesNotMatch(summary, /3 documento\(s\)/);
    const exam = w.NCRag.composeExtractive({ question: 'Explica', mode: 'examen', chunks });
    assert.doesNotMatch(exam, /sin datos inventados|una sola página|No hay cifras asociadas/);
    assert.match(exam, /No se identificaron cifras con unidad/);
    const numeric = [{ id: 'norma', index: 1, text: 'La norma prevé una jornada de 42 horas.' }];
    const numericSummary = w.NCRag.composeExtractive({ question: 'Resume', mode: 'resumen', chunks: numeric });
    assert.match(numericSummary, /Cifras con unidad detectadas/);
    assert.doesNotMatch(numericSummary, /Evidencia cuantitativa/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('la base local se consulta sin documentos, muestra fecha y permite verificar la ficha offline', async () => {
  const db = new IDBFactory(), first = await createApp(db), { w } = first;
  try {
    w.document.getElementById('btn-toggle-spiders').click();
    w.document.querySelector('[data-workspace="chat"]').click();
    const scope = w.document.getElementById('search-scope');
    assert.equal(scope.value, 'both');
    assert.match(w.document.getElementById('knowledge-meta').textContent, /fichas.*2026-11-16/);
    assert.equal(w.document.querySelectorAll('.knowledge-entry').length, w.NCKnowledge.info().count);
    scope.value = 'knowledge'; scope.dispatchEvent(new w.Event('change', { bubbles: true }));
    let guidance;
    const answer = await w.NCRag.ask('¿Qué es SG-SST?', { onRetrieved: result => { guidance = result; } });
    assert.ok(answer.sources.length);
    assert.ok(answer.sources.every(source => source.origin === 'knowledge'));
    assert.equal(answer.sources[0].knowledgeId, 'kb:sst-sistema');
    assert.equal(guidance.hits.length, 0, 'las fichas no se envían como texto de un documento al enjambre');
    assert.match(answer.text, /no se actualiza automáticamente/);
    assert.match(answer.text, /no sustituye asesoría jurídica/);
    assert.equal(w.NeuralStore.state.docs.length, 0);
    assert.equal(w.NeuralStore.state.allSentences.length, 0);
    assert.equal(w.NeuralStore.state.vault.length, 0);
    assert.equal(w.NeuralStore.state.nodes.filter(n => !n.isHub).length, 0);
    let visualOrders = 0;
    w.NeuralStore.on('spider:queryVisual', () => { visualOrders++; });
    w.document.getElementById('chat-input').value = '¿Qué es SG-SST?';
    const previous = w.NeuralStore.state.chat.length;
    w.document.getElementById('chat-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => w.NeuralStore.state.chat.length > previous);
    assert.equal(visualOrders, 0, 'una consulta solo de fichas no despacha ni muestra guía documental');
    assert.equal(w.document.getElementById('swarm-feedback').textContent, '');
    const article = w.BrainRAG.renderAnswer(answer);
    const details = article.querySelector('.sources-details');
    assert.equal(details.open, false);
    article.querySelector('.answer-body .cite-ref').click();
    assert.equal(details.open, true);
    const source = article.querySelector('[data-source-number="1"]');
    assert.match(source.textContent, /BASE LOCAL.*SG-SST/);
    assert.match(source.textContent, /2026-11-16/);
    assert.match(source.textContent, /requiere conexión/);
    assert.equal(source.querySelector('a').href, answer.sources[0].sourceUrl);
    assert.equal(w.NeuralStore.state.activeDocId, null);
    const md = w.NCRag.toMarkdown(answer);
    assert.match(md, /Base local:/); assert.match(md, /2026-11-16/); assert.match(md, /funcionpublica\.gov\.co/);
    await w.NeuralStore.savePersistent();
    assert.deepEqual(first.errors, []);
  } finally { first.dom.window.close(); }
  const second = await createApp(db);
  try {
    assert.equal(second.w.document.getElementById('search-scope').value, 'knowledge');
    const restored = second.w.document.querySelector('.sources-details');
    assert.ok(restored);
    second.w.document.querySelector('.answer-body .cite-ref').click();
    assert.equal(restored.open, true);
    assert.match(restored.textContent, /BASE LOCAL/);
    assert.deepEqual(second.errors, []);
  } finally { second.dom.window.close(); }
});

test('ámbitos, filtros y feedback separan fichas públicas de documentos privados', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    w.document.getElementById('btn-toggle-spiders').click();
    const S = w.NeuralStore;
    S.addDocument({ id: 'privado', name: 'privado.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'priv-s', text: 'La jornada laboral de nuestro proyecto es de 42 horas semanales en Colombia.' }
    ] }] });
    const before = { docs: S.state.docs.length, sentences: S.state.allSentences.length, vault: S.state.vault.length, nodes: S.state.nodes.length };
    const q = 'jornada laboral 42 horas Colombia';
    const both = await w.NCRag.ask(q, { scope: 'both' });
    assert.ok(both.sources.some(source => source.origin === 'document' && source.docId === 'privado'));
    assert.ok(both.sources.some(source => source.origin === 'knowledge' && source.knowledgeId === 'kb:jornada-42'));
    assert.equal(S.state.docs.length, before.docs); assert.equal(S.state.allSentences.length, before.sentences);
    assert.equal(S.state.vault.length, before.vault); assert.equal(S.state.nodes.length, before.nodes);
    const docs = await w.NCRag.ask(q, { scope: 'documents' });
    assert.ok(docs.sources.length); assert.ok(docs.sources.every(source => source.origin === 'document'));
    S.state.vault.push({ phrase: 'La jornada privada secreta', detail: 'datos secretos', keywords: ['jornada'] });
    const local = await w.NCRag.ask(q, { scope: 'knowledge' });
    assert.ok(local.sources.length); assert.ok(local.sources.every(source => source.origin === 'knowledge'));
    assert.doesNotMatch(local.text, /nuestro proyecto|secreta/i);
    const filtered = await w.NCRag.ask('jornada laboral =doc:privado', { scope: 'both' });
    assert.ok(filtered.sources.length); assert.ok(filtered.sources.every(source => source.docId === 'privado'));
    const pages = await w.NCRag.ask('jornada laboral =pag:1', { scope: 'both' });
    assert.ok(pages.sources.length); assert.ok(pages.sources.every(source => source.origin === 'document'));
    const noMatch = await w.NCRag.ask('seguridad social desconocida', { scope: 'knowledge' });
    assert.equal(noMatch.sources.length, 0); assert.match(noMatch.text, /Sin evidencia suficiente/);
    const article = w.BrainRAG.renderAnswer(local);
    const train = w.KimiAuxModel.trainOnPattern, negative = w.KimiAuxModel.recordNegativeEpisode;
    let training = 0; w.KimiAuxModel.trainOnPattern = () => training++; w.KimiAuxModel.recordNegativeEpisode = () => training++;
    article.querySelector('[aria-label="Respuesta útil"]').click();
    assert.equal(training, 0); assert.equal(S.state.feedback.at(-1).sentenceIds.length, 0);
    w.KimiAuxModel.trainOnPattern = train; w.KimiAuxModel.recordNegativeEpisode = negative;
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('una búsqueda documental sin resultados informa sin despachar y no deja avisos en solo base', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore;
    S.setSetting('autoHarvest', false);
    S.setSetting('searchScope', 'documents');
    S.addDocument({ id: 'doc-feedback', name: 'privado.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'feedback-source', text: 'La huerta contiene tomates y plantas.' }
    ] }] });
    let visualOrders = 0, dispatched = 0;
    S.on('spider:queryVisual', () => { visualOrders++; });
    S.on('spiders:dispatched', () => { dispatched++; });
    const absent = await w.BrainRAG.send('xyzzyplugh inexistente');
    assert.equal(absent.sources.length, 0);
    assert.match(w.document.getElementById('swarm-feedback').textContent, /sin pasajes disponibles/i);
    assert.equal(visualOrders, 0, 'un resultado vacío no debe producir una señal de despacho');
    assert.equal(dispatched, 0);
    assert.equal(S.state.claimedTargets.size, 0);

    S.setSetting('searchScope', 'knowledge');
    const knowledge = await w.BrainRAG.send('¿Qué es el SG-SST?');
    assert.ok(knowledge.sources.some(source => source.origin === 'knowledge'));
    assert.equal(w.document.getElementById('swarm-feedback').textContent, '', 'no conservar el aviso documental anterior');
    assert.equal(visualOrders, 0);
    assert.equal(dispatched, 0);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('una cita de base importada nunca convierte URL arbitrarias ni HTML en una fuente confiable', async () => {
  const { dom, w, errors } = await createApp(new IDBFactory());
  try {
    const base = w.NCKnowledge.get('kb:sst-sistema');
    const fake = { question: 'prueba', text: 'Fuente [1] y [2].', mode: 'examen', provider: 'internal',
      sources: [{ origin: 'knowledge', knowledgeId: base.id, sourceUrl: 'javascript:alert(1)', docName: '<img src=x>', text: '<script>mal</script>' },
        { origin: 'knowledge', knowledgeId: 'kb:inventada', sourceUrl: 'https://evil.example/', text: 'inventado' }] };
    const article = w.BrainRAG.renderAnswer(fake);
    assert.equal(article.querySelectorAll('img,script').length, 0);
    assert.equal(article.querySelectorAll('.sources-details a').length, 1);
    assert.equal(article.querySelector('.sources-details a').href, base.sourceUrl);
    assert.match(article.textContent, /Ficha local no disponible/);
    assert.doesNotMatch(w.NCRag.toMarkdown(fake), /evil\.example|javascript:/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('el chat usa síntesis educativas como evidencia local, con procedencia, ámbitos y persistencia', async () => {
  const db = new IDBFactory(), first = await createApp(db), { w } = first;
  try {
    w.document.getElementById('btn-toggle-spiders').click();
    const S = w.NeuralStore;
    S.setSetting('searchScope', 'knowledge');
    let fetches = 0, visual = 0, providerContext;
    w.fetch = async () => { fetches++; throw new Error('La consulta educativa no debe acceder a la red'); };
    S.on('spider:queryVisual', () => { visual++; });
    const run = w.NCProviders.run;
    w.NCProviders.run = async (ctx, options) => { providerContext = ctx; return run(ctx, options); };
    const before = [S.state.docs.length, S.state.allSentences.length, S.state.patterns.length, S.state.vault.length, S.state.nodes.length];
    const answer = await w.BrainRAG.send('¿Qué dice Aprende.org sobre las variables?');
    w.NCProviders.run = run;
    assert.equal(answer.sources[0].knowledgeId, 'kb:educacion-variable');
    assert.match(answer.text, /Una variable permite asociar un nombre con un dato/);
    assert.match(answer.text, /int cantidad = 4/);
    assert.match(answer.text, /síntesis propias.*no cursos completos/i);
    assert.ok(answer.sources.every(source => source.origin === 'knowledge' && source.collection === 'Aprende.org / Capacítate para el Empleo'));
    assert.ok(providerContext.chunks.some(chunk => chunk.id === 'kb:educacion-variable' && chunk.text.includes('Una variable permite')),
      'el compositor recibe los conceptos como evidencia, no solo una sugerencia de enlace');
    assert.ok(providerContext.chunks.every(chunk => chunk.text === w.NCKnowledge.get(chunk.id).sourceText), 'no se agregan palabras clave a la evidencia');
    assert.deepEqual([S.state.docs.length, S.state.allSentences.length, S.state.patterns.length, S.state.vault.length, S.state.nodes.length], before);
    assert.equal(visual, 0, 'las fichas no se envían al lector de documentos');
    assert.equal(fetches, 0);
    const article = [...w.document.querySelectorAll('.msg-ai')].at(-1);
    assert.match(article.textContent, /Una variable permite/);
    article.querySelector('.cite-ref').click();
    const details = article.querySelector('.sources-details'), source = details.querySelector('li');
    assert.equal(details.open, true);
    assert.match(source.textContent, /Capacítate para el Empleo.*2026-11-16|2026-11-16.*Capacítate para el Empleo/);
    assert.equal(source.querySelector('a').href, 'https://capacitateparaelempleo.org/assets/j8yic4i.pdf');
    const md = w.NCRag.toMarkdown(answer);
    assert.match(md, /Una variable permite/); assert.match(md, /2026-11-16/);
    assert.match(md, /https:\/\/capacitateparaelempleo\.org\/assets\/j8yic4i\.pdf/);

    const safety = await w.NCRag.ask('Aprende.org SST alturas', { scope: 'knowledge' });
    assert.notEqual(safety.intent, 'learn');
    assert.equal(safety.sources[0].knowledgeId, 'kb:educacion-alturas');
    assert.match(safety.text, /sistemas anticaídas/i);
    assert.match(safety.text, /no es legislación colombiana.*no prueba cumplimiento/i);
    assert.match(safety.text, /Revisión 2026-11-16/);
    const barePortal = await w.NCRag.ask('Aprende SST alturas', { scope: 'knowledge' });
    assert.notEqual(barePortal.intent, 'learn');
    assert.equal(barePortal.sources[0].knowledgeId, 'kb:educacion-alturas');
    const ai = await w.NCRag.ask('Aprende IA generativa', { scope: 'knowledge' });
    assert.notEqual(ai.intent, 'learn');
    assert.equal(ai.sources[0].knowledgeId, 'kb:educacion-ia-generativa');
    assert.match(ai.text, /producir texto, imágenes, música o código/);
    assert.equal(S.state.vault.length, before[3], 'nombrar el portal no memoriza texto accidentalmente');
    assert.equal(w.NCRag.detectIntent('Aprende que el cielo es azul'), 'learn');
    const pruebat = await w.NCRag.ask('PruébaT pseudocódigo', { scope: 'knowledge' });
    assert.ok(pruebat.sources.length && pruebat.sources.every(item => item.collection === 'PruébaT'));
    assert.match(pruebat.text, /pseudocódigo expresa los pasos/i);

    S.addDocument({ id: 'doc-privado', name: 'privado.txt', pages: [{ pageNum: 1, sentences: [
      { id: 'doc-privado-s1', text: 'Una variable privada almacena el número secreto 726.' }
    ] }] });
    const count = S.state.allSentences.length;
    const docs = await w.NCRag.ask('variable', { scope: 'documents' });
    assert.ok(docs.sources.length && docs.sources.every(item => item.origin === 'document'));
    const both = await w.NCRag.ask('variable', { scope: 'both' });
    assert.ok(both.sources.some(item => item.origin === 'document'));
    assert.ok(both.sources.some(item => item.knowledgeId === 'kb:educacion-variable'));
    assert.equal(S.state.allSentences.length, count, 'las síntesis no se insertan en el corpus privado');
    const filtered = await w.NCRag.ask('variable =doc:privado', { scope: 'both' });
    assert.ok(filtered.sources.length && filtered.sources.every(item => item.origin === 'document'));
    const character = await w.NCRag.ask('variable', { mode: 'conversacion' });
    assert.ok(character.sources.every(item => item.origin !== 'knowledge'));

    const fake = { question: 'prueba', text: 'Ficha [1].', mode: 'examen', provider: 'internal',
      sources: [{ origin: 'knowledge', knowledgeId: 'kb:educacion-variable', sourceUrl: 'javascript:alert(1)', text: '<script>mal</script>' }] };
    const fakeArticle = w.BrainRAG.renderAnswer(fake);
    assert.equal(fakeArticle.querySelector('.sources-details a').href, 'https://capacitateparaelempleo.org/assets/j8yic4i.pdf');
    assert.equal(fakeArticle.querySelectorAll('script,img').length, 0);
    assert.doesNotMatch(w.NCRag.toMarkdown(fake), /javascript:alert/);
    await S.savePersistent();
    assert.deepEqual(first.errors, []);
  } finally { first.dom.window.close(); }
  const second = await createApp(db);
  try {
    const restored = [...second.w.document.querySelectorAll('.msg-ai')].find(node => node.textContent.includes('Una variable permite asociar'));
    assert.ok(restored, 'el historial vuelve a mostrar la síntesis educativa');
    assert.equal(restored.querySelector('.sources-details a').href, 'https://capacitateparaelempleo.org/assets/j8yic4i.pdf');
    assert.match(restored.textContent, /2026-11-16/);
    assert.deepEqual(second.errors, []);
  } finally { second.dom.window.close(); }
});
