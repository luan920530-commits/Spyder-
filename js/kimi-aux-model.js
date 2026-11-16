/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/kimi-aux-model.js — Modelo auxiliar local: vocabulario personal, co-ocurrencia
 * hebbiana, estilo de escritura y memoria negativa.
 *
 * Correcciones v11:
 *  · guarda las 150 palabras MÁS FUERTES (antes guardaba las 150 últimas)
 *  · persiste el modelo de Markov y la memoria negativa
 *  · la memoria negativa ahora se consulta (isPenalized) y penaliza de verdad
 *  · decaimiento suave para que el vocabulario antiguo no domine
 *  · los conectores aprendidos se usan en el modo Redacción
 */
(function (root) {
  'use strict';

  const U = root.NCUtil;
  const AUX_KEY = 'kimi_aux_brain_v2';
  const MAX_VOCAB = 400;
  const MAX_MARKOV = 250;

  const brain = {
    cooccurrence: {},      // palabra → { vecina: peso }
    markov: {},            // palabra → { siguiente: peso }
    negativeEpisodes: [],  // respuestas penalizadas con 👎
    styleConnectors: ['por lo tanto', 'en síntesis', 'en contraste', 'además', 'sin embargo', 'en consecuencia'],
    evolutionXP: 0,
    level: 1,
    totalInferences: 0,
    trainedPatterns: 0,
    updatedAt: 0
  };

  function safeGraph(value, maxKeys, maxNeighbours) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = Object.create(null);
    Object.entries(value).slice(0, maxKeys).forEach(([key, neighbours]) => {
      if (!/^[a-z0-9%]{1,64}$/.test(key) || !neighbours || typeof neighbours !== 'object' || Array.isArray(neighbours)) return;
      const row = Object.create(null);
      Object.entries(neighbours).slice(0, maxNeighbours).forEach(([target, weight]) => {
        if (/^[a-z0-9%]{1,64}$/.test(target) && Number.isFinite(weight) && weight >= 0 && weight <= 10000) row[target] = weight;
      });
      out[key] = row;
    });
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(AUX_KEY) || localStorage.getItem('kimi_aux_brain_v1');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.cooccurrence && typeof d.cooccurrence === 'object') {
        const entries = Object.entries(safeGraph(d.cooccurrence, MAX_VOCAB * 2, 40))
          .sort((a, b) => sumWeights(b[1]) - sumWeights(a[1]))
          .slice(0, MAX_VOCAB);
        brain.cooccurrence = Object.fromEntries(entries);
      }
      if (d.markov && typeof d.markov === 'object') brain.markov = safeGraph(d.markov, MAX_MARKOV, 16);
      if (Array.isArray(d.negativeEpisodes)) brain.negativeEpisodes = d.negativeEpisodes.filter(x => typeof x === 'string').map(x => x.slice(0, 160)).slice(-40);
      if (Array.isArray(d.styleConnectors) && d.styleConnectors.length) brain.styleConnectors = d.styleConnectors.filter(x => typeof x === 'string').map(x => x.slice(0, 80)).slice(0, 12);
      brain.evolutionXP = Number.isFinite(d.evolutionXP) ? Math.max(0, d.evolutionXP) : 0;
      brain.level = Number.isFinite(d.level) ? Math.max(1, d.level) : 1 + Math.floor(brain.evolutionXP / 100);
      brain.totalInferences = Number.isFinite(d.totalInferences) ? Math.max(0, d.totalInferences) : 0;
      brain.trainedPatterns = Number.isFinite(d.trainedPatterns) ? Math.max(0, d.trainedPatterns) : 0;
    } catch (_) {}
  }

  function sumWeights(obj) {
    let s = 0;
    for (const k in obj) s += obj[k];
    return s;
  }

  function save() {
    try {
      // Top-N por fuerza real (no por orden de inserción)
      const compact = Object.fromEntries(
        Object.entries(brain.cooccurrence)
          .map(([k, v]) => [k, Object.fromEntries(
            Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 12)
          )])
          .sort((a, b) => sumWeights(b[1]) - sumWeights(a[1]))
          .slice(0, MAX_VOCAB)
      );
      brain.cooccurrence = compact;

      const markovKeys = Object.keys(brain.markov)
        .sort((a, b) => sumWeights(brain.markov[b]) - sumWeights(brain.markov[a]))
        .slice(0, MAX_MARKOV);
      const markov = {};
      markovKeys.forEach(k => {
        markov[k] = Object.fromEntries(
          Object.entries(brain.markov[k]).sort((a, b) => b[1] - a[1]).slice(0, 8)
        );
      });
      brain.markov = markov;
      brain.updatedAt = Date.now();

      localStorage.setItem(AUX_KEY, JSON.stringify({
        cooccurrence: brain.cooccurrence,
        markov: brain.markov,
        negativeEpisodes: brain.negativeEpisodes.slice(-40),
        styleConnectors: brain.styleConnectors.slice(0, 12),
        evolutionXP: brain.evolutionXP,
        level: brain.level,
        totalInferences: brain.totalInferences,
        trainedPatterns: brain.trainedPatterns
      }));
    } catch (e) {
      console.warn('[KimiAux] No se pudo guardar:', e.message);
    }
  }

  // ── Aprendizaje ──────────────────────────────────────────────────────────
  function trainOnPattern(text, boost) {
    const b = boost == null ? 1 : boost;
    const raw = U.words(text);
    if (!raw.length) return;

    for (let i = 0; i < raw.length - 1; i++) {
      const curr = raw[i], next = raw[i + 1];
      if (curr.length < 3 || next.length < 3) continue;
      if (!brain.markov[curr]) brain.markov[curr] = {};
      brain.markov[curr][next] = Math.max(0.1, (brain.markov[curr][next] || 0) + b);
    }

    const toks = Array.from(new Set(U.tokens(text))).slice(0, 14);
    for (let i = 0; i < toks.length; i++) {
      const a = toks[i];
      if (!brain.cooccurrence[a]) brain.cooccurrence[a] = {};
      for (let j = i + 1; j < toks.length; j++) {
        const c = toks[j];
        if (!brain.cooccurrence[c]) brain.cooccurrence[c] = {};
        const w = 0.5 * b;
        brain.cooccurrence[a][c] = (brain.cooccurrence[a][c] || 0) + w;
        brain.cooccurrence[c][a] = (brain.cooccurrence[c][a] || 0) + w;
      }
    }

    brain.evolutionXP += Math.round(5 * Math.max(0.2, b));
    brain.level = 1 + Math.floor(brain.evolutionXP / 100);
    brain.trainedPatterns++;
    save();
  }

  /** Términos asociados (para expandir consultas y sugerir relaciones). */
  function getAssociatedConcepts(query, limit) {
    const qt = U.tokens(query);
    const scores = {};
    qt.forEach(t => {
      const neighbors = brain.cooccurrence[t];
      if (!neighbors) return;
      Object.entries(neighbors).forEach(([target, w]) => {
        if (qt.includes(target)) return;
        if (isPenalized(target)) return;
        scores[target] = (scores[target] || 0) + w;
      });
    });
    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit || 5)
      .map(([word, weight]) => ({ word, weight: Number(weight.toFixed(2)) }));
  }

  /**
   * Sugerencia de conectores según el estilo aprendido. Se usa en Redacción.
   * (Sustituye a la "síntesis N-gram", que producía texto sin sentido.)
   */
  function suggestConnectors(n) {
    const list = brain.styleConnectors.slice(0, n || 3);
    while (list.length < (n || 3)) list.push('además');
    return list;
  }

  /** Aprende conectores del texto que escribe el usuario (modo Redacción). */
  function learnStyle(text) {
    const connectors = ['por lo tanto', 'en síntesis', 'en contraste', 'además', 'sin embargo', 'en consecuencia', 'no obstante', 'en definitiva'];
    const norm = U.normalize(text);
    connectors.forEach(c => {
      if (norm.includes(c) && !brain.styleConnectors.includes(c)) brain.styleConnectors.unshift(c);
    });
    brain.styleConnectors = brain.styleConnectors.slice(0, 12);
    save();
  }

  // ── Memoria negativa ─────────────────────────────────────────────────────
  function recordNegativeEpisode(text) {
    const clean = U.normalize(text).slice(0, 160);
    if (!clean) return;
    if (!brain.negativeEpisodes.includes(clean)) brain.negativeEpisodes.push(clean);
    if (brain.negativeEpisodes.length > 40) brain.negativeEpisodes.shift();
    save();
  }

  /** ¿Se parece a algo que el usuario penalizó? (umbral de trigramas) */
  function isPenalized(text) {
    const norm = U.normalize(text);
    if (!norm || !brain.negativeEpisodes.length) return false;
    return brain.negativeEpisodes.some(ep => {
      if (!ep) return false;
      if (norm.includes(ep.slice(0, 60)) || ep.includes(norm.slice(0, 60))) return true;
      return U.trigramSim(norm, ep) > 0.62;
    });
  }

  function reason(query) {
    brain.totalInferences++;
    const associated = getAssociatedConcepts(query, 5);
    const intent = /por qu[eé]|causa|c[oó]mo/i.test(query) ? 'CAUSAL'
      : /cu[aá]nto|m[eé]trica|porcentaje|datos/i.test(query) ? 'QUANT'
        : /qu[eé] es|define|concepto/i.test(query) ? 'DEF' : 'SYNTH';
    save();
    return {
      intent,
      associated,
      level: brain.level,
      xp: brain.evolutionXP,
      vocabSize: Object.keys(brain.cooccurrence).length,
      trainedPatterns: brain.trainedPatterns
    };
  }

  function getSelfReflection() {
    const nodes = (root.NeuralStore ? root.NeuralStore.state.nodes : []).filter(n => !n.isHub);
    const counts = { 'AGT-01': 0, 'AGT-02': 0, 'AGT-03': 0, 'AGT-04': 0 };
    nodes.forEach(n => { if (counts[n.cluster] !== undefined) counts[n.cluster]++; });
    const weakest = Object.entries(counts).sort((a, b) => a[1] - b[1])[0] || ['AGT-01', 0];
    return {
      level: brain.level,
      xp: brain.evolutionXP,
      vocab: Object.keys(brain.cooccurrence).length,
      counts,
      weakestCluster: weakest[0],
      text: `Nivel ${brain.level} (${brain.evolutionXP} XP). Domino ${Object.keys(brain.cooccurrence).length} conceptos y he aprendido de ${brain.trainedPatterns} patrones. Mi área más débil es ${weakest[0]} (${weakest[1]} nodos).`
    };
  }

  function runSleepCycle() {
    // Decaimiento suave y poda de pesos irrelevantes (evita que el pasado domine)
    Object.keys(brain.cooccurrence).forEach(k => {
      const map = brain.cooccurrence[k];
      Object.keys(map).forEach(k2 => {
        map[k2] *= 0.92;
        if (map[k2] < 0.05) delete map[k2];
      });
      if (!Object.keys(map).length) delete brain.cooccurrence[k];
    });
    save();
    return { vocab: Object.keys(brain.cooccurrence).length };
  }

  function reset() {
    brain.cooccurrence = {};
    brain.markov = {};
    brain.negativeEpisodes = [];
    brain.styleConnectors = ['por lo tanto', 'en síntesis', 'en contraste', 'además', 'sin embargo', 'en consecuencia'];
    brain.evolutionXP = 0;
    brain.level = 1;
    brain.totalInferences = 0;
    brain.trainedPatterns = 0;
    try { localStorage.removeItem(AUX_KEY); localStorage.removeItem('kimi_aux_brain_v1'); } catch (_) {}
  }

  function restore(data) {
    reset();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    try { localStorage.setItem(AUX_KEY, JSON.stringify(data)); load(); save(); } catch (_) {}
  }

  load();
  if (root.NeuralStore && root.NeuralStore.on) {
    root.NeuralStore.on('system:reset', reset);
    root.NeuralStore.on('memory:changed', () => save());
  }

  root.KimiAuxModel = {
    trainOnPattern, getAssociatedConcepts, reason, recordNegativeEpisode, isPenalized,
    runSleepCycle, getSelfReflection, suggestConnectors, learnStyle, save, reset, restore, brain
  };
})(typeof window !== 'undefined' ? window : globalThis);
