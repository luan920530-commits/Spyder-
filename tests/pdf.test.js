const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const P = require('../js/parsers');
const R = require('../js/retrieval');
const root = path.join(__dirname, '..');

function file(name, bytes) {
  const copy = Uint8Array.from(bytes);
  return { name, size: copy.length, arrayBuffer: async () => copy.slice().buffer };
}
function restore(key, value) {
  if (value === undefined) delete global[key]; else global[key] = value;
}

async function withPdfJs(run) {
  const previous = { document: global.document, pdfjsLib: global.pdfjsLib, NeuralStore: global.NeuralStore };
  try {
    // La distribución legacy también debe funcionar bajo Node 20, que carece de
    // Promise.withResolvers; el navegador usa exactamente estos mismos archivos.
    const actual = await import(pathToFileURL(path.join(root, 'vendor/pdfjs/pdf.min.mjs')).href);
    actual.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'vendor/pdfjs/pdf.worker.min.mjs')).href;
    let usedOptions;
    global.document = { baseURI: 'https://local.test/app/' };
    global.pdfjsLib = {
      GlobalWorkerOptions: {},
      getDocument(options) {
        usedOptions = options;
        // En Node, PDF.js lee del sistema de archivos; en el navegador usa las URL
        // configuradas por el parser y precargadas por el service worker.
        return actual.getDocument({ ...options,
          cMapUrl: path.join(root, 'vendor/pdfjs/cmaps') + path.sep,
          standardFontDataUrl: path.join(root, 'vendor/pdfjs/standard_fonts') + path.sep });
      }
    };
    return await run(() => usedOptions);
  } finally {
    for (const [key, value] of Object.entries(previous)) restore(key, value);
  }
}

function mockReader(document) {
  let destroyed = 0, cleaned = 0, options;
  global.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument(value) {
      options = value;
      return { promise: Promise.resolve(document({ cleaned: () => { cleaned++; } })),
        destroy: async () => { destroyed++; } };
    }
  };
  return () => ({ destroyed, cleaned, options });
}

test('PDF.js local extrae texto con CMaps y conserva las páginas y los fragmentos sin espacios falsos', async () => {
  await withPdfJs(async options => {
    const original = file('mapas.pdf', fs.readFileSync(path.join(root, 'tests/fixtures/pdf-cmap-multipagina.pdf')));
    const progress = [];
    const result = await P.parsePDF(original, detail => progress.push(detail));
    assert.equal(result.method, 'PDF.js local');
    assert.deepEqual(result.warnings, []);
    assert.equal(result.pageTexts.length, 3);
    assert.match(result.pageTexts[0].text, /primera pagina contiene informacion real/);
    assert.match(result.pageTexts[1].text, /Hola mundo\. こんにちは 日本語/);
    assert.match(result.pageTexts[2].text, /tercera pagina tambien/);
    assert.equal(options().isEvalSupported, false);
    assert.equal(options().cMapPacked, true);
    assert.equal(options().cMapUrl, 'https://local.test/app/vendor/pdfjs/cmaps/');
    assert.equal(options().standardFontDataUrl, 'https://local.test/app/vendor/pdfjs/standard_fonts/');
    assert.equal(global.pdfjsLib.GlobalWorkerOptions.workerSrc, 'https://local.test/app/vendor/pdfjs/pdf.worker.min.mjs');
    assert.equal(progress.at(-1).page, 3);
    const fragmented = await P.parsePDF(file('fragmentos.pdf', fs.readFileSync(path.join(root, 'tests/fixtures/pdf-fragmentos.pdf'))));
    assert.equal(fragmented.text.trim(), 'El protocolo Zafiro contiene texto verificable.');

    const saved = [];
    global.NeuralStore = { addDocument: doc => saved.push(doc) };
    const [ingested] = await P.handleFiles([original]);
    assert.equal(ingested.ok, true);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].pages.map(p => p.sourcePage), [1, 2, 3]);
    assert.ok(saved[0].pages[1].sentences.some(s => s.sourcePage === 2 && s.text.includes('こんにちは')));
    assert.ok(saved[0].pages[2].sentences.every(s => s.sourcePage === 3));
  });
});

test('un PDF protegido, uno inválido y un fallo de archivo tienen diagnósticos diferentes', async () => {
  await withPdfJs(async () => {
    const password = await P.parsePDF(file('protegido.pdf', fs.readFileSync(path.join(root, 'tests/fixtures/pdf-protegido.pdf'))));
    assert.equal(password.code, 'password');
    assert.match(password.error, /contraseña/i);
    assert.doesNotMatch(password.error, /escanead|OCR/i);
    const invalid = await P.parsePDF(file('roto.pdf', Buffer.from('no es un PDF')));
    assert.equal(invalid.code, 'invalid');
    assert.doesNotMatch(invalid.error, /escanead|OCR/i);
    const blank = await P.parsePDF(file('vacio.pdf', fs.readFileSync(path.join(root, 'tests/fixtures/pdf-vacio.pdf'))));
    assert.equal(blank.code, 'empty');
    assert.match(blank.error, /vacías.*imágenes.*codificación/i);
    const unreadable = await P.parsePDF({ name: 'no-disponible.pdf', arrayBuffer: async () => { throw new Error('fallo de lectura'); } });
    assert.equal(unreadable.code, 'file-read');
    assert.match(unreadable.error, /seleccionarlo/i);
  });
});

test('si falla una página se conservan las demás, el número original y los avisos persistentes', async () => {
  const previous = { document: global.document, pdfjsLib: global.pdfjsLib, NeuralStore: global.NeuralStore };
  try {
    global.document = { baseURI: 'https://local.test/app/' };
    const stats = mockReader(({ cleaned }) => ({
      numPages: 4,
      async getPage(number) {
        if (number === 2) throw new Error('página rota');
        return {
          async getTextContent() {
            if (number === 3) return { items: [] };
            if (number === 1) return { items: [{ str: 'El proto' }, { str: 'colo' }, { str: ' Zafiro.', hasEOL: true }] };
            return { items: [{ str: 'La cuarta página contiene información verificable.' }] };
          },
          cleanup: cleaned
        };
      }
    }));
    const saved = [], progress = [];
    global.NeuralStore = { addDocument: doc => saved.push(doc) };
    const [result] = await P.handleFiles([file('parcial.pdf', [37, 80, 68, 70])], { onProgress: value => progress.push(value) });
    assert.equal(result.ok, true);
    assert.equal(stats().destroyed, 1);
    assert.equal(stats().cleaned, 3);
    assert.equal(saved.length, 1);
    const doc = saved[0];
    assert.deepEqual(doc.pages.map(p => p.sourcePage), [1, 3, 4]);
    assert.match(doc.pages[0].text, /protocolo Zafiro/);
    assert.equal(doc.pages[1].text, '');
    assert.equal(doc.pages[2].sentences[0].sourcePage, 4);
    assert.equal(doc.pages[2].sentences[0].pageNum, 3);
    const index = R.rebuildFrom(doc.pages.flatMap(page => page.sentences));
    assert.deepEqual(R.search(index, '=pag:4', { diversify: false }).hits.map(hit => hit.sentence.id),
      [doc.pages[2].sentences[0].id], 'el filtro usa la página original, no el índice interno');
    assert.equal(R.search(index, '=pag:3', { diversify: false }).hits.length, 0);
    assert.match(doc.ingestWarnings.join(' '), /no se pudieron extraer las páginas PDF 2/i);
    assert.match(doc.ingestWarnings.join(' '), /1 página\(s\) no devolvieron texto/i);
    assert.equal(progress.at(-1).phase, 'indexed');
  } finally {
    for (const [key, value] of Object.entries(previous)) restore(key, value);
  }
});

test('distingue páginas vacías, fallos de extracción y límite de páginas', async () => {
  const previous = { document: global.document, pdfjsLib: global.pdfjsLib };
  try {
    global.document = { baseURI: 'https://local.test/' };
    const blank = mockReader(({ cleaned }) => ({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }), cleanup: cleaned }) }));
    let result = await P.parsePDF(file('vacio.pdf', [1]));
    assert.equal(result.code, 'empty');
    assert.match(result.error, /vacías.*imágenes.*codificación/i);
    assert.equal(blank().destroyed, 1);
    const broken = mockReader(() => ({ numPages: 1, getPage: async () => { throw new Error('fallo de página'); } }));
    result = await P.parsePDF(file('fallo.pdf', [1]));
    assert.equal(result.code, 'extract');
    assert.doesNotMatch(result.error, /OCR|escanead/i);
    assert.equal(broken().destroyed, 1);
    const many = mockReader(({ cleaned }) => ({ numPages: 501, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'Texto válido.' }] }), cleanup: cleaned }) }));
    result = await P.parsePDF(file('largo.pdf', [1]));
    assert.equal(result.pageTexts.length, 500);
    assert.match(result.warnings.join(' '), /primeras 500 de 501/);
    assert.equal(many().cleaned, 500);
    assert.equal(many().destroyed, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) restore(key, value);
  }
});

test('un lector ausente o incompatible no se presenta como PDF escaneado', async () => {
  const previous = { document: global.document, pdfjsLib: global.pdfjsLib };
  try {
    delete global.document; delete global.pdfjsLib;
    let result = await P.parsePDF(file('ejemplo.pdf', [37, 80, 68, 70]));
    assert.equal(result.code, 'reader');
    assert.doesNotMatch(result.error, /OCR|escanead/i);
    global.document = { baseURI: 'https://local.test/' };
    global.pdfjsLib = { GlobalWorkerOptions: {}, getDocument() { throw new Error('worker no disponible'); } };
    result = await P.parsePDF(file('ejemplo.pdf', [37, 80, 68, 70]));
    assert.equal(result.code, 'open');
    assert.doesNotMatch(result.error, /OCR|escanead/i);
  } finally {
    for (const [key, value] of Object.entries(previous)) restore(key, value);
  }
});
