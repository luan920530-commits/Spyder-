/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/memory.js — Memoria del sistema: afirmaciones consolidadas, Bóveda de
 * conocimiento (dedupe por stems + refuerzo), consolidación tipo «ciclo de sueño»
 * y aprendizaje por retroalimentación (👍/👎) que sí influye en el ranking.
 */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined') ? require('./util.js') : (root.NCUtil || {});
  const api = factory(U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCMemory = Object.assign(root.NCMemory || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';

  function store() {
    return typeof window !== 'undefined' ? window.NeuralStore : (globalThis.NeuralStore || null);
  }

  function state() {
    const s = store();
    return s ? s.state : { consolidatedMemory: [], vault: [], feedback: [], cards: [], nodes: [] };
  }

  // ── Afirmaciones manuales ────────────────────────────────────────────────
  function addFact(fact) {
    const clean = String(fact || '').trim();
    if (!clean) return null;
    const s = state();
    const entry = { fact: clean, date: new Date().toISOString(), stems: U.tokens(clean) };
    s.consolidatedMemory.push(entry);
    if (s.consolidatedMemory.length > 300) s.consolidatedMemory.shift();
    const st = store();
    if (st) { st.emit('memory:changed', { kind: 'fact', entry }); st.savePersistent(); }
    return entry;
  }

  function facts(query, limit) {
    const s = state();
    const qs = new Set(U.tokens(query || ''));
    const scored = (s.consolidatedMemory || []).map(m => {
      const stems = m.stems || U.tokens(m.fact);
      let overlap = 0;
      stems.forEach(t => { if (qs.has(t)) overlap++; });
      return { m, overlap };
    }).filter(x => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit || 5)
      .map(x => x.m);
    return scored;
  }

  // ── Bóveda ───────────────────────────────────────────────────────────────
  function keywordsOf(text) {
    const seen = new Set();
    const out = [];
    U.analyze(text).raw.forEach(w => {
      const st = U.stem(w);
      if (w.length < 4 || seen.has(st)) return;
      seen.add(st);
      out.push(w);
    });
    return out.slice(0, 8);
  }

  function vaultAdd(item) {
    const phrase = String((item && (item.phrase || item.label || item.text)) || '').trim();
    if (!phrase) return null;
    const s = state();
    const normKey = U.normalize(phrase).slice(0, 80);
    const kws = item.keywords && item.keywords.length ? item.keywords : keywordsOf(phrase + ' ' + (item.detail || ''));
    const src = { doc: item.docName || '', page: item.pageNum || null, sentenceId: item.sentenceId || null };

    const existing = (s.vault || []).find(v => {
      if (v.normKey === normKey) return true;
      const vk = (v.keywords || []).map(k => U.stem(k));
      const shared = kws.filter(k => vk.includes(U.stem(k))).length;
      return shared >= Math.min(3, Math.max(2, Math.min(kws.length, vk.length) - 1));
    });

    let result;
    if (existing) {
      existing.reinforcement = (existing.reinforcement || 1) + 1;
      existing.updatedAt = Date.now();
      if (src.doc && !(existing.sources || []).some(x => x.doc === src.doc && x.page === src.page)) {
        existing.sources = (existing.sources || []).concat(src);
      }
      if (item.detail && item.detail.length > (existing.detail || '').length) existing.detail = item.detail;
      if (!existing.cluster && item.cluster) existing.cluster = item.cluster;
      result = existing;
    } else {
      result = {
        id: U.uid('v'),
        normKey,
        phrase,
        detail: item.detail || phrase,
        cluster: item.cluster || 'AGT-01',
        manual: !src.doc,
        keywords: kws,
        sources: src.doc ? [src] : [],
        reinforcement: 1,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      s.vault.unshift(result);
      if (s.vault.length > 800) s.vault.pop();
    }
    const st = store();
    if (st) { st.emit('memory:changed', { kind: 'vault', entry: result }); st.savePersistent(); }
    return result;
  }

  function vaultSearch(query, opts) {
    const o = Object.assign({ limit: 50, cluster: null }, opts || {});
    const s = state();
    const q = U.normalize(query || '').trim();
    const qStems = U.tokens(query || '');
    let list = (s.vault || []).slice();
    if (o.cluster) list = list.filter(v => v.cluster === o.cluster);
    if (!q) return list.slice(0, o.limit);
    const scored = list.map(v => {
      const hay = U.normalize(v.phrase + ' ' + (v.detail || '') + ' ' + (v.keywords || []).join(' '));
      const vStems = new Set(U.tokens(v.phrase + ' ' + (v.detail || '')));
      let overlap = 0;
      qStems.forEach(t => { if (vStems.has(t)) overlap++; });
      const direct = hay.includes(q) ? 3 : 0;
      return { v, score: overlap + direct + (v.reinforcement || 1) * 0.1 };
    }).filter(x => x.score > (x.v.reinforcement || 1) * 0.1).sort((a, b) => b.score - a.score);
    return scored.slice(0, o.limit).map(x => x.v);
  }

  function vaultRemove(id) {
    const s = state();
    s.vault = (s.vault || []).filter(v => v.id !== id);
    const st = store();
    if (st) { st.emit('memory:changed', { kind: 'vault-removed', id }); st.savePersistent(); }
  }

  /** Fusiona entradas casi duplicadas y poda ruido. Devuelve estadísticas. */
  function consolidate() {
    const s = state();
    const before = (s.vault || []).length;
    const merged = [];
    let mergeCount = 0;

    [...(s.vault || [])].sort((a, b) => (b.reinforcement || 1) - (a.reinforcement || 1)).forEach(v => {
      const vk = new Set((v.keywords || []).map(k => U.stem(k)));
      const target = merged.find(m => {
        const mk = new Set((m.keywords || []).map(k => U.stem(k)));
        if (U.normalize(m.phrase) === U.normalize(v.phrase)) return true;
        return U.jaccard(mk, vk) >= 0.6;
      });
      if (target) {
        target.reinforcement = (target.reinforcement || 1) + (v.reinforcement || 1);
        target.manual = !!(target.manual || v.manual);
        target.sources = (target.sources || []).concat(v.sources || []);
        if ((v.detail || '').length > (target.detail || '').length) target.detail = v.detail;
        mergeCount++;
      } else {
        merged.push(v);
      }
    });

    // Poda: sin refuerzo y sin fuentes tras varias sesiones
    s.vault = merged.filter(v => v.manual || (v.reinforcement || 1) > 1 || (v.sources || []).length > 0 || !v.createdAt || Date.now() - v.createdAt < 7 * 86400000);
    const st = store();
    if (st) { st.emit('memory:changed', { kind: 'consolidated', merged: mergeCount }); st.savePersistent(); }
    return { before, after: s.vault.length, merged: mergeCount };
  }

  // ── Retroalimentación ────────────────────────────────────────────────────
  function recordFeedback(entry) {
    const s = state();
    if (!s.feedback) s.feedback = [];
    const record = Object.assign({
      id: U.uid('fb'),
      at: Date.now(),
      question: '',
      answer: '',
      rating: 0,
      provider: 'internal',
      mode: 'auto',
      citations: [],
      nodeIds: []
    }, entry || {});
    s.feedback.push(record);
    if (s.feedback.length > 400) s.feedback.shift();

    // Refuerzo del grafo según la valoración
    if (record.nodeIds && record.nodeIds.length && record.rating) {
      s.nodes.forEach(n => {
        if (!record.nodeIds.includes(n.id)) return;
        n.weight = Math.max(1, Math.min(50, (n.weight || 1) + record.rating * 1.5));
      });
    }
    // Refuerzo real de las entradas consultadas.
    (record.vaultIds || []).forEach(id => {
      const entry = s.vault.find(v => v.id === id);
      if (entry) entry.reinforcement = Math.max(1, Math.min(50, (entry.reinforcement || 1) + Number(record.rating || 0)));
    });

    const st = store();
    if (st) { st.emit('memory:changed', { kind: 'feedback', entry: record }); st.savePersistent(); }
    return record;
  }

  function fewShots(question, limit) {
    const s = state();
    const qs = new Set(U.tokens(question || ''));
    if (!qs.size) return [];
    return (s.feedback || [])
      .filter(f => f.rating > 0 && f.answer)
      .map(f => {
        const fs = new Set(U.tokens(f.question));
        let overlap = 0;
        qs.forEach(t => { if (fs.has(t)) overlap++; });
        return { f, sim: qs.size ? overlap / qs.size : 0 };
      })
      .filter(x => x.sim >= 0.2)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit || 2)
      .map(x => ({ question: x.f.question, answer: U.truncate(x.f.answer, 400), rating: x.f.rating, sim: Number(x.sim.toFixed(2)) }));
  }

  // ── Introspección ────────────────────────────────────────────────────────
  function selfReflection() {
    const s = state();
    const nodes = (s.nodes || []).filter(n => !n.isHub);
    const counts = { 'AGT-01': 0, 'AGT-02': 0, 'AGT-03': 0, 'AGT-04': 0 };
    nodes.forEach(n => { if (counts[n.cluster] !== undefined) counts[n.cluster]++; });
    const weakest = Object.entries(counts).sort((a, b) => a[1] - b[1])[0] || ['AGT-01', 0];
    return {
      nodes: nodes.length,
      vault: (s.vault || []).length,
      facts: (s.consolidatedMemory || []).length,
      feedback: (s.feedback || []).length,
      positive: (s.feedback || []).filter(f => f.rating > 0).length,
      counts,
      weakestCluster: weakest[0],
      text: `Tengo ${nodes.length} conceptos en red, ${(s.vault || []).length} entradas en la bóveda y ${(s.feedback || []).length} valoraciones. Mi área más débil es ${weakest[0]} (${weakest[1]} nodos).`
    };
  }

  function stats() {
    const s = state();
    return {
      facts: (s.consolidatedMemory || []).length,
      vault: (s.vault || []).length,
      feedback: (s.feedback || []).length,
      cards: (s.cards || []).length
    };
  }

  return {
    addFact, facts,
    vaultAdd, vaultSearch, vaultRemove, keywordsOf,
    consolidate, recordFeedback, fewShots,
    selfReflection, stats
  };
});
