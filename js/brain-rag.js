/** Interfaz del chat y del redactor. Todos los contenidos del usuario se tratan como texto. */
(function (root) {
  'use strict';
  const U = root.NCUtil;
  const S = () => root.NeuralStore;
  let busy = false, currentSend = null, nextQueryId = 0;

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
  function knowledgeLink(entry) {
    const a = element('a', 'source-link knowledge-external', 'Abrir fuente original (requiere conexión) ↗');
    a.href = entry.sourceUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  function goToSource(source) {
    if (!source || source.origin === 'knowledge') return;
    if (source.sentenceId && root.DocViewer?.goToSentence(source.sentenceId, source.docId)) return;
    // El historial puede conservar una página cuya oración ya no está activa.
    S().holdAutoNavigation();
    S().setActiveDoc(source.docId, source.pageNum);
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
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const localEntry = source => source?.origin === 'knowledge' ? root.NCKnowledge?.get(source.knowledgeId) : null;
    function showLocalSource(n) {
      const details = div.querySelector('.sources-details');
      const row = div.querySelector(`[data-source-number="${n}"]`);
      if (!details || !row) return;
      details.open = true;
      row.scrollIntoView({ block: 'nearest' });
      row.focus({ preventScroll: true });
    }
    function sourceButton(n, source) {
      const button = element('button', 'cite-ref', `[${n}]`);
      button.type = 'button';
      const entry = localEntry(source);
      button.title = source.origin === 'knowledge' ? (entry ? `Ver ficha local: ${entry.title}` : 'Ficha local no disponible') :
        `${source.docName || 'Fuente'} · pág. ${source.sourcePage || source.pageNum || '?'}`;
      button.addEventListener('click', () => source.origin === 'knowledge' ? showLocalSource(n) : goToSource(source));
      return button;
    }
    const characterReply = result.mode === 'conversacion' && result.characterReply;
    if (characterReply && typeof characterReply === 'object') {
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

    if (sources.length) {
      const details = element('details', 'sources-details');
      const sourceLabel = result.provider === 'qwen-local' ? 'Fragmentos consultados' : 'Fuentes';
      details.appendChild(element('summary', '', `${sourceLabel} (${sources.length})`));
      const list = element('ol', 'source-list');
      sources.forEach((source, i) => {
        const li = element('li'); li.dataset.sourceNumber = String(i + 1); li.tabIndex = -1;
        if (source.origin === 'knowledge') {
          // Una ficha importada solo puede enlazar a entradas canónicas de esta
          // instalación; no se ejecutan ni se abren URLs de un JSON externo.
          const entry = localEntry(source);
          li.appendChild(element('strong', 'knowledge-source-title', entry ? `[${i + 1}] BASE LOCAL · ${entry.title}` : `[${i + 1}] Ficha local no disponible en esta versión`));
          if (entry) {
            li.appendChild(element('p', 'source-excerpt', entry.sourceText));
            li.appendChild(element('p', 'knowledge-source-meta', `${entry.category} · Revisión ${entry.reviewed} · ${entry.sourceName}`));
            li.appendChild(knowledgeLink(entry));
          }
        } else {
          const button = element('button', 'source-link', `[${i + 1}] ${source.docName || 'Documento'} · pág. ${source.sourcePage || source.pageNum || '?'}`);
          button.type = 'button'; button.addEventListener('click', () => goToSource(source));
          li.append(button, element('p', 'source-excerpt', source.excerpt || source.text || ''));
        }
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
    const modeLabel = isCharacter ? `${result.character?.name || 'Personaje'} · ${result.provider === 'qwen-local' ? 'Qwen local' : 'reglas locales'}` : `${result.mode || 'auto'} · motor local`;
    const meta = element('span', 'muted', modeLabel + (Number.isFinite(result.latencyMs) ? ' · ' + U.formatMs(result.latencyMs) : ''));
    actions.appendChild(meta);
    // No copiar mensajes íntimos del modo personaje al registro de feedback ni
    // al modelo auxiliar: BORRAR debe eliminar el historial de esa conversación.
    if (!isCharacter) {
      const up = element('button', 'btn-mini', 'SÍ'); up.type = 'button'; up.setAttribute('aria-label', 'Respuesta útil');
      const down = element('button', 'btn-mini', 'NO'); down.type = 'button'; down.setAttribute('aria-label', 'Respuesta poco útil');
      function rate(rating) {
        const used = Array.isArray(result.citations?.used) ? result.citations.used : [];
        const rated = used.length ? sources.filter((_, i) => used.includes(i + 1)) : sources;
        // El historial puede conservar citas de un documento ya eliminado; no
        // atribuir una valoración nueva a IDs que ya no representan su fuente.
        const sentenceIds = [...new Set(rated.filter(source => {
          if (source.origin === 'knowledge') return false;
          const live = source.sentenceId && S().getSentence(source.sentenceId);
          return live && live.docId === source.docId;
        }).map(source => source.sentenceId))];
        const nodeIds = S().state.nodes.filter(node => !node.isHub && (node.sentenceIds || []).some(id => sentenceIds.includes(id))).map(node => node.id);
        const record = root.NCMemory.recordFeedback({
          question: result.question, answer: result.text, rating,
          provider: result.provider || 'internal', mode: result.mode,
          citations: used, nodeIds, vaultIds: result.vaultIds || [], sentenceIds
        });
        // Las fichas de referencia no se entrenan como patrones personales.
        if (!sources.some(source => source.origin === 'knowledge')) {
          if (rating < 0) root.KimiAuxModel?.recordNegativeEpisode(result.text || '', { sentenceIds, question: result.question, feedbackId: record.id });
          else root.KimiAuxModel?.trainOnPattern(result.text || '', 1.5);
        }
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
    box.appendChild(div); box.scrollTop = box.scrollHeight;
    return div;
  }
  async function send(question, mode, target) {
    const q = String(question || '').trim();
    if (!q || busy) return null;
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
    const pending = !target ? message('system', usingQwen ? 'Qwen está preparando la respuesta local…' : selectedMode === 'conversacion' ? 'Buscando en el libro elegido…' : 'Buscando en las fuentes seleccionadas…') : null;
    try {
      const result = await root.NCRag.ask(q, { mode: selectedMode, signal: controller.signal,
        onRetrieved(detail) {
          // Las fichas locales no son páginas del visor; solo se anima el
          // enjambre cuando hay candidatos privados. En búsquedas exclusivamente
          // documentales, conservar el aviso de que no hubo pasajes para dirigir.
          if (controller.signal.aborted) return;
          if (detail.hits?.length) S().emit('spider:queryVisual', { ...detail, query: q, requestId });
          else if (detail.scope === 'documents' && !detail.globalSample)
            S().emit('spiders:queryGuidance', { method: detail.method, sent: 0, pending: 0 });
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
    message('system', 'Procesamiento local. Consulta la base local o carga un documento; Qwen opcional se activa desde MODELO para conversar con personajes.');
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
      document.getElementById('study-quick-actions')?.classList.toggle('hidden', active);
      document.getElementById('character-quick-actions')?.classList.toggle('hidden', !active);
      document.getElementById('knowledge-controls')?.classList.toggle('hidden', active);
      const chat = document.getElementById('chat-input');
      if (chat) chat.placeholder = active ? 'Habla con tu personaje…' : 'Pregunta a tus documentos o a la base local…';
      const docs = textDocs(), key = JSON.stringify(docs.map(doc => [doc.id, doc.name]));
      if (key !== optionsKey) {
        optionsKey = key;
        book.replaceChildren(element('option', '', docs.length ? 'Selecciona un libro…' : 'Aún no hay libros cargados'));
        book.firstChild.value = '';
        docs.forEach(doc => { const option = element('option', '', doc.name); option.value = doc.id; book.appendChild(option); });
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
      if (!/\.(pdf|epub|txt|md|docx)$/i.test(selectedFile.name)) {
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
  function setupKnowledge() {
    const select = document.getElementById('search-scope'), catalog = document.getElementById('knowledge-catalog');
    const meta = document.getElementById('knowledge-meta'), knowledge = root.NCKnowledge;
    if (!select || !catalog || !meta || !knowledge) return;
    const sync = () => {
      const value = S().getSetting('searchScope', 'both');
      select.value = ['both', 'documents', 'knowledge'].includes(value) ? value : 'both';
    };
    select.addEventListener('change', () => S().setSetting('searchScope', select.value));
    S().on('settings:changed', ({ key }) => { if (key === 'searchScope') sync(); });
    S().on('system:reset', sync); S().on('brain:imported', sync);
    const info = knowledge.info();
    meta.textContent = `${info.count} fichas · revisión ${info.reviewed} · referencias y ejemplos, no un modelo generativo.`;
    for (const category of info.categories) {
      const entries = knowledge.list().filter(entry => entry.category === category);
      const group = element('details', 'knowledge-category');
      group.appendChild(element('summary', '', `${category} (${entries.length})`));
      entries.forEach(entry => {
        const item = element('details', 'knowledge-entry');
        item.appendChild(element('summary', '', entry.title));
        item.appendChild(element('p', '', entry.sourceText));
        item.appendChild(element('p', 'knowledge-source-meta', `${entry.sourceName} · revisión ${entry.reviewed}`));
        item.appendChild(knowledgeLink(entry));
        group.appendChild(item);
      });
      catalog.appendChild(group);
    }
    sync();
  }
  function init() {
    // Una recuperación pendiente no debe escribir ni despachar tras cambiar el corpus o ámbito.
    ['doc:added', 'doc:removed', 'system:resetting', 'brain:importing'].forEach(event => S().on(event, () => currentSend?.abort()));
    S().on('settings:changed', ({ key }) => {
      if (['mode', 'searchScope', 'characterDocId', 'characterName'].includes(key)) currentSend?.abort();
    });
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    restoreChat();
    setupKnowledge();
    setupCharacter();
    form?.addEventListener('submit', e => {
      e.preventDefault();
      if (!input || busy) return;
      const q = input.value.trim(); if (!q) return;
      input.value = ''; send(q);
    });
    document.querySelectorAll('.btn-chip').forEach(button => button.addEventListener('click', () => {
      const prompt = button.dataset.prompt || '';
      if (prompt.endsWith(' ')) { input.value = prompt; input.focus(); }
      else send(prompt);
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
    document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
      if (!confirm('¿Borrar el historial de conversación local?')) return;
      currentSend?.abort(); S().emit('chat:clearing');
      S().state.chat = []; S().savePersistent(); restoreChat();
    });
    S().on('chat:askAbout', ({ node }) => {
      document.querySelector('[data-tab="chat"]')?.click();
      send(`Explica ${node.label}`);
    });
    S().on('system:reset', restoreChat);
    S().on('brain:imported', restoreChat);
  }
  root.BrainRAG = { init, send, processQuery: (q, opts) => root.NCRag.ask(q, opts), renderAnswer, goToSource, download };
})(typeof window !== 'undefined' ? window : globalThis);
