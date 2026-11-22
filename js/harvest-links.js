/** Afinidades explicables entre cosechas; índice derivado, local y acotado. */
(function (root, factory) {
  const U = typeof module !== 'undefined' && module.exports ? require('./util.js') : root.NCUtil;
  const api = factory(U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCHarvestLinks = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';

  // Se compara la oración citada, no las ventanas solapadas ni el nombre del
  // documento. Las cotas evitan comparar cada cosecha con el corpus completo.
  const MAX_TERMS = 32, QUERY_TERMS = 12, POSTING_SAMPLE = 32, MAX_ANCHORS = 8, MAX_LINKS = 3;
  const MIN_SHARED = 2, MIN_SCORE = .18;
  const pairKey = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
  const edgeKey = (a, b) => 'affinity:' + pairKey(a, b);

  function describe(sentence) {
    const text = String(typeof sentence?.sourceText === 'string' ? sentence.sourceText : sentence?.text || '').slice(0, 4000);
    const { raw, stems } = U.analyze(text), terms = new Map();
    for (let i = 0; i < raw.length && terms.size < MAX_TERMS; i++) {
      const word = raw[i], stem = stems[i];
      if (word.length < 3 || !stem || stem.length < 3 || /\d/.test(word)) continue;
      if (!terms.has(stem)) terms.set(stem, word);
    }
    return { sentenceId: sentence?.id, terms };
  }

  function compare(a, b) {
    if (!a || !b || !a.sentenceId || a.sentenceId === b.sentenceId) return null;
    const shared = [];
    for (const [stem, word] of a.terms) if (b.terms.has(stem)) {
      const other = b.terms.get(stem);
      shared.push(word === other ? word : `${word} / ${other}`);
    }
    if (shared.length < MIN_SHARED) return null;
    const score = 2 * shared.length / (a.terms.size + b.terms.size);
    if (score < MIN_SCORE) return null;
    return { score: Math.round(score * 1000) / 1000, shared: shared.slice(0, 8), sharedCount: shared.length };
  }

  // Una etiqueta literal con palabras informativas es más útil que las tres
  // primeras palabras, que a menudo son «El sistema de». No resume ni inventa.
  function label(text) {
    const source = String(text || '').trim(), words = [];
    for (const word of source.matchAll(/\S+/g)) { words.push(word); if (words.length >= 80) break; }
    if (!words.length) return '';
    let best = null;
    for (let i = 0; i < words.length; i++) {
      const end = Math.min(words.length, i + 3), slice = words.slice(i, end);
      const terms = U.tokens(slice.map(w => w[0]).join(' ')).filter(t => t.length >= 3 && !/\d/.test(t));
      if (!terms.length) continue;
      const score = new Set(terms).size + (end - i === 3 ? .05 : 0) - i * .0001;
      if (!best || score > best.score) best = { start: words[i].index, end: words[end - 1].index + words[end - 1][0].length, score };
    }
    return (best ? source.slice(best.start, best.end) : words.slice(0, 3).map(w => w[0]).join(' ')).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  }

  function sample(items, max) {
    if (items.length <= max) return items;
    // Mezcla muestras repartidas con las más recientes: no se ignora siempre
    // el principio de un libro largo ni las últimas entregas del enjambre.
    const selected = new Set();
    const recent = Math.floor(max / 2), spread = max - recent;
    for (let i = 0; i < spread; i++) selected.add(items[Math.floor(i * (items.length - recent - 1) / Math.max(1, spread - 1))]);
    for (let i = items.length - recent; i < items.length; i++) selected.add(items[i]);
    return [...selected];
  }

  function create(getSentence, rejected = () => false) {
    const postings = new Map(), entriesByNode = new Map(), indexed = new Set();
    const edges = [], adjacency = new Map(), edgeKeys = new Set();

    function candidates(entry, excludeNode) {
      if (!entry || entry.terms.size < MIN_SHARED) return [];
      const possible = new Set();
      const query = [...entry.terms.keys()].filter(term => postings.has(term))
        .sort((a, b) => postings.get(a).length - postings.get(b).length || a.localeCompare(b)).slice(0, QUERY_TERMS);
      for (const term of query) for (const other of sample(postings.get(term), POSTING_SAMPLE)) possible.add(other);
      const best = new Map();
      for (const other of possible) {
        if (other.nodeId === excludeNode || rejected(entry.sentenceId, other.sentenceId)) continue;
        const result = compare(entry, other);
        if (!result) continue;
        const match = { ...result, nodeId: other.nodeId, sentenceId: other.sentenceId, sourceSentenceId: entry.sentenceId };
        const old = best.get(other.nodeId);
        if (!old || match.score > old.score || (match.score === old.score && match.sharedCount > old.sharedCount)) best.set(other.nodeId, match);
      }
      return [...best.values()].sort((a, b) => b.score - a.score || b.sharedCount - a.sharedCount ||
        a.sentenceId.localeCompare(b.sentenceId) || a.nodeId.localeCompare(b.nodeId));
    }

    function suggest(sentenceId, limit = MAX_LINKS) {
      const sentence = getSentence(sentenceId);
      return sentence ? candidates(describe(sentence)).slice(0, Math.max(0, Math.min(12, limit))) : [];
    }
    function validTarget(sentenceId, nodeId, targetId) {
      const source = getSentence(sentenceId), target = getSentence(targetId);
      const entry = (entriesByNode.get(nodeId) || []).find(e => e.sentenceId === targetId);
      return !!(source && target && entry && !rejected(sentenceId, targetId) && compare(describe(source), entry));
    }
    function add(node, preferred) {
      if (!node || node.isHub || !node.id || indexed.has(node.id)) return [];
      indexed.add(node.id);
      const ids = [...new Set(Array.isArray(node.sentenceIds) ? node.sentenceIds : [])].filter(id => getSentence(id));
      const entries = sample(ids, MAX_ANCHORS).map(id => ({ ...describe(getSentence(id)), nodeId: node.id }));
      const best = new Map();
      for (const entry of entries) for (const match of candidates(entry, node.id)) {
        const previous = best.get(match.nodeId);
        if (!previous || match.score > previous.score) best.set(match.nodeId, match);
      }
      // La araña ya pudo elegir un vecino antes de terminar el viaje. Se
      // comprueba otra vez contra ambas fuentes vivas y el voto del usuario.
      let chosen = null;
      if (preferred?.nodeId && preferred?.sentenceId) {
        const other = (entriesByNode.get(preferred.nodeId) || []).find(e => e.sentenceId === preferred.sentenceId);
        for (const entry of entries) {
          if (!other || rejected(entry.sentenceId, other.sentenceId)) continue;
          const result = compare(entry, other);
          if (result && (!chosen || result.score > chosen.score)) chosen = { ...result, nodeId: other.nodeId,
            sentenceId: other.sentenceId, sourceSentenceId: entry.sentenceId };
        }
      }
      const ordered = [...best.values()].sort((a, b) => b.score - a.score || b.sharedCount - a.sharedCount ||
        a.sentenceId.localeCompare(b.sentenceId) || a.nodeId.localeCompare(b.nodeId));
      const matches = chosen ? [chosen, ...ordered.filter(m => m.nodeId !== chosen.nodeId)] : ordered;
      const added = [];
      for (const match of matches.slice(0, MAX_LINKS)) {
        const key = edgeKey(node.id, match.nodeId);
        if (edgeKeys.has(key)) continue;
        const edge = { key, kind: 'affinity', source: node.id, target: match.nodeId, score: match.score,
          shared: match.shared, sourceSentenceId: match.sourceSentenceId, targetSentenceId: match.sentenceId };
        edgeKeys.add(key); edges.push(edge); added.push(edge);
        for (const id of [edge.source, edge.target]) {
          if (!adjacency.has(id)) adjacency.set(id, []);
          adjacency.get(id).push(edge);
        }
      }
      entriesByNode.set(node.id, entries);
      for (const entry of entries) for (const term of entry.terms.keys()) {
        if (!postings.has(term)) postings.set(term, []);
        postings.get(term).push(entry);
      }
      return added;
    }
    return { add, suggest, validTarget, edges: () => edges, connections: id => adjacency.get(id) || [],
      size: () => indexed.size };
  }
  return { create, compare, describe, label, pairKey, MAX_TERMS, QUERY_TERMS, POSTING_SAMPLE, MAX_ANCHORS, MAX_LINKS, MIN_SCORE };
});
