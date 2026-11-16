/**
 * NEURAL COMMAND // AI SPIDER OS
 * js/kimi-aux-model.js - Modelo Auxiliar Local con Aprendizaje Hebbiano y Evolución Autónoma
 */
(function () {
  const AUX_KEY = 'kimi_aux_brain_v1';

  const brain = {
    cooccurrence: {}, // { wordA: { wordB: weight } }
    evolutionXP: 0,
    level: 1,
    totalInferences: 0
  };

  function load() {
    try {
      const raw = localStorage.getItem(AUX_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.cooccurrence) brain.cooccurrence = data.cooccurrence;
      if (data.evolutionXP) brain.evolutionXP = data.evolutionXP;
      if (data.level) brain.level = data.level;
      if (data.totalInferences) brain.totalInferences = data.totalInferences;
    } catch (_) {}
  }

  function save() {
    try {
      // Mantener las 150 palabras más fuertes para no saturar localStorage
      const keys = Object.keys(brain.cooccurrence).slice(-150);
      const compact = {};
      keys.forEach(k => { compact[k] = brain.cooccurrence[k]; });
      localStorage.setItem(AUX_KEY, JSON.stringify({
        cooccurrence: compact,
        evolutionXP: brain.evolutionXP,
        level: brain.level,
        totalInferences: brain.totalInferences
      }));
    } catch (_) {}
  }

  function tokenize(text) {
    return (text || '').toLowerCase()
      .replace(/[^a-z0-9áéíóúñü\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);
  }

  // Aprendizaje Hebbiano: "Neuronas que disparan juntas, se conectan juntas"
  function trainOnPattern(text, boost = 1.0) {
    const tokens = Array.from(new Set(tokenize(text))).slice(0, 12);
    for (let i = 0; i < tokens.length; i++) {
      const a = tokens[i];
      if (!brain.cooccurrence[a]) brain.cooccurrence[a] = {};
      for (let j = i + 1; j < tokens.length; j++) {
        const b = tokens[j];
        if (!brain.cooccurrence[b]) brain.cooccurrence[b] = {};
        brain.cooccurrence[a][b] = (brain.cooccurrence[a][b] || 0) + 0.5 * boost;
        brain.cooccurrence[b][a] = (brain.cooccurrence[b][a] || 0) + 0.5 * boost;
      }
    }
    brain.evolutionXP += Math.round(5 * boost);
    brain.level = 1 + Math.floor(brain.evolutionXP / 100);
    save();
  }

  function getAssociatedConcepts(query, limit = 5) {
    const qTokens = tokenize(query);
    const scores = {};
    qTokens.forEach(qt => {
      const neighbors = brain.cooccurrence[qt];
      if (!neighbors) return;
      Object.entries(neighbors).forEach(([target, w]) => {
        if (!qTokens.includes(target)) {
          scores[target] = (scores[target] || 0) + w;
        }
      });
    });
    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word, weight]) => ({ word, weight: weight.toFixed(1) }));
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
      vocabSize: Object.keys(brain.cooccurrence).length
    };
  }

  load();
  window.KimiAuxModel = { trainOnPattern, getAssociatedConcepts, reason, brain };
})();
