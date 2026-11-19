/** Modelo local de utilidad de un par de pasajes. Un clasificador logístico por libro. */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./util.js') : root.NCUtil);
  if (node) module.exports = api;
  root.NCPassageLinks = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';
  const MAX_VOTES = 256, INITIAL = [-.65, 2.2, .16, .12];
  const predict = (w, x) => 1 / (1 + Math.exp(-x.reduce((v, xi, i) => v + xi * w[i], 0)));
  const key = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
  function example(v) {
    if (!v || ![v.docId, v.a, v.b].every(s => typeof s === 'string' && s.length > 0) || v.a === v.b || typeof v.useful !== 'boolean') return null;
    const { docId, a, b, useful } = v;
    return a < b ? { docId, a, b, useful } : { docId, a: b, b: a, useful };
  }
  function restoreVotes(rows, valid = () => true, strict = false) {
    const unique = new Map();
    for (const row of rows.slice(-MAX_VOTES)) {
      const v = example(row);
      if (!v || !valid(v)) {
        if (strict) throw new Error('Respaldo inválido: valoraciones de vínculos');
        continue;
      }
      const id = JSON.stringify([v.docId, v.a, v.b]); unique.delete(id); unique.set(id, v);
    }
    return [...unique.values()];
  }
  function create(doc, votes = []) {
    const sources = new Map(), postings = new Map(), labels = new Map();
    let weights = INITIAL.slice();
    doc.pages.forEach((page, i) => page.sentences.forEach(s => {
      // Solo la oración original. Dos ventanas de búsqueda solapadas no son evidencia de una relación.
      const terms = new Map();
      for (const word of U.words(s.text.slice(0, 3000))) {
        if (word.length < 3 || U.isStopword(word)) continue;
        const stem = U.stem(word);
        if (stem.length < 2 || terms.has(stem)) continue;
        terms.set(stem, word);
        if (!postings.has(stem)) postings.set(stem, []);
        postings.get(stem).push(s.id);
        if (terms.size === 48) break;
      }
      sources.set(s.id, { terms, page: s.sourcePage ?? page.sourcePage ?? i + 1, section: s.section || page.section || '', order: sources.size, text: s.text });
    }));
    function features(a, b) {
      if (!a || !b || a === b || a.text === b.text) return null;
      const shared = [];
      for (const [stem, word] of a.terms) if (b.terms.has(stem)) shared.push(word);
      if (!shared.length) return null; // ni proximidad ni feedback crean citas sin evidencia
      const overlap = shared.length / Math.sqrt(a.terms.size * b.terms.size);
      return { x: [1, overlap, a.page === b.page ? 1 : -1, !a.section || !b.section ? 0 : a.section === b.section ? 1 : -1], shared };
    }
    function fit(examples) {
      // Reproducible tras recarga y reversible al corregir un voto. Solo cuatro
      // parámetros compartidos: ningún peso está indexado por ID del par.
      weights = INITIAL.slice(); labels.clear();
      for (const v of examples) {
        if (v.docId !== doc.id) continue;
        const f = features(sources.get(v.a), sources.get(v.b));
        if (!f) continue;
        labels.set(key(v.a, v.b), v.useful);
        const error = Number(v.useful) - predict(weights, f.x);
        weights = weights.map((w, j) => Math.max(-4, Math.min(4, w + .65 * error * f.x[j])));
      }
    }
    function pair(id, other) {
      const f = features(sources.get(id), sources.get(other));
      return f && { id: other, score: predict(weights, f.x), shared: f.shared.slice(0, 3), vote: labels.get(key(id, other)) ?? null };
    }
    function suggest(id, limit = 3) {
      const source = sources.get(id);
      if (!source) return [];
      // Consultar las listas de hasta ocho términos (raros primero); nunca
      // construir una matriz N × N, ni recorrer un libro entero por clic.
      const candidates = new Set();
      [...source.terms.keys()].sort((a, b) => postings.get(a).length - postings.get(b).length).slice(0, 8).forEach(term => {
        for (const other of U.sampleEvenly(postings.get(term), 24)) if (other !== id) candidates.add(other);
      });
      return [...candidates].map(other => pair(id, other)).filter(Boolean)
        .sort((a, b) => b.score - a.score || sources.get(a.id).order - sources.get(b.id).order).slice(0, limit);
    }
    fit(votes);
    return { fit, pair, suggest, info: () => ({ weights: weights.slice(), examples: labels.size }) };
  }
  return { create, example, restoreVotes, MAX_VOTES };
});
