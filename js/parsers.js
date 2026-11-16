/**
 * NEURAL COMMAND // AI SPIDER OS
 * js/parsers.js - Motor de ingesta binaria local + paginación anti-saturación
 */
(function () {
  const CHARS_PER_PAGE = 1600;

  const DEMO_TEXT = `Arquitectura de Redes Neuronales y Sistemas Distribuidos en Tiempo Real.
Una red neuronal artificial es un modelo computacional inspirado en las conexiones sinápticas del cerebro biológico. Cada neurona artificial recibe señales de entrada, aplica pesos sinápticos ajustables y produce una salida mediante una función de activación no lineal como ReLU o Sigmoide.
Cuando el gradiente descendente se combina con la retropropagación (backpropagation), el sistema minimiza la función de pérdida en un 94.2% de los casos de prueba estándar tras 50 épocas de entrenamiento.
En contraste, los sistemas distribuidos modernos utilizan protocolos de consenso como Raft o Paxos para garantizar la tolerancia a fallos bizantinos. Si un nodo falla durante la replicación de estado, el clúster elige un nuevo líder en menos de 150 milisegundos.
Por lo tanto, la convergencia entre grafos semánticos locales y enjambres de agentes autónomos permite indexar conocimiento universitario sin depender de servidores en la nube.
En resumen, el procesamiento offline-first reduce la latencia de consulta a 12 ms y protege la privacidad académica al 100%, consolidando definiciones, reglas causales, métricas cuantitativas y síntesis transversales en una memoria persistente.`;

  function splitIntoSentences(text, docId, docName, pageNum, startIdx) {
    const raw = text
      .replace(/\r\n/g, '\n')
      .split(/(?<=[.!?。\n])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 8);

    return raw.map((s, idx) => ({
      id: `${docId}-p${pageNum}-s${startIdx + idx}`,
      docId,
      docName,
      pageNum,
      text: s,
      harvested: false
    }));
  }

  function paginateText(text, docId, docName) {
    const clean = text.trim();
    if (!clean) return [{ pageNum: 1, text: '(Documento vacío)', sentences: [] }];

    const pages = [];
    let cursor = 0;
    let pageNum = 1;
    let sentCounter = 1;

    while (cursor < clean.length) {
      let end = Math.min(cursor + CHARS_PER_PAGE, clean.length);
      if (end < clean.length) {
        const lastSpace = clean.lastIndexOf(' ', end);
        if (lastSpace > cursor + 400) end = lastSpace;
      }
      const chunk = clean.slice(cursor, end).trim();
      const sentences = splitIntoSentences(chunk, docId, docName, pageNum, sentCounter);
      sentCounter += sentences.length;
      pages.push({ pageNum, text: chunk, sentences });
      cursor = end;
      pageNum++;
    }
    return pages;
  }

  async function parsePDF(file) {
    const buffer = await file.arrayBuffer();
    if (window.pdfjsLib && window.__CDN_STATUS.pdfjs) {
      try {
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map(it => it.str).join(' ') + '\n\n';
        }
        if (fullText.trim().length > 20) return fullText;
      } catch (e) {
        console.warn('[PDF.js] Fallback a FlateDecode nativo:', e);
      }
    }
    // Respaldo nativo FlateDecode / texto ASCII
    const bytes = new Uint8Array(buffer);
    const rawStr = new TextDecoder('latin1').decode(bytes);
    const textMatches = rawStr.match(/\(([^()]{4,})\)/g) || [];
    const extracted = textMatches.map(m => m.slice(1, -1)).join(' ');
    return extracted.length > 30 ? extracted : `[PDF binario: ${file.name}] (${Math.round(file.size / 1024)} KB).`;
  }

  async function parseDOCX(file) {
    const buffer = await file.arrayBuffer();
    if (window.mammoth && window.__CDN_STATUS.mammoth) {
      const res = await window.mammoth.extractRawText({ arrayBuffer: buffer });
      return res.value;
    }
    if (window.JSZip) {
      const zip = await window.JSZip.loadAsync(buffer);
      const xml = await zip.file('word/document.xml')?.async('string');
      if (xml) {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        return Array.from(doc.getElementsByTagName('w:t')).map(n => n.textContent).join(' ');
      }
    }
    return `[DOCX: ${file.name}]`;
  }

  async function parseOfficeZip(file, ext) {
    if (!window.JSZip) return `[${ext.toUpperCase()}: ${file.name}] Requiere JSZip.`;
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const texts = [];
    const entries = Object.keys(zip.files).filter(k =>
      (ext === 'pptx' && k.startsWith('ppt/slides/slide') && k.endsWith('.xml')) ||
      (ext === 'xlsx' && k.includes('sharedStrings.xml'))
    );
    for (const path of entries.sort()) {
      const xml = await zip.files[path].async('string');
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const nodes = doc.querySelectorAll('t, a\\:t');
      nodes.forEach(n => { if (n.textContent.trim()) texts.push(n.textContent.trim()); });
    }
    return texts.join(' ') || `[${ext.toUpperCase()}: ${file.name}]`;
  }

  async function handleFiles(fileList) {
    for (const file of Array.from(fileList)) {
      const ext = file.name.split('.').pop().toLowerCase();
      const docId = 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      let text = '';
      let mediaUrl = null;
      let mediaType = null;

      try {
        if (ext === 'pdf') {
          text = await parsePDF(file);
        } else if (ext === 'docx') {
          text = await parseDOCX(file);
        } else if (ext === 'pptx' || ext === 'xlsx') {
          text = await parseOfficeZip(file, ext);
        } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
          mediaUrl = URL.createObjectURL(file);
          mediaType = 'image';
          text = `Imagen cargada: ${file.name}. `;
          if (window.Tesseract && window.__CDN_STATUS.tesseract) {
            const { data } = await window.Tesseract.recognize(mediaUrl, 'spa+eng');
            text += data.text || '';
          } else {
            text += 'OCR local listo para análisis visual.';
          }
        } else if (['mp4', 'webm'].includes(ext)) {
          mediaUrl = URL.createObjectURL(file);
          mediaType = 'video';
          text = `Video cargado: ${file.name}. Usa el botón de captura de fotogramas para enviar frames a la red neuronal.`;
        } else {
          text = await file.text();
        }
      } catch (err) {
        console.error('[Parser]', err);
        text = `Error leyendo ${file.name}: ${err.message}`;
      }

      const pages = paginateText(text, docId, file.name);
      window.NeuralStore.addDocument({
        id: docId,
        name: file.name,
        type: ext,
        pages,
        mediaUrl,
        mediaType
      });
    }
  }

  function renderActivePage() {
    const store = window.NeuralStore;
    const doc = store.getActiveDoc();
    const emptyEl = document.getElementById('doc-empty-state');
    const contentEl = document.getElementById('doc-content');
    const mediaEl = document.getElementById('media-viewer');
    const pageInd = document.getElementById('page-indicator');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    renderDocTabs();

    if (!doc) {
      emptyEl.classList.remove('hidden');
      mediaEl.classList.add('hidden');
      contentEl.innerHTML = '';
      pageInd.textContent = 'Pág 0 / 0';
      btnPrev.disabled = true;
      btnNext.disabled = true;
      return;
    }

    emptyEl.classList.add('hidden');

    // Media viewer
    if (doc.mediaUrl) {
      mediaEl.classList.remove('hidden');
      if (doc.mediaType === 'image') {
        mediaEl.innerHTML = `<img src="${doc.mediaUrl}" alt="${doc.name}" />`;
      } else if (doc.mediaType === 'video') {
        mediaEl.innerHTML = `
          <video id="active-video" src="${doc.mediaUrl}" controls></video>
          <div style="margin-top:6px;">
            <button class="btn-hud btn-cyan" id="btn-capture-frame">📸 Capturar Fotograma a Red</button>
          </div>`;
        document.getElementById('btn-capture-frame')?.addEventListener('click', () => {
          const vid = document.getElementById('active-video');
          if (!vid) return;
          const t = vid.currentTime.toFixed(1);
          window.NeuralStore.emit('spider:manualPattern', {
            cluster: 'AGT-03',
            label: `Frame ${t}s`,
            text: `Fotograma clave capturado en ${t}s del video ${doc.name}`,
            pageNum: 1,
            sentenceId: doc.pages[0]?.sentences[0]?.id || 'video-frame'
          });
        });
      }
    } else {
      mediaEl.classList.add('hidden');
      mediaEl.innerHTML = '';
    }

    const page = doc.pages[store.state.activePage - 1] || doc.pages[0];
    pageInd.textContent = `Pág ${store.state.activePage} / ${doc.pages.length}`;
    btnPrev.disabled = store.state.activePage <= 1;
    btnNext.disabled = store.state.activePage >= doc.pages.length;

    // Renderizar únicamente la página activa (Anti-Saturación DOM)
    contentEl.innerHTML = '';
    if (!page || !page.sentences.length) {
      contentEl.textContent = page?.text || '';
      return;
    }

    page.sentences.forEach(sent => {
      const sSpan = document.createElement('span');
      sSpan.className = 'sentence-block' + (sent.harvested ? ' sentence-harvested' : '');
      sSpan.dataset.sid = sent.id;

      const words = sent.text.split(/(\s+)/);
      words.forEach(w => {
        if (/^\s+$/.test(w)) {
          sSpan.appendChild(document.createTextNode(w));
        } else {
          const wSpan = document.createElement('span');
          wSpan.className = 'word-span';
          wSpan.textContent = w;
          wSpan.addEventListener('click', () => {
            window.NeuralStore.emit('spider:dispatchToSentence', {
              sentence: sent,
              targetEl: wSpan
            });
          });
          sSpan.appendChild(wSpan);
        }
      });

      contentEl.appendChild(sSpan);
      contentEl.appendChild(document.createTextNode(' '));
    });
  }

  function renderDocTabs() {
    const tabsEl = document.getElementById('doc-tabs');
    if (!tabsEl) return;
    const { docs, activeDocId } = window.NeuralStore.state;
    tabsEl.innerHTML = '';
    docs.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'doc-tab' + (d.id === activeDocId ? ' active' : '');
      btn.textContent = d.name;
      btn.addEventListener('click', () => window.NeuralStore.setActiveDoc(d.id, 1));
      tabsEl.appendChild(btn);
    });
  }

  function loadDemo() {
    const docId = 'doc-demo-' + Date.now();
    const pages = paginateText(DEMO_TEXT, docId, 'Arquitectura_IA_Demo.txt');
    window.NeuralStore.addDocument({
      id: docId,
      name: 'Arquitectura_IA_Demo.txt',
      type: 'txt',
      pages
    });
  }

  function init() {
    const fileInput = document.getElementById('file-input');
    const dropzone = document.getElementById('doc-dropzone');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');
    const btnDemo = document.getElementById('btn-load-demo');
    const btnPaste = document.getElementById('btn-paste-modal');
    const pasteModal = document.getElementById('paste-modal');
    const btnClosePaste = document.getElementById('btn-close-paste');
    const btnConfirmPaste = document.getElementById('btn-confirm-paste');

    fileInput?.addEventListener('change', e => {
      if (e.target.files?.length) handleFiles(e.target.files);
      e.target.value = '';
    });

    dropzone?.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone?.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    });

    btnPrev?.addEventListener('click', () => {
      window.NeuralStore.setActivePage(window.NeuralStore.state.activePage - 1);
    });
    btnNext?.addEventListener('click', () => {
      window.NeuralStore.setActivePage(window.NeuralStore.state.activePage + 1);
    });
    btnDemo?.addEventListener('click', loadDemo);

    btnPaste?.addEventListener('click', () => pasteModal.classList.remove('hidden'));
    btnClosePaste?.addEventListener('click', () => pasteModal.classList.add('hidden'));
    btnConfirmPaste?.addEventListener('click', () => {
      const title = document.getElementById('paste-title').value.trim() || 'Nota_Manual.txt';
      const body = document.getElementById('paste-body').value.trim();
      if (!body) return;
      const docId = 'doc-paste-' + Date.now();
      window.NeuralStore.addDocument({
        id: docId,
        name: title,
        type: 'txt',
        pages: paginateText(body, docId, title)
      });
      document.getElementById('paste-body').value = '';
      pasteModal.classList.add('hidden');
    });

    window.NeuralStore.on('doc:pageChanged', renderActivePage);
    window.NeuralStore.on('system:reset', renderActivePage);
  }

  window.DocParsers = { init, loadDemo, renderActivePage };
})();
