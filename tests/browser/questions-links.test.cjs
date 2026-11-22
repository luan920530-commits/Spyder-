const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, boot, serve, root } = require('../support/browser.cjs');

const upload = (page, name, text) => page.locator('#file-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const study = page => page.locator('#bot-stage');
const action = (page, name) => study(page).getByRole('button', { name, exact: true }).click();

test('PWA sin servidor: seleccionar la segunda ocurrencia con ratón, crear, recordar y volver exactamente a ese texto', async t => {
  const { url, closeServer } = await serve(t), ctx = await (await openBrowser(t)).newContext({ viewport: { width: 1366, height: 850 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(), errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message)); ctx.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) external.push(r.url()); });
  await boot(page, url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await closeServer(); await ctx.setOffline(true); await boot(page, url); await page.click('#btn-toggle-spiders');
  await upload(page, 'Cuaderno.txt', '# Portada\nIntroducción a las medidas de una muestra.\n# Medidas\nEl valor central se llama valor central en estos apuntes.');
  await page.waitForFunction(() => !document.getElementById('btn-next-page').disabled); await page.click('#btn-next-page');
  await page.waitForSelector('#doc-content .word-span:text-is("central")');
  const word = t => page.locator('#doc-content .word-span').filter({ hasText: new RegExp(`^${t}$`) }).nth(1);
  await word('valor').scrollIntoViewIfNeeded(); const start = await word('valor').boundingBox(), end = await word('central').boundingBox();
  await page.evaluate(() => { window.manualDispatches = 0; NeuralStore.on('spider:dispatchToSentence', () => window.manualDispatches++); });
  await page.mouse.move(start.x + .5, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(end.x + end.width - .5, end.y + end.height / 2, { steps: 8 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => getSelection().toString()), 'valor central'); assert.equal(await page.evaluate(() => window.manualDispatches), 0);
  await page.click('#btn-question'); assert.equal(await page.textContent('#question-quote'), 'valor central');
  assert.match(await page.textContent('#question-location'), /Cuaderno.txt · pág. 2/);
  await page.fill('#question-front', '¿Cómo llaman a esta medida?'); await page.click('#question-save');
  assert.ok(await page.locator('#review-mine').isChecked());
  await action(page, 'Empezar repaso'); assert.equal(await page.textContent('.study-card-front'), '¿Cómo llaman a esta medida?');
  assert.equal(await page.locator('#review-answer').count(), 0); await page.fill('#review-draft', 'INTENTO PRIVADO'); await action(page, 'Mostrar respuesta');
  assert.equal(await page.textContent('#review-answer'), 'valor central');
  await upload(page, 'Otro.txt', 'El valor central también aparece en este otro documento.'); await page.waitForSelector('#doc-tabs .active .doc-tab-name:text-is("Otro.txt")');
  const back = () => action(page, 'Volver al subrayado · Cuaderno.txt · pág. 2'); await back();
  const verify = () => page.waitForFunction(() => {
    const matches = [...document.querySelectorAll('#doc-content .word-span')].filter(w => w.textContent === 'valor');
    return matches.length === 2 && !matches[0].querySelector('mark') && matches[1].querySelector('mark') === document.activeElement &&
      [...document.querySelectorAll('mark.quote-focus')].map(m => m.textContent).join('') === 'valor central';
  }); await verify();
  await action(page, 'Difícil'); assert.match(await page.textContent('.review-summary'), /1 de 1/);
  await page.click('#btn-prev-page'); await study(page).locator('.review-summary .source-link').click(); await verify();
  const saved = await page.evaluate(async () => { await NeuralStore.flush(); return await NeuralStore.exportBrain(); });
  assert.equal(saved.data.cards[0].selector.start, 'El valor central se llama '.length); assert.ok(saved.data.cards[0].fsrs.stability > 0);
  assert.doesNotMatch(JSON.stringify(saved), /INTENTO PRIVADO/);
  await boot(page, url); await page.getByRole('button', { name: 'Cuaderno.txt', exact: true }).click(); await page.click('#btn-next-page');
  await page.waitForFunction(() => document.querySelectorAll('#doc-content mark').length > 0); await page.click('#btn-question');
  await page.click('#page-questions summary'); assert.match(await page.textContent('#page-question-list'), /Cómo llaman/);
  await page.getByRole('button', { name: 'Eliminar pregunta', exact: true }).click(); await page.getByRole('button', { name: /Confirmar eliminación/ }).click();
  assert.deepEqual(await page.evaluate(() => [NeuralStore.state.cards.length, NeuralStore.state.relationVotes.length]), [0,0]);
  await page.click('#question-cancel'); await page.waitForFunction(() => !document.querySelector('#doc-content mark'));
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
});

test('disco sin red: votar en la red cambia las líneas y la recomendación de un pasaje nunca valorado en Mi repaso tras recargar', async t => {
  const url = pathToFileURL(path.join(root, 'index.html')).href, ctx = await (await openBrowser(t)).newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  await ctx.setOffline(true); const page = await ctx.newPage(), errors = [], net = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) net.push(r.url()); });
  await boot(page, url); await page.click('#btn-toggle-spiders');
  await upload(page, 'Atlas.txt', '# Uno\nAtlas incluye luna blanca. Atlas indica clima frío.\n# Dos\nLago contiene agua dulce. Lago tiene peces rojos. Atlas registra canto largo.\n# Tres\nLago cubre rocas grises.');
  const inspect = async () => { await page.click('#btn-study-links'); await page.click('#link-compare'); await page.waitForSelector('#insp-relations li'); };
  const top = panel => page.locator(panel+' li p').first().textContent();
  await page.waitForFunction(() => !document.getElementById('btn-next-page').disabled); await page.click('#btn-next-page'); await inspect();
  assert.equal(await top('#insp-relations'), 'Lago tiene peces rojos.'); await page.click('#btn-close-inspector'); await page.click('#btn-study-links');
  await page.click('#btn-prev-page'); await inspect(); assert.equal(await top('#insp-relations'), 'Atlas indica clima frío.');
  const width = () => page.locator('line[data-kind=study]').evaluateAll(lines => {
    const l = lines.find(n => n.__data__.target.text.includes('clima frío')); return l && Number(l.getAttribute('stroke-width'));
  });
  const before = await width(); assert.ok(before > 0);
  await page.locator('#insp-relations li').first().getByRole('button', { name: 'No útil', exact: true }).click();
  assert.equal(await top('#insp-relations'), 'Atlas registra canto largo.'); assert.ok(await width() < before);
  assert.equal(await page.locator('#insp-relations [aria-pressed=true]').textContent(), 'No útil');
  await page.evaluate(() => NeuralStore.flush()); await boot(page, url);
  await page.click('#btn-next-page'); await page.waitForSelector('#doc-content .word-span:text-is("Lago")');
  // Alternativa accesible sin arrastre: elegir un pasaje completo con teclado.
  await page.press('#btn-question', 'Enter'); assert.equal(await page.textContent('#question-quote'), 'Lago contiene agua dulce.');
  await page.fill('#question-front', '¿Qué contiene el lago?'); await page.press('#question-save', 'Enter');
  await action(page, 'Empezar repaso'); await action(page, 'Mostrar respuesta'); await study(page).locator('.passage-links summary').click();
  assert.equal(await top('#bot-stage'), 'Lago cubre rocas grises.'); assert.equal(await study(page).locator('[data-vote][aria-pressed=true]').count(), 0);
  await study(page).getByRole('button', { name: 'Ver estos vínculos en la red' }).click(); assert.match(await page.textContent('#link-guide'), /Lago contiene agua dulce/);
  await action(page, 'Bien'); assert.equal(await page.evaluate(() => NeuralStore.state.relationVotes.length), 1, 'FSRS no vota vínculos');
  await page.getByRole('button', { name: 'Quitar documento Atlas.txt' }).click(); await page.waitForFunction(() => !document.querySelector('line[data-kind=study]'));
  assert.ok(await page.locator('#btn-study-links').isDisabled()); assert.deepEqual(await page.evaluate(() => [NeuralStore.state.cards.length, NeuralStore.state.relationVotes.length]), [0,0]);
  assert.deepEqual(net, []); assert.deepEqual(errors, []);
});

test('vista aislada: guardar con teclado, votar y deshacer la adaptación sin perder la tarjeta ni necesitar permisos de formulario', async t => {
  const { url } = await serve(t), page = await (await openBrowser(t)).newPage();
  const ready = page.waitForEvent('framenavigated', f => f.url() === url);
  await page.setContent(`<iframe sandbox="allow-scripts" width="1200" height="800" src="${url}"></iframe>`);
  const f = await ready; await f.waitForSelector('html[data-app-ready="true"]'); await f.click('#btn-toggle-spiders');
  await upload(f, 'Medidas.txt', 'El valor central es la mediana. Ordenar los datos permite determinar la mediana.');
  await f.waitForSelector('#btn-question'); // La lectura del archivo es asíncrona; no enviar Enter a un botón aún oculto.
  await f.press('#btn-question', 'Enter'); await f.selectOption('#question-passage', '1'); await f.fill('#question-front', '¿Qué se necesita para determinar la mediana?');
  await f.press('#question-save', 'Enter'); await action(f, 'Empezar repaso'); await action(f, 'Mostrar respuesta');
  assert.equal(await f.textContent('#review-answer'), 'Ordenar los datos permite determinar la mediana.');
  const panel = study(f).locator('.passage-links'); await panel.locator('summary').click(); const baseline = await panel.locator('li small').textContent();
  await panel.getByRole('button', { name: 'Vínculo útil', exact: true }).click(); assert.notEqual(await panel.locator('li small').textContent(), baseline);
  await panel.getByRole('button', { name: 'Restablecer vínculos de este documento' }).click(); await panel.getByRole('button', { name: /Confirmar: olvidar/ }).click();
  assert.equal(await panel.locator('li small').textContent(), baseline);
  const snapshot = await f.evaluate(() => NeuralStore.exportBrain()); assert.equal(snapshot.data.cards.length, 1); assert.equal(snapshot.data.cards[0].reps, 0);
  assert.equal(snapshot.data.relationVotes.length, 0);
});
