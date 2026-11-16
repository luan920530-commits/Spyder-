/** Interfaz del chat y del redactor. Todos los contenidos del usuario se tratan como texto. */
(function (root) {
  'use strict';
  const U = root.NCUtil;
  const S = () => root.NeuralStore;
  let busy = false;

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
    // safeMarkdown escapa toda la entrada ANTES de añadir sus etiquetas fijas.
    body.innerHTML = U.safeMarkdown(result.text || '');
    const sources = Array.isArray(result.sources) ? result.sources : [];
    body.querySelectorAll('.cite-ref').forEach(ref => {
      const n = Number(ref.textContent.replace(/\D/g, ''));
      const source = sources[n - 1];
      if (!source) { ref.classList.add('cite-unverified'); ref.title = 'Cita fuera de las fuentes'; return; }
      const button = element('button', 'cite-ref', `[${n}]`);
      button.type = 'button';
      button.title = `${source.docName || 'Fuente'} · pág. ${source.sourcePage || source.pageNum || '?'}`;
      button.addEventListener('click', () => goToSource(source));
      ref.replaceWith(button);
    });
    div.appendChild(body);

    if (sources.length) {
      const details = element('details', 'sources-details');
      details.appendChild(element('summary', '', `Fuentes (${sources.length})`));
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
    const meta = element('span', 'muted', `${result.mode || 'auto'} · motor local${Number.isFinite(result.latencyMs) ? ' · ' + U.formatMs(result.latencyMs) : ''}`);
    actions.appendChild(meta);
    const up = element('button', 'btn-mini', 'SÍ'); up.type = 'button'; up.setAttribute('aria-label', 'Respuesta útil');
    const down = element('button', 'btn-mini', 'NO'); down.type = 'button'; down.setAttribute('aria-label', 'Respuesta poco útil');
    function rate(rating) {
      const first = sources[0];
      root.NCMemory.recordFeedback({
        question: result.question, answer: result.text, rating,
        provider: result.provider || 'internal', mode: result.mode,
        citations: result.citations?.used || [], nodeIds: result.nodeIds || [], vaultIds: result.vaultIds || [],
        sentenceIds: first && first.sentenceId ? [first.sentenceId] : []
      });
      if (rating < 0) root.KimiAuxModel?.recordNegativeEpisode(result.text || '');
      else root.KimiAuxModel?.trainOnPattern(result.text || '', 1.5);
      up.disabled = down.disabled = true;
      meta.textContent = first ? 'Valoración guardada; se ajustó la prioridad del primer pasaje.' : 'Valoración guardada.';
    }
    up.addEventListener('click', () => rate(1));
    down.addEventListener('click', () => rate(-1));
    actions.append(up, down);
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
    const pending = !target ? message('system', 'Buscando en tus documentos…') : null;
    try {
      const result = await root.NCRag.ask(q, { mode: mode || S().getSetting('mode', 'auto') });
      pending?.remove();
      if (target) target.replaceChildren();
      renderAnswer(result, { container: out });
      if (result.nodeIds?.length) {
        root.NeuralGraph?.highlightPath(result.nodeIds);
        S().emit('spider:queryVisual', { query: q, nodeIds: result.nodeIds });
      }
      return result;
    } catch (error) {
      pending?.remove();
      if (target) target.replaceChildren(element('p', 'citation-warning', `No se pudo responder: ${error.message}`));
      else message('system', `No se pudo responder: ${error.message}`);
      return null;
    } finally {
      busy = false;
      if (formButton) formButton.disabled = false;
    }
  }
  function restoreChat() {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.replaceChildren();
    message('system', 'Motor extractivo independiente, 100 % local. Carga un documento o usa Demo para empezar.');
    (S().state.chat || []).slice(-30).forEach(entry => {
      if (entry.role !== 'assistant') return;
      if (entry.question) message('user', entry.question);
      renderAnswer(entry);
    });
  }
  function init() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');
    restoreChat();
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
    document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
      if (!confirm('¿Borrar el historial de conversación local?')) return;
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
