/** Herramientas de estudio locales: guía, SRS, quiz, bóveda, métricas y respaldo. */
(function (root) {
  'use strict';
  const U = root.NCUtil, A = root.NCAnalysis, SRS = root.NCSRS;
  const store = () => root.NeuralStore;
  let activeBot = 'guide', cardShown = false, showAllCards = false;
  let quiz = null, quizTimer = null, vaultQuery = '';

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(text, click, cls) {
    const node = el('button', cls || 'btn-mini', text);
    node.type = 'button'; node.addEventListener('click', click);
    return node;
  }
  function download(name, text, type) { root.BrainRAG.download(name, text, type); }
  function header(title, detail) {
    const h = el('div', 'study-heading');
    const left = el('div'); left.appendChild(el('h3', '', title));
    if (detail) left.appendChild(el('p', 'muted small', detail));
    h.appendChild(left); return h;
  }
  function jump(sentence) {
    if (!sentence) return;
    if (root.DocViewer?.goToSentence(sentence.id, sentence.docId)) return;
    store().holdAutoNavigation();
    store().setActiveDoc(sentence.docId, sentence.pageNum);
  }
  function renderGuide(stage) {
    const S = store(), sentences = S.state.allSentences.slice(0, 80);
    stage.appendChild(header('Guía de estudio', 'Síntesis extractiva editable; se conserva la procedencia de cada pasaje.'));
    const picked = A.summarize(sentences, Math.min(10, sentences.length));
    const text = '# Guía de estudio\n\n' + (picked.length ? picked.map(x => {
      const s = x.item; return `- ${s.text} (${s.docName || 'Documento'}, pág. ${s.sourcePage || s.pageNum || '?'})`;
    }).join('\n\n') : 'Carga texto o usa Demo para generar una guía.');
    const editor = el('textarea', 'study-editor'); editor.id = 'guide-editor'; editor.value = text;
    editor.setAttribute('aria-label', 'Guía de estudio editable'); stage.appendChild(editor);
    stage.appendChild(button('↓ Descargar guía .md', () => download('guia-estudio.md', editor.value, 'text/markdown;charset=utf-8'), 'btn-hud btn-cyan'));
  }
  function generateCards() {
    const S = store(), existing = new Set(S.state.cards.map(c => c.id));
    let added = 0;
    for (const sentence of S.state.allSentences.slice(0, 500)) {
      const id = 'fc-' + sentence.id;
      if (existing.has(id)) continue;
      const answer = A.pickAnswerTerm(sentence.text);
      if (!answer || !sentence.text.includes(answer)) continue;
      const node = S.state.nodes.find(n => (n.sentenceIds || []).includes(sentence.id));
      S.state.cards.push(SRS.newCard({
        id, front: 'Completa: ' + sentence.text.replace(answer, '________'),
        back: `${answer}\n\n${sentence.text}`, sentenceId: sentence.id,
        pageNum: sentence.pageNum, docName: sentence.docName, cluster: node?.cluster || 'AGT-01'
      }));
      existing.add(id); added++;
    }
    S.savePersistent(); cardShown = false; showAllCards = false;
    return added;
  }
  function renderCards(stage) {
    const S = store(), stats = SRS.deckStats(S.state.cards);
    stage.appendChild(header('Tarjetas · repetición espaciada', `${stats.total} tarjetas · ${stats.due} pendientes · dominio estimado ${U.pct(stats.mastery)}`));
    const toolbar = el('div', 'study-toolbar');
    toolbar.appendChild(button('+ Generar desde documentos', () => { generateCards(); render(); }, 'btn-hud btn-violet'));
    toolbar.appendChild(button('↓ Anki CSV', () => download('tarjetas-anki.csv', SRS.ankiCsv(S.state.cards), 'text/csv;charset=utf-8')));
    toolbar.appendChild(button(showAllCards ? 'Solo pendientes' : 'Ver todas', () => { showAllCards = !showAllCards; cardShown = false; render(); }));
    stage.appendChild(toolbar);
    const cards = showAllCards ? S.state.cards.slice().sort((a, b) => a.due - b.due) : SRS.dueCards(S.state.cards);
    if (!cards.length) {
      stage.appendChild(el('p', 'empty-hint', stats.total ? '¡No hay tarjetas pendientes! Puedes ver todas o volver más tarde.' : 'Genera tarjetas después de cargar un documento.'));
      return;
    }
    const card = cards[0], panel = el('div', 'study-card');
    panel.appendChild(el('div', 'study-card-meta', `Caja ${card.box || 0}/5 · próximo repaso: ${SRS.dueLabel(card)}`));
    panel.appendChild(el('p', 'study-card-front', card.front));
    if (cardShown) {
      panel.appendChild(el('p', 'study-card-back', card.back));
      const source = S.getSentence(card.sentenceId);
      if (source) panel.appendChild(button(`${source.docName} · pág. ${source.sourcePage || source.pageNum}`, () => jump(source), 'source-link'));
      const grades = el('div', 'grade-buttons');
      [['again', 'Otra vez'], ['hard', 'Difícil'], ['good', 'Bien'], ['easy', 'Fácil']].forEach(([grade, label]) => {
        grades.appendChild(button(label, () => {
          const index = S.state.cards.findIndex(c => c.id === card.id);
          if (index >= 0) S.state.cards[index] = SRS.review(card, grade);
          S.savePersistent(); cardShown = false; render();
        }, grade === 'good' ? 'btn-hud btn-cyan' : 'btn-mini'));
      });
      panel.appendChild(grades);
    } else panel.appendChild(button('Mostrar respuesta', () => { cardShown = true; render(); }, 'btn-hud btn-cyan'));
    stage.appendChild(panel);
  }
  function stopTimer() { if (quizTimer) clearInterval(quizTimer); quizTimer = null; }
  function startQuiz(timed) {
    stopTimer();
    const items = A.quizItems(store().state.allSentences, { n: 5, minLen: 35 });
    if (!items.length) { quiz = { error: 'Se necesitan al menos dos pasajes con vocabulario suficiente para crear distractores.' }; render(); return; }
    quiz = { items, answers: Array(items.length).fill(null), index: 0, started: Date.now(), timed, deadline: Date.now() + 180000, done: false };
    if (timed) quizTimer = setInterval(() => {
      if (!quiz || quiz.done) { stopTimer(); return; }
      const clock = document.getElementById('quiz-clock');
      const remaining = Math.max(0, Math.ceil((quiz.deadline - Date.now()) / 1000));
      if (clock) clock.textContent = `Tiempo restante: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
      if (!remaining) finishQuiz();
    }, 250);
    render();
  }
  function finishQuiz() {
    if (!quiz || quiz.done || !quiz.items) return;
    stopTimer(); quiz.done = true;
    const score = SRS.quizAccuracy(quiz.items, quiz.answers);
    const run = { ...score, at: Date.now(), timed: quiz.timed, perCluster: SRS.perClusterFromQuiz(quiz.items, quiz.answers) };
    store().state.quizRuns.push(run);
    if (store().state.quizRuns.length > 50) store().state.quizRuns.shift();
    store().savePersistent(); render();
  }
  function renderQuiz(stage) {
    const S = store();
    const previous = S.state.quizRuns.at(-1);
    stage.appendChild(header('Quiz de estudio', previous ? `Último resultado: ${previous.correct}/${previous.total} · ${U.pct(previous.accuracy)}` : 'Preguntas con distractores del material y revisión con fuente.'));
    if (!quiz || quiz.error) {
      if (quiz?.error) stage.appendChild(el('p', 'citation-warning', quiz.error));
      const label = el('label', 'check-row');
      const timed = el('input'); timed.type = 'checkbox'; timed.id = 'quiz-timed';
      label.append(timed, document.createTextNode(' Modo examen: 3 minutos'));
      stage.append(label, button('Crear quiz', () => startQuiz(timed.checked), 'btn-hud btn-cyan'));
      return;
    }
    if (quiz.done) {
      const score = SRS.quizAccuracy(quiz.items, quiz.answers);
      stage.appendChild(el('div', 'quiz-score', `${score.correct} / ${score.total} · ${U.pct(score.accuracy)}`));
      quiz.items.forEach((item, i) => {
        const row = el('div', 'quiz-review');
        row.appendChild(el('strong', '', `${quiz.answers[i] === item.answer ? '✓' : '✗'} ${item.prompt}`));
        row.appendChild(el('p', 'muted', `Tu respuesta: ${quiz.answers[i] || 'sin responder'} · correcta: ${item.answer}`));
        if (item.sentence) row.appendChild(button(`${item.sentence.docName} · pág. ${item.sentence.sourcePage || item.sentence.pageNum}`, () => jump(item.sentence), 'source-link'));
        stage.appendChild(row);
      });
      stage.appendChild(button('Nuevo quiz', () => { quiz = null; render(); }, 'btn-hud btn-cyan'));
      return;
    }
    const item = quiz.items[quiz.index], selected = quiz.answers[quiz.index];
    const top = el('div', 'quiz-top');
    top.appendChild(el('strong', '', `Pregunta ${quiz.index + 1} / ${quiz.items.length}`));
    if (quiz.timed) top.appendChild(el('span', 'amber', '',));
    if (quiz.timed) top.lastChild.id = 'quiz-clock';
    stage.appendChild(top);
    stage.appendChild(el('p', 'quiz-prompt', item.prompt));
    const options = el('div', 'quiz-options');
    item.options.forEach(option => {
      const b = button(option, () => { quiz.answers[quiz.index] = option; render(); }, 'btn-hud btn-ghost quiz-option');
      if (selected !== null) b.disabled = true;
      if (selected !== null && option === item.answer) b.classList.add('correct');
      if (selected === option && option !== item.answer) b.classList.add('incorrect');
      options.appendChild(b);
    });
    stage.appendChild(options);
    if (selected !== null) {
      stage.appendChild(el('p', selected === item.answer ? 'emerald' : 'coral', selected === item.answer ? 'Correcto.' : `Respuesta correcta: ${item.answer}`));
      if (item.sentence) stage.appendChild(button('Ver fuente', () => jump(item.sentence), 'source-link'));
      stage.appendChild(button(quiz.index === quiz.items.length - 1 ? 'Terminar y guardar' : 'Siguiente →', () => {
        if (quiz.index === quiz.items.length - 1) finishQuiz();
        else { quiz.index++; render(); }
      }, 'btn-hud btn-cyan'));
    }
    stage.appendChild(button('Finalizar ahora', finishQuiz));
  }
  function renderVault(stage) {
    const S = store();
    stage.appendChild(header('Bóveda de conocimiento', `${S.state.vault.length} conceptos guardados localmente.`));
    const search = el('input', 'study-input'); search.type = 'search'; search.placeholder = 'Buscar en la bóveda'; search.value = vaultQuery;
    search.setAttribute('aria-label', 'Buscar en la bóveda');
    search.addEventListener('input', () => { vaultQuery = search.value; renderVaultList(list); });
    stage.appendChild(search);
    const add = el('div', 'study-toolbar');
    const input = el('input', 'study-input'); input.placeholder = 'Añadir una nota a la bóveda'; input.setAttribute('aria-label', 'Nueva nota');
    add.append(input, button('Guardar', () => {
      const value = input.value.trim(); if (!value) return;
      root.NCMemory.vaultAdd({ phrase: value, detail: value }); input.value = ''; render();
    }, 'btn-hud btn-cyan'));
    stage.appendChild(add);
    const list = el('div', 'vault-list'); stage.appendChild(list); renderVaultList(list);
  }
  function renderVaultList(list) {
    list.replaceChildren();
    const entries = root.NCMemory.vaultSearch(vaultQuery, { limit: 80 });
    if (!entries.length) { list.appendChild(el('p', 'muted', 'No hay entradas que coincidan.')); return; }
    entries.forEach(item => {
      const row = el('article', 'vault-entry');
      const line = el('div', 'vault-entry-head'); line.append(el('strong', '', item.phrase), el('span', 'badge badge-cyan', `×${item.reinforcement || 1}`));
      row.append(line, el('p', '', item.detail || ''));
      (item.sources || []).forEach(src => {
        const sentence = store().getSentence(src.sentenceId);
        if (sentence) row.appendChild(button(`${src.doc || 'Fuente'} · pág. ${sentence.sourcePage || src.page || '?'}`, () => jump(sentence), 'source-link'));
      });
      row.appendChild(button('Eliminar', () => { root.NCMemory.vaultRemove(item.id); render(); }, 'btn-mini'));
      list.appendChild(row);
    });
  }
  function renderMetrics(stage) {
    stage.appendChild(header('Evaluación del motor', 'Medición local de recuperación, latencia y citas.'));
    const btn = button('▶ Evaluar corpus', () => {
      btn.disabled = true; result.replaceChildren(el('p', 'muted', 'Evaluando…'));
      setTimeout(async () => {
        try {
          const run = await root.NCEval.run({ sample: 40, k: 5 });
          if (run.error) result.replaceChildren(el('p', 'citation-warning', run.error));
          else root.NCEval.render();
        } catch (error) { result.replaceChildren(el('p', 'citation-warning', error.message)); }
        finally { btn.disabled = false; }
      }, 20);
    }, 'btn-hud btn-cyan');
    stage.appendChild(btn);
    const result = el('div', 'metrics-results'); result.id = 'eval-results'; stage.appendChild(result);
    root.NCEval.render();
  }
  function renderBackup(stage) {
    stage.appendChild(header('Respaldo local', 'Exporta documentos indexados, grafo, tarjetas, quiz, memoria y ajustes en JSON. Los archivos multimedia originales no se incluyen.'));
    const status = el('p', 'muted'); status.setAttribute('role', 'status');
    stage.appendChild(button('↓ Exportar cerebro .json', async () => {
      try { download('neural-command-respaldo.json', JSON.stringify(await store().exportBrain(), null, 2), 'application/json;charset=utf-8'); status.textContent = 'Respaldo preparado.'; }
      catch (e) { status.textContent = `No se pudo exportar: ${e.message}`; }
    }, 'btn-hud btn-cyan'));
    const label = el('label', 'btn-hud btn-ghost backup-label', '↑ Importar respaldo .json');
    const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
    file.addEventListener('change', async () => {
      if (!file.files?.length) return;
      if (!confirm('Importar reemplazará el estado local actual. ¿Continuar?')) { file.value = ''; return; }
      try {
        const data = JSON.parse(await file.files[0].text());
        await store().importBrain(data); status.textContent = 'Respaldo importado.';
      } catch (e) { status.textContent = `No se pudo importar: ${e.message}`; }
      file.value = '';
    });
    label.appendChild(file); stage.append(label, status);
  }
  function render() {
    const stage = document.getElementById('bot-stage');
    if (!stage) return;
    document.querySelectorAll('.bot-btn').forEach(b => {
      const active = b.dataset.bot === activeBot; b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active));
    });
    stage.replaceChildren();
    if (activeBot === 'guide') renderGuide(stage);
    else if (activeBot === 'flashcards') renderCards(stage);
    else if (activeBot === 'quiz') renderQuiz(stage);
    else if (activeBot === 'vault') renderVault(stage);
    else if (activeBot === 'metrics') renderMetrics(stage);
    else if (activeBot === 'backup') renderBackup(stage);
  }
  function init() {
    document.querySelectorAll('.bot-btn').forEach(b => b.addEventListener('click', () => { activeBot = b.dataset.bot; cardShown = false; render(); }));
    store().on('system:reset', () => { stopTimer(); quiz = null; cardShown = false; render(); });
    store().on('brain:imported', () => { stopTimer(); quiz = null; render(); });
    store().on('doc:added', () => { if (activeBot === 'guide') render(); });
    store().on('doc:removed', () => { if (activeBot === 'guide' || activeBot === 'flashcards') render(); });
    render();
  }
  root.StudyBots = { init, render, generateCards, startQuiz, finishQuiz };
})(typeof window !== 'undefined' ? window : globalThis);
