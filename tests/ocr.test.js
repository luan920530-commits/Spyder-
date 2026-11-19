const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const P = require('../js/parsers'), OCR = require('../js/ocr');
const pdf = { name: 'tramos.pdf', arrayBuffer: async () => new ArrayBuffer(10) };

test('OCR: tamaño del lienzo acotado para fotos, documentos apaisados y páginas PDF', () => {
  for (const [w, h, scale] of [[4000, 4000, 1], [18000, 2, 2], [595, 842, 2.5], [1, 32000, 1], [840, 220, 1]]) {
    const dim = OCR.size(w, h, scale);
    assert.ok(dim.width > 0 && dim.height > 0 && dim.width * dim.height <= 3000000);
    assert.ok(dim.width <= 2600 && dim.height <= 2600 && dim.scale <= scale);
  }
  assert.throws(() => OCR.size(Infinity, 20)); assert.throws(() => OCR.size(0, 10));
});

test('los bytes que carga el navegador corresponden al paquete OCR fijado y al SHA-384 del cargador', () => {
  const root = path.join(__dirname, '..'), bytes = fs.readFileSync(path.join(root, 'vendor/ocr/es-lstm-6.1.2.js'));
  const sri = 'sha384-' + crypto.createHash('sha384').update(bytes).digest('base64');
  assert.ok(fs.readFileSync(path.join(root, 'js/ocr.js'), 'utf8').includes(sri));
  const pack = {}; require('node:vm').runInNewContext(bytes.toString(), pack);
  const hash = b => crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(hash(Buffer.from(pack.NCOcrAssets.spa, 'base64')), '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464');
  assert.equal(hash(Buffer.from(pack.NCOcrAssets.wasm, 'base64')), '220e2e87551edccb85519796a170469f8ab2a8055216789e3b8b1ada18b7bc2b');
});

test('OCR por tramo: más allá de p.500 conserva texto nativo, citas físicas y páginas fallidas; abre y libera un solo motor', async t => {
  const visited = [], reads = []; let closed = 0, opened = 0, destroyed = 0;
  t.mock.method(global.NCOCR, 'open', async () => { opened++; return { close: () => closed++, read: async c => { reads.push(c.n); if (c.n === 503) throw Error('no legible'); return 'Texto reconocido localmente.'; } }; });
  t.mock.method(global.NCOCR, 'pdfCanvas', async page => ({ n: page.n }));
  const old = global.pdfjsLib; t.after(() => old ? global.pdfjsLib = old : delete global.pdfjsLib);
  global.pdfjsLib = { getDocument: () => ({ destroy: async () => { destroyed++; }, promise: Promise.resolve({ numPages: 520,
    async getPage(n) { visited.push(n); return { n, cleanup() {}, getTextContent: async () => ({ items: [502, 503].includes(n) ? [] : [{ str: 'Texto nativo sin duplicar.' }] }) }; } }) }) };
  const [result] = await P.handleFiles([pdf], { ocr: true, ocrStart: 501 });
  assert.ok(result.ok); assert.deepEqual(visited, Array.from({ length: 12 }, (_, i) => 501 + i));
  assert.deepEqual(reads, [502, 503]); assert.deepEqual([opened, closed, destroyed], [1, 1, 1]);
  const [native, scan, unreadable] = result.doc.pages; assert.equal(native.ocr, undefined); assert.equal(scan.ocr, true);
  assert.equal(scan.sentences[0].sourcePage, 502); assert.equal(scan.sentences[0].pageNum, 2); assert.equal(unreadable.sentences.length, 0);
  assert.match(result.doc.ingestWarnings.join(' '), /501–512 de 520/); assert.match(result.doc.ingestWarnings.join(' '), /pág. 503: no legible/);
  for (const start of [0, 2.5, 521]) assert.match((await P.handleFiles([pdf], { ocr: true, ocrStart: start }))[0].error, /entre 1 y 520/);
  assert.equal(visited.length, 12); assert.equal(destroyed, 4);
});

test('selector OCR rechaza archivos de más de 64 MiB y formatos no compatibles antes de iniciar el motor', async () => {
  const [big, wrong] = await P.handleFiles([{ ...pdf, size: 64 * 1024 * 1024 + 1 }, new File(['nota'], 'clase.txt', { type: 'text/plain' })], { ocr: true });
  assert.equal(big.ok, false); assert.match(big.error, /64 MiB/);
  assert.equal(wrong.ok, false); assert.match(wrong.error, /PDF, PNG, JPEG y WebP/);
});

test('subtítulos aportados: ejercicios sobre diálogo, sin tiempos, índices ni metadatos; intervalo rastreable', async () => {
  for (const ext of ['srt', 'vtt']) {
    const content = (ext === 'vtt' ? '\uFEFFWEBVTT\n\nNOTE comentario editorial\n\n' : '') + '1\r\n00:00:00,000 --> 00:00:02,200\r\n<b>La mediana</b> es central.\r\n\r\n2\r\n00:00:02.400 --> 00:00:04.000 align:start\r\nLa media usa todos los valores.';
    const [r] = await P.handleFiles([new File([content], `clase.${ext}`)]);
    assert.ok(r.ok); assert.equal(r.doc.method, 'Subtítulos ' + ext.toUpperCase());
    assert.match(r.doc.pages[0].section, /00:00:00,000–00:00:04.000/);
    assert.equal(r.doc.pages[0].text, 'La mediana es central. La media usa todos los valores.');
    assert.ok(r.doc.pages[0].sentences.every(s => s.section === r.doc.pages[0].section));
  }
  const [blank] = await P.handleFiles([new File(['WEBVTT\n\nNOTE hola'], 'vacío.vtt')]); assert.equal(blank.ok, false); assert.match(blank.error, /transcripción sin tiempos/);
});
