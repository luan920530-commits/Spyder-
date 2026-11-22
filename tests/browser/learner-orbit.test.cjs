const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, boot, serve, root, fixture } = require('../support/browser.cjs');

test('Mi repaso en móvil offline: elegir libro y meta, recordar, comparar, abrir la fuente y retomar las fechas tras recargar', async t => {
  const { url, closeServer } = await serve(t);
  const context = await (await openBrowser(t)).newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = [], external = [], page = await context.newPage();
  context.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) external.push(r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  const stage = page.locator('#bot-stage'), action = name => stage.getByRole('button', { name, exact: true }).click();
  const plan = async () => { await page.click('[data-workspace="study"]'); await page.click('[data-bot="plan"]'); };
  await boot(page, url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await closeServer(); await context.setOffline(true); await boot(page, url); await plan();
  await action('Cargar demo'); await page.locator('#file-input').setInputFiles(fixture('personaje-novela.pdf'));
  await page.selectOption('#review-doc', { label: 'personaje-novela.pdf' }); await page.selectOption('#review-size', '3');
  await action('Preparar hasta 3 tarjetas nuevas'); await action('Empezar repaso');
  assert.equal(await page.locator('#review-task').textContent(), 'Tarjeta 1 de 3');
  assert.equal(await page.locator('.review-turn .study-card-back').count(), 0);
  await page.fill('#review-draft', 'ejemplo: intento privado'); await page.click('[data-bot="guide"]'); await page.click('[data-bot="plan"]');
  assert.equal(await page.inputValue('#review-draft'), 'ejemplo: intento privado'); await action('Mostrar respuesta');
  assert.match(await page.textContent('#review-answer'), /ejemplo/i); await action('Difícil');
  await action('Mostrar respuesta'); await action('Bien');
  await action('Mostrar respuesta'); await action('personaje-novela.pdf · pág. 2');
  await page.waitForSelector('#doc-content .sentence-active'); assert.match(await page.textContent('#doc-content .sentence-active'), /llave de plata/);
  // NCDB.get lee primero su espejo de memoria. Esperar el commit real que
  // dispara la calificación (no forzarlo desde la prueba antes de recargar).
  await page.evaluate(() => {
    const off = NeuralStore.on('persistence:saved', async ({ collections }) => {
      if (!collections.includes('cards')) return;
      const db = await NCDB.open(), read = db.transaction(NCDB.STORE).objectStore(NCDB.STORE).get('cards');
      read.onsuccess = () => {
        const cards = read.result?.v;
        if (cards?.length === 3 && cards.every(c => c.fsrs && c.lastReview)) { window.reviewCommitted = true; off(); }
      };
    });
  });
  await action('Fácil'); assert.match(await page.textContent('.review-summary'), /Sesión completada.*Calificaste 3 de 3/s);
  assert.match(await page.textContent('.review-summary'), /Difícil: 1 · Bien: 1 · Fácil: 1/);
  const readSchedule = () => page.evaluate(() => window.NeuralStore.state.cards.map(c => [c.docName, c.sourcePage, c.due, c.lastReview, c.fsrs]));
  const schedule = await readSchedule(); assert.equal(schedule.length, 3); assert.ok(schedule.every(c => c[0] === 'personaje-novela.pdf'));
  const intervals = schedule.map(c => c[2] - c[3]); assert.ok(intervals[0] < intervals[1] && intervals[1] < intervals[2]);
  await page.waitForFunction(() => window.reviewCommitted === true);
  const backup = await page.evaluate(() => window.NeuralStore.exportBrain()); assert.ok(!JSON.stringify(backup).includes('intento privado'));
  await boot(page, url); await plan(); assert.equal(await page.inputValue('#review-size'), '3');
  assert.deepEqual(await readSchedule(), schedule); assert.ok(await page.locator('#review-start').isDisabled());
  assert.match(await page.textContent('.review-next'), /Al día. Próximo repaso/); assert.deepEqual(errors, []); assert.deepEqual(external, []);
});

test('órbita desde disco: arrastres reales de ratón y táctiles sin selección; clic, teclado, fuentes y centrado siguen funcionando', async t => {
  const ctx = await (await openBrowser(t)).newContext({ reducedMotion: 'reduce', viewport: { width: 1366, height: 800 }, hasTouch: true });
  const page = await ctx.newPage(), external = [], errors = [];
  page.on('request', r => { if (/^https?:/.test(r.url())) external.push(r.url()); }); page.on('pageerror', e => errors.push(e.message));
  await boot(page, pathToFileURL(path.join(root, 'index.html')).href);
  // La araña crea el nodo al cosechar el pasaje; no se inyectan nodos ni se reemplaza el simulador.
  await page.locator('#file-input').setInputFiles({ name: 'Atlas.txt', mimeType: 'text/plain', buffer: Buffer.from('La cartografía representa los caminos y accidentes geográficos de una región.') });
  const concept = page.locator('.node-group[aria-label^="Inspeccionar"] .node-circle').first();
  await concept.waitFor({ timeout: 30000 }); await page.click('#btn-toggle-spiders');
  await page.evaluate(() => {
    window.dispatchLog = []; const dispatch = window.SpiderEngine.dispatchFromNetwork;
    window.SpiderEngine.dispatchFromNetwork = args => { window.dispatchLog.push(args); return dispatch(args); };
  });
  const dispatches = () => page.evaluate(() => window.dispatchLog.length);
  const sel = '.node-group[aria-label^="Enviar arañas desde AGT-01"]', hub = page.locator(sel);
  const view = () => hub.getAttribute('transform');
  const changed = old => page.waitForFunction(([s, prev]) => document.querySelector(s).getAttribute('transform') !== prev, [sel, old]);
  const center = async n => { const box = await n.boundingBox(); return [box.x + box.width / 2, box.y + box.height / 2]; };
  const flat = await view(); await page.click('#btn-orbit'); await changed(flat); const upright = await view();
  assert.match(upright, /scale\(/); const [x,y] = await center(concept);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 72, y + 48, { steps: 10 }); await page.mouse.up();
  await changed(upright); assert.ok(!(await page.locator('#node-inspector').isVisible())); assert.equal(await dispatches(), 0);
  // El siguiente clic distinto no debe quedar suprimido por el arrastre anterior.
  await concept.click(); assert.match(await page.locator('#insp-citations').innerText(), /Atlas.txt · Pág 1/);
  await page.locator('#insp-citations button').click(); await page.waitForSelector('#doc-content .sentence-active'); await page.click('#btn-close-inspector');
  await page.click('[data-orbit-key="+"]'); assert.equal(await page.textContent('#orbit-zoom'), '110 %');
  await page.press('#arena-stage', 'Home'); assert.equal(await page.textContent('#orbit-zoom'), '100 %');
  await page.waitForFunction(([s, v]) => document.querySelector(s).getAttribute('transform') === v, [sel, upright]);
  await hub.press('ArrowLeft'); await changed(upright); await hub.press('Enter'); assert.equal(await dispatches(), 1);

  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#panel-arena').evaluate(n => n.scrollIntoView({ block: 'center' }));
  await page.click('#btn-center-net'); const stage = page.locator('#arena-stage'), box = await stage.boundingBox();
  const orig = await view(), scroll = await page.evaluate(() => window.scrollY), touch = await ctx.newCDPSession(page);
  const px = box.x + box.width * .55, py = box.y + box.height * .55;
  const send = (type, dx, dy) => touch.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ id: 1, x: px + dx, y: py + dy }] });
  await send('touchStart', 0, 0); await send('touchMove', 23, -20); await send('touchMove', 60, -44); await send('touchEnd');
  await changed(orig); assert.equal(await dispatches(), 1); assert.equal(await page.evaluate(() => window.scrollY), scroll);
  // Tras girar, el punto de inicio puede estar ahora sobre un concepto. La
  // segunda acción prueba un toque del fondo, no un toque de ese inspector.
  const backdrop = await stage.evaluate(s => {
    const r = s.getBoundingClientRect();
    for (const fy of [.36,.45,.59,.7]) for (const fx of [.32,.62,.23,.75]) {
      const x = r.x+r.width*fx, y = r.y+r.height*fy;
      const clear = [-16,0,16].every(dx => [-16,0,16].every(dy => {
        const n=document.elementFromPoint(x+dx,y+dy);
        return s.contains(n) && !n.closest('.node-group,button,.arena-tools,#node-inspector');
      }));
      if (clear) return [x,y];
    }
  });
  assert.ok(backdrop,'hay espacio libre en el globo'); await page.touchscreen.tap(...backdrop);
  await page.waitForFunction(() => window.dispatchLog.length >= 2); assert.equal(await dispatches(), 2); assert.ok(!await page.locator('#node-inspector').isVisible());
  await page.click('#btn-orbit'); await page.waitForFunction(s => !document.querySelector(s).getAttribute('transform').includes('scale('), sel);
  assert.equal(await page.getAttribute('#btn-orbit', 'aria-pressed'), 'false'); assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
