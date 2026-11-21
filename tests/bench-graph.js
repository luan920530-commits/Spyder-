#!/usr/bin/env node
// Comparación sintética de proyección y fuerzas D3; no incluye DOM ni pintura.
const U = require('../js/util');
const { project } = require('../js/graph-projection');
const d3 = require('../vendor/d3/d3.min.js');
const requested = Number(process.argv[2] || 20000);
if (!Number.isInteger(requested) || requested < 1 || requested > 100000) {
  throw new Error('Indica entre 1 y 100000 conceptos.');
}
const hubs = Array.from({ length: 4 }, (_, i) => ({ id: `AGT-0${i + 1}`, isHub: true,
  x: 100 + i * 100, y: 180, fx: 100 + i * 100, fy: 180 }));
const nodes = hubs.concat(Array.from({ length: requested }, (_, i) => ({
  id: `n${i}`, cluster: hubs[i % 4].id, label: `Concepto ${i}`,
  text: `Texto sintético de referencia ${i}`, sentenceIds: [`s${i}`]
})));
const links = nodes.slice(4).map(node => ({ source: node.cluster, target: node.id, kind: 'hierarchy' }));
const projectionTimes = [];
let view;
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  view = project(nodes, links, { limit: 40, edgeLimit: 90, page: i % Math.ceil(requested / 40) });
  if (i >= 10) projectionTimes.push(performance.now() - start);
}

// D3 muta sus datos, como en la aplicación: trabajar siempre sobre copias.
function forceTime(sourceNodes, sourceLinks) {
  const start = performance.now();
  const copies = sourceNodes.map(node => ({ ...node }));
  const edges = sourceLinks.map(link => ({ ...link }));
  const simulation = d3.forceSimulation(copies).stop()
    .force('link', d3.forceLink(edges).id(node => node.id).distance(62).strength(.35))
    .force('charge', d3.forceManyBody().strength(-90))
    .force('collide', d3.forceCollide().radius(node => node.isHub ? 26 : 18))
    .force('center', d3.forceCenter(300, 200).strength(.06));
  simulation.tick(8);
  return performance.now() - start;
}
forceTime(view.nodes, view.links); // calentamiento
const visibleForces = Array.from({ length: 5 }, () => forceTime(view.nodes, view.links));
const fullForce = forceTime(nodes, links);
const round = n => +n.toFixed(2);
console.log(JSON.stringify({
  concepts: requested,
  storedNodes: nodes.length,
  storedLinks: links.length,
  shownNodes: view.nodes.length,
  shownLinks: view.links.length,
  projectionMs: { samples: projectionTimes.length, p50: round(U.percentile(projectionTimes, 50)), p95: round(U.percentile(projectionTimes, 95)) },
  forceSetupAnd8TicksMs: { visibleP50: round(U.percentile(visibleForces, 50)), fullOnce: round(fullForce) },
  note: 'Datos sintéticos en Node; fuerzas sin DOM, pintura ni ingesta. El resultado depende del equipo.'
}, null, 2));
