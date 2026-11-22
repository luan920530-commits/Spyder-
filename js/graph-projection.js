/** Proyección acotada y reversible del grafo: nunca modifica el almacenamiento. */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined') ? require('./util.js') : root.NCUtil;
  const api = factory(U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCGraphProjection = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';

  const idOf = endpoint => typeof endpoint === 'object' && endpoint ? endpoint.id : endpoint;

  function project(nodes, links, options = {}) {
    const all = nodes || [], hubs = all.filter(n => n.isHub), concepts = all.filter(n => !n.isHub);
    const limit = Math.max(1, Math.floor(options.limit || 40));
    const edgeLimit = Math.max(0, Math.floor(options.edgeLimit == null ? 100 : options.edgeLimit));
    const query = U.normalize(options.query || '').trim();
    // En redes pequeñas se conserva el atenuado histórico; en redes grandes el
    // filtro reduce la muestra ANTES de paginar para que cada grupo sea accesible.
    const filter = options.cluster && (concepts.length > limit || query) ? options.cluster : null;
    const eligible = concepts.filter(node => {
      if (filter && (options.semantic ? node.topicId : node.cluster) !== filter) return false;
      if (!query) return true;
      return U.normalize([node.label, node.text, node.section, node.topicLabel].filter(Boolean).join(' ')).includes(query);
    });
    const pages = Math.max(1, Math.ceil(eligible.length / limit));
    const page = Math.max(0, Math.min(pages - 1, Math.floor(options.page || 0)));
    const from = page * limit, selected = eligible.slice(from, from + limit);
    // Hasta siete nodos reales de entregas activas o recientes pueden acompañar
    // la página sin desplazarla ni alterar sus totales. El filtro sigue vigente.
    const ids = new Set(hubs.concat(selected).map(n => n.id));
    const requested = new Set((options.pins || []).slice(0, 7)), pinned = [];
    if (requested.size) for (const node of eligible) {
      if (requested.has(node.id) && !ids.has(node.id)) { pinned.push(node); ids.add(node.id); }
    }
    const visible = hubs.concat(selected, pinned);
    const matchingLinks = (links || []).filter(link => ids.has(idOf(link.source)) && ids.has(idOf(link.target)));
    const hubIds = new Set(hubs.map(n => n.id));
    const pair = options.affinityPair;
    const priority = l => {
      const a = idOf(l.source), b = idOf(l.target);
      if (l.kind === 'affinity' && pair?.length === 2 &&
          ((a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]))) return 3;
      return hubIds.has(a) || hubIds.has(b) ? 2 : l.kind === 'affinity' ? 1 : 0;
    };
    matchingLinks.sort((a, b) => priority(b) - priority(a) || (Number(b.score) || 0) - (Number(a.score) || 0));
    const shownLinks = matchingLinks.slice(0, edgeLimit);
    // Si hay muy poco espacio no dejar invisibles todas las afinidades.
    const affinity = matchingLinks.find(l => l.kind === 'affinity');
    if (edgeLimit && affinity && !shownLinks.includes(affinity)) shownLinks[shownLinks.length - 1] = affinity;
    return { nodes: visible, links: shownLinks, eligible, page, pages, limit, pinned: pinned.length,
      total: concepts.length, filtered: eligible.length, start: selected.length ? from + 1 : 0,
      end: from + selected.length, matchingLinks: matchingLinks.length };
  }

  return { project };
});
