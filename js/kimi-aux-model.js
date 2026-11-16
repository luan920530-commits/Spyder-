/**
 * NEURAL COMMAND // AI SPIDER OS
 * js/kimi-aux-model.js - Modelo Auxiliar Local con Aprendizaje Hebbiano y Evolución Autónoma
 */
(function () {
  const AUX_KEY = 'kimi_aux_brain_v1';

  const brain = {
    cooccurrence: {}, // { wordA: { wordB: weight } }
    markov: {},       // { wordA: { nextWord: weight } } para generación N-gram natural
    negativeEpisodes: [], // Memoria negativa (EMK): patrones penalizados con 👎
    episodes: [],         // Episodios maestros comprimidos por SleepCycle
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

  // Aprendizaje Hebbiano + N-gram (Markov) secuencial
  function trainOnPattern(text, boost = 1.0) {
    const rawWords = (text || '').toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i < rawWords.length - 1; i++) {
      const curr = rawWords[i];
      const next = rawWords[i + 1];
      if (!brain.markov[curr]) brain.markov[curr] = {};
      brain.markov[curr][next] = Math.max(0.1, (brain.markov[curr][next] || 0) + 1.0 * boost);
    }

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

  function generateNaturalText(query, maxWords = 20) {
    const qTokens = tokenize(query);
    let curr = qTokens.find(t => brain.markov[t]) || Object.keys(brain.markov)[0];
    if (!curr) return '';

    const out = [curr];
    for (let i = 0; i < maxWords - 1; i++) {
      const nextMap = brain.markov[curr];
      if (!nextMap) break;
      const entries = Object.entries(nextMap).sort((a, b) => b[1] - a[1]);
      if (!entries.length) break;
      // Elegir entre las 2 transiciones sinápticas más fuertes para evitar bucles
      const pool = entries.slice(0, Math.min(2, entries.length));
      const picked = pool[Math.floor(Math.random() * pool.length)][0];
      if (out.includes(picked) && out.length > 6) break;
      out.push(picked);
      curr = picked;
    }
    const sentence = out.join(' ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
  }

  function reason(query) {
    brain.totalInferences++;
    const associated = getAssociatedConcepts(query, 5);
    const naturalSynthesis = generateNaturalText(query, 18);
    const intent = /por qu[eé]|causa|c[oó]mo/i.test(query) ? 'CAUSAL'
      : /cu[aá]nto|m[eé]trica|porcentaje|datos/i.test(query) ? 'QUANT'
      : /qu[eé] es|define|concepto/i.test(query) ? 'DEF' : 'SYNTH';

    save();
    return {
      intent,
      associated,
      naturalSynthesis,
      level: brain.level,
      xp: brain.evolutionXP,
      vocabSize: Object.keys(brain.cooccurrence).length
    };
  }

  function recordNegativeEpisode(text) {
    if (!text) return;
    brain.negativeEpisodes.push(text.slice(0, 80).toLowerCase());
    if (brain.negativeEpisodes.length > 30) brain.negativeEpisodes.shift();
    save();
  }

  function runSleepCycle(nodes = []) {
    // Compresión episódica (EMK): agrupa nodos por clúster y poda ruido de bajo peso
    const byCluster = {};
    nodes.filter(n => !n.isHub).forEach(n => {
      if (!byCluster[n.cluster]) byCluster[n.cluster] = [];
      byCluster[n.cluster].push(n);
    });
    brain.episodes = Object.entries(byCluster).map(([cluster, list]) => {
      const top = list.sort((a, b) => (b.weight || 1) - (a.weight || 1)).slice(0, 3);
      return { cluster, summary: top.map(t => t.label).join(' · '), count: list.length };
    });
    save();
    return brain.episodes;
  }

  load();
  window.KimiAuxModel = {
    trainOnPattern,
    getAssociatedConcepts,
    generateNaturalText,
    reason,
    recordNegativeEpisode,
    runSleepCycle,
    brain
  };
})();
