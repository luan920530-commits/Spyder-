/** Vista compartida de las sugerencias: en el inspector o al revelar una tarjeta. */
(function (root) {
  'use strict';
  const S = root.NeuralStore, U = root.NCUtil;
  function el(tag, text) { const n = document.createElement(tag); if (text) n.textContent = text; return n; }
  function button(text, click, cls = 'btn-mini') {
    const b = el('button', text); b.type = 'button'; b.className = cls; b.addEventListener('click', click); return b;
  }
  function draw(details, changed) {
    const id = details.dataset.sid, source = S.getSentence(id), box = details.querySelector('div');
    box.replaceChildren(); if (!source || source.docId !== details.dataset.doc) return;
    const links = S.relatedPassages(id), n = S.state.relationVotes.filter(v => v.docId === source.docId).length;
    const status = el('p', `${changed ? 'Sugerencias recalculadas. ' : ''}Pares valorados en este documento: ${n}.`);
    status.setAttribute('role', 'status'); box.append(status);
    if (n) box.append(button('Restablecer vínculos de este documento', e => {
      if (!e.currentTarget.dataset.confirm) {
        e.currentTarget.dataset.confirm = '1'; e.currentTarget.textContent = 'Confirmar: olvidar mis valoraciones de vínculos'; return;
      }
      S.clearRelations(source.docId); details.querySelector('summary').focus({ preventScroll: true });
    }));
    if (!links.length) { box.append(el('p', 'Sin otro pasaje con términos en común.')); return; }
    box.append(el('p', 'Tus votos ajustan las sugerencias de todo este documento, no el calendario de repaso. La afinidad no mide verdad ni dominio.'));
    const list = el('ul');
    for (const link of links) {
      const s = S.getSentence(link.id); if (s?.docId !== source.docId) continue;
      const li = el('li'); li.dataset.related = link.id;
      li.append(button(`${s.docName} · pág. ${s.sourcePage || s.pageNum}`, () => {
        S.holdAutoNavigation(); S.setActiveDoc(s.docId, s.pageNum);
        requestAnimationFrame(() => root.NeuralGraph.scrollToSentence(s.id));
      }, 'source-link'), el('p', U.truncate(s.sourceText, 180)),
      el('small', `Afinidad ${Math.round(link.score * 100)}/100 · Términos afines: ${link.shared.join(', ')}`));
      const controls = el('div');
      for (const [useful, label] of [[true, 'Vínculo útil'], [false, 'No útil']]) {
        const b = button(label, () => {
          if (!li.isConnected || S.getSentence(id) !== source || S.getSentence(s.id) !== s) return;
          if (S.rateRelation(id, s.id, useful)) {
            const again = [...details.querySelectorAll('li')].find(row => row.dataset.related === s.id);
            (again?.querySelector(`[data-vote="${useful}"]`) || details.querySelector('summary')).focus({ preventScroll: true });
          }
        });
        b.dataset.vote = String(useful); b.setAttribute('aria-pressed', String(link.vote === useful)); controls.append(b);
      }
      li.append(controls); list.append(li);
    }
    box.append(list, button('Ver estos vínculos en la red', () => root.NeuralGraph.showStudyLinks(id, true)));
  }
  function create(id) {
    const details = el('details'); details.className = 'passage-links'; details.dataset.sid = id; details.dataset.doc = S.getSentence(id)?.docId || '';
    details.append(el('summary', 'Vínculos de estudio'), el('div'));
    details.addEventListener('toggle', () => { if (details.open) draw(details, false); });
    return details;
  }
  S.on('relations:changed', () => {
    for (const details of document.querySelectorAll('.passage-links[open]')) draw(details, true);
  });
  root.NCPassagePanel = { create };
})(typeof window !== 'undefined' ? window : globalThis);
