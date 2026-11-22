/** Mi repaso: cola corta en memoria; el calendario y la meta se guardan en el store. */
(function (root) {
  'use strict';
  root.NCLearnerReview = { create };
  function create({ store: S, el, header, button, renderCard, gradeCard, addCards, jump, redraw }) {
    const srs = root.NCSRS;
    let docId = '', mineOnly = false, pendingScope = null, run = null, notice = '', wake = null;
    function clearWake() { clearTimeout(wake); wake = null; }
    function reset() { clearWake(); docId = ''; mineOnly = false; pendingScope = null; run = null; notice = ''; }
    function sourceId(c) { return c.docId || S.getSentence(c.sentenceId)?.docId; }
    function scopedCards() { return S.state.cards.filter(c => (!docId || sourceId(c) === docId) && (!mineOnly || c.kind === 'highlight')); }
    function limit() { const n = S.getSetting('reviewSessionSize', 5); return srs.SESSION_LIMITS.includes(n) ? n : 5; }
    function when(due) { return new Date(due).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    function nextStep(plan) {
      if (plan.due) return `Disponibles ahora: ${plan.due} (${plan.due - plan.fresh} de repaso y ${plan.fresh} nuevas).`;
      if (plan.next !== null) return `Al día. Próximo repaso: ${when(plan.next)} (en ${srs.dueLabel({ due: plan.next })}).`;
      return 'Todavía no hay tarjetas en esta selección.';
    }
    function update(focus) { redraw(); if (focus) document.getElementById(focus)?.focus({ preventScroll: true }); }
    function status(panel, text) {
      if (!text) return;
      const line = el('p', 'review-notice', text); line.setAttribute('role', 'status'); panel.appendChild(line);
    }
    function select(panel, id, label, pairs, value, change) {
      const key = el('label', '', label); key.htmlFor = id;
      const field = el('select'); field.id = id;
      for (const [v, text] of pairs) { const opt = el('option', '', text); opt.value = v; field.appendChild(opt); }
      field.value = value; field.addEventListener('change', () => { notice = ''; change(field.value); update(id); });
      panel.append(key, field);
    }
    function message(text) {
      notice = text; redraw();
      const start = document.getElementById('review-start');
      (start.disabled ? document.getElementById('review-doc') : start).focus({ preventScroll: true });
    }
    function setup(stage) {
      const docs = S.state.docs.filter(d => !d.mediaType), size = limit(), cards = scopedCards(), plan = srs.sessionPlan(cards, size);
      const fields = el('div', 'tutor-setup');
      select(fields, 'review-doc', 'Qué estudiar', [['', 'Todos mis documentos'], ...docs.map(d => [d.id, d.displayName || d.name])], docId, v => { docId = v; });
      select(fields, 'review-size', 'Máximo por sesión', srs.SESSION_LIMITS.map(n => [n, `${n} tarjetas`]), size, n => S.setSetting('reviewSessionSize', +n));
      const filter = el('label', 'check-row'), check = el('input'); check.type = 'checkbox'; check.id = 'review-mine'; check.checked = mineOnly;
      check.addEventListener('change', () => { mineOnly = check.checked; notice = ''; update('review-mine'); });
      filter.append(check, 'Solo mis preguntas subrayadas'); fields.append(filter);
      stage.append(fields, el('p', 'review-today', `Tarjetas distintas repasadas hoy en esta selección: ${plan.reviewedToday}.`),
        el('p', 'review-next', nextStep(plan)));
      const start = button('Empezar repaso', () => {
        const deck = scopedCards(), ids = srs.sessionPlan(deck, limit()).ids;
        if (!ids.length) { message('Ya no quedan tarjetas pendientes.'); return; }
        const byId = new Map(deck.map(c => [c.id, c])), queue = ids.map(id => byId.get(id));
        run = { queue, total: queue.length, docIds: new Set(queue.map(sourceId)), marks: [], shown: false, draft: '', ended: false, skipped: 0, feedback: '' };
        notice = ''; update('review-task');
      }, 'btn-hud btn-cyan'); start.id = 'review-start'; start.disabled = !plan.ids.length;
      stage.append(start, el('p', 'muted small', `Primero los repasos vencidos; después las tarjetas nuevas. No se adelantan fechas. En esta sesión: ${plan.ids.length}.`));
      status(stage, notice);
      if (mineOnly && docs.length && !cards.length) {
        stage.appendChild(el('p', 'empty-hint', 'En el visor, selecciona texto y pulsa «Subrayar · Crear mi pregunta», o desmarca el filtro para ver las otras tarjetas.'));
      } else if (!mineOnly && docs.length && plan.ids.length < size) {
        const available = size - plan.ids.length;
        stage.appendChild(button(`Preparar hasta ${available} tarjetas nuevas`, () => {
          const sources = docId ? S.state.allSentences.filter(s => s.docId === docId) : S.state.allSentences;
          const n = addCards(sources, false, available);
          message(n ? `Tarjetas preparadas de tus pasajes: ${n}.` : 'No hay más pasajes con términos adecuados en esta selección. También puedes practicar Explicación propia en el tutor.');
        }));
      } else if (!docs.length) {
        stage.append(el('p', 'empty-hint', 'Carga tus apuntes para preparar tarjetas o prueba los documentos de la demo.'),
          button('Elegir archivo', () => document.getElementById('file-input').click()),
          button('Cargar demo', () => document.getElementById('btn-load-demo').click()));
      }
      // Despertar al siguiente vencimiento, no mantener un contador por segundo.
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
      const nextUpdate = Math.min(plan.next ?? Infinity, plan.reviewedToday ? +midnight : Infinity);
      if (Number.isFinite(nextUpdate)) wake = setTimeout(() => {
        if (fields.isConnected) update(stage.contains(document.activeElement) ? document.activeElement.id : null);
      }, Math.min(2147483647, Math.max(1, nextUpdate - Date.now() + 10)));
    }
    function summary(stage) {
      const { marks, total, skipped } = run, panel = el('div', 'study-card review-summary');
      const title = el('strong', '', marks.length === total ? 'Sesión completada' : 'Sesión terminada');
      title.id = 'review-task'; title.tabIndex = -1;
      panel.append(title, el('p', '', `Calificaste ${marks.length} de ${total} tarjetas.`));
      if (skipped) panel.appendChild(el('p', 'muted', `Ya repasadas en otra herramienta o retiradas: ${skipped}. No se calificaron dos veces.`));
      if (marks.length) {
        panel.appendChild(el('p', '', srs.GRADES.map(g => `${srs.GRADE_LABEL[g]}: ${marks.filter(m => m.grade === g).length}`).join(' · ')));
        const weak = marks.filter(m => m.grade === 'again' || m.grade === 'hard');
        if (weak.length) {
          panel.appendChild(el('p', '', 'Para reforzar: vuelve al pasaje e intenta explicarlo con un ejemplo propio.'));
          for (const m of weak) {
            const src = S.getSentence(m.sentenceId);
            panel.appendChild(src ? button(`${src.docName} · pág. ${src.sourcePage || src.pageNum} · ${root.NCUtil.truncate(m.front, 52)}`, () => jump(src, S.state.cards.find(c => c.id === m.id)), 'source-link') : el('p', 'muted', m.front));
          }
        }
      }
      status(panel, run.feedback);
      panel.appendChild(el('p', 'review-next', nextStep(srs.sessionPlan(scopedCards(), limit()))));
      stage.append(panel, button('Volver a mi plan', () => {
        run = null; if (pendingScope) selectDocument(pendingScope, true); update('review-doc');
      }, 'btn-hud btn-cyan'));
    }
    function turn(stage) {
      const r = run;
      // Si se calificó en Tarjetas mientras esta sesión estaba apartada, se
      // reemplazó la tarjeta del store. Nunca aplicar la nota a su copia vieja.
      while (!r.ended && r.queue.length && !S.state.cards.includes(r.queue[0])) {
        r.queue.shift(); r.skipped++; r.shown = false; r.draft = '';
      }
      if (r.ended || !r.queue.length) { summary(stage); return; }
      const card = r.queue[0], panel = el('div', 'study-card review-turn');
      const task = el('h4', '', `Tarjeta ${r.total - r.queue.length + 1} de ${r.total}`); task.id = 'review-task'; task.tabIndex = -1;
      panel.appendChild(task);
      renderCard(panel, card, r.shown, () => { r.shown = true; update('review-answer'); }, grade => {
        if (run !== r || r.queue[0] !== card || r.ended || !r.shown) return;
        const rated = gradeCard(card, grade);
        if (rated) {
          r.marks.push({ grade, id: card.id, sentenceId: card.sentenceId, front: card.front });
          r.feedback = `${srs.GRADE_LABEL[grade]} → próximo repaso de esa tarjeta: ${when(rated.due)}.`;
        } else r.skipped++;
        r.queue.shift(); r.shown = false; r.draft = ''; update('review-task');
      }, () => {
        if (r.shown) {
          if (r.draft.trim()) panel.appendChild(el('p', 'review-attempt', `Tu intento: ${r.draft}`));
        } else {
          const label = el('label', '', 'Tu intento (opcional, no se guarda)'); label.htmlFor = 'review-draft';
          const input = el('textarea', 'study-input'); input.id = 'review-draft'; input.rows = 2; input.maxLength = 2000;
          input.spellcheck = false; input.autocomplete = 'off'; input.value = r.draft;
          input.addEventListener('input', () => { r.draft = input.value; }); panel.append(label, input);
        }
      });
      if (r.shown) { const answer = panel.querySelector('.study-card-back'); answer.id = 'review-answer'; answer.tabIndex = -1; }
      status(panel, r.feedback);
      stage.append(panel, button('Terminar por ahora', () => { r.ended = true; r.draft = ''; update('review-task'); }));
    }
    function render(stage) {
      clearWake();
      stage.appendChild(header('Mi repaso', 'Recuerda antes de mirar la respuesta. Tú valoras el esfuerzo; FSRS usa esa valoración para programar la próxima revisión en este dispositivo.'));
      if (run) turn(stage); else setup(stage);
    }
    function removed(id) {
      if (pendingScope === id) pendingScope = null;
      if (docId === id || run?.docIds.has(id)) {
        run = null; if (docId === id) docId = '';
        if (pendingScope) selectDocument(pendingScope, true);
        notice = 'Se retiró un documento del repaso.';
      }
    }
    function selectDocument(id, authored = false) {
      if (run && !run.ended && run.queue.length) {
        if (authored) { pendingScope = id; run.feedback = 'Pregunta añadida. Tu sesión actual no cambia; al volver al plan verás tus preguntas subrayadas.'; }
        return;
      }
      run = null; docId = id || ''; mineOnly = authored; pendingScope = null; notice = '';
    }
    return { render, reset, removed, clearWake, selectDocument };
  }
})(typeof window !== 'undefined' ? window : globalThis);
