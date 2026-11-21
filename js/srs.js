/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/srs.js — Repetición espaciada local (Leitner + SM-2 simplificado), estados de
 * dominio y métricas de estudio. Módulo puro: ejecutable en Node con `require`.
 */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./util.js')
    : (root.NCUtil || {});
  const api = factory(U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCSRS = Object.assign(root.NCSRS || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';

  const DAY = 86400000;
  const MIN = 60000;
  const MAX_BOX = 5;
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

  /**
   * Programa la siguiente revisión.
   * @param {object} card
   * @param {'again'|'hard'|'good'|'easy'} grade
   * @param {number} now
   */
  function review(card, grade, now) {
    const t = now || Date.now();
    const c = Object.assign({}, newCard({ due: t }), card || {});
    const g = GRADES.includes(grade) ? grade : 'good';
    c.reps = (c.reps || 0) + 1;
    c.lastReview = t;
    c.history = (c.history || []).slice(-30);
    c.history.push({ grade: g, at: t, box: c.box });

    if (g === 'again') {
      c.box = 0;
      c.lapses = (c.lapses || 0) + 1;
      c.ease = Math.max(1.3, (c.ease || 2.5) - 0.2);
      c.interval = 10 / (60 * 24);          // 10 minutos
      c.due = t + 10 * MIN;
    } else if (g === 'hard') {
      c.box = Math.max(1, Math.min(MAX_BOX, c.box || 0));
      c.ease = Math.max(1.3, (c.ease || 2.5) - 0.15);
      c.interval = Math.max(1, (c.interval || 0) * 1.2);
      c.due = t + c.interval * DAY;
    } else if (g === 'good') {
      c.box = Math.min(MAX_BOX, (c.box || 0) + 1);
      c.interval = Math.max(1, (c.interval || 0) * (c.ease || 2.5));
      c.due = t + c.interval * DAY;
    } else {
      c.box = Math.min(MAX_BOX, (c.box || 0) + 2);
      c.ease = Math.min(3.2, (c.ease || 2.5) + 0.1);
      c.interval = Math.max(2, (c.interval || 0) * (c.ease || 2.5) * 1.3);
      c.due = t + c.interval * DAY;
    }
    c.interval = Number(c.interval.toFixed(4));
    return c;
  }

  function isDue(card, now) {
    return (card.due || 0) <= (now || Date.now());
  }

  function dueCards(cards, now) {
    return (cards || []).filter(c => isDue(c, now)).sort((a, b) => (a.due || 0) - (b.due || 0));
  }

  function dueLabel(card, now) {
    const t = now || Date.now();
    const diff = (card.due || t) - t;
    if (diff <= 0) return 'ahora';
    if (diff < 60 * MIN) return Math.round(diff / MIN) + ' min';
    if (diff < 2 * DAY) return Math.round(diff / DAY) + ' d';
    return Math.round(diff / DAY) + ' días';
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
    const t = now || Date.now();
    const due = dueCards(list, t).length;
    const mastery = list.length ? list.reduce((a, c) => a + cardMastery(c), 0) / list.length : 0;
    const byBox = [0, 1, 2, 3, 4, 5].map(b => list.filter(c => (c.box || 0) === b).length);
    const learned = list.filter(c => (c.box || 0) >= 3).length;
    return {
      total: list.length, due, mastery, byBox, learned,
      avgBox: list.length ? list.reduce((a, c) => a + (c.box || 0), 0) / list.length : 0,
      nextDue: list.length ? Math.min(...list.map(c => c.due || t)) : null
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
  function ankiCsv(cards) {
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
    const rows = [['Front', 'Back', 'Tags'].map(esc).join(',')];
    (cards || []).forEach(c => {
      rows.push([
        esc(c.front || ''),
        esc((c.back || '') + (c.pageNum ? ` [Pág ${c.pageNum}]` : '')),
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
    DAY, MAX_BOX, GRADES, GRADE_LABEL,
    newCard, review, isDue, dueCards, dueLabel,
    cardMastery, deckStats, clusterMastery,
    ankiCsv, quizAccuracy, perClusterFromQuiz
  };
});
