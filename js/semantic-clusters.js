/** Temas aproximados a partir de cosenos MiniLM. Los roles de las arañas son independientes. */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined') ? require('./util.js') : root.NCUtil;
  const api = factory(U, root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCSemantic = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U, root) {
  'use strict';
  const COLORS = ['#38dcff', '#a78bfa', '#f5aa3c', '#34e696'];
  const OTHER = 'SEM-OTHER';

  /**
   * Agrupación incremental determinista por similitud al centroide. La cantidad
   * de temas está acotada para el panel; si ninguno se parece lo suficiente,
   * el pasaje queda sin grupo, en lugar de fingir afinidad. Es una heurística,
   * no etiquetas humanas ni una garantía de calidad semántica.
   */
  function createClusterer(options) {
    const o = Object.assign({ maxTopics: 4, newThreshold: .64, minSimilarity: .35 }, options || {});
    let topics = [], assignments = new Map(), dimensions = 0, other = 0;
    function clear() { topics = []; assignments = new Map(); dimensions = 0; other = 0; }
    function add(id, vector, text) {
      if (!id || assignments.has(id) || !vector || !vector.length || (dimensions && dimensions !== vector.length)) return false;
      let norm = 0;
      for (const value of vector) { if (!Number.isFinite(value)) return false; norm += value * value; }
      if (!norm) return false;
      norm = Math.sqrt(norm); dimensions = vector.length;
      let best = null, similarity = -Infinity;
      for (const topic of topics) {
        const score = U.cosine(vector, topic.sum);
        if (score > similarity) { best = topic; similarity = score; }
      }
      if ((!best || similarity < o.newThreshold) && topics.length < o.maxTopics) {
        const number = topics.length + 1;
        best = { id: `SEM-${number}`, number, color: COLORS[(number - 1) % COLORS.length],
          sum: new Float64Array(dimensions), count: 0, terms: new Map() };
        topics.push(best);
      } else if (similarity < o.minSimilarity) {
        assignments.set(id, OTHER); other++; return true;
      }
      assignments.set(id, best.id); best.count++;
      for (let i = 0; i < dimensions; i++) best.sum[i] += vector[i] / norm;
      // Los nombres son pistas léxicas, no etiquetas generadas por el modelo.
      const analyzed = U.analyze(text || '');
      const seen = new Set();
      analyzed.raw.slice(0, 100).forEach((word, i) => {
        const key = analyzed.stems[i];
        if (word.length < 4 || seen.has(key)) return;
        seen.add(key);
        const entry = best.terms.get(key);
        if (entry) entry.count++;
        else if (best.terms.size < 300) best.terms.set(key, { word, count: 1 });
      });
      return true;
    }
    function list() {
      const out = topics.map(t => {
        const words = [...t.terms.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, 2).map(x => x.word);
        return { id: t.id, number: t.number, color: t.color, count: t.count,
          label: `Tema ${t.number}` + (words.length ? ` · ${words.join(' / ')}` : '') };
      });
      if (other) out.push({ id: OTHER, number: 0, color: '#94a3b8', count: other, label: 'Sin grupo afín' });
      return out;
    }
    return { add, clear, list, topicId: id => assignments.get(id) || null, size: () => assignments.size };
  }

  const clusterer = createClusterer();
  const store = () => root.NeuralStore;
  const model = () => root.NCLocalModel;
  let initialized = false, epoch = 0, rebuilding = false, deferred = new Set(), timer = null;

  function usable() { return !!(model()?.info().enabled && store()?.getSetting('embedEnabled', true)); }
  function info() {
    const modelInfo = model()?.info() || {};
    return { active: usable() && clusterer.size() > 0, indexed: clusterer.size(),
      total: store()?.state.index?.sentences.length || 0, modelEnabled: !!modelInfo.enabled,
      indexing: modelInfo.status === 'indexing' || rebuilding };
  }
  function notify() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; store()?.emit('semantic:updated', info()); }, 100);
  }
  function ingest(entries) {
    const index = store()?.state.index;
    if (!index || !usable()) return;
    for (const entry of entries) {
      const pos = index.posById.get(entry.id), sentence = pos == null ? null : index.sentences[pos];
      if (sentence) clusterer.add(entry.id, entry.vector, sentence.sourceText || sentence.text);
    }
    if (entries.length) notify();
  }
  function clear() {
    epoch++; rebuilding = false; deferred.clear(); clusterer.clear(); notify();
  }
  function rebuild() {
    const token = ++epoch;
    clusterer.clear(); deferred.clear(); rebuilding = false;
    if (!usable() || !model()?.vectorSnapshot) { notify(); return; }
    // Recorrer en lotes cede el hilo principal y no copia todo el corpus a la vez.
    const ids = store().state.index.sentences.map(sentence => sentence.id);
    let cursor = 0; rebuilding = true; notify();
    function step() {
      if (token !== epoch || !usable()) return;
      ingest(model().vectorSnapshot(ids.slice(cursor, cursor + 128))); cursor += 128;
      if (cursor < ids.length) { setTimeout(step, 0); return; }
      rebuilding = false;
      if (deferred.size) { const extra = [...deferred]; deferred.clear(); ingest(model().vectorSnapshot(extra)); }
      notify();
    }
    step();
  }
  function onVectors(detail) {
    if (!usable()) return;
    if (detail?.reset) { rebuild(); return; }
    const ids = Array.isArray(detail?.added) ? detail.added : [];
    if (rebuilding) ids.forEach(id => deferred.add(id));
    else ingest(model().vectorSnapshot(ids));
  }
  function init() {
    if (initialized || !store()) return;
    initialized = true;
    const S = store();
    S.on('model:vectorsChanged', onVectors);
    S.on('model:status', state => {
      if (!state.enabled || !S.getSetting('embedEnabled', true)) {
        if (clusterer.size() || rebuilding) clear(); else notify();
      } else notify();
    });
    S.on('settings:changed', ({ key }) => { if (key === 'embedEnabled') { if (usable()) rebuild(); else clear(); } });
    // Se reconstruye para retirar contribuciones de documentos eliminados y
    // para reasociar feedback histórico tras restaurar un respaldo.
    ['doc:removed', 'brain:imported', 'system:reset'].forEach(event => S.on(event, rebuild));
    S.on('memory:changed', detail => { if (detail?.kind === 'feedback') notify(); });
    rebuild();
  }
  function topicId(id) { return usable() ? clusterer.topicId(id) : null; }
  function topics() { return usable() ? clusterer.list() : []; }
  function topicForSentence(id) {
    const id_ = topicId(id);
    return id_ ? topics().find(topic => topic.id === id_) || null : null;
  }
  // Las valoraciones se guardan con los IDs de fuentes; los IDs de temas son
  // derivados y pueden cambiar al eliminar documentos o reconstruir vectores.
  function preferenceWeights(feedback) {
    const weights = new Map();
    if (!usable()) return weights;
    for (const item of (feedback || []).slice(-400)) {
      const rating = Math.sign(Number(item?.rating) || 0);
      if (!rating) continue;
      const ids = Array.isArray(item.sentenceIds) ? item.sentenceIds.slice(0, 100) : [];
      const relevant = new Set(ids.map(topicId).filter(id => id && id !== OTHER));
      for (const id of relevant) weights.set(id, Math.max(-.45, Math.min(.45, (weights.get(id) || 0) + rating * .15)));
    }
    return weights;
  }
  function preferenceFor(id, weights) {
    const topic = topicId(id);
    return topic && topic !== OTHER ? (weights?.get(topic) || 0) : 0;
  }

  return { createClusterer, init, info, topics, topicId, topicForSentence, preferenceWeights, preferenceFor, OTHER };
});
