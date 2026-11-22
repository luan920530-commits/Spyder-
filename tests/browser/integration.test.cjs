const test = require('node:test');
const assert = require('node:assert/strict');
const { openBrowser, serve } = require('../support/browser.cjs');

for (const [name, viewport] of [['escritorio', { width: 1440, height: 900 }], ['móvil', { width: 390, height: 844 }]]) {
  test(`${name}: cinco lectores con preguntas, grafo acotado y órbita en la misma sesión`, async t => {
    const { url } = await serve(t);
    const context = await (await openBrowser(t)).newContext({ viewport, hasTouch: name === 'móvil' });
    t.after(() => context.close());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Avance reproducible del reloj de animación; el layout, los controles y
    // el motor de las arañas son reales. Se omite la pintura decorativa.
    await page.addInitScript(() => {
      let queue = new Map(), next = 1, time = 1000;
      window.requestAnimationFrame = fn => { const id = next++; queue.set(id, fn); return id; };
      window.cancelAnimationFrame = id => queue.delete(id);
      for (const key of ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'clearRect']) {
        CanvasRenderingContext2D.prototype[key] = function () {};
      }
      window.stepAnimation = (count = 1) => {
        for (let i = 0; i < count; i++) {
          time += 50;
          const callbacks = [...queue.values()]; queue.clear();
          for (const callback of callbacks) {
            if (callback.toString().includes('drawSphere(time)')) queue.set(next++, callback);
            else callback(time);
          }
        }
      };
    });
    await page.goto(url); await page.waitForSelector('html[data-app-ready="true"]');
    await page.evaluate(() => {
      const S = NeuralStore;
      S.setSetting('embedEnabled', false); S.setSetting('autoHarvest', false);
      const sentences = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`,
        text: `La variable ${i} conserva un valor distinto para que cada araña lea su propio pasaje y mantenga la cita completa.` }));
      S.addDocument({ id: 'lecturas', name: 'lecturas.txt', pages: [{ pageNum: 1,
        text: sentences.map(s => s.text).join(' '), sentences }] });
      SpiderEngine.setSpiderCount(5); window.stepAnimation(2);
      window.delivered = []; S.on('spider:delivered', e => { if (e.fresh) window.delivered.push(e.sentenceId); });
      document.getElementById('btn-toggle-spiders').click();
    });
    const active = await page.evaluate(() => {
      let maximum = 0;
      for (let i = 0; i < 300 && maximum < 5; i++) {
        window.stepAnimation();
        maximum = Math.max(maximum, SpiderEngine.getStatus().spiders.filter(s => s.phase === 'EXTRAER_DATOS').length);
      }
      const zone = document.getElementById('doc-dropzone').getBoundingClientRect();
      const content = document.getElementById('doc-content').getBoundingClientRect();
      const tracks = [...document.querySelectorAll('.scan-track')].map(el => {
        const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, role: el.getAttribute('role'), label: el.getAttribute('aria-label') };
      });
      return { maximum, claims: [...NeuralStore.state.claimedTargets], tracks,
        zone: { top: zone.top, bottom: zone.bottom }, contentTop: content.top,
        questionToolsVisible: !document.getElementById('question-tools').hidden };
    });
    assert.equal(active.maximum, 5);
    assert.equal(new Set(active.claims).size, 5);
    assert.equal(active.tracks.length, 5);
    assert.equal(active.questionToolsVisible, true);
    assert.ok(active.tracks.every(track => track.role === 'group' && track.label.includes('Fragmento:')));
    assert.ok(active.tracks.every(track => track.top >= active.zone.top && track.bottom <= active.zone.bottom));
    assert.ok(active.contentTop >= Math.max(...active.tracks.map(track => track.bottom)));

    // Selección y tarjeta reales mientras los cinco lectores siguen activos.
    // El reloj avanza durante la selección y el guardado, no solo antes/después.
    const word = text => page.locator('#doc-content .word-span').filter({ hasText: new RegExp(`^${text}$`) }).first();
    await word('valor').scrollIntoViewIfNeeded();
    const start = await word('valor').boundingBox(), end = await word('distinto').boundingBox();
    await page.mouse.move(start.x + .5, start.y + start.height / 2); await page.mouse.down();
    await page.mouse.move(end.x + end.width - .5, end.y + end.height / 2, { steps: 8 });
    await page.evaluate(() => window.stepAnimation(1)); await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), 'valor distinto');
    assert.equal(await page.evaluate(() => SpiderEngine.getStatus().spiders.filter(s => s.phase === 'EXTRAER_DATOS').length), 5);
    await page.click('#btn-question'); assert.equal(await page.textContent('#question-quote'), 'valor distinto');
    await page.fill('#question-front', '¿Qué conserva la variable?');
    await page.evaluate(() => window.stepAnimation(1)); await page.click('#question-save');
    await page.evaluate(() => window.stepAnimation(2));
    const annotation = await page.evaluate(() => ({
      active: SpiderEngine.getStatus().spiders.filter(s => s.phase === 'EXTRAER_DATOS').length,
      cards: NeuralStore.state.cards.map(card => ({ quote: card.selector.quote, start: card.selector.start, sentenceId: card.sentenceId })),
      marks: [...document.querySelectorAll('#doc-content mark')].map(mark => mark.textContent).join('')
    }));
    assert.equal(annotation.active, 5);
    assert.deepEqual(annotation.cards, [{ quote: 'valor distinto', start: 'La variable 0 conserva un '.length, sentenceId: 's0' }]);
    assert.equal(annotation.marks, 'valor distinto');
    await page.click('[data-workspace="extract"]');

    const cdp = await context.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const tree = await cdp.send('Accessibility.getFullAXTree');
    const accessibleTracks = tree.nodes.filter(node => !node.ignored && node.role?.value === 'group' && node.name?.value?.includes('Fragmento:'));
    assert.equal(accessibleTracks.length, 5, 'los cinco carriles están en el árbol de accesibilidad');
    const combined = await page.evaluate(() => {
      document.getElementById('btn-toggle-spiders').click();
      const before = SpiderEngine.getStatus().spiders.map(s => [s.phase, s.scanIndex, s.sentenceId]);
      document.getElementById('btn-study-links').click();
      document.getElementById('btn-orbit').click();
      document.getElementById('btn-question').click();
      const modal = document.getElementById('question-dialog').open;
      window.stepAnimation(40);
      const after = SpiderEngine.getStatus().spiders.map(s => [s.phase, s.scanIndex, s.sentenceId]);
      const result = { before, after, modal,
        orbit: document.getElementById('btn-orbit').getAttribute('aria-pressed'),
        studyLinks: document.querySelectorAll('line[data-kind="study"]').length,
        graphNodes: document.querySelectorAll('#neural-svg .node-group').length };
      document.getElementById('question-cancel').click();
      document.getElementById('btn-toggle-spiders').click();
      for (let i = 0; i < 1000 && window.delivered.length < 5; i++) window.stepAnimation();
      document.getElementById('btn-toggle-spiders').click();
      result.delivered = window.delivered; return result;
    });
    assert.deepEqual(combined.before, combined.after, 'la pausa conserva las cinco lecturas');
    assert.equal(combined.modal, true);
    assert.equal(combined.orbit, 'true');
    assert.ok(combined.studyLinks > 0 && combined.graphNodes <= 48);
    assert.equal(new Set(combined.delivered.filter(id => active.claims.includes(id))).size, 5);
    await page.evaluate(() => NeuralStore.flush());
    await page.reload(); await page.waitForSelector('html[data-app-ready="true"]');
    const restored = await page.evaluate(() => {
      NeuralStore.setActiveDoc('lecturas', 1); window.stepAnimation(3);
      return { cards: NeuralStore.state.cards.map(card => card.selector.quote),
        marks: [...document.querySelectorAll('#doc-content mark')].map(mark => mark.textContent).join('') };
    });
    assert.deepEqual(restored.cards, ['valor distinto']); assert.equal(restored.marks, 'valor distinto');
    assert.deepEqual(errors, []);
  });
}
