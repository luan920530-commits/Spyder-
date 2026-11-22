/** Selección, autoría y vuelta a una cita exacta. Ningún Range ni borrador se persiste. */
(function (root) {
  'use strict';
  const H = root.NCHighlights, S = root.NeuralStore, $ = id => document.getElementById(id);
  let page, pageDoc, selected, draft, activeId, requested, citation, focusCitation = false, replacing = false;
  const pageCards = () => !page ? [] : S.state.cards.filter(c => c.kind === 'highlight' && c.docId === page.docId && c.pageNum === page.pageNum);
  const live = () => !replacing && pageDoc === S.getActiveDoc() && page?.pageNum === S.state.activePage;
  function capture() {
    if (!live() || $('question-dialog').open) return;
    const sel = root.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0), article = $('doc-content');
    if (!article.contains(range.startContainer) && !article.contains(range.endContainer)) return;
    const a = H.anchor(page, H.rangeToSelector(range, article));
    selected = a ? { a } : { error: `Selecciona hasta ${H.MAX_QUOTE} caracteres de una sola página del documento.` };
  }
  function close() {
    const dialog = $('question-dialog');
    if (dialog.open) { if (dialog.close) dialog.close(); else dialog.removeAttribute('open'); }
    draft = selected = null; $('question-front').value = ''; $('question-quote').textContent = '';
    $('question-passage').replaceChildren(); $('page-question-list').replaceChildren(); $('page-questions').open = false;
    $('question-location').textContent = ''; $('question-status').textContent = '';
  }
  function prepare(doc, num) {
    if (pageDoc !== doc || page?.pageNum !== num) { close(); activeId = null; }
    pageDoc = doc; page = H.indexPage(doc, num);
    $('question-tools').hidden = !page?.blocks.length;
    const edges = [], cards = pageCards();
    // Un salto desde el chat muestra el mismo tipo de marca, pero no crea una
    // tarjeta. No conservar el resaltado al cambiar de página ni de corpus.
    if (citation) {
      const a = H.resolve(page,citation);
      if (a) edges.push([a.selector.start, 1, 1], [a.selector.end, -1, -1]);
      else { citation = null; focusCitation = false; }
    }
    if (requested) activeId = cards.some(c => c.id === requested) ? requested : null;
    for (const card of cards) {
      const a = H.resolve(page, card);
      if (!a) continue;
      const focus = Number(card.id === activeId);
      edges.push([a.selector.start, 1, focus], [a.selector.end, -1, -focus]);
    }
    // Barrido único: respeta los solapes sin anidar marcas, mutar el texto
    // fuente, romper los word-span del enjambre ni duplicar espacios.
    edges.sort((a, b) => a[0] - b[0]);
    let offset = 0, edge = 0, count = 0, focus = 0;
    return (parent, text) => {
      const start = offset, end = start + text.length;
      while (offset < end) {
        while (edge < edges.length && edges[edge][0] === offset) {
          count += edges[edge][1]; focus += edges[edge][2]; edge++;
        }
        const next = Math.min(end, edges[edge]?.[0] ?? end), part = text.slice(offset - start, next - start);
        if (count) {
          const mark = document.createElement('mark'); mark.textContent = part;
          if (focus) mark.className = 'quote-focus'; parent.appendChild(mark);
        } else parent.appendChild(document.createTextNode(part));
        offset = next;
      }
    };
  }
  function finish() {
    if (!requested && !focusCitation) return;
    requested = null; focusCitation = false;
    const mark = $('doc-content').querySelector('mark.quote-focus');
    if (mark) { mark.tabIndex = -1; mark.focus({ preventScroll: true }); mark.scrollIntoView({ block: 'center' }); }
    else root.DocViewer.toast('El subrayado ya no coincide con esta página.');
  }
  function showSource(card) {
    const doc = S.state.docs.find(d => d.id === card.docId);
    if (!H.resolve(H.indexPage(doc, card.pageNum), card)) { root.DocViewer.toast('La cita exacta ya no está disponible.'); return; }
    close(); citation = null; focusCitation = false; requested = card.id; S.holdAutoNavigation(); S.setActiveDoc(doc.id, card.pageNum);
    // El visor está presente en los cuatro espacios. No destruir la sesión ni
    // competir con el desplazamiento diferido de los botones de navegación.
  }
  function use(a, warning = '') {
    draft = a;
    $('question-quote').textContent = a?.selector.quote || 'Sin selección';
    $('question-location').textContent = `${page.docName} · pág. ${a?.sourcePage || page.blocks[0]?.sourcePage || page.pageNum}`;
    $('question-status').textContent = warning;
    $('question-save').disabled = !a;
  }
  function choosePassage() {
    const b = page.blocks[Number($('question-passage').value)];
    const a = b && H.anchor(page, { start: b.start, end: b.end, quote: page.text.slice(b.start, b.end) });
    use(a, a ? '' : `Selecciona un fragmento de hasta ${H.MAX_QUOTE} caracteres en el visor.`);
  }
  function listQuestions() {
    const list = $('page-question-list'); list.replaceChildren();
    const cards = pageCards(); $('page-questions').hidden = !cards.length;
    for (const c of cards) {
      const row = document.createElement('p'), title = document.createElement('strong'); title.textContent = c.front; row.append(title);
      for (const [label, action] of [['Ver subrayado', () => showSource(c)], ['Eliminar pregunta', e => {
        if (!e.currentTarget.dataset.confirm) { e.currentTarget.dataset.confirm = '1'; e.currentTarget.textContent = 'Confirmar eliminación de esta tarjeta'; return; }
        S.removeQuestion(c.id); listQuestions(); $('question-cancel').focus();
      }]]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-mini'; b.textContent = label;
        b.addEventListener('click', action); row.append(b);
      }
      list.append(row);
    }
  }
  function open(anchor, suggestion) {
    if (!live() || !page.blocks.length) return;
    if (!anchor) capture();
    const picked = anchor ? { a: anchor } : selected; selected = null;
    const dialog = $('question-dialog'), picker = $('question-passage'); picker.replaceChildren();
    $('passage-picker').hidden = !!picked?.a;
    if (!picked?.a) {
      page.blocks.forEach((b, i) => {
        const opt = document.createElement('option'); opt.value = String(i); opt.textContent = `${i + 1}. ${root.NCUtil.truncate(page.text.slice(b.start, b.end), 110)}`; picker.append(opt);
      });
      if (picked?.error) { picker.selectedIndex = -1; use(null, picked.error); } else choosePassage();
    } else use(picked.a);
    $('question-front').value = suggestion || '';
    listQuestions(); root.getSelection()?.removeAllRanges();
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    (picked?.a ? $('question-front') : picker).focus();
  }
  function citationAnchor(src) {
    if (replacing || !root.NCStudyDialogue.resolveSource(S.state.index, src)) return null;
    const doc = S.state.docs.find(d => d.id === src.docId);
    const ip = H.indexPage(doc,src.pageNum), b = ip?.blocks.find(b => b.id === src.sentenceId);
    if (!b) return null;
    const start = b.start + src.offset;
    return H.anchor(ip, { start, end: start + src.text.length, quote: src.text });
  }
  function showCitation(src) {
    const a = citationAnchor(src); if (!a) return false;
    close(); activeId = requested = null; citation = a; focusCitation = true;
    S.holdAutoNavigation(); S.setActiveDoc(a.docId,a.pageNum);
    return true;
  }
  // El tutor propone una pregunta editable, nunca califica ni añade tarjetas
  // automáticamente. Solo se subraya una cita que aún coincide exactamente.
  function fromCitation(src, suggestion) {
    const a = citationAnchor(src); if (!a) return false;
    S.holdAutoNavigation(); S.setActiveDoc(a.docId,a.pageNum);
    requestAnimationFrame(() => {
      if (live() && H.resolve(page,a) && !$('question-dialog').open) open(a, String(suggestion || '').slice(0,H.MAX_QUESTION));
    });
    return true;
  }
  function init() {
    const article = $('doc-content');
    document.addEventListener('selectionchange', capture);
    document.addEventListener('pointerdown', e => {
      if ($('btn-question').contains(e.target)) capture(); else selected = null;
    }, true);
    article.addEventListener('pointerdown', () => S.holdAutoNavigation());
    article.addEventListener('pointerup', capture); article.addEventListener('keyup', capture);
    $('btn-question').addEventListener('click', () => open()); $('question-passage').addEventListener('change', choosePassage);
    $('question-cancel').addEventListener('click', close);
    $('question-dialog').addEventListener('cancel', e => { e.preventDefault(); close(); });
    $('btn-my-review').addEventListener('click', () => S.emit('study:openReview', { docId: page?.docId }));
    $('question-save').addEventListener('click', () => {
      if (!live() || !$('question-dialog').open) return;
      const card = S.addQuestion(draft, $('question-front').value);
      if (!card) { $('question-status').textContent = 'Comprueba el fragmento y escribe una pregunta antes de guardar.'; return; }
      close(); S.emit('study:openReview', { docId: card.docId, authored: true }); root.DocViewer.toast('Pregunta en Mi repaso. La respuesta es tu cita literal.');
    });
    S.on('chat:clearing', () => {
      if (citation) { citation = null; focusCitation = false; root.DocViewer.render(); }
    });
    for (const name of ['system:resetting', 'brain:importing']) S.on(name, () => { replacing = true; focusCitation = false; citation = requested = activeId = null; close(); });
    for (const name of ['system:reset', 'brain:imported', 'brain:importFailed']) S.on(name, () => { replacing = false; });
    S.on('doc:pageChanged', () => { if (!live()) close(); });
  }
  root.NCQuestionUI = { init, prepare, finish, showSource, showCitation, fromCitation, holdingPage: () =>
    $('question-dialog').open || (!!selected && !root.getSelection()?.isCollapsed) };
})(typeof window !== 'undefined' ? window : globalThis);
