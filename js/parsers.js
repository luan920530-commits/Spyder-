/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/parsers.js — Ingesta local multi-formato con extracción por secciones.
 *
 * Formatos: PDF (PDF.js local), DOCX/PPTX/XLSX/EPUB (ZIP nativo o JSZip),
 * HTML, TXT/MD/código/CSV/SRT, imágenes (OCR opcional) y vídeo (captura de fotogramas).
 * Todo ocurre en el navegador; ninguna llamada a servidores.
 */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined') ? require('./util.js') : (root.NCUtil || {});
  const api = factory(U, root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DocParsers = Object.assign(root.DocParsers || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U, root) {
  'use strict';

  const CHARS_PER_PAGE = 1500;
  const MAX_PAGE_SENTENCES = 12;

  // ─────────────────────────────────────────────────────────────────────────
  // ZIP nativo (sin JSZip): lee el directorio central y descomprime con
  // DecompressionStream('deflate-raw'). Soporta método 0 (store) y 8 (deflate).
  // ─────────────────────────────────────────────────────────────────────────
  function hasDecompression() {
    return typeof DecompressionStream !== 'undefined';
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function findEOCD(bytes) {
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
    }
    return -1;
  }

  async function readZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const eocd = findEOCD(bytes);
    if (eocd < 0) throw new Error('ZIP inválido (sin EOCD)');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = dv.getUint16(eocd + 10, true);
    let offset = dv.getUint32(eocd + 16, true);
    const entries = new Map();

    for (let i = 0; i < count; i++) {
      if (dv.getUint32(offset, true) !== 0x02014b50) break;
      const method = dv.getUint16(offset + 10, true);
      const compSize = dv.getUint32(offset + 20, true);
      const nameLen = dv.getUint16(offset + 28, true);
      const extraLen = dv.getUint16(offset + 30, true);
      const commentLen = dv.getUint16(offset + 32, true);
      const localOffset = dv.getUint32(offset + 42, true);
      const name = new TextDecoder('utf-8').decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      entries.set(name, { method, compSize, localOffset });
      offset += 46 + nameLen + extraLen + commentLen;
    }

    async function extract(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lo = e.localOffset;
      if (dv.getUint32(lo, true) !== 0x04034b50) return null;
      const nameLen = dv.getUint16(lo + 26, true);
      const extraLen = dv.getUint16(lo + 28, true);
      const start = lo + 30 + nameLen + extraLen;
      const raw = bytes.subarray(start, start + e.compSize);
      if (e.method === 0) return raw;
      if (e.method === 8) {
        if (hasDecompression()) return inflateRaw(raw);
        throw new Error('Descompresión no disponible en este navegador');
      }
      throw new Error('Método ZIP no soportado: ' + e.method);
    }

    return { names: Array.from(entries.keys()), extract };
  }

  async function unzipText(buffer, filename) {
    const zip = await readZip(buffer);
    const bytes = await zip.extract(filename);
    if (!bytes) return null;
    return new TextDecoder('utf-8').decode(bytes);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PDF: lector y recursos locales, con páginas y errores diferenciados.
  // ─────────────────────────────────────────────────────────────────────────
  const MAX_PDF_PAGES = 500;

  // Solo se cargan scripts empaquetados, nunca rutas procedentes del PDF. Las
  // importaciones simultáneas comparten carga; un fallo de red permite reintentar.
  const pdfScripts = new Map();
  function loadPdfScript(filename, base) {
    const url = new URL('vendor/pdfjs/' + filename, base).href;
    if (!pdfScripts.has(url)) {
      const pending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => { script.remove(); resolve(); };
        script.onerror = () => { script.remove(); reject(new Error(`No se pudo cargar ${filename}`)); };
        document.head.appendChild(script);
      }).catch(error => { pdfScripts.delete(url); throw error; });
      pdfScripts.set(url, pending);
    }
    return pdfScripts.get(url);
  }

  // En la web se mantienen el worker dedicado y las peticiones individuales.
  // Con origen opaco se usa el motor en el hilo principal; los CMaps/fuentes
  // se leen como datos de un script clásico solo si ese PDF los necesita.
  function packedPdfResources(base, pdfjs) {
    async function bytes(key) {
      await loadPdfScript('packed-assets.js', base);
      const data = root.NCPdfPackedAssets?.[key];
      if (typeof data !== 'string') throw new Error('Recurso PDF no incluido');
      return Uint8Array.from(atob(data), char => char.charCodeAt(0));
    }
    return {
      useWorkerFetch: false,
      CMapReaderFactory: class {
        async fetch({ name }) {
          return { cMapData: await bytes(`cmaps/${name}.bcmap`), compressionType: pdfjs.CMapCompressionType.BINARY };
        }
      },
      StandardFontDataFactory: class {
        fetch({ filename }) { return bytes('standard_fonts/' + filename); }
      }
    };
  }

  function readerFailure() {
    return { code: 'reader', error: 'No se pudo iniciar el lector PDF local. Si usas la aplicación web, recárgala con conexión para actualizar el lector. Si abriste index.html desde disco, comprueba que conservas la carpeta vendor/pdfjs del proyecto.' };
  }

  function pdfFailure(error) {
    if (/Setting up fake worker failed|does not match the Worker version/i.test(error?.message || '')) return readerFailure();
    if (error?.name === 'PasswordException') {
      return { code: 'password', error: 'El PDF requiere una contraseña. Ábrelo con ella y guarda una copia sin contraseña para importarlo.' };
    }
    if (error?.name === 'InvalidPDFException' || error?.name === 'MissingPDFException') {
      return { code: 'invalid', error: 'No se pudo abrir el PDF: el archivo puede estar dañado, incompleto o no ser un PDF válido.' };
    }
    return { code: 'open', error: 'El lector local no pudo abrir o interpretar este PDF. Puede estar dañado, protegido o usar un formato no compatible.' };
  }

  function listPdfPages(pages) {
    const shown = pages.slice(0, 8).join(', ');
    return pages.length > 8 ? `${shown} y ${pages.length - 8} más` : shown;
  }

  const MAX_OCR_PAGES = 12;
  async function parsePDF(file, onProgress, opts = {}) {
    let buffer;
    try { buffer = await file.arrayBuffer(); }
    catch (_) {
      return { text: '', method: 'error de lectura', failed: true, code: 'file-read',
        error: 'No se pudo leer el archivo seleccionado. Vuelve a seleccionarlo y comprueba que esté disponible.' };
    }

    // La versión legacy incluye los polyfills para navegadores sin Promise.withResolvers.
    // Todos sus recursos están en la misma instalación, incluidos los CMaps y fuentes.
    let pdfjs = root.pdfjsLib;
    const base = typeof document !== 'undefined' ? document.baseURI : null;
    // En un iframe aislado la URL puede ser https: pero el origen efectivo es
    // «null»: tampoco se puede importar el worker ni hacer fetch de sus CMaps.
    const opaqueOrigin = base && (base.startsWith('file:') || root.origin === 'null');
    try {
      if (!pdfjs && base) {
        await loadPdfScript('pdf.min.js', base);
        pdfjs = await root.pdfjsLibPromise;
      }
      if (typeof pdfjs?.getDocument !== 'function') throw new Error('PDF.js no disponible');
      if (opaqueOrigin) {
        await loadPdfScript('pdf.worker.min.js', base);
        if (!root.pdfjsWorker?.WorkerMessageHandler) throw new Error('Motor PDF local no disponible');
      } else if (base && pdfjs.GlobalWorkerOptions)
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.entry.js', base).href;
    } catch (e) {
      console.warn('[PDF.js local] No se pudo cargar el lector:', e?.message || String(e));
      return { text: '', method: 'error del lector', failed: true, ...readerFailure() };
    }

    let task, pdf, destroying;
    const signal = opts.signal, dispose = () => destroying ||= Promise.resolve().then(() => task?.destroy()).catch(() => {});
    try {
      const options = { data: new Uint8Array(buffer), isEvalSupported: false };
      if (opaqueOrigin) Object.assign(options, packedPdfResources(base, pdfjs));
      else if (base) {
        options.cMapUrl = new URL('vendor/pdfjs/cmaps/', base).href;
        options.cMapPacked = true;
        options.standardFontDataUrl = new URL('vendor/pdfjs/standard_fonts/', base).href;
      }
      if (signal?.aborted) throw new DOMException('Lectura cancelada', 'AbortError');
      task = pdfjs.getDocument(options); signal?.addEventListener('abort', dispose, { once: true });
      pdf = await task.promise;
    } catch (e) {
      signal?.removeEventListener('abort', dispose);
      if (signal?.aborted) throw new DOMException('Lectura cancelada', 'AbortError');
      console.warn('[PDF.js local] No se pudo abrir:', e?.message || String(e));
      await dispose();
      return Object.assign({ text: '', method: 'error de PDF', failed: true }, pdfFailure(e));
    }

    const pageTexts = [], failedPages = [], emptyPages = [], ocrPages = [], ocrErrors = [];
    const first = opts.ocr ? opts.ocrStart ?? 1 : 1;
    const limit = Math.min(pdf.numPages, opts.ocr ? first + MAX_OCR_PAGES - 1 : MAX_PDF_PAGES);
    let engine, unavailable;
    try {
      if (!Number.isSafeInteger(first) || first < 1 || first > pdf.numPages) throw Error(`Elige una página entre 1 y ${pdf.numPages}.`);
      for (let i = first; i <= limit; i++) {
        if (opts.signal?.aborted) throw new DOMException('Lectura cancelada', 'AbortError');
        let page;
        try {
          page = await pdf.getPage(i);
          let text = '';
          try {
            const content = await page.getTextContent();
            text = (content.items || []).map(item => (typeof item.str === 'string' ? item.str : '') + (item.hasEOL ? '\n' : '')).join('');
          } catch (error) { if (!opts.ocr) throw error; }
          let recognized = false;
          if (opts.ocr && !text.trim()) {
            onProgress?.({ phase: 'ocr-page', name: file.name, page: i, limit });
            if (!engine && !unavailable) {
              try { engine = await root.NCOCR.open(opts.signal); } catch (error) { unavailable = error.message; }
            }
            if (engine) {
              let canvas;
              try {
                canvas = await root.NCOCR.pdfCanvas(page, opts.signal);
                text = await engine.read(canvas);
                if (text.trim()) { recognized = true; ocrPages.push(i); }
              } catch (error) { ocrErrors.push(`pág. ${i}: ${error.message}`); }
              finally { if (canvas) canvas.width = canvas.height = 0; }
            }
          }
          pageTexts.push(recognized ? { sourcePage: i, text, ocr: true } : { sourcePage: i, text });
          if (!text.trim()) emptyPages.push(i);
        } catch (e) {
          failedPages.push(i);
          console.warn(`[PDF.js local] No se pudo extraer la página ${i}:`, e?.message || String(e));
        } finally { try { page?.cleanup(); } catch (_) {} }
        if (opts.signal?.aborted) throw new DOMException('Lectura cancelada', 'AbortError');
        if (onProgress && (i === first || i % 20 === 0 || i === limit)) onProgress({ phase: 'pdf-page', name: file.name, page: i, total: pdf.numPages, limit });
      }
    } finally {
      signal?.removeEventListener('abort', dispose);
      engine?.close(); await dispose();
    }

    const text = pageTexts.map(p => p.text).join('\n\n');
    const warnings = [];
    if (failedPages.length) warnings.push(`Lectura parcial: no se pudieron extraer las páginas PDF ${listPdfPages(failedPages)}.`);
    if (opts.ocr && (first > 1 || limit < pdf.numPages)) warnings.push(`Solo se leyeron las páginas PDF ${first}–${limit} de ${pdf.numPages}. Para otro tramo cambia la página inicial.`);
    if (ocrPages.length) warnings.push(`Texto reconocido por OCR en páginas ${listPdfPages(ocrPages)}. Compruébalo en el original antes de estudiar.`);
    if (unavailable || ocrErrors.length) warnings.push(`OCR incompleto: ${unavailable || ocrErrors[0]}`);
    if (emptyPages.length && text.trim()) warnings.push(`${emptyPages.length} página(s) no devolvieron texto; pueden estar vacías, contener imágenes o usar una codificación no compatible.`);
    if (!opts.ocr && pdf.numPages > limit) warnings.push(`Solo se analizaron las primeras ${limit} de ${pdf.numPages} páginas del PDF.`);
    if (text.trim()) return { text, pageTexts, method: ocrPages.length ? 'PDF.js + OCR local' : 'PDF.js local', warnings,
      ...(opts.ocr ? { displayName: `${file.name} · págs. ${first}–${limit}${ocrPages.length ? ' · OCR' : ''}` } : {}) };
    if (opts.ocr) return { text: '', failed: true, code: 'ocr', error: `Sin texto legible en el tramo ${first}–${limit}. ${unavailable || ocrErrors[0] || 'Prueba con una imagen nítida y bien orientada u otro tramo del PDF.'}` };
    if (failedPages.length) {
      const limited = pdf.numPages > limit ? ` Solo se analizaron las primeras ${limit} de ${pdf.numPages} páginas.` : '';
      return { text: '', method: 'error de extracción', failed: true, code: 'extract',
        error: `El PDF se abrió, pero falló la extracción de las páginas ${listPdfPages(failedPages)} y no se obtuvo texto del resto de páginas analizadas.${limited}` };
    }
    const scope = pdf.numPages > limit ? `las primeras ${limit} páginas analizadas` : 'las páginas analizadas';
    return { text: '', method: 'sin texto', failed: true, code: 'empty',
      error: `El PDF se abrió, pero no se encontró texto extraíble en ${scope}. Pueden estar vacías, contener imágenes o usar una codificación no compatible. Si no puedes copiar el texto en tu visor PDF, usa «Leer un escaneo · OCR» en el panel Documento.` };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OOXML / EPUB
  // ─────────────────────────────────────────────────────────────────────────
  async function withZip(buffer, fn) {
    if (hasDecompression()) {
      try { return await fn(await readZip(buffer)); } catch (e) { console.warn('[ZIP nativo]', e.message); }
    }
    if (root.JSZip) {
      const zip = await root.JSZip.loadAsync(buffer);
      const adapter = {
        names: Object.keys(zip.files),
        extract: async name => (zip.files[name] ? zip.files[name].async('uint8array') : null)
      };
      return fn(adapter);
    }
    throw new Error('Se requiere descompresión ZIP (navegador moderno) o JSZip');
  }

  function xmlToText(xml, tags) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const selector = tags && tags.length ? tags.join(',') : 'p,h1,h2,h3,h4,li';
    const nodes = doc.querySelectorAll(selector);
    if (nodes.length) {
      return Array.from(nodes).map(n => n.textContent.trim()).filter(Boolean).join('\n');
    }
    return doc.documentElement ? doc.documentElement.textContent : '';
  }

  async function parseDOCX(file) {
    const buffer = await file.arrayBuffer();
    if (root.mammoth) {
      try {
        const res = await root.mammoth.extractRawText({ arrayBuffer: buffer.slice(0) });
        if (res && res.value && res.value.trim()) return { text: res.value, method: 'Mammoth' };
      } catch (e) { console.warn('[Mammoth]', e.message); }
    }
    const text = await withZip(buffer, async zip => {
      const xml = await zip.extract('word/document.xml');
      if (!xml) throw new Error('document.xml no encontrado');
      const str = new TextDecoder('utf-8').decode(xml);
      const doc = new DOMParser().parseFromString(str, 'text/xml');
      const paras = Array.from(doc.getElementsByTagName('w:p'));
      return paras.map(p => Array.from(p.getElementsByTagName('w:t')).map(t => t.textContent).join('')).filter(Boolean).join('\n');
    });
    return text.trim() ? { text, method: 'DOCX local' } : { text: '', method: 'sin texto', failed: true, error: 'El DOCX no contiene texto extraíble.' };
  }

  async function parseOfficeZip(file, ext) {
    const buffer = await file.arrayBuffer();
    const text = await withZip(buffer, async zip => {
      const out = [];
      if (ext === 'pptx') {
        const slides = zip.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .sort((a, b) => (parseInt(a.match(/(\d+)/)[1], 10)) - (parseInt(b.match(/(\d+)/)[1], 10)));
        for (const name of slides) {
          const bytes = await zip.extract(name);
          if (!bytes) continue;
          const xml = new TextDecoder('utf-8').decode(bytes);
          const doc = new DOMParser().parseFromString(xml, 'text/xml');
          const txt = Array.from(doc.getElementsByTagName('a:t')).map(n => n.textContent).join(' ');
          if (txt.trim()) out.push(`## Diapositiva ${out.length + 1}\n${txt.trim()}`);
        }
      } else if (ext === 'xlsx') {
        const sharedName = zip.names.find(n => n === 'xl/sharedStrings.xml');
        let shared = [];
        if (sharedName) {
          const xml = new TextDecoder('utf-8').decode(await zip.extract(sharedName));
          const doc = new DOMParser().parseFromString(xml, 'text/xml');
          shared = Array.from(doc.getElementsByTagName('si')).map(si =>
            Array.from(si.getElementsByTagName('t')).map(n => n.textContent).join(''));
        }
        const sheets = zip.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
          .sort((a, b) => Number(a.match(/sheet(\d+)/)[1]) - Number(b.match(/sheet(\d+)/)[1]));
        for (const name of sheets) {
          const xml = new TextDecoder('utf-8').decode(await zip.extract(name));
          const doc = new DOMParser().parseFromString(xml, 'text/xml');
          const rows = Array.from(doc.getElementsByTagName('row')).map(row =>
            Array.from(row.getElementsByTagName('c')).map(cell => {
              const type = cell.getAttribute('t');
              const value = cell.getElementsByTagName('v')[0]?.textContent || '';
              if (type === 's') return shared[Number(value)] || '';
              if (type === 'inlineStr') return Array.from(cell.getElementsByTagName('t')).map(t => t.textContent).join('');
              return value;
            }).filter(Boolean).join(' | ')).filter(Boolean);
          if (rows.length) out.push(`## Hoja ${out.length + 1}\n${rows.join('\n')}`);
        }
      }
      return out.join('\n\n');
    });
    return text.trim() ? { text, method: `${ext.toUpperCase()} local` } : { text: '', method: 'sin texto', failed: true, error: 'No hay texto extraíble en el archivo.' };
  }

  async function parseEPUB(file) {
    const buffer = await file.arrayBuffer();
    const text = await withZip(buffer, async zip => {
      const container = await zip.extract('META-INF/container.xml');
      let opfPath = null;
      if (container) {
        const xml = new TextDecoder('utf-8').decode(container);
        const m = xml.match(/full-path="([^"]+\.opf)"/i);
        if (m) opfPath = m[1];
      }
      if (!opfPath) opfPath = zip.names.find(n => n.endsWith('.opf'));
      if (!opfPath) throw new Error('OPF no encontrado');

      const opfBytes = await zip.extract(opfPath);
      const opf = new TextDecoder('utf-8').decode(opfBytes);
      const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

      const opfDoc = new DOMParser().parseFromString(opf, 'text/xml');
      const manifest = new Map();
      Array.from(opfDoc.getElementsByTagNameNS('*', 'item')).forEach(item => {
        const id = item.getAttribute('id'), href = item.getAttribute('href');
        if (id && href) manifest.set(id, href);
      });
      const order = [];
      Array.from(opfDoc.getElementsByTagNameNS('*', 'itemref')).forEach(item => {
        const href = manifest.get(item.getAttribute('idref'));
        if (!href) return;
        // Normaliza rutas relativas internas sin realizar ninguna petición de red.
        const path = (base + href.split('#')[0]).split('/');
        const segments = [];
        path.forEach(part => { if (part === '..') segments.pop(); else if (part && part !== '.') segments.push(part); });
        order.push(segments.join('/'));
      });
      const files = order.length ? order : zip.names.filter(n => /\.x?html?$/i.test(n)).sort();

      const parts = [];
      for (const name of files.slice(0, 400)) {
        const bytes = await zip.extract(name);
        if (!bytes) continue;
        const html = new TextDecoder('utf-8').decode(bytes);
        parts.push(parseHTMLText(html));
      }
      return parts.filter(Boolean).join('\n\n');
    });
    return text.trim() ? { text: text.trim(), method: 'EPUB local' } : { text: '', method: 'sin texto', failed: true, error: 'El EPUB no contiene texto extraíble.' };
  }

  function parseHTMLText(html) {
    // No crear un documento HTML que pueda cargar recursos externos al analizarlo.
    return U.unescapeHtml(String(html || '')
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/pre|\/blockquote)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' '))
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Paginación por secciones
  // ─────────────────────────────────────────────────────────────────────────
  function splitIntoSentences(text) {
    return U.sentenceSplit(text);
  }

  function paginate(text, docId, docName) {
    const clean = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!clean) return [{ pageNum: 1, text: '', sentences: [], section: '' }];

    const lines = clean.split('\n');
    const blocks = [];   // { section, text }
    let section = '';
    let buffer = [];

    const flushBuffer = () => {
      const joined = buffer.join(' ').trim();
      if (joined) blocks.push({ section, text: joined });
      buffer = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) { flushBuffer(); continue; }
      if (U.isHeading(line)) {
        flushBuffer();
        section = line.replace(/^#+\s*/, '');
        blocks.push({ section, text: '', heading: true });
        continue;
      }
      // Líneas muy cortas que parecen subtítulo también abren sección
      if (line.length < 60 && !/[.!?]$/.test(line) && line.split(/\s+/).length <= 8 && /^[A-ZÁÉÍÓÚÑ0-9]/.test(line)) {
        flushBuffer();
        section = section || line;
      }
      buffer.push(line);
    }
    flushBuffer();

    const pages = [];
    let sentences = [];
    let pageChars = 0;
    let pageNum = 1;
    let sentCounter = 1;
    let currentSection = blocks[0] ? blocks[0].section : '';

    const pushPage = () => {
      if (!sentences.length) return;
      pages.push({
        pageNum,
        text: sentences.map(s => s.text).join(' '),
        section: currentSection,
        sentences
      });
      pageNum++;
      sentences = [];
      pageChars = 0;
    };

    blocks.forEach(block => {
      if (block.heading) {
        pushPage();
        currentSection = block.section;
        return;
      }
      currentSection = block.section || currentSection;
      const list = splitIntoSentences(block.text);
      list.forEach(sText => {
        const sentence = {
          id: `${docId}-p${pageNum}-s${sentCounter++}`,
          docId,
          docName,
          pageNum,
          section: currentSection,
          text: sText,
          harvested: false
        };
        sentences.push(sentence);
        pageChars += sText.length;
        if (pageChars >= CHARS_PER_PAGE || sentences.length >= MAX_PAGE_SENTENCES) pushPage();
      });
    });
    pushPage();

    if (!pages.length) {
      const text = clean.slice(0, CHARS_PER_PAGE);
      pages.push({ pageNum: 1, text, section: '', sentences: [{ id: `${docId}-p1-s1`, docId, docName, pageNum: 1, section: '', text, harvested: false }] });
    }
    return pages;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ingesta
  // ─────────────────────────────────────────────────────────────────────────
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];
  const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv'];

  function fileType(file) {
    // Algunos selectores móviles entregan el nombre del libro sin extensión.
    return file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() || '').toLowerCase();
  }

  async function parseOne(file, onProgress, opts) {
    const ext = fileType(file);
    const kind = (() => {
      if (ext === 'pdf') return 'pdf';
      if (ext === 'docx') return 'docx';
      if (ext === 'pptx' || ext === 'xlsx') return 'office';
      if (ext === 'epub') return 'epub';
      if (ext === 'html' || ext === 'htm') return 'html';
      if (IMAGE_EXT.includes(ext)) return 'image';
      if (VIDEO_EXT.includes(ext)) return 'video';
      return 'text';
    })();

    if (onProgress) onProgress({ phase: 'parse', kind, name: file.name });

    if (opts.ocr && file.size > 64 * 1024 * 1024) throw Error('El OCR admite archivos de hasta 64 MiB. Divide el documento antes de importarlo.');
    if (kind === 'pdf') return parsePDF(file, onProgress, opts);
    if (opts.ocr) {
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const starts = a => a.every((v, i) => v === bytes[i]);
      if (!starts([137,80,78,71,13,10,26,10]) && !starts([255,216,255]) && !(starts([82,73,70,70]) && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP'))
        throw Error('El OCR acepta PDF, PNG, JPEG y WebP.');
      onProgress?.({ phase: 'ocr-page', name: file.name, page: 1, limit: 1 });
      const canvas = await root.NCOCR.imageCanvas(file, opts.signal);
      let engine;
      try {
        engine = await root.NCOCR.open(opts.signal);
        const text = await engine.read(canvas);
        if (!text.trim()) throw Error('El OCR no encontró texto legible en la imagen.');
        return { text, displayName: `${file.name} · OCR`, method: 'OCR local · español', warnings: ['Texto reconocido por OCR. Comprueba el original antes de estudiar.'] };
      } finally { if (engine) engine.close(); canvas.width = canvas.height = 0; }
    }
    if (kind === 'docx') return parseDOCX(file);
    if (kind === 'office') return parseOfficeZip(file, ext);
    if (kind === 'epub') return parseEPUB(file);
    if (kind === 'html') return { text: parseHTMLText(await file.text()), method: 'HTML' };
    if (ext === 'srt' || ext === 'vtt') return parseCaptions(await file.text(), ext);
    if (kind === 'image') {
      return { text: '', method: 'imagen · vista previa', warnings: ['Para extraer texto de una imagen usa «Leer un escaneo · OCR» con un PNG, JPEG o WebP.'], mediaUrl: URL.createObjectURL(file), mediaType: 'image' };
    }
    if (kind === 'video') {
      return { text: '', method: 'vídeo local', warnings: ['No se transcribe el audio. Importa los subtítulos SRT/VTT como documento o pega tu transcripción para practicarla.'], mediaUrl: URL.createObjectURL(file), mediaType: 'video' };
    }
    return { text: await file.text(), method: 'texto plano' };
  }

  // Trabaja con subtítulos aportados por el usuario, no infiere diálogo del audio.
  function parseCaptions(raw, ext) {
    const groups = [];
    const timing = /^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s|$)/;
    let group;
    for (const block of raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/)) {
      const lines = block.split('\n');
      if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
      const i = timing.test(lines[0]) ? 0 : 1, times = timing.exec(lines[i] || '');
      if (!times) continue;
      const text = lines.slice(i + 1).join(' ').replace(/<\/?(?:b|i|u|ruby|rt|c|v|lang)(?:[.\s][^>]*)?>|<(?:(?:\d+:)?\d{2}:\d{2}\.\d{3})>/gi, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
      if (!text) continue;
      if (!group || group.text.length + text.length > CHARS_PER_PAGE || group.count >= MAX_PAGE_SENTENCES) {
        group = { from: times[1], text: '', count: 0 }; groups.push(group);
      }
      group.to = times[2]; group.text += (group.text ? ' ' : '') + text; group.count++;
    }
    if (!groups.length) throw Error('No se encontraron subtítulos con tiempos y texto. Si tienes una transcripción sin tiempos, impórtala como TXT o pégala.');
    return { method: `Subtítulos ${ext.toUpperCase()}`, segments: groups.map(g => ({ text: g.text, section: `Subtítulos · ${g.from}–${g.to}` })) };
  }

  async function handleFiles(fileList, opts) {
    const o = opts || {};
    const results = [];
    for (const file of Array.from(fileList || [])) {
      if (o.signal?.aborted) break;
      try {
        const parsed = await parseOne(file, o.onProgress, o);
        // Evita volver a añadir un libro si se hizo RESET o se importó un respaldo
        // mientras PDF.js seguía leyendo. No modifica la carga normal de archivos.
        if (o.signal?.aborted) {
          if (parsed.mediaUrl) URL.revokeObjectURL(parsed.mediaUrl);
          results.push({ ok: false, cancelled: true, name: file.name }); break;
        }
        if (parsed.failed) {
          const error = new Error(parsed.error || 'No se pudo extraer el texto');
          error.code = parsed.code;
          throw error;
        }
        const docId = U.uid('doc');
        let pages;
        const segments = parsed.pageTexts || parsed.segments;
        if (segments) {
          pages = [];
          segments.forEach(part => {
            paginate(part.text, docId, file.name).forEach(p => {
              const n = pages.length + 1;
              p.pageNum = n;
              if (part.sourcePage) p.sourcePage = part.sourcePage;
              if (part.section) p.section = part.section;
              if (part.ocr) p.ocr = true;
              p.sentences.forEach((sentence, i) => {
                sentence.id = `${docId}-p${n}-s${i + 1}`;
                sentence.pageNum = n;
                if (part.sourcePage) sentence.sourcePage = part.sourcePage;
                if (part.section) sentence.section = part.section;
              });
              pages.push(p);
            });
          });
        } else pages = paginate(parsed.text || '', docId, file.name);
        const doc = {
          id: docId,
          name: file.name,
          type: fileType(file),
          size: file.size || 0,
          method: parsed.method,
          ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
          ingestWarnings: parsed.warnings || [],
          mediaUrl: parsed.mediaUrl || null,
          mediaType: parsed.mediaType || null,
          pages
        };
        if (root.NeuralStore) root.NeuralStore.addDocument(doc);
        results.push({ ok: !parsed.failed, doc, method: parsed.method });
        if (o.onProgress) o.onProgress({ phase: 'indexed', doc, method: parsed.method, ok: !parsed.failed });
      } catch (err) {
        if (o.signal?.aborted) { results.push({ ok: false, cancelled: true, name: file.name }); break; }
        console.error('[Parser]', err);
        results.push({ ok: false, error: err.message, code: err.code || null, name: file.name });
        if (o.onProgress) o.onProgress({ phase: 'error', name: file.name, error: err.message, code: err.code || null });
      }
    }
    return results;
  }

  async function importFromURL() {
    throw new Error('Importación por URL desactivada para mantener el procesamiento 100 % local. Descarga el archivo y súbelo.');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Documentos de demostración (dos fuentes con mediciones para contrastar)
  // ─────────────────────────────────────────────────────────────────────────
  const DEMO_DOCS = [
    {
      name: 'Arquitectura_IA_Demo.txt',
      text: `1. Fundamentos de redes neuronales
Una red neuronal artificial es un modelo computacional inspirado en las conexiones sinápticas del cerebro biológico. Cada neurona artificial recibe señales de entrada, aplica pesos sinápticos ajustables y produce una salida mediante una función de activación no lineal como ReLU o Sigmoide.
Cuando el gradiente descendente se combina con la retropropagación, el sistema minimiza la función de pérdida en un 94.2% de los casos de prueba estándar tras 50 épocas de entrenamiento supervisado.
La latencia de inferencia de este modelo en el dispositivo local es de 12 milisegundos con cuantización de 8 bits.

2. Sistemas distribuidos y consenso
Los sistemas distribuidos modernos utilizan protocolos de consenso como Raft o Paxos para tolerar fallos de parada; Raft no tolera fallos bizantinos. Si un nodo falla durante la replicación de estado, el clúster elige un nuevo líder en menos de 150 milisegundos.
El protocolo Raft mantiene la consistencia del registro replicado mientras una mayoría de nodos esté disponible.

3. Procesamiento offline-first
La convergencia entre grafos semánticos locales y enjambres de agentes autónomos permite indexar conocimiento universitario sin depender de servidores en la nube.
En resumen, el procesamiento offline-first reduce la latencia de consulta a 12 milisegundos y protege la privacidad académica al 100%, consolidando definiciones, reglas causales, métricas cuantitativas y síntesis transversales en una memoria persistente.`
    },
    {
      name: 'Informe_Contraste_2025.md',
      text: `# Medición independiente de latencia
El presente informe audita el rendimiento del mismo sistema descrito en la arquitectura de referencia.
Las pruebas se ejecutaron sobre 500 consultas académicas con un corpus de 120 documentos y un índice invertido local.

## Resultados
El sistema reduce la latencia de consulta a 40 milisegundos en promedio, muy por encima de la cifra declarada en la documentación original.
La tasa de acierto del protocolo de consenso se mantiene en un 94.2% de los casos, sin diferencias significativas frente al informe previo.
El consumo de memoria del índice local es de 220 megabytes para el corpus completo, lo que permite ejecutarlo en un portátil de gama media.

## Limitaciones del estudio
La muestra se limita a documentos en español y no incluye PDF escaneados.
No se evaluó el impacto de la cuantización de 8 bits en la calidad de la recuperación.`
    }
  ];

  function loadDemo() {
    const out = [];
    DEMO_DOCS.forEach(demo => {
      const docId = U.uid('doc');
      const pages = paginate(demo.text, docId, demo.name);
      const doc = {
        id: docId,
        name: demo.name,
        type: demo.name.split('.').pop(),
        method: 'demo',
        pages
      };
      if (root.NeuralStore) out.push(root.NeuralStore.addDocument(doc));
    });
    return out;
  }

  function init() {
    if (typeof document === 'undefined') return;
    const fileInput = document.getElementById('file-input');
    const dropzone = document.getElementById('doc-dropzone');

    const progress = detail => {
      if (root.NeuralStore) root.NeuralStore.emit('ingest:progress', detail);
    };

    // El tutor reutiliza el selector normal. Un anexo que aún se lee no debe
    // entrar en la biblioteca que acaba de sustituir un respaldo o un reset.
    const reads = new Set();
    async function readFiles(files) {
      if (replacing || !files?.length) return;
      const job = new AbortController(); reads.add(job);
      try { await handleFiles(files, { signal:job.signal, onProgress(detail) { if (!job.signal.aborted) progress(detail); } }); }
      finally { reads.delete(job); }
    }
    fileInput?.addEventListener('change', async e => {
      await readFiles(e.target.files);
      e.target.value = '';
    });

    dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone?.addEventListener('drop', async e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      await readFiles(e.dataTransfer?.files);
    });

    const ocrFile = document.getElementById('ocr-file'), cancel = document.getElementById('ocr-cancel');
    const status = document.getElementById('ocr-status'), start = document.getElementById('ocr-start');
    let controller, replacing = false, epoch = 0;
    const sync = () => {
      ocrFile.disabled = start.disabled = replacing || !!controller;
      cancel.classList.toggle('hidden', !controller);
    };
    cancel.addEventListener('click', () => { controller?.abort(); status.textContent = 'Cancelando lectura…'; });
    for (const event of ['system:resetting', 'brain:importing']) root.NeuralStore.on(event, () => {
      replacing = true; epoch++; controller?.abort(); reads.forEach(job => job.abort()); status.textContent = ''; sync();
    });
    for (const event of ['system:reset', 'brain:imported', 'brain:importFailed']) root.NeuralStore.on(event, () => { replacing = false; sync(); });
    ocrFile.addEventListener('change', async () => {
      const file = ocrFile.files?.[0]; ocrFile.value = '';
      if (!file || controller || replacing) return;
      controller = new AbortController(); const { signal } = controller, started = epoch; sync();
      status.textContent = 'Preparando lectura local…';
      try {
        const [result] = await handleFiles([file], { ocr: true, ocrStart: Number(start.value), signal, onProgress(detail) {
          if (signal.aborted) return;
          if (detail.phase === 'ocr-page') status.textContent = `Reconociendo texto: página ${detail.page}…`;
          progress(detail);
        } });
        if (started !== epoch) return;
        if (signal.aborted) progress({ phase: 'cancelled' });
        status.textContent = signal.aborted ? 'Lectura cancelada.' : result?.ok ? `Listo. ${result.doc.ingestWarnings.join(' ') || 'Puedes estudiar el texto en Analizar.'}` : result?.error || 'No se leyó el archivo.';
      } finally { controller = null; sync(); }
    });

    fileInput?.setAttribute('accept', '.pdf,application/pdf,.docx,.pptx,.xlsx,.epub,.html,.htm,.txt,.md,.py,.js,.ts,.csv,.json,.srt,.vtt,.jpg,.jpeg,.png,.webp,.mp4,.webm');
  }

  return {
    CHARS_PER_PAGE,
    paginate, splitIntoSentences, parseHTMLText,
    fileType, handleFiles, importFromURL, loadDemo, init,
    readZip, parsePDF, parseDOCX, parseEPUB, DEMO_DOCS
  };
});
