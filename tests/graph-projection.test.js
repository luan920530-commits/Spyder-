const test = require('node:test');
const assert = require('node:assert/strict');
const { project } = require('../js/graph-projection');

test('20.000 conceptos permanecen explorables en páginas acotadas, sin alterar el grafo', () => {
  const hubs = [{ id: 'AGT-01', isHub: true }, { id: 'AGT-02', isHub: true }];
  const nodes = hubs.concat(Array.from({ length: 20000 }, (_, i) => ({
    id: `n${i}`, label: `Concepto ${i}`, text: `Fuente número ${i}`,
    cluster: i % 2 ? 'AGT-01' : 'AGT-02', sentenceIds: [`s${i}`]
  })));
  const links = nodes.slice(2).map(n => ({ source: n.cluster, target: n.id, kind: 'hierarchy' }));
  const savedNodes = nodes.slice(), savedLinks = links.slice();
  const seen = new Set();
  for (let page = 0; page < 500; page++) {
    const view = project(nodes, links, { page, limit: 40, edgeLimit: 90 });
    assert.equal(view.nodes.length, 42); assert.ok(view.links.length <= 90);
    view.nodes.filter(n => !n.isHub).forEach(n => seen.add(n.id));
  }
  assert.equal(seen.size, 20000);
  assert.deepEqual(nodes, savedNodes); assert.deepEqual(links, savedLinks);
  const filtered = project(nodes, links, { cluster: 'AGT-02', page: 249, limit: 40 });
  assert.equal(filtered.filtered, 10000); assert.equal(filtered.page, 249);
  assert.ok(filtered.nodes.filter(n => !n.isHub).every(n => n.cluster === 'AGT-02'));
  const searched = project(nodes, links, { query: 'CONCEPTO 19999', limit: 24 });
  assert.equal(searched.filtered, 1); assert.equal(searched.nodes.at(-1).id, 'n19999');
  assert.deepEqual(searched.nodes.at(-1).sentenceIds, ['s19999']);
  const beyond = project(nodes, links, { page: 999999, limit: 40 });
  assert.equal(beyond.page, 499); assert.equal(beyond.end, 20000);
});

test('limita conexiones densas y admite extremos D3 sin tocar las relaciones originales', () => {
  const nodes = [{ id: 'hub', isHub: true }, ...Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, cluster: 'A', label: `N ${i}` }))];
  const links = [];
  for (const n of nodes.slice(1)) {
    links.push({ source: { id: 'hub' }, target: n.id, kind: 'hierarchy' });
    for (const other of nodes.slice(1)) if (n !== other) links.push({ source: n, target: other, kind: 'synaptic' });
  }
  const view = project(nodes, links, { limit: 40, edgeLimit: 20, cluster: 'A' });
  assert.equal(view.nodes.length, 16);
  assert.equal(view.links.length, 20); assert.ok(view.matchingLinks > view.links.length);
  assert.equal(view.links.filter(l => l.kind === 'hierarchy').length, 15);
  assert.ok(links.length > 200);
});

test('temas semánticos y texto filtran antes de paginar; no crean citas', () => {
  const nodes = [{ id: 'SEM-1', isHub: true }, { id: 'SEM-2', isHub: true }, ...Array.from({ length: 60 }, (_, i) => ({
    id: `id-${i}`, label: i === 59 ? 'Ácido nucleico' : `Tema ${i}`, topicId: i % 2 ? 'SEM-1' : 'SEM-2', sentenceIds: [`sentence-${i}`]
  }))];
  const result = project(nodes, [], { limit: 24, semantic: true, cluster: 'SEM-1', query: 'acido' });
  assert.equal(result.filtered, 1); assert.equal(result.nodes.at(-1).id, 'id-59');
  assert.deepEqual(result.nodes.at(-1).sentenceIds, ['sentence-59']);
  assert.equal(project(nodes, [], { query: 'sin coincidencias' }).start, 0);
});
