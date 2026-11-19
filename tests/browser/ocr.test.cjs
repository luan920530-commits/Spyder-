const test = require('node:test');
const assert = require('node:assert/strict');
const { openBrowser, boot, serve, fixture } = require('../support/browser.cjs');
const pack = 'vendor/ocr/es-lstm-6.1.2.js';

async function read(frame, filename, first = 1) {
  const tools = frame.locator('#ocr-tools');
  if (!await tools.evaluate(el => el.open)) await tools.locator('summary').click();
  await frame.fill('#ocr-start', String(first));
  await frame.locator('#ocr-file').setInputFiles(fixture(filename));
  await frame.waitForFunction(() => !document.getElementById('ocr-file').disabled && !!document.getElementById('ocr-status').textContent);
  return frame.textContent('#ocr-status');
}

test('OCR de píxeles reales: no precarga el modelo, reconoce PNG y permite estudiar un PDF mixto tras apagar el servidor', async t => {
  const { url, closeServer } = await serve(t), ctx = await (await openBrowser(t)).newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const external = [], requests = [], errors = [];
  ctx.on('request', r => { if (r.url().endsWith(pack)) requests.push(r.url()); if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) external.push(r.url()); });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await boot(page, url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.match(await read(page, 'personaje-novela.pdf'), /Listo/); assert.deepEqual(requests, []);
  assert.ok(!await page.evaluate(async path => !!await caches.match(path), pack));
  assert.match(await read(page, 'ocr-mediana.png'), /Listo/);
  await page.waitForFunction(() => document.getElementById('doc-content').textContent.includes('La mediana indica el valor central.'));
  assert.ok(await page.evaluate(async path => !!await caches.match(path), pack));
  await closeServer(); await ctx.setOffline(true); await boot(page, url);
  assert.match(await read(page, 'ocr-mixto.pdf', 2), /Listo/);
  const doc = await page.evaluate(() => NeuralStore.getActiveDoc());
  assert.equal(doc.pages[0].text, 'La mediana indica el valor central.'); assert.equal(doc.pages[0].ocr, true);
  assert.deepEqual(doc.pages.map(p => p.sourcePage), [2, 3]); assert.equal(doc.pages[1].sentences.length, 0);
  assert.match(doc.ingestWarnings.join(' '), /2–3 de 3/);
  await page.click('#ocr-tools summary');
  await page.click('[data-workspace="network"]'); await page.selectOption('#tutor-doc', { label: 'ocr-mixto.pdf · págs. 2–3 · OCR' });
  await page.getByRole('button', { name: 'Empezar práctica' }).click(); await page.fill('#tutor-answer', 'mediana'); await page.press('#tutor-answer', 'Enter');
  assert.match(await page.textContent('#tutor-feedback'), /Recordaste/);
  await page.getByRole('button', { name: 'Ver fuente · ocr-mixto.pdf · pág. 2' }).click();
  await page.waitForSelector('#doc-content .sentence-active'); assert.match(await page.textContent('#doc-section'), /PDF pág. 2 · OCR/);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
});

test('PWA fría sin motor OCR: conserva texto nativo de un PDF mixto y avisa; una imagen no produce un libro ficticio', async t => {
  const { url, closeServer } = await serve(t), ctx = await (await openBrowser(t)).newContext(); const page = await ctx.newPage();
  await boot(page, url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await closeServer(); await ctx.setOffline(true); await boot(page, url);
  assert.match(await read(page, 'ocr-mixto.pdf'), /Listo/);
  const doc = await page.evaluate(() => NeuralStore.getActiveDoc());
  assert.match(doc.pages[0].text, /texto nativo/); assert.equal(doc.pages[1].text, ''); assert.match(doc.ingestWarnings.join(' '), /OCR incompleto.*motor OCR no está disponible/);
  assert.match(await read(page, 'ocr-mediana.png'), /motor OCR no está disponible/); assert.equal(await page.evaluate(() => NeuralStore.state.docs.length), 1);
});

test('vista aislada: cancelar mientras llega el motor no crea documentos; al reintentar reconoce la página en su worker', async t => {
  const { url } = await serve(t), page = await (await openBrowser(t)).newPage();
  const ready = page.waitForEvent('framenavigated', f => f.url() === url);
  await page.setContent(`<iframe sandbox="allow-scripts" src="${url}" width="1180" height="800"></iframe>`);
  const frame = await ready; await frame.waitForSelector('html[data-app-ready="true"]'); await frame.click('#ocr-tools summary');
  let resume; const gate = new Promise(resolve => { resume = resolve; }); t.after(resume);
  await page.route('**/' + pack, async route => { await gate; await route.continue().catch(() => {}); }, { times: 1 });
  const requested = page.waitForRequest(r => r.url().endsWith(pack));
  await frame.locator('#ocr-file').setInputFiles(fixture('ocr-mediana.png')); await requested;
  await frame.click('#ocr-cancel'); await frame.waitForFunction(() => document.getElementById('ocr-status').textContent === 'Lectura cancelada.');
  assert.equal(await frame.evaluate(() => NeuralStore.state.docs.length), 0); resume();
  assert.match(await read(frame, 'ocr-mixto.pdf'), /Listo/);
  const doc = await frame.evaluate(() => NeuralStore.getActiveDoc());
  assert.deepEqual(doc.pages.map(p => p.text), ['La primera pagina contiene texto nativo.', 'La mediana indica el valor central.', '']);
  assert.equal(doc.pages[0].ocr, undefined); assert.equal(doc.pages[1].ocr, true);
});
