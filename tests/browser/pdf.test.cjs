// Prueba la entrada real (FileList → visor/índice), no un mock de pdfjsLib.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, boot, serve, root, fixture } = require('../support/browser.cjs');
const JSZip = require('../../vendor/jszip/jszip.min.js');

async function checkBook(page, selector, name) {
  await page.locator(selector).setInputFiles({ name, mimeType: 'application/pdf', buffer: await fs.readFile(fixture('pdf-cmap-multipagina.pdf')) });
  await page.waitForFunction(name => window.NeuralStore.getActiveDoc()?.name === name ||
    document.getElementById('ingest-message').textContent.startsWith(name + ':'), name);
  assert.equal(await page.locator('#ingest-message').textContent(), '');
  const doc = await page.evaluate(() => window.NeuralStore.getActiveDoc());
  assert.equal(doc.name, name);
  assert.equal(doc.type, 'pdf');
  assert.deepEqual(doc.pages.map(p => p.sourcePage), [1, 2, 3]);
  assert.match(doc.pages[0].text, /primera pagina contiene informacion real/);
  // Sin el CMap local el libro aún se abriría, pero este pasaje se perdería.
  assert.match(doc.pages[1].sentences[0].text, /こんにちは 日本語/);
  await page.click('[data-workspace="extract"]');
  await page.locator('#btn-next-page').click();
  await page.waitForFunction(() => document.getElementById('doc-content').textContent.includes('こんにちは 日本語'));
  assert.match(await page.locator('#doc-section').textContent(), /PDF pág\. 2/);
}

async function docx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Este DOCX conserva su texto.</w:t></w:r></w:p></w:body></w:document>');
  return { name: 'control.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

test('desde file: se importan un DOCX y un PDF con CMap sin relajar CORS ni usar la red', async t => {
  const page = await (await openBrowser(t)).newPage();
  const network = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await boot(page, pathToFileURL(path.join(root, 'index.html')).href);
  await page.locator('#file-input').setInputFiles(await docx());
  await page.waitForFunction(() => document.getElementById('doc-content').textContent.includes('Este DOCX conserva su texto.'));
  assert.equal(await page.evaluate(() => !!globalThis.pdfjsLib), false, 'DOCX no necesita cargar el lector PDF');
  await checkBook(page, '#file-input', 'Mapas.PDF');
  await page.locator('#file-input').setInputFiles(fixture('pdf-protegido.pdf'));
  await page.waitForFunction(() => document.getElementById('ingest-message').textContent.includes('contraseña'));
  assert.equal(await page.evaluate(() => window.NeuralStore.state.docs.length), 2, 'no se indexa un documento fallido');
  assert.deepEqual(network, []);
});

test('una vista previa HTTP con origen opaco también lee las tres páginas, sin permiso allow-same-origin', async t => {
  const { url } = await serve(t);
  const page = await (await openBrowser(t)).newPage();
  const ready = page.waitForEvent('framenavigated', frame => frame.url() === url);
  await page.setContent(`<iframe sandbox="allow-scripts" src="${url}" width="1200" height="800"></iframe>`);
  const frame = await ready;
  await frame.waitForSelector('html[data-app-ready="true"]');
  assert.equal(await frame.evaluate(() => self.origin), 'null');
  await frame.locator('#chk-auto-page').uncheck();
  await checkBook(frame, '#file-input', 'Vista previa.pdf');
});

test('PWA bajo subruta: primera importación PDF offline desde Personaje, con worker real y sin depender del MIME de .mjs', async t => {
  const { url, closeServer } = await serve(t);
  const browser = await openBrowser(t);
  const context = await browser.newContext();
  const page = await context.newPage();
  const workers = [], external = [];
  context.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) external.push(r.url()); });
  page.on('worker', worker => workers.push(worker.url()));
  await boot(page, url);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await closeServer();
  await context.setOffline(true);
  await boot(page, url);
  await page.click('[data-workspace="chat"]');
  await page.selectOption('#mode-select', 'conversacion');
  await checkBook(page, '#character-file', 'Libro sin extensión');
  assert.equal(await page.locator('#character-book').inputValue(), await page.evaluate(() => window.NeuralStore.getActiveDoc().id));
  assert.ok(workers.includes(url + 'vendor/pdfjs/pdf.worker.entry.js'), 'en la web la extracción usa el worker dedicado');
  assert.equal(await page.evaluate(() => !!globalThis.NCPdfPackedAssets), false);
  assert.deepEqual(external, []);
});
