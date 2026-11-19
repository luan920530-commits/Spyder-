/** Interfaz del chat y del redactor. Todos los contenidos del usuario se tratan como texto. */
(function (root) {
  'use strict';
  const U = root.NCUtil;
  const S = () => root.NeuralStore;
  let busy = false, replacing = false, currentSend = null, nextQueryId = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' }));
    const a = element('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function goToSource(source) {
    if (!source) return;
    S().holdAutoNavigation();
    S().setActiveDoc(source.docId, source.pageNum);
    if (source.sentenceId) setTimeout(() => root.NeuralGraph?.scrollToSentence(source.sentenceId), 100);
  }
  function message(role, text) {
    const box = document.getElementById('chat-messages');
    if (!box) return null;
    const div = element('div', `msg msg-${role}`);
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }
  function renderAnswer(result, options) {
    const opts = options || {};
    const box = opts.container || document.getElementById('chat-messages');
    if (!box) return;
    const div = element('article', 'msg msg-ai');
    const body = element('div', 'answer-body');
    if (result.intent === 'smalltalk' && result.smalltalk) {
      body.textContent = result.text; div.append(body, element('small','muted','Spyder · charla local'));
      box.appendChild(div); box.scrollTop = box.scrollHeight;
      return div; // No es evidencia: sin citas, valoración de fuentes ni entrenamiento.
    }
    const sources = Array.isArray(result.sources) ? result.sources : [];
    function sourceButton(n, source) {
      const button = element('button', 'cite-ref', `[${n}]`);
      button.type = 'button';
      button.title = `${source.docName || 'Fuente'} · pág. ${source.sourcePage || source.pageNum || '?'}`;
      button.addEventListener('click', () => goToSource(source));
      return button;
    }
    const characterReply = result.mode === 'conversacion' && result.characterReply;
    const isTutor = result.mode === 'tutor' && result.dialogue?.version === 1;
    if (isTutor) {
      root.NCDialogueUI.render(body, result);
    } else if (characterReply && typeof characterReply === 'object') {
      // El texto del libro es literal: sus corchetes no se convierten en citas de la app.
      body.appendChild(element('div', '', String(characterReply.lead || '')));
      if (characterReply.excerpt) {
        body.appendChild(element('div', 'character-excerpt-label', String(characterReply.excerptLabel || 'Fragmento del libro:')));
        const quote = element('div', 'character-excerpt', `«${String(characterReply.excerpt)}»`);
        if (sources[0]) quote.append(' ', sourceButton(1, sources[0]));
        body.appendChild(quote);
      }
      if (characterReply.closing) body.appendChild(element('div', '', String(characterReply.closing)));
    } else {
      // safeMarkdown escapa toda la entrada ANTES de añadir sus etiquetas fijas.
      body.innerHTML = U.safeMarkdown(result.text || '');
      body.querySelectorAll('.cite-ref').forEach(ref => {
        const n = Number(ref.textContent.replace(/\D/g, ''));
        const source = sources[n - 1];
        if (!source) { ref.classList.add('cite-unverified'); ref.title = 'Cita fuera de las fuentes'; return; }
        ref.replaceWith(sourceButton(n, source));
      });
    }
    div.appendChild(body);
    if (result.mode === 'conversacion' && result.provider === 'qwen-local') {
      div.appendChild(element('p', 'citation-warning', 'Interpretación generada localmente: puede inventar o equivocarse. Los fragmentos consultados no verifican la respuesta.'));
    }

    if (!isTutor && sources.length) {
      const details = element('details', 'sources-details');
      const sourceLabel = result.provider === 'qwen-local' ? 'Fragmentos consultados' : 'Fuentes';
      details.appendChild(element('summary', '', `${sourceLabel} (${sources.length})`));
      const list = element('ol', 'source-list');
      sources.forEach((source, i) => {
        const li = element('li');
        const button = element('button', 'source-link', `[${i + 1}] ${source.docName || 'Documento'} · pág. ${source.sourcePage || source.pageNum || '?'}`);
        button.type = 'button'; button.addEventListener('click', () => goToSource(source));
        li.append(button, element('p', 'source-excerpt', source.excerpt || source.text || ''));
        list.appendChild(li);
      });
      details.appendChild(list); div.appendChild(details);
    }
    if (result.citations && (result.citations.unverified?.length || result.citations.weak?.length)) {
      const msg = result.citations.unverified?.length
        ? `Citas fuera de rango: ${result.citations.unverified.join(', ')}.`
        : `Algunas citas tienen poco solapamiento textual (${result.citations.weak.join(', ')}); revisa la fuente.`;
      div.appendChild(element('p', 'citation-warning', msg));
    }
    if (result.trace && result.trace.length) {
      const trace = element('details', 'trace-details');
      trace.appendChild(element('summary', '', 'Ver proceso y límites'));
      const list = element('ul'); result.trace.forEach(line => list.appendChild(element('li', '', line)));
      trace.appendChild(list); div.appendChild(trace);
    }
    const actions = element('div', 'answer-actions');
    const isCharacter = result.mode === 'conversacion';
    const modeLabel = isTutor ? `Tutor · ${result.provider === 'qwen-local' ? 'reglas y explicación de Qwen' : 'reglas locales'}` : isCharacter ? `${result.character?.name || 'Personaje'} · ${result.provider === 'qwen-local' ? 'Qwen local' : 'reglas locales'}` : `${result.mode || 'auto'} · motor local`;
    const meta = element('span', 'muted', modeLabel + (Number.isFinite(result.latencyMs) ? ' · ' + U.formatMs(result.latencyMs) : ''));
    actions.appendChild(meta);
    // No copiar mensajes íntimos del modo personaje al registro de feedback ni
    // al modelo auxiliar: BORRAR debe eliminar el historial de esa conversación.
    if (!isCharacter && !isTutor) {
      const up = element('button', 'btn-mini', 'SÍ'); up.type = 'button'; up.setAttribute('aria-label', 'Respuesta útil');
      const down = element('button', 'btn-mini', 'NO'); down.type = 'button'; down.setAttribute('aria-label', 'Respuesta poco útil');
      function rate(rating) {
        const used = Array.isArray(result.citations?.used) ? result.citations.used : [];
        const rated = used.length ? sources.filter((_, i) => used.includes(i + 1)) : sources;
        // El historial puede conservar citas de un documento ya eliminado; no
        // atribuir una valoración nueva a IDs que ya no representan su fuente.
        const sentenceIds = [...new Set(rated.filter(source => {
          const live = source.sentenceId && S().getSentence(source.sentenceId);
          return live && live.docId === source.docId;
        }).map(source => source.sentenceId))];
        const nodeIds = S().state.nodes.filter(node => !node.isHub && (node.sentenceIds || []).some(id => sentenceIds.includes(id))).map(node => node.id);
        const record = root.NCMemory.recordFeedback({
          question: result.question, answer: result.text, rating,
          provider: result.provider || 'internal', mode: result.mode,
          citations: used, nodeIds, vaultIds: result.vaultIds || [], sentenceIds
        });
        if (rating < 0) root.KimiAuxModel?.recordNegativeEpisode(result.text || '', { sentenceIds, question: result.question, feedbackId: record.id });
        else root.KimiAuxModel?.trainOnPattern(result.text || '', 1.5);
        up.disabled = down.disabled = true;
        meta.textContent = sentenceIds.length ? 'Valoración guardada para las fuentes y, si MiniLM está activo, sus temas.' : 'Valoración guardada.';
      }
      up.addEventListener('click', () => rate(1));
      down.addEventListener('click', () => rate(-1));
      actions.append(up, down);
    }
    const md = element('button', 'btn-mini', '↓ .md'); md.type = 'button';
    md.addEventListener('click', () => download('respuesta-neural.md', root.NCRag.toMarkdown({ ...result, sources }), 'text/markdown;charset=utf-8'));
    actions.appendChild(md); div.appendChild(actions);
    box.appendChild(div);
    if (isTutor) box.scrollTop += div.getBoundingClientRect().top - box.getBoundingClientRect().top;
    else box.scrollTop = box.scrollHeight;
    return div;
  }
  async function send(question, mode, target) {
    const q = String(question || '').trim();
    if (!q || busy || replacing) return null;
    busy = true;
    const formButton = document.getElementById('btn-send');
    if (formButton) formButton.disabled = true;
    const out = target || document.getElementById('chat-messages');
    if (!target) message('user', q);
    else out.replaceChildren(element('p', 'muted', 'Analizando las fuentes locales…'));
    const selectedMode = mode || S().getSetting('mode', 'auto');
    const usingQwen = selectedMode === 'conversacion' && root.NCQwenModel?.info().enabled;
    const stop = document.getElementById('btn-stop-generation');
    const controller = new AbortController(); currentSend = controller;
    const requestId = `query-${++nextQueryId}`;
    S().emit('spider:queryStart', { requestId });
    controller.signal.addEventListener('abort', () => S().emit('spider:queryCancelled', { requestId }), { once: true });
    if (stop) stop.classList.toggle('hidden', !usingQwen || !!target);
    const pending = !target ? message('system', usingQwen ? 'Qwen está preparando la respuesta local…' : selectedMode === 'conversacion' ? 'Buscando en el libro elegido…' : 'Preparando la respuesta local…') : null;
    try {
      const result = await root.NCRag.ask(q, { mode: selectedMode, signal: controller.signal,
        onGenerating() {
          if (controller.signal.aborted || !pending) return;
          stop?.classList.remove('hidden'); pending.textContent = 'Qwen redacta una explicación opcional. Las citas se conservan por separado…';
        },
        onRetrieved(detail) {
          if (!controller.signal.aborted) S().emit('spider:queryVisual', { ...detail, query: q, requestId });
        },
        onToken(text) {
          if (!pending || controller.signal.aborted) return;
          const clean = root.NCQwenPrompt?.cleanOutput(text);
          if (clean) { pending.textContent = `Qwen: ${clean}`; out.scrollTop = out.scrollHeight; }
        } });
      if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      pending?.remove();
      if (target) target.replaceChildren();
      renderAnswer(result, { container: out });
      return result;
    } catch (error) {
      pending?.remove();
      if (error?.name !== 'AbortError') {
        if (target) target.replaceChildren(element('p', 'citation-warning', `No se pudo responder: ${error.message}`));
        else message('system', `No se pudo responder: ${error.message}`);
      }
      return null;
    } finally {
      if (currentSend === controller) currentSend = null;
      stop?.classList.add('hidden');
      busy = false;
      if (formButton) formButton.disabled = false;
    }
  }
  function restoreChat() {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.replaceChildren();
    message('system', 'Puedes saludar sin cargar un libro. Para trabajar con tus apuntes, añade un documento o usa Demo. Este chat se guarda con el estudio; ✦ HABLAR abre el espacio personal separado.');
    (S().state.chat || []).slice(-30).forEach(entry => {
      if (entry.role !== 'assistant') return;
      if (entry.question) message('user', entry.question);
      renderAnswer(entry);
    });
  }
  function setupCharacter() {
    const setup = document.getElementById('character-setup');
    const book = document.getElementById('character-book');
    const name = document.getElementById('character-name');
    const file = document.getElementById('character-file');
    const status = document.getElementById('character-status');
    const uploadLabel = file?.closest('label');
    if (!setup || !book || !name || !file || !status) return;
    let uploading = false, uploadController = null, notice = '', optionsKey = '';
    const textDocs = () => S().state.docs.filter(doc => !doc.mediaType && (doc.pages || []).some(page =>
      (page.sentences || []).some(sentence => String(sentence.text || '').trim())));

    function sync() {
      const active = S().getSetting('mode', 'auto') === 'conversacion';
      const qwen = !!root.NCQwenModel?.info().enabled;
      setup.classList.toggle('hidden', !active);
      document.getElementById('character-engine-badge').textContent = qwen ? 'QWEN LOCAL' : 'SIN LLM';
      document.getElementById('btn-character-qwen').classList.toggle('hidden', qwen);
      const tutor = S().getSetting('mode') === 'tutor';
      document.getElementById('study-quick-actions')?.classList.toggle('hidden', active || tutor);
      document.getElementById('character-quick-actions')?.classList.toggle('hidden', !active);
      const chat = document.getElementById('chat-input');
      if (chat) chat.placeholder = active ? 'Habla con tu personaje…' : tutor ? 'Pregunta o sigue el hilo…' : 'Saluda o pregunta por tus apuntes…';
      const docs = textDocs(), key = JSON.stringify(docs.map(doc => [doc.id, doc.name]));
      if (key !== optionsKey) {
        optionsKey = key;
        book.replaceChildren(element('option', '', docs.length ? 'Selecciona un libro…' : 'Aún no hay libros cargados'));
        book.firstChild.value = '';
        docs.forEach(doc => { const option = element('option', '', doc.displayName || doc.name); option.value = doc.id; book.appendChild(option); });
      }
      const selected = String(S().getSetting('characterDocId', '') || '');
      if (selected && !docs.some(doc => doc.id === selected)) {
        S().setSetting('characterDocId', '');
        return;
      }
      book.value = selected;
      const savedName = String(S().getSetting('characterName', '') || '').slice(0, 80);
      if (name.value !== savedName) name.value = savedName;
      book.disabled = uploading || !docs.length;
      file.disabled = uploading;
      uploadLabel?.classList.toggle('is-busy', uploading);
      if (uploading) return;
      status.textContent = notice || (!selected ? 'Sube un PDF, EPUB, TXT, Markdown o DOCX, o elige un libro ya cargado.' :
        !savedName.trim() ? 'Escribe el nombre del personaje para empezar.' : 'Listo. Pregunta por su historia o simplemente saluda.');
    }

    book.addEventListener('change', () => { notice = ''; S().setSetting('characterDocId', book.value); });
    name.addEventListener('input', () => { notice = ''; S().setSetting('characterName', name.value); });
    file.addEventListener('change', async () => {
      const selectedFile = file.files?.[0];
      if (!selectedFile || uploading) return;
      notice = '';
      if (!['pdf', 'epub', 'txt', 'md', 'docx'].includes(root.DocParsers.fileType(selectedFile))) {
        notice = 'Selecciona un libro PDF, EPUB, TXT, Markdown o DOCX.';
        file.value = ''; sync(); return;
      }
      uploading = true; uploadController = new AbortController();
      const controller = uploadController;
      sync(); status.textContent = 'Cargando el libro en este dispositivo…';
      try {
        const results = await root.DocParsers.handleFiles([selectedFile], {
          signal: controller.signal,
          onProgress(detail) {
            if (controller.signal.aborted) return;
            S().emit('ingest:progress', detail);
            if (detail.phase === 'pdf-page') status.textContent = `Leyendo PDF: página ${detail.page} de ${detail.limit}…`;
            else if (detail.phase === 'parse') status.textContent = 'Leyendo el libro en este dispositivo…';
          }
        });
        const result = results[0];
        if (!controller.signal.aborted && result?.ok) {
          S().setSetting('characterDocId', result.doc.id);
          notice = (result.doc.ingestWarnings || []).length ? `Libro cargado. ${result.doc.ingestWarnings.join(' ')}` : 'Libro cargado. Escribe el personaje y comienza a conversar.';
        } else if (!controller.signal.aborted) notice = result?.error || 'No se pudo cargar el libro.';
      } catch (error) {
        if (!controller.signal.aborted) notice = `No se pudo cargar el libro: ${error.message}`;
      } finally {
        if (uploadController === controller) uploadController = null;
        uploading = false; file.value = ''; sync();
      }
    });
    S().on('settings:changed', ({ key }) => { if (['mode', 'characterDocId', 'characterName'].includes(key)) sync(); });
    S().on('qwen:status', sync);
    S().on('doc:added', sync);
    S().on('doc:removed', () => { notice = ''; root.NCCharacter?.clearCache(); sync(); });
    const cancelUpload = () => { uploadController?.abort(); };
    S().on('system:resetting', cancelUpload); S().on('brain:importing', cancelUpload);
    const reset = () => { cancelUpload(); notice = ''; root.NCCharacter?.clearCache(); sync(); };
    S().on('system:reset', reset); S().on('brain:imported', reset);
    sync();
  }
  function init() {
    // Una recuperación pendiente no debe escribir ni despachar tras cambiar el corpus.
    ['doc:added', 'doc:removed', 'system:resetting', 'brain:importing'].forEach(event => S().on(event, () => currentSend?.abort()));
    S().on('settings:changed', ({ key }) => {
      if (['mode', 'characterDocId', 'characterName', 'dialogueDocId', 'dialogueQwen'].includes(key)) currentSend?.abort();
    });
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    restoreChat();
    setupCharacter(); root.NCDialogueUI.init();
    function submitLocal(e) {
      e.preventDefault();
      if (!input || busy || replacing) return;
      const q = input.value.trim(); if (!q) return;
      input.value = ''; send(q);
    }
    form?.addEventListener('submit', submitLocal);
    // En un iframe sin allow-forms el navegador bloquea submit incluso antes
    // del evento. El clic (también el implícito con Enter) solo procesa en local.
    document.getElementById('btn-send')?.addEventListener('click', submitLocal);
    document.querySelectorAll('.btn-chip').forEach(button => button.addEventListener('click', () => {
      const prompt = button.dataset.prompt || '';
      if (prompt.endsWith(' ')) { input.value = prompt; input.focus(); }
      else send(prompt, button.dataset.mode);
    }));
    document.getElementById('btn-run-writer')?.addEventListener('click', () => {
      const input = document.getElementById('writer-prompt');
      const output = document.getElementById('writer-output');
      if (!input || !output) return;
      const topic = input.value.trim() || 'Resumen del documento completo';
      root.KimiAuxModel?.learnStyle(topic);
      send(topic, 'redaccion', output);
    });
    document.getElementById('btn-stop-generation')?.addEventListener('click', () => currentSend?.abort());
    const clearPrompt = document.getElementById('dialogue-clear');
    function clearChat() {
      currentSend?.abort(); S().emit('chat:clearing');
      S().state.chat = []; S().savePersistent(); restoreChat();
      clearPrompt.hidden = true; S().emit('chat:cleared'); input.focus();
    }
    document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
      if (S().getSetting('mode') === 'tutor') {
        clearPrompt.hidden = false; document.getElementById('dialogue-clear-no').focus();
      } else if (confirm('¿Borrar el chat de estudio y de personajes? No se borrará Spyder personal.')) clearChat();
    });
    document.getElementById('dialogue-clear-no').addEventListener('click', () => { clearPrompt.hidden = true; input.focus(); });
    document.getElementById('dialogue-clear-yes').addEventListener('click', clearChat);
    for (const e of ['system:resetting','brain:importing']) S().on(e, () => { replacing = true; clearPrompt.hidden = true; });
    for (const e of ['system:reset','brain:imported','brain:importFailed']) S().on(e, () => { replacing = false; });
    S().on('chat:askAbout', ({ node }) => {
      document.querySelector('[data-tab="chat"]')?.click();
      send(`Explica ${node.label}`);
    });
    S().on('system:reset', restoreChat);
    S().on('brain:imported', restoreChat);
  }
  root.BrainRAG = { init, send, processQuery: (q, opts) => root.NCRag.ask(q, opts), renderAnswer, goToSource, download };
})(typeof window !== 'undefined' ? window : globalThis);
