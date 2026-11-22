/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/srs.js — Fechas FSRS locales y métricas del alumno. Las cajas históricas
 * siguen siendo un indicador visual, no el algoritmo de programación.
 */
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('../vendor/fsrs/ts-fsrs.umd.js') : root.FSRS);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCSRS = Object.assign(root.NCSRS || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (F) {
  'use strict';

  const DAY = 86400000;
  const MIN = 60000;
  const MAX_BOX = 5;
  const scheduler = F.fsrs({ enable_fuzz: false });
  const GRADES = ['again', 'hard', 'good', 'easy'];

  const GRADE_LABEL = {
    again: 'Otra vez',
    hard: 'Difícil',
    good: 'Bien',
    easy: 'Fácil'
  };

  function newCard(fields) {
    const now = Date.now();
    return Object.assign({
      box: 0,
      ease: 2.5,
      interval: 0,          // días
      reps: 0,
      lapses: 0,
      due: now,
      createdAt: now,
      lastReview: null
    }, fields || {});
  }

  const validTime = n => Number.isFinite(n) && Math.abs(n) <= 8.64e15;
  const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
  function schedulerCard(card, now) {
    const base = F.createEmptyCard(new Date(now)), mem = card.fsrs;
    if (!validTime(card.lastReview) || !validTime(card.due)) return base;
    // Una importación o un cambio de reloj no deben producir tiempo transcurrido negativo.
    base.last_review = new Date(Math.min(now, card.lastReview)); base.due = new Date(card.due);
    if (mem?.version === 1 && [F.State.Learning, F.State.Review, F.State.Relearning].includes(mem.state) &&
        mem.stability >= F.S_MIN && mem.stability <= 36500 && Number.isFinite(mem.stability) &&
        mem.difficulty >= 1 && mem.difficulty <= 10 && Number.isFinite(mem.difficulty)) {
      return { ...base, state: mem.state, stability: mem.stability, difficulty: mem.difficulty,
        reps: count(mem.reps), lapses: count(mem.lapses), learning_steps: count(mem.learning_steps),
        elapsed_days: count(mem.elapsed_days), scheduled_days: count(mem.scheduled_days) };
    }
    // Inicialización aproximada para tarjetas antiguas ya espaciadas por días.
    // Solo al calificarlas: no recalcular vencimientos al abrir/importar el mazo.
    if (card.reps > 0 && Number.isFinite(card.interval) && card.interval >= 1) {
      const days = Math.min(36500, card.interval);
      return { ...base, state: F.State.Review, stability: days, difficulty: 5,
        scheduled_days: Math.round(days), reps: count(card.reps), lapses: count(card.lapses) };
    }
    return F.createEmptyCard(new Date(now));
  }

  function review(card, grade, now = Date.now()) {
    const c = { ...newCard({ createdAt: now, due: now }), ...card }, g = GRADES.includes(grade) ? grade : 'good';
    const next = scheduler.next(schedulerCard(c, now), new Date(now), GRADES.indexOf(g) + 1).card;
    const { stability, difficulty, state, reps, lapses, learning_steps, scheduled_days, elapsed_days } = next;
    const box = Math.min(MAX_BOX, count(c.box));
    // Conservar las estadísticas y textos del alumno. FSRS distingue un fallo en
    // aprendizaje inicial de una recaída; los lapsos históricos contaban ambos.
    return { ...c, lastReview: now, due: +next.due, interval: (+next.due - now) / DAY,
      fsrs: { version: 1, stability, difficulty, state, reps, lapses, learning_steps, scheduled_days, elapsed_days },
      reps: count(c.reps) + 1, lapses: count(c.lapses) + Number(g === 'again'),
      box: g === 'again' ? 0 : g === 'hard' ? Math.max(1, box) : Math.min(MAX_BOX, box + (g === 'easy' ? 2 : 1)),
      history: [...(Array.isArray(c.history) ? c.history.slice(-30) : []), { grade: g, at: now, box }] };
  }

  function isDue(card, now) {
    return (card.due || 0) <= (now ?? Date.now());
  }

  function dueCards(cards, now) {
    return (cards || []).filter(c => isDue(c, now)).sort((a, b) => (a.due || 0) - (b.due || 0));
  }

  function dueLabel(card, now) {
    const t = now ?? Date.now();
    const diff = (card.due || t) - t;
    if (diff <= 0) return 'ahora';
    if (diff < 60 * MIN) return Math.ceil(diff / MIN) + ' min';
    if (diff < DAY) return Math.ceil(diff / (60 * MIN)) + ' h';
    const days = Math.round(diff / DAY); return days === 1 ? '1 día' : days + ' días';
  }

  const SESSION_LIMITS = [3, 5, 10];
  function sessionPlan(cards, limit = 5, now = Date.now()) {
    const size = SESSION_LIMITS.includes(limit) ? limit : 5, seen = new Set(), due = [];
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    let next = null, reviewedToday = 0, fresh = 0;
    for (const c of cards) {
      if (!c?.id || seen.has(c.id)) continue;
      seen.add(c.id);
      if (validTime(c.lastReview) && c.lastReview >= +midnight && c.lastReview <= now) reviewedToday++;
      if (isDue(c, now)) { due.push(c); if (!c.reps) fresh++; }
      else if (validTime(c.due) && (next === null || c.due < next)) next = c.due;
    }
    due.sort((a, b) => Number(!a.reps) - Number(!b.reps) || (a.due || 0) - (b.due || 0));
    return { ids: due.slice(0, size).map(c => c.id), due: due.length, fresh, reviewedToday, next };
  }

  /** 0..1 — cuánto se domina una tarjeta según caja, aciertos y lapsos. */
  function cardMastery(card) {
    const box = Math.min(MAX_BOX, Math.max(0, card.box || 0)) / MAX_BOX;
    const reps = Math.min(1, (card.reps || 0) / 6);
    const penalty = Math.min(0.35, (card.lapses || 0) * 0.07);
    return Math.max(0, Math.min(1, 0.65 * box + 0.35 * reps - penalty));
  }

  function deckStats(cards, now) {
    const list = cards || [];
    const t = now ?? Date.now();
    const due = dueCards(list, t).length;
    const mastery = list.length ? list.reduce((a, c) => a + cardMastery(c), 0) / list.length : 0;
    const byBox = [0, 1, 2, 3, 4, 5].map(b => list.filter(c => (c.box || 0) === b).length);
    const learned = list.filter(c => (c.box || 0) >= 3).length;
    return {
      total: list.length, due, mastery, byBox, learned,
      avgBox: list.length ? list.reduce((a, c) => a + (c.box || 0), 0) / list.length : 0,
      nextDue: list.length ? list.reduce((next, c) => Math.min(next, c.due || t), Infinity) : null
    };
  }

  function clusterMastery(cards, quizHistory, clusters) {
    const out = {};
    const list = clusters || ['AGT-01', 'AGT-02', 'AGT-03', 'AGT-04'];
    list.forEach(c => { out[c] = { cards: 0, mastery: 0, quiz: null, score: 0 }; });

    (cards || []).forEach(card => {
      const c = card.cluster || 'AGT-01';
      if (!out[c]) out[c] = { cards: 0, mastery: 0, quiz: null, score: 0 };
      out[c].cards++;
      out[c].mastery += cardMastery(card);
    });
    Object.keys(out).forEach(c => {
      if (out[c].cards) out[c].mastery = out[c].mastery / out[c].cards;
    });

    (quizHistory || []).forEach(run => {
      (run.perCluster || []).forEach(pc => {
        if (!out[pc.cluster]) out[pc.cluster] = { cards: 0, mastery: 0, quiz: null, score: 0 };
        const prev = out[pc.cluster].quiz;
        out[pc.cluster].quiz = prev == null ? pc.accuracy : (prev + pc.accuracy) / 2;
      });
    });

    Object.keys(out).forEach(c => {
      const m = out[c].mastery || 0;
      const q = out[c].quiz == null ? m : out[c].quiz;
      out[c].score = Number((0.55 * m + 0.45 * q).toFixed(3));
    });
    return out;
  }

  /** Exporta a CSV compatible con la importación de Anki. */
  function ankiCsv(cards, resolveSource) {
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
    const rows = [['Front', 'Back', 'Tags'].map(esc).join(',')];
    (cards || []).forEach(c => {
      // Las tarjetas antiguas solo tienen la página interna; recuperar la física
      // desde el ancla si el documento continúa disponible.
      const source = resolveSource?.(c.sentenceId), doc = c.docName || source?.docName;
      const page = c.sourcePage || source?.sourcePage || c.pageNum;
      rows.push([
        esc(c.front || ''),
        esc((c.back || '') + (page ? ` [Pág ${page}]` : '') + (doc ? ` · ${doc}` : '')),
        esc(`neural ${c.cluster || 'general'}`)
      ].join(','));
    });
    return rows.join('\n');
  }

  function quizAccuracy(items, answers) {
    if (!items || !items.length) return { correct: 0, total: 0, accuracy: 0 };
    let correct = 0;
    items.forEach((it, i) => { if (answers && answers[i] === it.answer) correct++; });
    return { correct, total: items.length, accuracy: Number((correct / items.length).toFixed(3)) };
  }

  function perClusterFromQuiz(items, answers) {
    const map = new Map();
    items.forEach((it, i) => {
      const cluster = it.cluster || 'AGT-01';
      if (!map.has(cluster)) map.set(cluster, { cluster, correct: 0, total: 0 });
      const row = map.get(cluster);
      row.total++;
      if (answers && answers[i] === it.answer) row.correct++;
    });
    return Array.from(map.values()).map(r => ({ ...r, accuracy: r.total ? r.correct / r.total : 0 }));
  }

  return {
    DAY, MAX_BOX, GRADES, GRADE_LABEL, SESSION_LIMITS, sessionPlan,
    newCard, review, isDue, dueCards, dueLabel,
    cardMastery, deckStats, clusterMastery,
    ankiCsv, quizAccuracy, perClusterFromQuiz
  };
});
