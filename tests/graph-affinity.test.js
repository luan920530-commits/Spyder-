const test = require('node:test');
const assert = require('node:assert/strict');
const { project } = require('../js/graph-projection');

test('las afinidades visibles tienen prioridad sobre aristas auxiliares y las anclas recientes no cambian la paginación', () => {
  const hubs = [{ id: 'h', isHub: true }];
  const nodes = hubs.concat(Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, cluster: 'A', label: `N ${i}` })));
  const links = nodes.slice(1).map(n => ({ source: 'h', target: n.id, kind: 'hierarchy' }));
  links.push({ source: 'n0', target: 'n1', kind: 'synaptic' });
  links.push({ source: 'n0', target: 'n1', kind: 'affinity', score: .6 });
  links.push({ source: 'n98', target: 'n99', kind: 'affinity', score: .8 });
  const view = project(nodes, links, { limit: 4, edgeLimit: 6, page: 0, pins: ['n98', 'n99'] });
  assert.equal(view.pinned, 2);
  assert.deepEqual([view.start, view.end, view.filtered, view.pages], [1, 4, 100, 25]);
  assert.deepEqual(view.nodes.slice(-2).map(n => n.id), ['n98', 'n99']);
  assert.ok(view.links.some(l => l.kind === 'affinity'));
  assert.equal(view.links.length, 6);
  assert.equal(links.length, 103, 'la proyección no altera el grafo');
  const narrow = project(nodes, links, { limit: 4, edgeLimit: 2 });
  assert.ok(narrow.links.some(l => l.kind === 'affinity'), 'reservar al menos un hilo cuando el límite es pequeño');
  const recent = project(nodes, links, { limit: 4, edgeLimit: 1, pins: ['n98', 'n99'], affinityPair: ['n99', 'n98'] });
  assert.equal(recent.links.length, 1);
  assert.deepEqual([recent.links[0].source, recent.links[0].target, recent.links[0].kind], ['n98', 'n99', 'affinity'],
    'la última pareja visible tiene prioridad incluso con un límite muy estricto');
  const filter = project(nodes, links, { limit: 4, query: 'N 0', pins: ['n99'] });
  assert.equal(filter.pinned, 0, 'una entrega no viola una búsqueda explícita');
  assert.equal(filter.nodes.length, 2);
  const capped = project(nodes, links, { limit: 4, pins: Array.from({ length: 50 }, (_, i) => `n${i + 10}`) });
  assert.equal(capped.pinned, 7);
});
