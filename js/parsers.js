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

  function pdfFailure(error) {
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

  async function parsePDF(file, onProgress) {
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
    try {
      if (!pdfjs && base) pdfjs = await import(new URL('vendor/pdfjs/pdf.min.mjs', base).href);
      if (!pdfjs || typeof pdfjs.getDocument !== 'function') throw new Error('PDF.js no disponible');
      if (base && pdfjs.GlobalWorkerOptions)
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', base).href;
    } catch (e) {
      console.warn('[PDF.js local] No se pudo cargar el lector:', e?.message || String(e));
      return { text: '', method: 'error del lector', failed: true, code: 'reader',
        error: 'No se pudo cargar el lector PDF local. Recarga la aplicación y comprueba su instalación o la compatibilidad del navegador.' };
    }

    let task, pdf;
    try {
      const options = { data: new Uint8Array(buffer.slice(0)), isEvalSupported: false };
      if (base) {
        options.cMapUrl = new URL('vendor/pdfjs/cmaps/', base).href;
        options.cMapPacked = true;
        options.standardFontDataUrl = new URL('vendor/pdfjs/standard_fonts/', base).href;
      }
      task = pdfjs.getDocument(options);
      pdf = await task.promise;
    } catch (e) {
      console.warn('[PDF.js local] No se pudo abrir:', e?.message || String(e));
      try { await task?.destroy(); } catch (_) {}
      return Object.assign({ text: '', method: 'error de PDF', failed: true }, pdfFailure(e));
    }

    const pageTexts = [], failedPages = [], emptyPages = [];
    const limit = Math.min(pdf.numPages, MAX_PDF_PAGES);
    try {
      for (let i = 1; i <= limit; i++) {
        let page;
        try {
          page = await pdf.getPage(i);
          const content = await page.getTextContent();
          // PDF.js ya inserta espacios entre fragmentos. Añadir uno a cada item
          // separaría palabras cuando una fuente o ligadura las divide en varios.
          const text = (content.items || []).map(item =>
            (typeof item.str === 'string' ? item.str : '') + (item.hasEOL ? '\n' : '')).join('');
          pageTexts.push({ sourcePage: i, text });
          if (!text.trim()) emptyPages.push(i);
        } catch (e) {
          failedPages.push(i);
          console.warn(`[PDF.js local] No se pudo extraer la página ${i}:`, e?.message || String(e));
        } finally {
          try { page?.cleanup(); } catch (_) {}
        }
        if (onProgress && (i === 1 || i % 20 === 0 || i === limit))
          onProgress({ phase: 'pdf-page', name: file.name, page: i, total: pdf.numPages, limit });
      }
    } finally {
      try { await task?.destroy(); } catch (_) {}
    }

    const text = pageTexts.map(p => p.text).join('\n\n');
    const warnings = [];
    if (failedPages.length) warnings.push(`Lectura parcial: no se pudieron extraer las páginas PDF ${listPdfPages(failedPages)}.`);
    if (emptyPages.length && text.trim()) warnings.push(`${emptyPages.length} página(s) no devolvieron texto; pueden estar vacías, contener imágenes o usar una codificación no compatible.`);
    if (pdf.numPages > limit) warnings.push(`Solo se analizaron las primeras ${limit} de ${pdf.numPages} páginas del PDF.`);
    if (text.trim()) return { text, pageTexts, method: 'PDF.js local', warnings };
    if (failedPages.length) {
      const limited = pdf.numPages > limit ? ` Solo se analizaron las primeras ${limit} de ${pdf.numPages} páginas.` : '';
      return { text: '', method: 'error de extracción', failed: true, code: 'extract',
        error: `El PDF se abrió, pero falló la extracción de las páginas ${listPdfPages(failedPages)} y no se obtuvo texto del resto de páginas analizadas.${limited}` };
    }
    const scope = pdf.numPages > limit ? `las primeras ${limit} páginas analizadas` : 'las páginas analizadas';
    return { text: '', method: 'sin texto', failed: true, code: 'empty',
      error: `No se encontró texto extraíble en ${scope}. Pueden estar vacías, contener imágenes o usar una codificación no compatible. No se incluye OCR.` };
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

  async function parseOne(file, onProgress) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
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

    if (kind === 'pdf') return parsePDF(file, onProgress);
    if (kind === 'docx') return parseDOCX(file);
    if (kind === 'office') return parseOfficeZip(file, ext);
    if (kind === 'epub') return parseEPUB(file);
    if (kind === 'html') return { text: parseHTMLText(await file.text()), method: 'HTML' };
    if (kind === 'image') {
      return { text: '', method: 'imagen · OCR no incluido', mediaUrl: URL.createObjectURL(file), mediaType: 'image' };
    }
    if (kind === 'video') {
      return { text: '', method: 'vídeo local', mediaUrl: URL.createObjectURL(file), mediaType: 'video' };
    }
    return { text: await file.text(), method: 'texto plano' };
  }

  async function handleFiles(fileList, opts) {
    const o = opts || {};
    const results = [];
    for (const file of Array.from(fileList || [])) {
      try {
        const parsed = await parseOne(file, o.onProgress);
        if (parsed.failed) {
          const error = new Error(parsed.error || 'No se pudo extraer el texto');
          error.code = parsed.code;
          throw error;
        }
        const docId = U.uid('doc');
        let pages;
        if (Array.isArray(parsed.pageTexts)) {
          pages = [];
          parsed.pageTexts.forEach(part => {
            paginate(part.text, docId, file.name).forEach(p => {
              const n = pages.length + 1;
              p.pageNum = n; p.sourcePage = part.sourcePage;
              p.sentences.forEach((sentence, i) => {
                sentence.id = `${docId}-p${n}-s${i + 1}`;
                sentence.pageNum = n; sentence.sourcePage = part.sourcePage;
              });
              pages.push(p);
            });
          });
        } else pages = paginate(parsed.text || '', docId, file.name);
        const doc = {
          id: docId,
          name: file.name,
          type: (file.name.split('.').pop() || '').toLowerCase(),
          size: file.size || 0,
          method: parsed.method,
          ingestWarnings: parsed.warnings || [],
          mediaUrl: parsed.mediaUrl || null,
          mediaType: parsed.mediaType || null,
          pages
        };
        if (root.NeuralStore) root.NeuralStore.addDocument(doc);
        results.push({ ok: !parsed.failed, doc, method: parsed.method });
        if (o.onProgress) o.onProgress({ phase: 'indexed', doc, method: parsed.method, ok: !parsed.failed });
      } catch (err) {
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
  // Documentos de demostración (dos fuentes con una contradicción real)
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

    fileInput?.addEventListener('change', async e => {
      if (e.target.files?.length) await handleFiles(e.target.files, { onProgress: progress });
      e.target.value = '';
    });

    dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone?.addEventListener('drop', async e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files, { onProgress: progress });
    });

    document.getElementById('file-input')?.setAttribute('accept', '.pdf,.docx,.pptx,.xlsx,.epub,.html,.htm,.txt,.md,.py,.js,.ts,.csv,.json,.srt,.vtt,.jpg,.jpeg,.png,.webp,.mp4,.webm');
  }

  return {
    CHARS_PER_PAGE,
    paginate, splitIntoSentences, parseHTMLText,
    handleFiles, importFromURL, loadDemo, init,
    readZip, parsePDF, parseDOCX, parseEPUB, DEMO_DOCS
  };
});
