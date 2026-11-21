/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/viewer.js — Visor documental: pestañas de documentos, paginación por secciones,
 * multimedia con captura de fotogramas, pegado de texto e importación por URL.
 */
(function (root) {
  'use strict';

  const U = root.NCUtil;
  const store = () => root.NeuralStore;

  let renderScheduled = false;
  let ingestError = '';
  let pendingSource = null;
  // El enjambre consulta posiciones con frecuencia; evita recorrer todo el DOM por frame.
  const sentenceElements = new Map();

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => { renderScheduled = false; render(); });
  }

  // Las citas se revelan después del render real, no tras un plazo fijo:
  // una página grande o un navegador lento pueden tardar más de 100 ms.
  function goToSentence(id, expectedDocId) {
    const S = store(), sentence = S?.getSentence(id);
    if (!sentence || (expectedDocId && sentence.docId !== expectedDocId)) return false;
    pendingSource = { id, docId: sentence.docId, pageNum: sentence.pageNum };
    S.holdAutoNavigation();
    S.setActiveDoc(sentence.docId, sentence.pageNum);
    return true;
  }

  function revealPendingSource() {
    if (!pendingSource) return;
    const request = pendingSource; pendingSource = null;
    const S = store();
    if (S?.state.activeDocId === request.docId && S.state.activePage === request.pageNum)
      root.NeuralGraph?.scrollToSentence(request.id);
  }

  function showIngestMessage(message) {
    const el = document.getElementById('ingest-message');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
  }

  function render() {
    const S = store();
    if (!S) return;
    const doc = S.getActiveDoc();
    const emptyEl = document.getElementById('doc-empty-state');
    const contentEl = document.getElementById('doc-content');
    const mediaEl = document.getElementById('media-viewer');
    const pageInd = document.getElementById('page-indicator');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');
    const sectionEl = document.getElementById('doc-section');
    const statusEl = document.getElementById('ingest-status');

    sentenceElements.clear();
    renderDocTabs();
    showIngestMessage(ingestError || (doc?.ingestWarnings || []).join(' '));

    if (!doc) {
      emptyEl?.classList.remove('hidden');
      mediaEl?.classList.add('hidden');
      if (contentEl) contentEl.innerHTML = '';
      if (pageInd) pageInd.textContent = 'Pág 0 / 0';
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      if (sectionEl) sectionEl.textContent = 'Sin documento';
      if (statusEl) statusEl.textContent = 'Esperando material';
      pendingSource = null;
      return;
    }

    emptyEl?.classList.add('hidden');
    if (statusEl) {
      statusEl.textContent = `${doc.name} · ${doc.method || doc.type || 'texto'} · ${doc.pages.length} pág.`;
    }

    // Solo se usan URL blob creadas para archivos seleccionados en esta sesión.
    if (mediaEl) {
      mediaEl.replaceChildren();
      if (doc.mediaUrl && String(doc.mediaUrl).startsWith('blob:')) {
        mediaEl.classList.remove('hidden');
        const media = document.createElement(doc.mediaType === 'image' ? 'img' : 'video');
        media.src = doc.mediaUrl;
        if (doc.mediaType === 'image') media.alt = doc.name;
        else {
          media.id = 'active-video'; media.controls = true;
        }
        mediaEl.appendChild(media);
        if (doc.mediaType === 'video') {
          const button = document.createElement('button');
          button.className = 'btn-hud btn-cyan'; button.textContent = '📸 Registrar momento';
          button.addEventListener('click', () => captureFrame(doc));
          mediaEl.appendChild(button);
        }
      } else if (doc.mediaType) {
        mediaEl.classList.remove('hidden');
        mediaEl.textContent = 'Para volver a ver el archivo multimedia, selecciónalo de nuevo.';
      } else mediaEl.classList.add('hidden');
    }

    const page = doc.pages[S.state.activePage - 1] || doc.pages[0];
    if (pageInd) pageInd.textContent = `Pág ${S.state.activePage} / ${doc.pages.length}`;
    if (btnPrev) btnPrev.disabled = S.state.activePage <= 1;
    if (btnNext) btnNext.disabled = S.state.activePage >= doc.pages.length;
    if (sectionEl) sectionEl.textContent = (page?.section || 'Sin sección') + (page?.sourcePage ? ` · PDF pág. ${page.sourcePage}` : '');

    if (!contentEl) { pendingSource = null; return; }
    contentEl.innerHTML = '';

    if (!page || !(page.sentences || []).length) {
      contentEl.textContent = page?.text || '';
      pendingSource = null;
      return;
    }

    page.sentences.forEach(sent => {
      const block = document.createElement('span');
      block.className = 'sentence-block' + (sent.harvested ? ' sentence-harvested' : '');
      block.dataset.sid = sent.id;
      block.title = 'Clic en una palabra para enviar una araña';

      const words = sent.text.split(/(\s+)/);
      words.forEach(w => {
        if (/^\s+$/.test(w)) {
          block.appendChild(document.createTextNode(w));
          return;
        }
        const span = document.createElement('span');
        span.className = 'word-span';
        span.textContent = w;
        span.addEventListener('click', () => {
          S.emit('spider:dispatchToSentence', { sentence: S.getSentence(sent.id) || sent });
        });
        block.appendChild(span);
      });

      contentEl.appendChild(block);
      sentenceElements.set(sent.id, block);
      contentEl.appendChild(document.createTextNode(' '));
    });
    revealPendingSource();
  }

  function renderDocTabs() {
    const S = store();
    const tabsEl = document.getElementById('doc-tabs');
    if (!tabsEl || !S) return;
    tabsEl.innerHTML = '';
    S.state.docs.forEach(d => {
      const wrap = document.createElement('div');
      wrap.className = 'doc-tab' + (d.id === S.state.activeDocId ? ' active' : '');
      const btn = document.createElement('button');
      btn.className = 'doc-tab-name';
      btn.textContent = d.name;
      btn.title = `${d.name} · ${d.pages.length} pág.`;
      btn.addEventListener('click', () => { S.holdAutoNavigation(); S.setActiveDoc(d.id, 1); });
      const close = document.createElement('button');
      close.className = 'doc-tab-close';
      close.textContent = '✕';
      close.setAttribute('aria-label', 'Quitar documento ' + d.name);
      close.addEventListener('click', e => {
        e.stopPropagation();
        S.removeDocument(d.id);
      });
      wrap.appendChild(btn);
      wrap.appendChild(close);
      tabsEl.appendChild(wrap);
    });
  }

  function captureFrame(doc) {
    const S = store();
    const vid = document.getElementById('active-video');
    if (!vid || !S) return;
    const t = Number(vid.currentTime || 0).toFixed(1);
    S.addPattern({
      cluster: 'AGT-03',
      label: `Momento ${t}s`,
      text: `Marca de tiempo ${t}s del vídeo ${doc.name} (sin fotograma guardado).`,
      pageNum: 1,
      sentenceId: (doc.pages[0]?.sentences[0] || {}).id || 'video-frame',
      color: '#f59e0b'
    });
    toast(`Marca de tiempo ${t}s guardada`);
  }

  function toast(msg) {
    const el = document.getElementById('hud-toast');
    const msgEl = document.getElementById('hud-toast-msg');
    if (!el || !msgEl) return;
    msgEl.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  // ── Modales de ingesta ───────────────────────────────────────────────────
  function setupModals() {
    const S = store();
    if (!S) return;

    const pasteModal = document.getElementById('paste-modal');
    document.getElementById('btn-paste-modal')?.addEventListener('click', () => { pasteModal?.classList.remove('hidden'); document.getElementById('paste-title')?.focus(); });
    document.getElementById('btn-close-paste')?.addEventListener('click', () => { pasteModal?.classList.add('hidden'); document.getElementById('btn-paste-modal')?.focus(); });

    document.getElementById('btn-confirm-paste')?.addEventListener('click', () => {
      const title = (document.getElementById('paste-title')?.value || '').trim() || 'Nota_Manual.txt';
      const body = (document.getElementById('paste-body')?.value || '').trim();
      if (!body) return;
      const docId = U.uid('doc');
      S.addDocument({
        id: docId, name: title, type: 'txt', method: 'pegado',
        pages: root.DocParsers.paginate(body, docId, title)
      });
      const bodyEl = document.getElementById('paste-body');
      if (bodyEl) bodyEl.value = '';
      pasteModal?.classList.add('hidden');
      toast('Texto indexado');
    });

    document.getElementById('chk-auto-page')?.addEventListener('change', () => S.holdAutoNavigation(0));
    document.getElementById('btn-prev-page')?.addEventListener('click', () => {
      S.holdAutoNavigation(); S.setActivePage(S.state.activePage - 1);
    });
    document.getElementById('btn-next-page')?.addEventListener('click', () => {
      S.holdAutoNavigation(); S.setActivePage(S.state.activePage + 1);
    });
  }

  function init() {
    const S = store();
    if (!S) return;

    setupModals();

    S.on('doc:pageChanged', ({ docId, pageNum } = {}) => {
      if (pendingSource && (pendingSource.docId !== docId || pendingSource.pageNum !== pageNum)) pendingSource = null;
      ingestError = ''; scheduleRender();
    });
    S.on('doc:added', scheduleRender);
    ['doc:removed', 'system:reset', 'brain:imported'].forEach(event => S.on(event, () => { pendingSource = null; scheduleRender(); }));
    S.on('ingest:progress', detail => {
      const status = document.getElementById('ingest-status');
      if (!status) return;
      if (detail.phase === 'parse') {
        ingestError = ''; showIngestMessage('');
        status.textContent = `Analizando ${detail.name}…`;
      } else if (detail.phase === 'pdf-page') {
        status.textContent = `Leyendo PDF ${detail.page} / ${detail.limit} pág.`;
      } else if (detail.phase === 'indexed') {
        status.textContent = `${detail.doc.name} · ${detail.method} · listo`;
        showIngestMessage((detail.doc.ingestWarnings || []).join(' '));
      } else if (detail.phase === 'error') {
        status.textContent = `Error con ${detail.name}`;
        ingestError = `${detail.name}: ${detail.error}`;
        showIngestMessage(ingestError);
        const zone = document.getElementById('doc-dropzone');
        if (zone) zone.scrollTop = 0;
      }
    });

    S.on('harvest:progress', ({ harvested, total, rate }) => {
      const bar = document.getElementById('harvest-bar');
      const label = document.getElementById('harvest-label');
      const rateEl = document.getElementById('harvest-rate');
      if (bar) bar.style.width = total ? Math.round((harvested / total) * 100) + '%' : '0%';
      if (label) label.textContent = `${harvested}/${total} pasajes`;
      if (rateEl) rateEl.textContent = `${rate.toFixed(1)}/s`;
    });

    scheduleRender();
  }

  root.DocViewer = { init, render, toast, goToSentence, getSentenceElement: id => sentenceElements.get(id) || null };
})(typeof window !== 'undefined' ? window : globalThis);
