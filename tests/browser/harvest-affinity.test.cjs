const test = require('node:test');
const assert = require('node:assert/strict');
const { openBrowser, boot, serve } = require('../support/browser.cjs');

for (const [name, viewport] of [['escritorio', { width: 1440, height: 900 }], ['móvil', { width: 390, height: 844 }]]) {
  test(`${name}: lecturas reales conectan citas afines, no fuerzan una ajena y sobreviven offline`, async t => {
    const { url, closeServer } = await serve(t);
    const context = await (await openBrowser(t)).newContext({ viewport, hasTouch: name === 'móvil', reducedMotion: 'reduce' });
    t.after(() => context.close());
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    context.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) external.push(r.url()); });
    await boot(page, url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(() => NeuralStore.setSetting('autoHarvest', false));
    const text = 'Las neuronas transmiten impulsos eléctricos mediante sinapsis. ' +
      'Las neuronas reciben impulsos eléctricos de otras células. ' +
      'Los volcanes liberan lava caliente durante una erupción.';
    await page.locator('#file-input').setInputFiles({ name: 'Biologia.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await page.waitForFunction(() => NeuralStore.state.allSentences.length === 3 && SpiderEngine.getStatus().paused);
    await page.evaluate(() => {
      window.affinityDeliveries = []; window.affinityExtractions = []; window.lastAffinityTarget = null;
      const position = NeuralGraph.getDeliveryScreenPos;
      NeuralGraph.getDeliveryScreenPos = id => {
        const point = position(id); if (point) window.lastAffinityTarget = { ...point }; return point;
      };
      NeuralStore.on('spider:extracted', event => { window.lastAffinityTarget = null; window.affinityExtractions.push(event); });
      NeuralStore.on('spider:delivered', event => {
        const spider = SpiderEngine.getStatus().spiders.find(s => s.id === event.spiderId);
        window.affinityDeliveries.push({ ...event, x: spider.x, y: spider.y, target: window.lastAffinityTarget });
        if (!SpiderEngine.getStatus().paused) document.getElementById('btn-toggle-spiders').click();
      });
    });
    const read = async index => {
      await page.locator('#doc-content .sentence-block').nth(index).locator('.word-span').first().click();
      await page.getByRole('button', { name: 'Reanudar enjambre' }).click();
      await page.waitForFunction(n => window.affinityDeliveries.length === n, index + 1);
    };
    await read(0); await read(1); await read(2);
    const outcome = await page.evaluate(() => ({
      deliveries: window.affinityDeliveries, extractions: window.affinityExtractions,
      nodes: NeuralStore.state.nodes.filter(n => !n.isHub).map(n => ({ id: n.id, label: n.label, ids: n.sentenceIds })),
      edges: NeuralStore.harvestEdges().map(e => ({ ...e })), stored: NeuralStore.state.links.filter(l => l.kind === 'affinity').length
    }));
    assert.equal(outcome.deliveries.length, 3); assert.ok(outcome.deliveries.every(e => e.fresh));
    assert.equal(outcome.deliveries[0].relatedNodeId, null);
    assert.equal(outcome.deliveries[1].relatedNodeId, outcome.nodes[0].id);
    assert.equal(outcome.extractions[1].relatedNodeId, outcome.nodes[0].id);
    const destination = outcome.deliveries[1];
    assert.ok(destination.target && Math.hypot(destination.x - destination.target.x, destination.y - destination.target.y) < .01,
      'la araña termina en el nodo afín que se proyecta realmente');
    assert.equal(outcome.deliveries[2].relatedNodeId, null);
    assert.equal(outcome.deliveries[2].target, null);
    assert.equal(outcome.edges.length, 1); assert.equal(outcome.stored, 0);
    assert.deepEqual([...outcome.edges[0].shared].sort(), ['electricos', 'impulsos', 'neuronas']);
    assert.match(outcome.nodes[0].label, /neuronas transmiten impulsos/i);
    assert.equal(await page.locator('line[data-kind="affinity"]').count(), 1);
    assert.match(await page.textContent('#harvest-affinity-guide'), /no relación demostrada/);

    // El inspector por teclado explica las palabras y permite abrir ambas citas.
    const index = await page.locator('g.node-group').evaluateAll((groups, id) => groups.findIndex(g => g.__data__.id === id), outcome.nodes[1].id);
    const node = page.locator('g.node-group').nth(index); await node.scrollIntoViewIfNeeded(); await node.focus(); await node.press('Enter');
    await page.locator('#insp-connections summary').click();
    const connection = page.locator('#insp-connection-list .affinity-connection');
    assert.match(await connection.innerText(), /Palabras afines: neuronas, impulsos, electricos/);
    const sources = connection.locator('.source-link');
    assert.equal(await sources.count(), 2);
    assert.match(await sources.first().innerText(), /^Esta cita:/);
    assert.match(await sources.last().innerText(), /^Cita vecina:/);
    assert.match(await sources.first().getAttribute('title'), /Las neuronas reciben impulsos eléctricos/);
    assert.match(await sources.last().getAttribute('title'), /Las neuronas transmiten impulsos eléctricos/);
    await sources.last().click();
    await page.waitForFunction(id => [...document.querySelectorAll('#doc-content .sentence-block')].some(n => n.dataset.sid === id && n.classList.contains('sentence-active')), outcome.nodes[0].ids[0]);
    await page.click('#btn-close-inspector');
    await page.locator('#btn-orbit').scrollIntoViewIfNeeded(); await page.click('#btn-orbit');
    assert.equal(await page.getAttribute('#btn-orbit', 'aria-pressed'), 'true');
    const before = await node.getAttribute('transform'); await page.click('[data-orbit-key="ArrowLeft"]');
    await page.waitForFunction(([id, transform]) => {
      const n = [...document.querySelectorAll('g.node-group')].find(g => g.__data__.id === id);
      return n && n.getAttribute('transform') !== transform;
    }, [outcome.nodes[1].id, before]);
    assert.equal(await page.locator('line[data-kind="affinity"]').count(), 1);

    const backup = await page.evaluate(async () => { await NeuralStore.flush(); return NeuralStore.exportBrain(); });
    await closeServer(); await context.setOffline(true); await boot(page, url);
    await page.waitForSelector('line[data-kind="affinity"]');
    assert.equal(await page.evaluate(() => NeuralStore.harvestEdges().length), 1);
    assert.equal(await page.locator('#doc-content .sentence-harvested').count(), 3);
    await page.getByRole('button', { name: 'Quitar documento Biologia.txt' }).click();
    assert.equal(await page.evaluate(() => NeuralStore.harvestEdges().length), 0);
    assert.equal(await page.locator('line[data-kind="affinity"]').count(), 0);
    await page.evaluate(data => NeuralStore.importBrain(data), backup);
    await page.waitForSelector('line[data-kind="affinity"]');
    assert.equal(await page.evaluate(() => NeuralStore.harvestEdges().length), 1);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
  });
}

test('MiniLM real: la agrupación semántica y su restauración offline conservan la afinidad entre citas', async t => {
  const { url, closeServer } = await serve(t);
  const context = await (await openBrowser(t)).newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  context.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(url)) external.push(r.url()); });
  await boot(page, url); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(() => {
    const S = NeuralStore; S.setSetting('autoHarvest', false);
    const sentences = [
      { id: 'sem-a', text: 'Las neuronas transmiten impulsos eléctricos mediante sinapsis.' },
      { id: 'sem-b', text: 'Las neuronas reciben impulsos eléctricos de otras células.' },
      { id: 'sem-c', text: 'Los volcanes liberan lava caliente durante una erupción.' },
      { id: 'sem-d', text: 'Las neuronas propagan impulsos eléctricos entre células.' }
    ];
    S.addDocument({ id: 'sem-doc', name: 'citas.txt', pages: sentences.map((s, i) => ({ pageNum: i + 1, text: s.text, sentences: [s] })) });
    for (const id of ['sem-a', 'sem-b', 'sem-c']) {
      const s = S.getSentence(id);
      S.addPattern({ cluster: 'AGT-01', label: NCHarvestLinks.label(s.sourceText), text: s.text, pageNum: s.pageNum, sentenceId: id });
    }
  });
  assert.equal(await page.evaluate(() => NeuralStore.harvestEdges().length), 1);
  await page.click('#btn-model'); await page.click('#btn-install-model');
  await page.waitForFunction(() => ['ready', 'error'].includes(NCLocalModel.info().status), null, { timeout: 120000 });
  const info = await page.evaluate(() => NCLocalModel.info());
  assert.equal(info.status, 'ready', info.message); assert.equal(info.indexed, 4);
  await page.waitForFunction(() => NCSemantic.info().active && document.getElementById('graph-grouping').textContent.includes('TEMAS MINILM'), null, { timeout: 30000 });
  const affinity = () => page.locator('line[data-kind="affinity"]');
  assert.equal(await affinity().count(), 1);
  const evidence = await affinity().evaluate(line => [line.__data__.sourceSentenceId, line.__data__.targetSentenceId].sort());
  assert.deepEqual(evidence, ['sem-a', 'sem-b']);
  assert.equal(await page.evaluate(() => NeuralStore.harvestEdges().length), 1, 'un tema común no añade relaciones por sí solo');
  await page.click('#btn-close-model'); await page.click('#btn-orbit');
  assert.equal(await affinity().count(), 1);

  // Una lectura y entrega reales con MiniLM activo y la cámara girada.
  await page.click('[data-orbit-key="ArrowLeft"]');
  await page.evaluate(() => {
    const S = NeuralStore, position = NeuralGraph.getDeliveryScreenPos;
    window.semanticDelivery = null; window.semanticTarget = null; window.semanticExtraction = null;
    NeuralGraph.getDeliveryScreenPos = id => {
      const p = position(id); if (p) window.semanticTarget = { ...p }; return p;
    };
    S.on('spider:extracted', event => { if (event.sentenceId === 'sem-d') window.semanticExtraction = event; });
    S.on('spider:delivered', event => {
      if (event.sentenceId !== 'sem-d') return;
      const spider = SpiderEngine.getStatus().spiders.find(s => s.id === event.spiderId);
      window.semanticDelivery = { ...event, x: spider.x, y: spider.y, target: window.semanticTarget };
      if (!SpiderEngine.getStatus().paused) document.getElementById('btn-toggle-spiders').click();
    });
    S.setActivePage(4);
  });
  await page.locator('#doc-content .sentence-block .word-span').first().click();
  await page.getByRole('button', { name: 'Reanudar enjambre' }).click();
  await page.waitForFunction(() => !!window.semanticDelivery);
  const delivered = await page.evaluate(() => ({ delivery: window.semanticDelivery, extraction: window.semanticExtraction,
    neighbor: NeuralStore.state.nodes.find(n => n.id === window.semanticDelivery.relatedNodeId)?.sentenceIds }));
  assert.ok(delivered.delivery.fresh && delivered.delivery.relatedNodeId);
  assert.equal(delivered.extraction.relatedNodeId, delivered.delivery.relatedNodeId);
  assert.ok(delivered.neighbor.some(id => ['sem-a', 'sem-b'].includes(id)));
  assert.ok(delivered.delivery.target && Math.hypot(delivered.delivery.x - delivered.delivery.target.x,
    delivered.delivery.y - delivered.delivery.target.y) < .01, 'la entrega termina en el vecino proyectado en órbita');
  const edgePairs = () => affinity().evaluateAll(lines => lines.map(line =>
    [line.__data__.sourceSentenceId, line.__data__.targetSentenceId].sort().join(':')).sort());
  const beforeOffline = await edgePairs();
  assert.ok(beforeOffline.includes('sem-a:sem-b'));
  assert.ok(beforeOffline.some(pair => pair.includes('sem-d')));
  assert.ok(beforeOffline.every(pair => !pair.includes('sem-c')));
  await page.evaluate(() => NeuralStore.flush());
  await closeServer(); await context.setOffline(true); await boot(page, url);
  await page.waitForFunction(() => ['ready', 'error'].includes(NCLocalModel.info().status), null, { timeout: 120000 });
  const restored = await page.evaluate(() => NCLocalModel.info());
  assert.equal(restored.status, 'ready', restored.message); assert.equal(restored.indexed, 4);
  await page.waitForFunction(() => NCSemantic.info().active && document.getElementById('graph-grouping').textContent.includes('TEMAS MINILM'), null, { timeout: 30000 });
  assert.deepEqual(await edgePairs(), beforeOffline);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
