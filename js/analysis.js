/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/analysis.js — Análisis del corpus: TextRank, síntesis extractiva, palabras clave,
 * extracción de afirmaciones, detección real de contradicciones, esbozo por secciones,
 * preguntas socráticas, rúbrica y generación de ítems de estudio.
 *
 * Módulo puro (sin DOM): ejecutable en Node con `require`.
 */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./util.js')
    : (root.NCUtil || {});
  const api = factory(U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCAnalysis = Object.assign(root.NCAnalysis || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';

  const textOf = s => (typeof s === 'string' ? s : (s && s.text) || '');

  // ─────────────────────────────────────────────────────────────────────────
  // TextRank (grafo de similitud entre oraciones)
  // ─────────────────────────────────────────────────────────────────────────
  function textRank(items, opts) {
    const o = Object.assign({ damping: 0.85, iterations: 24, epsilon: 0.0005 }, opts || {});
    const n = items.length;
    if (!n) return [];
    if (n === 1) return [{ index: 0, score: 1 }];

    const stemSets = items.map(it => new Set(U.tokens(textOf(it))));
    const sim = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const s = U.jaccard(stemSets[i], stemSets[j]);
        sim[i][j] = s; sim[j][i] = s;
      }
    }

    let scores = new Array(n).fill(1 / n);
    for (let it = 0; it < o.iterations; it++) {
      const next = new Array(n).fill((1 - o.damping) / n);
      let delta = 0;
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < n; j++) {
          if (i === j || sim[j][i] === 0) continue;
          const outSum = sim[j].reduce((a, b) => a + b, 0) || 1;
          acc += (sim[j][i] / outSum) * scores[j];
        }
        next[i] += o.damping * acc;
        delta += Math.abs(next[i] - scores[i]);
      }
      scores = next;
      if (delta < o.epsilon) break;
    }
    return scores.map((score, index) => ({ index, score }));
  }

  /** Selecciona las n oraciones más centrales y las devuelve en orden de lectura. */
  function summarize(items, n) {
    const count = Math.max(1, Math.min(n || 4, items.length));
    const ranked = textRank(items).sort((a, b) => b.score - a.score).slice(0, count);
    const picked = new Set(ranked.map(r => r.index));
    return items
      .map((item, index) => ({ item, index, score: ranked.find(r => r.index === index)?.score || 0 }))
      .filter(x => picked.has(x.index));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Palabras clave (tf-idf sobre el propio conjunto + posición)
  // ─────────────────────────────────────────────────────────────────────────
  function keyphrases(items, n) {
    const docs = items.map(it => U.tokens(textOf(it)));
    const df = new Map();
    docs.forEach(toks => new Set(toks).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
    const total = docs.length || 1;
    const tf = new Map();
    docs.forEach(toks => toks.forEach(t => tf.set(t, (tf.get(t) || 0) + 1)));

    // Forma superficial más frecuente para cada stem (para mostrar palabras legibles)
    const surfaces = new Map();
    items.forEach(it => {
      const raw = U.analyze(textOf(it));
      raw.raw.forEach((w, i) => {
        const st = raw.stems[i];
        if (!surfaces.has(st)) surfaces.set(st, new Map());
        const m = surfaces.get(st);
        m.set(w, (m.get(w) || 0) + 1);
      });
    });

    const scored = [];
    for (const [term, freq] of tf) {
      const d = df.get(term) || 1;
      const idf = Math.log(1 + total / d);
      const surfaceMap = surfaces.get(term);
      let surface = term;
      if (surfaceMap) {
        surface = Array.from(surfaceMap.entries()).sort((a, b) => b[1] - a[1])[0][0];
      }
      scored.push({ term, surface, count: freq, score: freq * idf });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, n || 10).map(x => ({ ...x, score: Number(x.score.toFixed(3)) }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Afirmaciones cuantitativas y contradicciones
  // ─────────────────────────────────────────────────────────────────────────
  const UNIT_ALIASES = [
    [/^(%|por\s*ciento|porcentaje)$/i, 'pct'],
    [/^(milisegundos?|mseg|ms)$/i, 'ms'],
    [/^(segundos?|segs?|s)$/i, 's'],
    [/^(minutos?|min)$/i, 'min'],
    [/^(horas?|h)$/i, 'h'],
    [/^(kilobytes?|kbytes?|kb)$/i, 'kb'],
    [/^(megabytes?|mb)$/i, 'mb'],
    [/^(gigabytes?|gb)$/i, 'gb'],
    [/^(terabytes?|tb)$/i, 'tb'],
    [/^(épocas?|epocas?|epochs?)$/i, 'epocas'],
    [/^(años?|anos?|years?)$/i, 'años'],
    [/^(nodos?|nodes?)$/i, 'nodos'],
    [/^(veces|x)$/i, 'veces'],
    [/^(personas?|usuarios?)$/i, 'personas'],
    [/^(parámetros?|parametros?|params?)$/i, 'params'],
    [/^(capas?|layers?)$/i, 'capas'],
    [/^(dimensiones?|dimensions?)$/i, 'dimensiones']
  ];

  // Número + unidad léxica opcional (capturada como palabra, no como regex suelta)
  const NUMBER_RE = /(-?\d+(?:[.,]\d+)?)\s*(%|por\s*ciento|[a-záéíóúñ]{1,16})?/gi;

  function detectUnit(unitRaw) {
    if (!unitRaw) return { unit: null };
    const raw = String(unitRaw).trim();
    if (!raw) return { unit: null };
    for (const [re, unit] of UNIT_ALIASES) {
      if (re.test(raw)) return { unit };
    }
    return { unit: null };
  }

  const POSITIVE_RE = /(aumenta|incrementa|sube|crece|maximiza|mejora|reduce|disminuye|baja|decrece|minimiza|optimiza|acelera|degrada|empeora|duplica|triplica)/i;
  const POS_WORDS = /(aumenta|incrementa|sube|crece|maximiza|mejora|duplica|triplica|acelera|optimiza)/i;
  const NEG_WORDS = /(reduce|disminuye|baja|decrece|minimiza|degrada|empeora)/i;

  function extractClaims(items) {
    const claims = [];
    items.forEach((item, index) => {
      const text = textOf(item);
      if (!text) return;
      const numbers = [];
      NUMBER_RE.lastIndex = 0;
      let m;
      while ((m = NUMBER_RE.exec(text))) {
        const raw = m[1];
        const value = Number(raw.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
        if (!isFinite(value)) continue;
        const { unit } = detectUnit(m[2]);
        // Un número sin unidad y menor que 1900 suele ser año o ruido: se conserva igualmente
        numbers.push({ raw, value, unit });
      }
      if (!numbers.length && !POSITIVE_RE.test(text)) return;
      let polarity = 0;
      if (POS_WORDS.test(text)) polarity = 1;
      else if (NEG_WORDS.test(text)) polarity = -1;

      claims.push({
        index,
        id: (item && item.id) || 'claim-' + index,
        text,
        pageNum: (item && item.pageNum) || null,
        docId: (item && item.docId) || null,
        docName: (item && item.docName) || '',
        sentence: item,
        numbers,
        polarity,
        subject: new Set(U.tokens(text).filter(t => !/^\d/.test(t)))
      });
    });
    return claims;
  }

  const UNCOMPARABLE_UNITS = /^(años|epocas|personas|veces|params|nodos)$/;

  /**
   * Detección real de contradicciones entre afirmaciones:
   *  a) mismo tema (≥2 stems compartidos) + misma unidad + valores distintos (> tolerance)
   *  b) mismo tema + polaridades opuestas sobre la misma métrica
   */
  function detectContradictions(items, opts) {
    const o = Object.assign({ minShared: 2, tolerance: 0.1, max: 12 }, opts || {});
    const claims = extractClaims(items);
    const results = [];

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i], b = claims[j];
        if ((a.docId || a.docName) === (b.docId || b.docName) && a.pageNum === b.pageNum && Math.abs(a.index - b.index) <= 1) continue;
        const shared = [...a.subject].filter(t => b.subject.has(t));
        const sharedCount = shared.length;
        if (sharedCount < o.minShared) continue;

        for (const na of a.numbers) {
          for (const nb of b.numbers) {
            if (!na.unit || !nb.unit || na.unit !== nb.unit) continue;
            if (UNCOMPARABLE_UNITS.test(na.unit)) continue;
            if (na.unit === 'pct' && (na.value > 100 || nb.value > 100)) continue;
            const denom = Math.max(Math.abs(na.value), Math.abs(nb.value), 1);
            const diff = Math.abs(na.value - nb.value) / denom;
            if (diff > o.tolerance && (na.value !== nb.value)) {
              results.push({
                type: 'numeric',
                severity: diff > 0.5 ? 'alta' : 'media',
                a: { id: a.id, text: a.text, value: na.value, unit: na.unit, pageNum: a.pageNum,
                  sourcePage: a.sentence?.sourcePage || null, docId: a.docId, docName: a.docName },
                b: { id: b.id, text: b.text, value: nb.value, unit: nb.unit, pageNum: b.pageNum,
                  sourcePage: b.sentence?.sourcePage || null, docId: b.docId, docName: b.docName },
                sharedTerms: shared.slice(0, 5),
                diff: Number(diff.toFixed(2)),
                reason: `${na.value}${na.unit === 'pct' ? '%' : ' ' + na.unit} frente a ${nb.value}${nb.unit === 'pct' ? '%' : ' ' + nb.unit} sobre ${shared.slice(0, 3).join(', ')}`
              });
            }
          }
        }

        if (a.polarity && b.polarity && a.polarity !== b.polarity && sharedCount >= o.minShared + 1) {
          results.push({
            type: 'polarity',
            severity: 'media',
            a: { id: a.id, text: a.text, polarity: a.polarity, pageNum: a.pageNum,
              sourcePage: a.sentence?.sourcePage || null, docId: a.docId, docName: a.docName },
            b: { id: b.id, text: b.text, polarity: b.polarity, pageNum: b.pageNum,
              sourcePage: b.sentence?.sourcePage || null, docId: b.docId, docName: b.docName },
            sharedTerms: shared.slice(0, 5),
            reason: `tendencia opuesta (${a.polarity > 0 ? 'aumenta' : 'reduce'} vs ${b.polarity > 0 ? 'aumenta' : 'reduce'}) sobre ${shared.slice(0, 3).join(', ')}`
          });
        }
        if (results.length >= o.max) return dedupeContradictions(results).slice(0, o.max);
      }
    }
    return dedupeContradictions(results).slice(0, o.max);
  }

  function dedupeContradictions(list) {
    const seen = new Set();
    return list.filter(c => {
      const key = [c.type, c.a.text.slice(0, 60), c.b.text.slice(0, 60)].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Esbozo por secciones
  // ─────────────────────────────────────────────────────────────────────────
  function outline(sentences) {
    const sections = [];
    let current = { title: 'Inicio', items: [], start: 0 };
    (sentences || []).forEach((s, i) => {
      const title = s.section || s.heading;
      if (title && title !== current.title) {
        if (current.items.length) sections.push(current);
        current = { title, items: [], start: i };
      }
      current.items.push(s);
    });
    if (current.items.length) sections.push(current);
    return sections.filter(s => s.items.length);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Preguntas socráticas y crítica
  // ─────────────────────────────────────────────────────────────────────────
  function socraticQuestions(chunks, claims, keyTerms) {
    const out = [];
    const push = (q, why) => { if (q && !out.some(x => x.q === q)) out.push({ q, why }); };
    const top = (claims || [])[0];

    if (top) {
      const num = top.numbers[0];
      if (num) push(`¿Qué representa ${num.raw}${num.unit === 'pct' ? '%' : ''} y bajo qué condiciones sería distinto?`, 'Revisa el contexto de la cifra');
      push(`¿Qué supuesto implícito debe cumplirse para que «${U.truncate(top.text, 90)}» sea cierto?`, 'Obliga a explicitar premisas');
    }
    if ((keyTerms || []).length >= 2) {
      push(`¿Qué relación causal existe entre «${keyTerms[0].term}» y «${keyTerms[1].term}»? ¿Correlación o causalidad?`, 'Distingue mecanismo de coincidencia');
    }
    (chunks || []).slice(0, 3).forEach((c, i) => {
      push(`Si eliminas «${U.words3(c.text)}», ¿qué parte del argumento se cae? (fuente [${c.index || i + 1}])`, 'Evalúa la estructura argumental');
    });
    const hasNumbers = (claims || []).some(c => c.numbers.length);
    if (!hasNumbers) push('No se detectaron cifras automáticamente: ¿harían falta datos cuantitativos para validar la tesis?', 'Considera posibles vacíos de evidencia');
    push('¿Qué contraejemplo haría falsa la tesis principal del material consultado?', 'Fomenta pensamiento crítico');
    return out.slice(0, 6);
  }

  function evidenceDensity(sentences) {
    const list = sentences || [];
    const withNumbers = list.filter(s => /\d/.test(textOf(s))).length;
    return { total: list.length, withNumbers, ratio: list.length ? withNumbers / list.length : 0 };
  }

  function critique(chunks, claims, contradictions) {
    const bullets = [];
    // Solo contar el texto mostrado, no el ancla completa ni palabras clave
    // que pudieron quedar fuera del contexto por filtros o exclusiones.
    const density = evidenceDensity(chunks || []);
    if (density.ratio < 0.25) {
      bullets.push({ kind: 'warn', text: `Baja presencia de cifras: ${density.withNumbers}/${density.total} fragmentos contienen dígitos.` });
    } else {
      bullets.push({ kind: 'ok', text: `Se detectan dígitos en ${density.withNumbers}/${density.total} fragmentos; verifica qué representan.` });
    }
    if ((contradictions || []).length) {
      bullets.push({ kind: 'alert', text: `Se detectaron ${contradictions.length} posibles contradicciones (cifras o tendencias opuestas) entre fuentes.` });
    }
    const unsupported = (claims || []).filter(c => c.numbers.length === 0 && /(siempre|nunca|todos|ninguno|garantiza|demuestra|es evidente)/i.test(c.text));
    unsupported.slice(0, 3).forEach(c => {
      bullets.push({ kind: 'warn', text: `Afirmación absoluta sin dato adjunto: «${U.truncate(c.text, 110)}»` });
    });
    // El número de página por sí solo no identifica una fuente: dos
    // documentos pueden tener página 1 y una ficha local puede no tener página.
    const locations = (chunks || []).map(c => {
      const doc = c.docId || c.sentence?.docId || c.docName || c.sentence?.docName;
      const page = c.sourcePage ?? c.sentence?.sourcePage ?? c.pageNum ?? c.sentence?.pageNum;
      return doc && page != null ? JSON.stringify([doc, page]) : null;
    });
    if (locations.length > 2 && locations.every(Boolean) && new Set(locations).size === 1) {
      bullets.push({ kind: 'warn', text: 'Toda la evidencia proviene de una sola página del mismo documento: riesgo de sesgo de fuente.' });
    }
    return bullets;
  }

  function rubric(answer) {
    const text = String(answer || '');
    const checks = [
      { id: 'definicion', label: 'Define el concepto', ok: /(es un|es una|se define|se entiende|consiste|significa)/i.test(text) },
      { id: 'mecanismo', label: 'Explica el mecanismo', ok: /(porque|debido|gracias a|mediante|implica|provoca|causa|de modo que)/i.test(text) },
      { id: 'evidencia', label: 'Aporta evidencia o cifra', ok: /\d/.test(text) },
      { id: 'limite', label: 'Reconoce límites', ok: /(sin embargo|no obstante|límite|limitación|salvo|siempre que|supuesto)/i.test(text) },
      { id: 'cita', label: 'Cita la fuente', ok: /\[\d{1,2}\]|pág(ina)?\s*\d+/i.test(text) }
    ];
    const score = checks.filter(c => c.ok).length / checks.length;
    return { checks, score, scorePct: Math.round(score * 100) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Generación de ítems de estudio (quiz con distractores reales)
  // ─────────────────────────────────────────────────────────────────────────
  function pickAnswerTerm(text) {
    const words = (String(text || '').match(/[\p{L}]{6,}/gu) || [])
      .filter(w => !U.isStopword(U.normalize(w)));
    if (!words.length) return null;
    const counts = new Map();
    words.forEach(w => counts.set(U.normalize(w), (counts.get(U.normalize(w)) || 0) + 1));
    return words.filter(w => counts.get(U.normalize(w)) === 1).sort((a, b) => b.length - a.length)[0] || null;
  }

  function quizItems(sentences, opts) {
    const o = Object.assign({ n: 5, minLen: 60 }, opts || {});
    const random = o.random || Math.random;
    function shuffle(list) {
      const a = [...list];
      for (let i = a.length - 1; i > 0; --i) {
        const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    const pool = (sentences || []).filter(s => textOf(s).length >= o.minLen);
    if (pool.length < 2) return [];

    // Bolsa de términos candidatos de todo el corpus (para distractores plausibles)
    const vocab = [];
    const seenStem = new Set(), answers = new Map();
    pool.forEach(s => {
      answers.set(s, pickAnswerTerm(textOf(s)));
      U.analyze(textOf(s)).raw.forEach(w => {
        const st = U.stem(w);
        if (w.length < 6 || U.isStopword(U.normalize(w)) || seenStem.has(st)) return;
        seenStem.add(st);
        vocab.push(w);
      });
    });

    const shuffled = shuffle(pool).slice(0, Math.max(o.n * 4, 12));
    const items = [];
    const usedAnswers = new Set();

    for (const s of shuffled) {
      if (items.length >= o.n) break;
      const text = textOf(s);
      const answer = answers.get(s);
      if (!answer || usedAnswers.has(answer.toLowerCase())) continue;
      if (text.split(answer).length - 1 !== 1) continue;

      const excluded = new Set(U.tokens(text)); excluded.add(U.stem(answer));
      const near = d => Math.abs(d.length - answer.length) <= Math.max(6, answer.length * 0.6) && !excluded.has(U.stem(d));

      // 1º distractores del mismo clúster/documento, 2º del vocabulario global
      const sameDoc = pool.filter(x => x !== s && (x.docId === s.docId || (s.cluster && x.cluster === s.cluster)))
        .map(x => answers.get(x)).filter(Boolean).filter(near);
      const global = vocab.filter(near);

      const candidates = [];
      for (const cand of [...sameDoc, ...shuffle(global)]) {
        const low = cand.toLowerCase();
        if (candidates.some(c => c.toLowerCase() === low)) continue;
        candidates.push(cand);
        if (candidates.length === 3) break;
      }
      if (candidates.length < 3) continue;

      const options = shuffle([answer, ...candidates]);
      usedAnswers.add(answer.toLowerCase());
      items.push({
        id: 'q-' + (s.id || U.hash(text)),
        prompt: text.replace(answer, '________'),
        answer,
        options,
        sentence: s,
        pageNum: s.pageNum,
        docName: s.docName,
        cluster: s.cluster || null
      });
    }
    return items;
  }

  /** Genera flashcards a partir de nodos (frente = etiqueta, reverso = texto + cita). */
  function flashcardsFromNodes(nodes) {
    return (nodes || []).filter(n => !n.isHub && n.label && n.text).map(n => ({
      id: 'fc-' + (n.id || U.hash(n.label)),
      front: n.label,
      back: n.text,
      pageNum: (n.pageNums && n.pageNums[0]) || 1,
      cluster: n.cluster,
      sentenceId: (n.sentenceIds && n.sentenceIds[0]) || null,
      nodeId: n.id
    }));
  }

  return {
    textRank, summarize, keyphrases,
    extractClaims, detectContradictions, detectUnit,
    outline, socraticQuestions, evidenceDensity, critique, rubric,
    pickAnswerTerm, quizItems, flashcardsFromNodes
  };
});
