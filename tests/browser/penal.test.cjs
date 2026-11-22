const test = require('node:test');
const assert = require('node:assert/strict');
const { openBrowser, boot, serve } = require('../support/browser.cjs');

for (const [name, viewport] of [['escritorio', { width: 1440, height: 900 }], ['móvil', { width: 390, height: 844 }]]) {
  test(`${name}: el chat consulta la cláusula penal offline y abre las fuentes`, async t => {
    const { url, closeServer } = await serve(t);
    const context = await (await openBrowser(t)).newContext({ viewport, hasTouch: name === 'móvil', reducedMotion: 'reduce' });
    t.after(() => context.close());
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    context.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(url)) external.push(request.url()); });
    await boot(page, url);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await closeServer(); await context.setOffline(true); await boot(page, url);
    await page.click('[data-workspace="chat"]');
    assert.equal(await page.inputValue('#search-scope'), 'both');
    const answers = page.locator('#chat-messages article.msg-ai');
    async function say(question) {
      const index = await answers.count();
      await page.fill('#chat-input', question); await page.press('#chat-input', 'Enter');
      await answers.nth(index).waitFor();
      return answers.nth(index);
    }
    const answer = await say('Qué es una cláusula penal y cuál es su finalidad');
    const text = await answer.locator('.answer-body').textContent();
    assert.match(text, /En Colombia.*dar o hacer algo.*incumple o retrasa/);
    assert.match(text, /asegurar el cumplimiento/);
    assert.match(text, /estima anticipadamente los perjuicios/);
    assert.match(text, /apremio o de garantía si hay pacto expreso e inequívoco/);
    assert.match(text, /Revisión 2026-11-16.*no sustituye asesoría jurídica/);
    await answer.locator('.answer-body .cite-ref').first().click();
    assert.equal(await answer.locator('.sources-details').evaluate(node => node.open), true);
    const sources = answer.locator('.source-list li');
    assert.equal(await sources.count(), 2);
    assert.match(await sources.nth(0).textContent(), /Código Civil colombiano/);
    assert.match(await sources.nth(1).textContent(), /Consejo de Estado.*1748/);
    assert.equal(await sources.nth(0).locator('a').getAttribute('href'), 'https://www.cancilleria.gov.co/sites/default/files/Normograma/docs/codigo_civil_pr049.htm');
    assert.equal(await sources.nth(1).locator('a').getAttribute('href'), 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=21359');
    const unrelated = await say('¿Cuál es la pena por un delito?');
    assert.match(await unrelated.textContent(), /Sin evidencia suficiente/);
    assert.equal(await unrelated.locator('.source-list li').count(), 0);
    const foreign = await say('¿Qué es una cláusula penal en México?');
    assert.match(await foreign.textContent(), /Sin evidencia suficiente/);
    assert.equal(await foreign.locator('.source-list li').count(), 0);
    await page.selectOption('#search-scope', 'documents');
    const docOnly = await say('Qué es una cláusula penal y cuál es su finalidad');
    assert.match(await docOnly.textContent(), /Sin evidencia suficiente/);
    assert.equal(await docOnly.locator('.source-list li').count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
  });
}
