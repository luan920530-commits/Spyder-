/** Herramientas de estudio locales: tutor, guía, SRS, quiz, bóveda, métricas y respaldo. */
(function (root) {
  'use strict';
  const U = root.NCUtil, A = root.NCAnalysis, SRS = root.NCSRS, skills = root.NCStudySkills;
  const store = () => root.NeuralStore;
  let learner;
  let activeBot = 'guide', cardShown = false, showAllCards = false, browseIndex = 0;
  let quiz = null, quizTimer = null, vaultQuery = '', guideDraft = null;
  let session = null, tutorDocId = '', tutorSkill = 'recall', tutorNotice = '', changingCorpus = false;

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
  function jump(sentence, card) {
    if (card?.kind === 'highlight') { root.NCQuestionUI.showSource(card); return; }
    if (!sentence || store().getSentence(sentence.id)?.docId !== sentence.docId) return;
    if (root.DocViewer?.goToSentence(sentence.id, sentence.docId)) return;
    store().holdAutoNavigation();
    store().setActiveDoc(sentence.docId, sentence.pageNum);
  }
  // La sesión y el texto escrito son transitorios. Solo se persiste el balance
  // al completar todos los turnos; las tarjetas de refuerzo son optativas.
  function beginPractice(items) {
    if (!items.length) {
      tutorNotice = 'No hay un término adecuado para ocultar en este material. Prueba «Explicación propia» o elige otro documento.';
    } else {
      tutorNotice = '';
      session = { items, turns: [], phase: tutorSkill === 'explain' ? 'read' : 'attempt', draft: '', hint: false };
    }
    renderPractice();
  }
  function reviewTurn(ok) {
    if (session?.phase !== 'feedback') return;
    const item = session.items[session.turns.length];
    session.turns.push({ sentenceId: item.source.id, ok, hint: session.hint });
    session.draft = ''; session.hint = false; session.feedback = null;
    if (session.turns.length === session.items.length) {
      session.phase = 'done';
      store().recordTutorRun({ docId: tutorDocId, skill: tutorSkill, at: Date.now(), turns: session.turns });
    } else session.phase = tutorSkill === 'explain' ? 'read' : 'attempt';
    renderPractice();
  }
  function renderTutorSetup(stage) {
    const S = store(), docs = S.state.docs.filter(d => !d.mediaType && d.pages.some(p => p.sentences.some(s => s.text.trim())));
    if (tutorNotice) { const status = el('p', 'citation-warning', tutorNotice); status.setAttribute('role', 'status'); stage.appendChild(status); }
    if (!docs.length) {
      stage.append(el('p', 'empty-hint', 'El tutor necesita al menos un pasaje con texto. Elige tus apuntes o prueba con los documentos de la demo.'),
        button('Elegir archivo', () => document.getElementById('file-input').click(), 'btn-hud btn-cyan'),
        button('Cargar demo', () => document.getElementById('btn-load-demo').click()),
        button('Leer un escaneo', () => {
          const tools = document.getElementById('ocr-tools'); tools.open = true; tools.scrollIntoView({ block: 'center' }); tools.querySelector('summary').focus();
        }));
      return;
    }
    if (!docs.some(d => d.id === tutorDocId)) tutorDocId = (docs.find(d => d.id === S.state.activeDocId) || docs[0]).id;
    const setup = el('div', 'tutor-setup');
    function select(id, title, entries, value, change) {
      const label = el('label', '', title); label.htmlFor = id;
      const control = el('select'); control.id = id;
      for (const [key, text] of entries) { const opt = el('option', '', text); opt.value = key; control.appendChild(opt); }
      control.value = value;
      control.addEventListener('change', () => { change(control.value); tutorNotice = ''; renderPractice(); document.getElementById(id)?.focus(); });
      setup.append(label, control);
    }
    select('tutor-doc', 'Documento', docs.map(d => [d.id, d.displayName || d.name]), tutorDocId, id => { tutorDocId = id; });
    select('tutor-skill', 'Habilidad', Object.entries(skills.SKILLS), tutorSkill, skill => { tutorSkill = skill; });
    stage.append(setup, el('p', 'tutor-instruction', tutorSkill === 'recall'
      ? 'Completa la palabra que falta sin mirar la fuente. Después podrás comprobarla en el pasaje.'
      : 'Lee un pasaje, ocúltalo e intenta explicarlo con tus palabras. Compararás tu explicación con el original.'),
      button('Empezar práctica', () => beginPractice(skills.plan(S.state.allSentences, tutorDocId, tutorSkill, S.state.tutorRuns)), 'btn-hud btn-cyan'));
    const last = S.state.tutorRuns.filter(r => r.docId === tutorDocId && r.skill === tutorSkill).at(-1);
    if (last) {
      const pending = last.turns.filter(t => !t.ok || t.hint).length;
      stage.appendChild(el('p', 'study-card-meta tutor-last', `Última práctica: ${last.turns.length} ${last.turns.length === 1 ? 'pasaje' : 'pasajes'} · ${pending} para reforzar. Los pendientes se practican primero.`));
    }
  }
  function renderTutor(stage) {
    stage.appendChild(header('Tutor de estudio', 'Hasta tres pasajes de un documento. Solo se guarda el balance final, no tus respuestas. No necesitas instalar un modelo.'));
    if (!session) { renderTutorSetup(stage); return; }
    const { items, turns, phase } = session;
    if (phase === 'done') {
      const pending = items.filter((_, i) => !turns[i].ok || turns[i].hint);
      const panel = el('div', 'study-card tutor-result');
      panel.append(el('strong', '', 'Práctica completada'), el('p', '', `${skills.SKILLS[tutorSkill]} · ${items[0].source.docName}`),
        el('p', '', `${tutorSkill === 'recall' ? 'Términos recordados' : 'Ideas que marcaste como explicadas'}: ${turns.filter(t => t.ok).length}/${turns.length}. Pistas usadas: ${turns.filter(t => t.hint).length}.`),
        el('p', 'muted', pending.length ? `Pasajes para reforzar por dificultad o uso de pista: ${pending.length}.` : 'No quedaron pasajes pendientes. En otra sesión se priorizará material nuevo.'));
      if (pending.length) {
        panel.appendChild(button('Practicar solo los pendientes', () => beginPractice(pending), 'btn-hud btn-cyan'));
        const save = button('Añadir pendientes a Tarjetas', () => {
          const n = addStudyCards(pending.map(item => item.source), true);
          if (n && ['flashcards', 'plan'].includes(activeBot)) render();
          session.cardNotice = n ? `Tarjetas nuevas: ${n}. Repásalas en Estudio → Mi repaso.` : 'Estos pasajes ya están en Tarjetas.';
          renderPractice();
        });
        save.disabled = !!session.cardNotice; panel.appendChild(save);
        if (session.cardNotice) panel.appendChild(el('p', 'emerald', session.cardNotice));
      }
      stage.append(panel, button('Elegir otra práctica', () => { session = null; renderPractice(); }));
      return;
    }
    const item = items[turns.length], source = item.source, panel = el('div', 'study-card tutor-turn');
    panel.append(el('div', 'study-card-meta', `${skills.SKILLS[tutorSkill]} · Pasaje ${turns.length + 1} de ${items.length}`),
      el('p', 'muted small', `${source.docName} · pág. ${source.sourcePage || source.pageNum}`));
    if (phase === 'read') {
      panel.append(el('strong', '', 'Primero, lee el pasaje'), el('blockquote', 'study-card-back', source.text),
        button('Ocultar y explicar', () => { session.phase = 'attempt'; renderPractice(); document.getElementById('tutor-answer').focus(); }, 'btn-hud btn-cyan'));
    } else if (phase === 'attempt') {
      const label = el('label', 'study-card-front', item.prompt); label.htmlFor = 'tutor-answer';
      const input = el(tutorSkill === 'recall' ? 'input' : 'textarea', 'study-input');
      input.id = 'tutor-answer'; input.value = session.draft; input.maxLength = 2000; input.autocomplete = 'off';
      input.spellcheck = false; // No solicitar corrección remota del texto de práctica.
      // Es una comparación en memoria, no un envío de formulario. También debe
      // funcionar en una vista previa sin el permiso allow-forms.
      const controls = el('div', 'tutor-form');
      function showFeedback(feedback) {
        if (!feedback) return;
        session.draft = input.value; session.feedback = feedback; session.phase = 'feedback'; renderPractice();
        document.getElementById('tutor-feedback')?.focus();
      }
      const submit = button('Comparar con la fuente', () => showFeedback(skills.compare(item, tutorSkill, input.value)), 'btn-hud btn-cyan');
      submit.disabled = !session.draft.trim();
      input.addEventListener('input', () => { session.draft = input.value; submit.disabled = !input.value.trim(); });
      if (tutorSkill === 'recall') input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submit.click(); }
      });
      const hintText = el('p', 'muted', item.hint); hintText.hidden = !session.hint;
      const hint = button('Dame una pista', () => { session.hint = true; hintText.hidden = false; hint.disabled = true; });
      hint.disabled = session.hint; controls.append(label, input, hint, hintText, submit);
      if (tutorSkill === 'recall') controls.appendChild(button('No lo recuerdo', () => { input.value = ''; showFeedback({ ok: false }); }));
      panel.appendChild(controls);
    } else {
      const feedback = session.feedback;
      const verdict = el('strong', '', tutorSkill === 'explain' ? 'Compara las ideas' : feedback.ok ? 'Recordaste el término.' : `El término del pasaje es «${item.answer}».`);
      verdict.id = 'tutor-feedback'; verdict.tabIndex = -1;
      panel.append(verdict, el('p', '', session.draft ? `Tu respuesta: ${session.draft}` : 'Lo has marcado para repasar.'), el('blockquote', 'study-card-back', source.text),
        button(`Ver fuente · ${source.docName} · pág. ${source.sourcePage || source.pageNum}`, () => jump(source), 'source-link'));
      if (tutorSkill === 'explain') {
        panel.append(el('p', 'muted', `Palabras en común: ${feedback.shared.join(', ') || 'ninguna'}. Esto no califica el significado. ¿Expresaste la misma idea sin cambiar quién, qué o por qué?`),
          button('Sí, recogí la idea', () => reviewTurn(true), 'btn-hud btn-cyan'), button('Necesito repasarla', () => reviewTurn(false)));
      } else panel.appendChild(button(turns.length + 1 === items.length ? 'Ver balance' : 'Siguiente pasaje', () => reviewTurn(feedback.ok), 'btn-hud btn-cyan'));
    }
    stage.append(panel, button('Salir sin guardar la práctica', () => { session = null; renderPractice(); }));
  }
  function renderPractice() {
    const stage = document.getElementById('tutor-stage');
    stage.replaceChildren();
    if (changingCorpus) stage.appendChild(el('p', 'muted', 'Actualizando los documentos…'));
    else renderTutor(stage);
  }
  function renderGuide(stage) {
    stage.appendChild(header('Guía de estudio', 'Síntesis de hasta 80 pasajes de todo el corpus. El borrador se mantiene al cambiar de herramienta; descárgalo antes de quitar material o recargar.'));
    const editor = el('textarea', 'study-editor'); editor.id = 'guide-editor';
    if (guideDraft !== null) editor.value = guideDraft;
    else {
      const sentences = skills.sample(store().state.allSentences, 80);
      const picked = A.summarize(sentences, Math.min(10, sentences.length));
      editor.value = '# Guía de estudio\n\n' + (picked.length ? picked.map(({ item: s }) =>
        `- ${s.text} (${s.docName || 'Documento'}, pág. ${s.sourcePage || s.pageNum || '?'})`).join('\n\n') : 'Carga texto o usa Demo para generar una guía.');
    }
    editor.setAttribute('aria-label', 'Guía de estudio editable');
    editor.addEventListener('input', () => { guideDraft = editor.value; });
    stage.append(editor, button('↓ Descargar guía .md', () => download('guia-estudio.md', editor.value, 'text/markdown;charset=utf-8'), 'btn-hud btn-cyan'),
      button('Regenerar con el material actual', () => {
        if (guideDraft !== null && !confirm('¿Reemplazar tus ediciones por una guía nueva?')) return;
        guideDraft = null; render();
      }));
  }
  function addStudyCards(sources, allowOpenQuestion = false, limit = 500) {
    const S = store(), existing = new Set(S.state.cards.map(c => c.id)), clusters = new Map();
    for (const node of S.state.nodes) for (const id of (node.sentenceIds || [])) clusters.set(id, node.cluster);
    let added = 0;
    for (const s of sources) {
      if (existing.has('fc-' + s.id)) continue;
      const fields = skills.cardFields(s, allowOpenQuestion);
      if (!fields) continue;
      S.state.cards.push(SRS.newCard({ ...fields, cluster: clusters.get(s.id) || 'AGT-01' }));
      existing.add(fields.id);
      if (++added === limit) break;
    }
    if (added) S.saveCards();
    return added;
  }
  function generateCards() {
    cardShown = false; showAllCards = false;
    return addStudyCards(store().state.allSentences);
  }
  function renderCards(stage) {
    const S = store(), stats = SRS.deckStats(S.state.cards);
    stage.appendChild(header('Tarjetas · repetición espaciada FSRS', `${stats.total} tarjetas · ${stats.due} pendientes · dominio estimado ${U.pct(stats.mastery)}. Cada lote añade hasta 500 tarjetas nuevas.`));
    const toolbar = el('div', 'study-toolbar');
    toolbar.appendChild(button('+ Generar desde documentos', () => { const n = generateCards(); render(); root.DocViewer.toast(n ? `${n} tarjetas nuevas.` : 'No hay nuevas tarjetas que generar con estos pasajes.'); }, 'btn-hud btn-violet'));
    toolbar.appendChild(button('↓ Anki CSV', () => download('tarjetas-anki.csv', SRS.ankiCsv(S.state.cards, S.getSentence), 'text/csv;charset=utf-8')));
    toolbar.appendChild(button(showAllCards ? 'Solo pendientes' : 'Ver todas', () => { showAllCards = !showAllCards; browseIndex = 0; cardShown = false; render(); }));
    stage.appendChild(toolbar);
    const cards = showAllCards ? S.state.cards.slice().sort((a, b) => a.due - b.due) : SRS.dueCards(S.state.cards);
    if (!cards.length) {
      stage.appendChild(el('p', 'empty-hint', stats.total ? '¡No hay tarjetas pendientes! Puedes ver todas o volver más tarde.' : 'Genera tarjetas después de cargar un documento.'));
      return;
    }
    const index = showAllCards ? Math.min(browseIndex, cards.length - 1) : 0;
    if (showAllCards) {
      const nav = el('div', 'study-toolbar');
      const change = step => { browseIndex = index + step; cardShown = false; render(); };
      const prev = button('Anterior', () => change(-1)), next = button('Siguiente', () => change(1));
      prev.disabled = index === 0; next.disabled = index === cards.length - 1;
      nav.append(prev, el('span', 'muted', `Tarjeta ${index + 1} de ${cards.length}`), next); stage.appendChild(nav);
    }
    const card = cards[index], panel = el('div', 'study-card');
    panel.appendChild(el('div', 'study-card-meta', `Caja ${card.box || 0}/5 · próximo repaso: ${SRS.dueLabel(card)}`));
    renderCard(panel, card, cardShown, () => { cardShown = true; render(); }, grade => {
      gradeCard(card, grade); cardShown = false; render();
    });
    stage.appendChild(panel);
  }
  function gradeCard(card, grade) {
    const S = store(), slot = S.state.cards.indexOf(card);
    if (slot < 0) return null;
    const result = SRS.review(card, grade);
    S.state.cards[slot] = result; S.saveCards(); return result;
  }
  function renderCard(panel, card, shown, reveal, onGrade, afterFront) {
    panel.appendChild(el('p', 'study-card-front', card.front));
    afterFront?.();
    if (!shown) { panel.appendChild(button('Mostrar respuesta', reveal, 'btn-hud btn-cyan')); return; }
    panel.appendChild(el('p', 'study-card-back', card.back));
    const source = store().getSentence(card.sentenceId);
    if (source) panel.appendChild(button(`${card.kind === 'highlight' ? 'Volver al subrayado · ' : ''}${source.docName} · pág. ${source.sourcePage || source.pageNum}`, () => jump(source, card), 'source-link'));
    if (source) panel.appendChild(root.NCPassagePanel.create(source.id));
    panel.appendChild(el('p', 'muted small', '¿La recordaste sin mirar? Si no, elige «Otra vez». Si sí, indica cuánto esfuerzo te costó.'));
    const grades = el('div', 'grade-buttons');
    SRS.GRADES.forEach(g => {
      grades.appendChild(button(SRS.GRADE_LABEL[g], () => onGrade(g), g === 'good' ? 'btn-hud btn-cyan' : 'btn-mini'));
    });
    panel.appendChild(grades);
  }
  function stopTimer() { if (quizTimer) clearInterval(quizTimer); quizTimer = null; }
  function startQuiz(timed) {
    stopTimer();
    const items = A.quizItems(skills.sample(store().state.allSentences, 500), { n: 5, minLen: 35 });
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
    store().savePersistent(); if (activeBot === 'quiz') render();
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
    stage.appendChild(header('Respaldo local', 'Exporta documentos, grafo, tarjetas, quiz, balances del tutor, memoria y ajustes en JSON. No incluye Spyder personal ni los archivos multimedia originales.'));
    const status = el('p', 'muted'); status.id = 'study-backup-status'; status.setAttribute('role', 'status');
    const notify = text => {
      const current = document.getElementById('study-backup-status');
      if (current) current.textContent = text; else root.DocViewer.toast(text);
    };
    stage.appendChild(button('↓ Exportar cerebro .json', async () => {
      try { download('neural-command-respaldo.json', JSON.stringify(await store().exportBrain(), null, 2), 'application/json;charset=utf-8'); status.textContent = 'Respaldo preparado.'; }
      catch (e) { status.textContent = `No se pudo exportar: ${e.message}`; }
    }, 'btn-hud btn-cyan'));
    const label = el('label', 'btn-hud btn-ghost backup-label', '↑ Importar respaldo .json');
    const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.className = 'sr-only';
    file.addEventListener('change', async () => {
      if (!file.files?.length) return;
      if (!confirm('Importar reemplazará los datos de estudio, no los de Spyder personal. ¿Continuar?')) { file.value = ''; return; }
      try {
        const data = JSON.parse(await file.files[0].text());
        await store().importBrain(data); notify('Respaldo importado.');
      } catch (e) { notify(`No se pudo importar: ${e.message}`); }
      file.value = '';
    });
    label.appendChild(file); stage.append(label, status);
  }
  function render() {
    const stage = document.getElementById('bot-stage');
    if (!stage) return;
    document.querySelectorAll('.bot-btn').forEach(b => {
      const active = b.dataset.bot === activeBot; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
    });
    learner?.clearWake(); stage.replaceChildren();
    if (changingCorpus) { stage.appendChild(el('p', 'muted', 'Actualizando los documentos…')); return; }
    if (activeBot === 'guide') renderGuide(stage);
    else if (activeBot === 'plan') learner.render(stage);
    else if (activeBot === 'flashcards') renderCards(stage);
    else if (activeBot === 'quiz') renderQuiz(stage);
    else if (activeBot === 'vault') renderVault(stage);
    else if (activeBot === 'metrics') renderMetrics(stage);
    else if (activeBot === 'backup') renderBackup(stage);
  }
  function init() {
    learner = root.NCLearnerReview.create({ store: store(), el, header, button, renderCard, gradeCard, addCards: addStudyCards, jump, redraw: render });
    store().on('study:openReview', ({ docId, authored }) => {
      if (changingCorpus) return;
      learner.selectDocument(docId, authored); activeBot = 'plan';
      document.querySelector('[data-workspace="study"]').click(); render();
      const target = document.getElementById('review-task') || document.getElementById('review-start');
      (target?.disabled ? document.getElementById('review-doc') : target)?.focus({ preventScroll: true });
    });
    store().on('questions:changed', () => { if (['plan', 'flashcards'].includes(activeBot)) { cardShown = false; render(); } });
    document.querySelectorAll('.bot-btn').forEach(b => b.addEventListener('click', () => { activeBot = b.dataset.bot; cardShown = false; render(); }));
    const clearPractice = () => {
      learner.reset(); stopTimer(); quiz = null; session = null; guideDraft = null; tutorDocId = ''; tutorNotice = ''; vaultQuery = '';
      cardShown = false; showAllCards = false;
    };
    for (const event of ['system:resetting', 'brain:importing']) store().on(event, () => {
      changingCorpus = true; clearPractice(); renderPractice(); render();
    });
    for (const event of ['system:reset', 'brain:imported', 'brain:importFailed']) store().on(event, () => {
      changingCorpus = false; renderPractice(); render();
    });
    store().on('doc:added', () => {
      if (!session) renderPractice();
      if ((activeBot === 'guide' && guideDraft === null) || activeBot === 'plan') render();
    });
    store().on('doc:removed', ({ docId }) => {
      // También los distractores pueden proceder del documento retirado.
      if (quiz) { stopTimer(); quiz = { error: 'Se retiró material. Crea otro quiz con las fuentes disponibles.' }; }
      if (tutorDocId === docId) { session = null; tutorDocId = ''; tutorNotice = 'Se retiró el documento de la práctica.'; }
      learner.removed(docId); guideDraft = null; cardShown = false;
      if (!session) renderPractice();
      if (['guide', 'plan', 'flashcards', 'quiz', 'vault'].includes(activeBot)) render();
    });
    renderPractice(); render();
  }
  root.StudyBots = { init, render, generateCards, startQuiz, finishQuiz };
})(typeof window !== 'undefined' ? window : globalThis);
