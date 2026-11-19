// Interacción real, sin inyectar respuestas ni activar modelos. El servidor de
// la primera prueba se apaga antes de cargar el libro y empezar la práctica.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { openBrowser, boot, serve, fixture } = require('../support/browser.cjs');

function tutorButton(frame, name) { return frame.locator('#tutor-stage').getByRole('button', { name, exact: true }); }
function stageButton(frame, name) { return frame.locator('#bot-stage').getByRole('button', { name, exact: true }); }

test('tutor PWA: practicar un PDF sin conexión, abrir el original, reforzar con tarjetas y recuperar el balance al recargar', async t => {
  const { url, closeServer } = await serve(t);
  const context = await (await openBrowser(t)).newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, hasTouch: true });
  const external = [], errors = [];
  context.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) external.push(r.url()); });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const action = text => tutorButton(page, text).click();
  await boot(page, url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await closeServer(); await context.setOffline(true);
  await boot(page, url); await page.click('[data-workspace="network"]');
  assert.ok(await tutorButton(page, 'Elegir archivo').isVisible()); await action('Cargar demo');
  await page.locator('#file-input').setInputFiles(fixture('personaje-novela.pdf'));
  await page.selectOption('#tutor-doc', { label: 'personaje-novela.pdf' });
  await action('Empezar práctica');
  assert.equal(await page.locator('label[for=tutor-answer]').innerText(), 'Una novela de ________.');
  await page.fill('#tutor-answer', 'EJEMPLO');
  await page.click('#open-review'); assert.ok(await page.locator('#review-case').isVisible());
  await page.click('#analysis-graph'); assert.equal(await page.evaluate(() => document.activeElement.id), 'arena-stage');
  await page.click('[data-workspace="study"]'); assert.ok(await page.locator('#guide-editor').isVisible());
  assert.ok(!await page.locator('#tutor-answer').isVisible()); await page.click('#study-open-tutor');
  assert.equal(await page.inputValue('#tutor-answer'), 'EJEMPLO'); await page.press('#tutor-answer', 'Enter');
  assert.match(await page.textContent('#tutor-feedback'), /Recordaste/); await action('Siguiente pasaje');
  await action('Dame una pista'); await page.fill('#tutor-answer', 'incorrecta'); await action('Comparar con la fuente');
  assert.match(await page.textContent('#tutor-feedback'), /biblioteca/); await action('Siguiente pasaje');
  await action('No lo recuerdo');
  await action('Ver fuente · personaje-novela.pdf · pág. 2');
  await page.waitForSelector('#doc-content .sentence-active');
  assert.match(await page.textContent('#doc-content .sentence-active'), /llave de plata/);
  await action('Ver balance');
  assert.match(await page.textContent('.tutor-result'), /Términos recordados: 1\/3\. Pistas usadas: 1/);
  await action('Añadir pendientes a Tarjetas');
  assert.match(await page.textContent('.tutor-result'), /Tarjetas nuevas: 2/);
  await action('Practicar solo los pendientes'); assert.match(await page.textContent('.tutor-turn'), /Pasaje 1 de 2/);
  await action('Salir sin guardar la práctica'); await page.click('[data-workspace="study"]'); await page.click('[data-bot="flashcards"]');
  const done = page.waitForEvent('download'); await stageButton(page, '↓ Anki CSV').click();
  const csv = await fs.readFile(await (await done).path(), 'utf8');
  assert.match(csv, /biblioteca\. \[Pág 1\]/); assert.match(csv, /caja azul\. \[Pág 2\]/);
  await page.waitForFunction(async () => (await window.NCDB.get('tutorRuns'))?.length === 1);
  await boot(page, url); await page.click('[data-workspace="network"]');
  await page.selectOption('#tutor-doc', { label: 'personaje-novela.pdf' });
  assert.match(await page.textContent('.tutor-last'), /3 pasajes · 2 para reforzar/);
  await action('Empezar práctica'); assert.match(await page.textContent('label[for=tutor-answer]'), /un mapa antiguo/);
  assert.equal(await page.evaluate(() => window.NeuralStore.state.cards.length), 2);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
});

test('vista previa sin permisos de formularios ni almacenamiento: autoexplicación y descarga del respaldo desde memoria', async t => {
  const { url } = await serve(t);
  const page = await (await openBrowser(t)).newPage();
  const ready = page.waitForEvent('framenavigated', f => f.url() === url);
  await page.setContent(`<iframe sandbox="allow-scripts allow-downloads" width="1200" height="800" src="${url}"></iframe>`);
  const frame = await ready; await frame.waitForSelector('html[data-app-ready="true"]');
  await frame.click('[data-workspace="network"]');
  const text = 'La brújula señala el norte magnético.';
  await frame.locator('#file-input').setInputFiles({ name: 'orientación.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  const action = name => tutorButton(frame, name).click();
  await frame.selectOption('#tutor-skill', 'explain'); await action('Empezar práctica');
  assert.equal(await frame.textContent('.tutor-turn blockquote'), text);
  await action('Ocultar y explicar'); assert.equal(await frame.locator('.tutor-turn blockquote').count(), 0);
  await frame.fill('#tutor-answer', 'mi-paráfrasis-privada'); await action('Comparar con la fuente');
  assert.match(await frame.textContent('.tutor-turn'), /Esto no califica el significado/);
  await action('Sí, recogí la idea'); assert.match(await frame.textContent('.tutor-result'), /Ideas que marcaste como explicadas: 1\/1/);
  await frame.click('[data-workspace="study"]'); await frame.click('[data-bot="backup"]'); const done = page.waitForEvent('download'); await stageButton(frame, '↓ Exportar cerebro .json').click();
  const json = await fs.readFile(await (await done).path(), 'utf8'); assert.doesNotMatch(json, /mi-paráfrasis-privada/);
  const { docs, tutorRuns } = JSON.parse(json).data; assert.equal(docs.length, 1); assert.equal(docs[0].name, 'orientación.txt');
  assert.deepEqual(tutorRuns[0].turns, [{ sentenceId: docs[0].pages[0].sentences[0].id, ok: true, hint: false }]);
  await frame.click('[data-workspace="chat"]');
  for (const method of ['click', 'Enter']) {
    await frame.fill('#chat-input', '¿Cuánto es 7 + 3?');
    if (method === 'click') await frame.click('#btn-send'); else await frame.press('#chat-input', 'Enter');
  }
  const answers = await frame.evaluate(() => window.NeuralStore.state.chat.map(r => r.text));
  assert.equal(answers.length, 2); assert.ok(answers.every(text => text.includes('7 + 3 = 10')));
});

test('desde la interfaz: modos de estudio, redacción con fuentes, bóveda, métricas e importación de respaldo', async t => {
  const { url } = await serve(t);
  const page = await (await openBrowser(t)).newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await boot(page, url); await page.click('#btn-load-demo'); await page.click('#btn-toggle-spiders');
  await page.click('[data-workspace="chat"]'); await page.selectOption('#mode-select', 'socratico');
  const last = () => page.evaluate(() => window.NeuralStore.state.chat.at(-1));
  const ask = async q => { await page.fill('#chat-input', q); await page.click('#btn-send'); };
  await ask('¿Cómo se mide la latencia del sistema?'); assert.match((await last()).text, /Guía socrática/);
  await page.click('[data-prompt^="Resume y analiza"]'); assert.match((await last()).text, /Síntesis del material/);
  await page.click('[data-prompt^="Detecta contradicciones"]'); assert.match((await last()).text, /12 ms frente a 40 ms/);
  await page.click('[data-prompt^="Aprende que"]'); assert.equal(await page.inputValue('#chat-input'), 'Aprende que ');
  await ask('Aprende que mi repaso empieza el martes.'); assert.equal((await last()).mode, 'learn');
  await page.selectOption('#mode-select', 'examen'); await ask('zyxwvutsrq =doc:NoExiste'); assert.equal((await last()).sources.length, 0);
  await page.click('[data-tab="writer"]'); await page.fill('#writer-prompt', 'La latencia de consulta'); await page.click('#btn-run-writer');
  await page.waitForSelector('#writer-output .cite-ref'); assert.equal((await last()).mode, 'redaccion');
  await page.click('[data-workspace="study"]'); await page.click('[data-bot="vault"]');
  await page.getByLabel('Nueva nota').fill('Preparar mi exposición'); await stageButton(page, 'Guardar').click();
  await page.getByLabel('Buscar en la bóveda').fill('exposición'); assert.match(await page.textContent('.vault-list'), /Preparar mi exposición/);
  await page.click('[data-bot="metrics"]'); await stageButton(page, '▶ Evaluar corpus').click(); await page.waitForSelector('#eval-results .eval-kpi');
  await page.click('[data-bot="backup"]'); const download = page.waitForEvent('download'); await stageButton(page, '↓ Exportar cerebro .json').click();
  const backup = await fs.readFile(await (await download).path());
  page.on('dialog', d => d.accept()); await page.click('[data-workspace="extract"]'); await page.click('#btn-reset-all');
  await page.waitForFunction(() => window.NeuralStore.state.docs.length === 0);
  await page.click('[data-workspace="study"]');
  await page.locator('#bot-stage input[type=file]').setInputFiles({ name: 'repaso.json', mimeType: 'application/json', buffer: backup });
  await page.waitForFunction(() => document.getElementById('study-backup-status')?.textContent === 'Respaldo importado.');
  const restored = await page.evaluate(() => { const s = window.NeuralStore.state; return [s.docs.length, s.evalRuns.length, s.vault.some(v => v.phrase === 'Preparar mi exposición')]; });
  assert.deepEqual(restored, [2, 1, true]); assert.deepEqual(errors, []);
});

test('chat principal offline: saludar sin libros, contestar una cortesía y pasar a una pregunta con fuentes', async t => {
  const { url, closeServer } = await serve(t);
  const ctx = await (await openBrowser(t)).newContext({ reducedMotion:'reduce' });
  const page = await ctx.newPage(), errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  ctx.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) external.push(r.url()); });
  await boot(page,url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await closeServer(); await ctx.setOffline(true); await boot(page,url);
  await page.click('[data-workspace="chat"]'); assert.equal(await page.inputValue('#mode-select'),'auto');
  const answers = page.locator('#chat-messages .msg-ai');
  async function say(text) {
    const n = await answers.count(); await page.fill('#chat-input',text); await page.press('#chat-input','Enter');
    await answers.nth(n).waitFor(); return answers.nth(n);
  }
  assert.match(await (await say('¡Buenos días!')).textContent(),/¡Buenos días!/);
  const polite = await say('¿Cómo estás?'); assert.match(await polite.textContent(),/listo para conversar/); assert.equal(await polite.locator('button').count(),0);
  assert.match(await (await say('Bien, gracias')).textContent(),/¡Qué bueno!/);
  assert.match(await (await say('Gracias, ¿cuánto es 7 + 3?')).textContent(),/= 10/);
  await page.click('#open-dialogue'); await page.click('#dialogue-demo');
  assert.match(await (await say('Hola, ¿qué dicen los informes sobre la latencia?')).textContent(),/12 ms y 40 ms/);
  await say('Gracias'); const why = await say('¿Por qué?'); assert.ok(await why.locator('.dialogue-source').count() >= 2);
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
});
