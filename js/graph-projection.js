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
    const visible = hubs.concat(selected), ids = new Set(visible.map(n => n.id));
    const matchingLinks = (links || []).filter(link => ids.has(idOf(link.source)) && ids.has(idOf(link.target)));
    // Priorizar relaciones hacia los hubs hace legible la muestra; el inspector
    // permite recorrer TODAS las relaciones originales, incluso fuera de página.
    const hubIds = new Set(hubs.map(n => n.id));
    matchingLinks.sort((a, b) => Number(hubIds.has(idOf(b.source)) || hubIds.has(idOf(b.target))) -
      Number(hubIds.has(idOf(a.source)) || hubIds.has(idOf(a.target))));
    return { nodes: visible, links: matchingLinks.slice(0, edgeLimit), eligible, page, pages, limit,
      total: concepts.length, filtered: eligible.length, start: selected.length ? from + 1 : 0,
      end: from + selected.length, matchingLinks: matchingLinks.length };
  }

  return { project };
});
