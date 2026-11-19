/** Presentación del tutor. Los corchetes del usuario, de un libro o de Qwen son solo texto. */
(function (root) {
  'use strict';
  const D = root.NCStudyDialogue, S = root.NeuralStore, U = root.NCUtil;
  const $ = id => document.getElementById(id);
  const controls = new WeakMap();
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function button(text, cls, run) {
    const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', run); return b;
  }
  function refresh(row) {
    const c = controls.get(row);
    if (!c) return;
    const live = !!D.resolveSource(S.state.index, c.src);
    c.visit.disabled = c.card.disabled = !live;
    c.note.textContent = live ? '' : 'Cita de un turno anterior: ya no coincide con una fuente disponible.';
  }
  function render(body, result) {
    const d = result.dialogue, sources = Array.isArray(result.sources) ? result.sources.slice(0,D.MAX_SOURCES) : [];
    body.classList.add('dialogue-result');
    const practice = d.action === 'practice' && sources.length && d.practice;
    if (practice) {
      const label = el('label','Tu explicación (borrador sin guardar)');
      const draft = el('textarea'); draft.rows = 2; draft.maxLength = 1200; label.append(draft);
      const solution = el('details',null,'dialogue-solution');
      solution.append(el('summary','Comparar mi explicación con las fuentes'));
      body.append(el('h4','Ponme a prueba'),el('p',d.practice,'dialogue-practice'),label,solution);
      body = el('div'); solution.append(body);
    }
    function part(title, text, cls) {
      if (!text) return;
      body.append(el('h4',title),el('p',text,cls));
    }
    const refs = ns => Array.isArray(ns) ? ns.filter(n => Number.isInteger(n) && n > 0 && n <= sources.length).map(n => `[${n}]`).join(' ') : '';
    if (d.topic) body.append(el('small',`Tema: ${d.topic}`, 'muted'));
    if (d.before) part('Lectura anterior (citas del turno previo)', d.before);
    if (d.change) part('Qué ha cambiado', [d.change,refs(d.changeRefs)].filter(Boolean).join(' '), 'dialogue-change');
    part('Lectura provisional', [d.reading,refs(d.refs)].filter(Boolean).join(' '), 'dialogue-reading');
    part(d.action === 'compare' ? 'Contraste' : 'Por qué', d.reason);
    if (sources.length) body.append(el('h4', 'Lo que dice el material · citas literales'));
    sources.forEach((src,i) => {
      if (!src || typeof src.text !== 'string') return;
      const row = el('section', null, 'dialogue-source');
      const where = `[${i+1}] ${src.docName || 'Documento'} · pág. ${src.sourcePage || src.pageNum}`;
      const added = Array.isArray(d.changeRefs) && d.changeRefs.includes(i+1);
      row.append(el('small', where + (added ? ' · incorporado en esta revisión' : '')), el('blockquote', src.text));
      const visit = button('Ver en la fuente','source-link', () => {
        if (!root.NCQuestionUI.showCitation(src)) refresh(row);
      });
      visit.setAttribute('aria-label', `Ver en la fuente ${where}`);
      const card = button('Crear mi pregunta','btn-mini', () => {
        if (!root.NCQuestionUI.fromCitation(src, d.topic)) refresh(row);
      });
      card.setAttribute('aria-label', `Crear mi pregunta con la cita ${i+1}`);
      const note = el('p', null, 'dialogue-note'); row.append(visit,card,note);
      controls.set(row, { src,visit,card,note }); refresh(row); body.append(row);
    });
    part('Qué falta comprobar', d.gap);
    if (d.generated) part('Explicación de Qwen · puede equivocarse, no es una fuente', d.generated, 'dialogue-generated');
    if (d.notice) body.append(el('p',d.notice,'dialogue-note'));
    if (!practice) part('Para repasar', d.practice, 'dialogue-practice');
  }
  function init() {
    const setup = $('dialogue-setup'), book = $('dialogue-doc'), quick = $('dialogue-quick-actions'), input = $('chat-input');
    const opt = $('dialogue-qwen'); let optionsKey = '';
    const ingest = $('dialogue-ingest');
    function sync() {
      const active = S.getSetting('mode') === 'tutor', scope = S.getSetting('dialogueDocId','');
      setup.hidden = quick.hidden = !active;
      if (!active) { $('dialogue-clear').hidden = true; input.removeAttribute('maxlength'); return; }
      input.maxLength = D.MAX_QUESTION;
      const docs = S.state.docs.filter(doc => !doc.mediaType && doc.pages.some(p => p.sentences.length));
      const key = JSON.stringify(docs.map(doc => [doc.id, doc.displayName || doc.name]));
      if (optionsKey !== key) {
        optionsKey = key; book.replaceChildren(new Option('Toda mi biblioteca',''));
        const names = docs.map(doc => doc.displayName || doc.name), totals = new Map(), seen = new Map();
        names.forEach(name => totals.set(name, (totals.get(name) || 0)+1));
        docs.forEach((doc,i) => {
          const name = names[i], n = (seen.get(name) || 0)+1; seen.set(name,n);
          book.add(new Option(totals.get(name)>1 ? `${name} (${n}/${totals.get(name)})` : name, doc.id));
        });
      }
      if (scope && !docs.some(doc => doc.id === scope)) { S.setSetting('dialogueDocId',''); return; }
      book.value = scope; book.disabled = !docs.length;
      const prev = D.lastTurn(S.state.chat,scope)?.dialogue;
      const corpusChanged = prev && prev.cursor?.n !== S.state.index.sentences.length;
      $('dialogue-status').textContent = prev ? `Tema: ${U.truncate(prev.topic,100)} · ` + (corpusChanged ? 'Tu biblioteca cambió. Pulsa Revisar conclusión.' : 'Puedes seguir el hilo o preguntar por otro tema.') :
        docs.length ? 'Haz una pregunta sobre tus apuntes. Después podrás pedir razones o contrastar las fuentes.' : 'Para empezar, añade tus apuntes o carga la demo. No necesitas descargar un modelo.';
      quick.querySelectorAll('button').forEach(b => { b.disabled = !prev; });
      const enabled = !!root.NCQwenModel?.info()?.enabled;
      opt.disabled = !enabled; opt.checked = enabled && S.getSetting('dialogueQwen', false) === true;
      $('dialogue-engine').textContent = enabled ? 'Las citas y la lectura local se conservan con o sin la explicación generada.' : 'Motor por reglas, sin descargas. Qwen solo se usa si lo activas en MODELO y marcas esta opción.';
    }
    const open = () => {
      document.querySelector('.workspace-step[data-workspace="chat"]').click();
      S.setSetting('mode','tutor'); input.focus({ preventScroll:true });
    };
    $('open-dialogue').addEventListener('click',open); $('study-open-dialogue').addEventListener('click',open);
    book.addEventListener('change', () => S.setSetting('dialogueDocId',book.value));
    opt.addEventListener('change', () => S.setSetting('dialogueQwen',opt.checked));
    $('dialogue-upload').addEventListener('click', () => $('file-input').click());
    $('dialogue-demo').addEventListener('click', () => {
      $('btn-load-demo').click(); S.setSetting('dialogueDocId','');
      if (!input.value) input.value = '¿Qué dicen los informes sobre la latencia?';
      input.focus();
    });
    S.on('ingest:progress', detail => {
      if (setup.hidden) return;
      if (detail.phase === 'error') ingest.textContent = `No se añadió ${detail.name}: ${detail.error}`;
      else if (detail.phase === 'indexed') {
        const scope = S.getSetting('dialogueDocId');
        ingest.textContent = (detail.doc.ingestWarnings || []).join(' ') || (scope && scope !== detail.doc.id ? 'El archivo se añadió fuera del libro seleccionado. Para contrastarlos, elige Toda mi biblioteca y escribe el tema.' : `Añadido: ${detail.doc.name}.`);
      } else if (detail.phase === 'parse') ingest.textContent = 'Leyendo el archivo local…';
    });
    for (const event of ['chat:cleared','brain:imported','system:reset']) S.on(event, () => { ingest.textContent = ''; sync(); });
    for (const event of ['rag:answer','qwen:status']) S.on(event, sync);
    for (const event of ['doc:added','doc:removed']) S.on(event, () => {
      sync(); document.querySelectorAll('.dialogue-source').forEach(refresh);
    });
    S.on('settings:changed', ({ key }) => { if (['mode','dialogueDocId','dialogueQwen'].includes(key)) sync(); });
    sync();
  }
  root.NCDialogueUI = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
