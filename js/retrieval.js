/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/retrieval.js — Motor de recuperación local: índice invertido, BM25+, bigramas,
 * similitud difusa por trigramas, fusión con vectores densos (RRF), MMR y ensamblado
 * de contexto con citas.
 *
 * Módulo puro (sin DOM): ejecutable en Node con `require`.
 * Complejidad de consulta: O(términos del query + postings visitados), nunca O(N²).
 */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./util.js')
    : (root.NCUtil || {});
  const api = factory(U);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCRetrieval = Object.assign(root.NCRetrieval || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';

  const SCHEMA = 3;
  const K1 = 1.5;
  const B = 0.75;
  const BIGRAM_WEIGHT = 0.35;

  const stem = U.stem || (w => String(w || '').toLowerCase());

  // ─────────────────────────────────────────────────────────────────────────
  // Índice
  // ─────────────────────────────────────────────────────────────────────────
  function createIndex() {
    return {
      schema: SCHEMA,
      sentences: [],
      posById: new Map(),
      postings: new Map(),   // término → Map(pos → tf)
      termGrams: new Map(),  // trigrama → vocabulario (corrección de erratas)
      bigrams: new Map(),    // "a|b"   → Map(pos → 1)
      df: new Map(),
      lens: [],              // nº de tokens por oración (para BM25)
      chars: [],             // longitud en caracteres
      stems: [],             // Set de stems por oración (MMR, dedupe, similitud)
      vectors: new Map(),    // pos → Float32Array (capa densa opcional)
      avgdl: 1,
      totalTokens: 0,
      builtAt: Date.now()
    };
  }

  function addSentence(index, sentence) {
    const id = sentence.id || U.uid('s');
    if (index.posById.has(id)) return index.posById.get(id);
    const pos = index.sentences.length;
    const s = Object.assign({}, sentence, { id });
    index.sentences.push(s);
    index.posById.set(id, pos);

    const toks = U.tokens(s.text);
    const lens = toks.length;
    index.lens[pos] = lens;
    index.chars[pos] = s.text.length;
    index.totalTokens += lens;

    const stemSet = new Set();
    const seen = new Set();
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      stemSet.add(t);
      let p = index.postings.get(t);
      if (!p) {
        p = new Map(); index.postings.set(t, p);
        U.trigrams(t).forEach(g => {
          let terms = index.termGrams.get(g);
          if (!terms) index.termGrams.set(g, (terms = new Set()));
          terms.add(t);
        });
      }
      p.set(pos, (p.get(pos) || 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        index.df.set(t, (index.df.get(t) || 0) + 1);
      }
      if (i + 1 < toks.length && toks[i + 1] !== t) {
        const key = t + '|' + toks[i + 1];
        let bp = index.bigrams.get(key);
        if (!bp) { bp = new Map(); index.bigrams.set(key, bp); }
        bp.set(pos, 1);
      }
    }
    index.stems[pos] = stemSet;
    index.avgdl = index.totalTokens / (index.sentences.length || 1);
    return pos;
  }

  function addSentences(index, sentences) {
    let added = 0;
    for (const s of sentences || []) {
      const before = index.sentences.length;
      addSentence(index, s);
      if (index.sentences.length > before) added++;
    }
    return added;
  }

  function removeDoc(index, docId) {
    const keep = index.sentences.map((s, i) => ({ s, i })).filter(x => x.s.docId !== docId);
    const fresh = createIndex();
    keep.forEach(x => addSentence(fresh, x.s));
    Object.keys(index).forEach(k => { delete index[k]; });
    Object.assign(index, fresh);
  }

  function rebuildFrom(sentences) {
    const idx = createIndex();
    addSentences(idx, sentences);
    return idx;
  }

  function stats(index) {
    const docs = new Set(index.sentences.map(s => s.docId));
    return {
      sentences: index.sentences.length,
      docs: docs.size,
      terms: index.postings.size,
      bigrams: index.bigrams.size,
      tokens: index.totalTokens,
      avgdl: index.avgdl,
      vectors: index.vectors.size,
      builtAt: index.builtAt
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Parser de consulta: filtros, frases y exclusiones
  // ─────────────────────────────────────────────────────────────────────────
  function parseQuery(raw) {
    const text = String(raw || '');
    const filters = { docs: [], pages: [], exclude: [], phrases: [] };
    let rest = text;

    // =doc:algo  |  =doc:"dos palabras"
    rest = rest.replace(/=doc:\s*("[^"]+"|'[^']+'|\S+)/gi, (_, v) => {
      filters.docs.push(v.replace(/^["']|["']$/g, '').toLowerCase());
      return ' ';
    });
    // =pag:12  |  =page:12  |  =p12
    rest = rest.replace(/=(?:pag(?:e|ina)?|p):?\s*(\d+)/gi, (_, v) => {
      filters.pages.push(Number(v));
      return ' ';
    });
    // -excluir
    rest = rest.replace(/(^|\s)-([a-záéíóúñü0-9]{3,})/gi, (_, pre, v) => {
      filters.exclude.push(v.toLowerCase());
      return pre;
    });
    // "frase exacta"
    rest = rest.replace(/"([^"]{3,})"/g, (_, v) => {
      filters.phrases.push(v.toLowerCase());
      return ' ' + v + ' ';
    });

    const terms = U.tokens(rest);
    return {
      raw: text,
      cleaned: rest.trim(),
      terms,
      uniqueTerms: Array.from(new Set(terms)),
      filters,
      hasFilters: !!(filters.docs.length || filters.pages.length || filters.exclude.length || filters.phrases.length)
    };
  }

  function passesFilters(sentence, filters) {
    if (!filters) return true;
    if (filters.docs && filters.docs.length) {
      const name = String(sentence.docName || '').toLowerCase();
      const id = String(sentence.docId || '').toLowerCase();
      if (!filters.docs.some(d => name.includes(d) || id.includes(d))) return false;
    }
    // En PDF, la cita visible usa la página original; pageNum es solo la
    // página interna del visor (una página física puede dividirse en varias).
    if (filters.pages && filters.pages.length && !filters.pages.includes(Number(sentence.sourcePage || sentence.pageNum))) return false;
    if (filters.phrases && filters.phrases.length) {
      const text = U.normalize(sentence.text || '');
      if (!filters.phrases.every(phrase => text.includes(U.normalize(phrase)))) return false;
    }
    return true;
  }

  function containsExcluded(sentence, filters) {
    if (!filters || !filters.exclude || !filters.exclude.length) return false;
    const hay = U.normalize(sentence.text || '');
    return filters.exclude.some(x => hay.includes(U.normalize(x)));
  }

  /**
   * Proyecta ventanas sin los componentes excluidos. El ancla también debe
   * pasar el filtro; de lo contrario su cita llevaría al texto excluido.
   * Devuelve el índice original si ninguna ventana necesita cambiar.
   */
  function projectExclusions(index, filters) {
    if (!filters?.exclude?.length) return index;
    let changed = false;
    const sentences = [];
    for (const sentence of index.sentences) {
      if (!containsExcluded(sentence, filters)) { sentences.push(sentence); continue; }
      changed = true;
      if (!Array.isArray(sentence.parts) || containsExcluded({ text: sentence.sourceText || '' }, filters)) continue;
      const parts = sentence.parts.filter(part => !containsExcluded(part, filters));
      if (!parts.some(part => part.id === sentence.id)) continue;
      const text = parts.map(part => part.text).join(' ');
      sentences.push({ ...sentence, parts, text, contextText: sentence.section ? `${sentence.section}\n${text}` : text });
    }
    if (!changed) return index;
    const projected = rebuildFrom(sentences);
    // La proyección determinista depende solo del cuerpo. Reutilizar vectores
    // intactos evita recalcular todo el corpus al excluir una oración vecina.
    projected.concepts = [];
    projected.sentences.forEach((sentence, pos) => {
      const oldPos = index.posById.get(sentence.id);
      if (oldPos == null || index.sentences[oldPos].text !== sentence.text) return;
      if (index.vectors.has(oldPos) && index.concepts?.[oldPos]) {
        projected.vectors.set(pos, index.vectors.get(oldPos));
        projected.concepts[pos] = index.concepts[oldPos];
      }
    });
    return projected;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Búsqueda léxica: BM25+ con coordinación y bigramas
  // ─────────────────────────────────────────────────────────────────────────
  function bm25Scores(index, parsed) {
    const { postings, df, lens, avgdl } = index;
    const N = index.sentences.length || 1;
    const scores = new Map();
    const matched = new Map();

    for (const t of parsed.uniqueTerms) {
      const p = postings.get(t);
      if (!p) continue;
      const dfi = df.get(t) || 0;
      const idf = Math.log(1 + (N - dfi + 0.5) / (dfi + 0.5));
      for (const [pos, tf] of p) {
        const norm = 1 - B + B * (lens[pos] / (avgdl || 1));
        const contribution = idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
        scores.set(pos, (scores.get(pos) || 0) + contribution);
        matched.set(pos, (matched.get(pos) || 0) + 1);
      }
    }

    // Bigramas del query: premian la coincidencia de frases consecutivas
    for (let i = 0; i < parsed.terms.length - 1; i++) {
      const key = parsed.terms[i] + '|' + parsed.terms[i + 1];
      const bp = index.bigrams.get(key);
      if (!bp) continue;
      for (const pos of bp.keys()) {
        scores.set(pos, (scores.get(pos) || 0) + BIGRAM_WEIGHT * (scores.get(pos) > 0 ? 1 : 1));
        matched.set(pos, (matched.get(pos) || 0) + 0.5);
      }
    }

    // Frases exactas (substring sobre el texto normalizado)
    if (parsed.filters.phrases.length) {
      const nq = parsed.filters.phrases.map(p => U.normalize(p));
      for (let pos = 0; pos < index.sentences.length; pos++) {
        const hay = U.normalize(index.sentences[pos].text);
        for (const ph of nq) {
          if (hay.includes(ph) && scores.has(pos)) scores.set(pos, scores.get(pos) * 2.2 + 2);
        }
      }
    }

    // Coordinación: favorece oraciones que cubren más términos del query
    const qn = parsed.uniqueTerms.length || 1;
    for (const [pos, s] of scores) {
      const cov = Math.min(1, (matched.get(pos) || 0) / qn);
      scores.set(pos, s * (0.72 + 0.28 * cov));
    }
    return scores;
  }

  function fuzzyExpand(index, parsed) {
    const extra = new Set();
    for (const term of parsed.uniqueTerms) {
      if (term.length < 4 || index.postings.has(term)) continue;
      const options = new Set();
      U.trigrams(term).forEach(g => (index.termGrams.get(g) || []).forEach(t => {
        if (Math.abs(t.length - term.length) <= 2) options.add(t);
      }));
      [...options].map(t => ({ t, sim: U.trigramSim(term, t) }))
        .filter(x => x.sim >= 0.42).sort((a, b) => b.sim - a.sim).slice(0, 2)
        .forEach(x => extra.add(x.t));
    }
    if (!extra.size) return parsed;
    return { ...parsed, uniqueTerms: [...parsed.uniqueTerms, ...extra], fuzzyTerms: [...extra] };
  }

  /** Coseno real entre vectores de consulta y pasajes. */
  function vectorScores(index, queryText, candidates) {
    const out = new Map();
    const qVec = index.queryVectorCache && index.queryVectorCache[queryText];
    if (!qVec) return out;
    for (const pos of candidates || index.vectors.keys()) {
      const vector = index.vectors.get(pos);
      if (vector) out.set(pos, U.cosine(qVec, vector));
    }
    return out;
  }

  /** Búsqueda híbrida: unión léxica/densa y Reciprocal Rank Fusion (RRF). */
  function search(index, query, opts) {
    const o = Object.assign({ k: 8, pool: 60, diversify: true, lambda: 0.7, fuzzy: true }, opts || {});
    const parsed = o.parsed || parseQuery(query);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!index || !index.sentences.length) return { hits: [], parsed, tookMs: 0, total: 0 };
    const eligible = s => passesFilters(s, parsed.filters) && !containsExcluded(s, parsed.filters);
    const effective = o.fuzzy ? fuzzyExpand(index, parsed) : parsed;
    const lex = bm25Scores(index, effective);
    const lexList = [];
    for (const [pos, score] of lex) if (eligible(index.sentences[pos])) lexList.push({ pos, score });
    // Los filtros solos permiten explorar páginas; con términos nunca se inventan resultados.
    if (!parsed.uniqueTerms.length && (parsed.filters.docs.length || parsed.filters.pages.length)) {
      index.sentences.forEach((s, pos) => { if (eligible(s)) lexList.push({ pos, score: 0 }); });
    }
    lexList.sort((a, b) => b.score - a.score || a.pos - b.pos);
    const lexPool = lexList.slice(0, o.pool);
    const candidateSet = new Map();
    lexPool.forEach((entry, i) => candidateSet.set(entry.pos, {
      pos: entry.pos, lexScore: entry.score, lexRank: i + 1, dense: 0, denseRank: 0
    }));

    const queryConcepts = o.queryConcepts || [];
    const queryVec = index.queryVectorCache && index.queryVectorCache[query];
    if (queryVec && parsed.uniqueTerms.length) {
      // El filtro por conceptos evita que colisiones del hash inventen evidencia.
      const candidates = [];
      for (const [pos] of index.vectors) {
        const concepts = index.concepts && index.concepts[pos];
        if (concepts && queryConcepts.length && !queryConcepts.some(c => concepts.has(c))) continue;
        if (eligible(index.sentences[pos])) candidates.push(pos);
      }
      const dense = [...vectorScores(index, query, candidates)]
        .filter(([, score]) => score > 0.08)
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, o.pool);
      dense.forEach(([pos, score], i) => {
        const item = candidateSet.get(pos) || { pos, lexScore: 0, lexRank: 0 };
        item.dense = score; item.denseRank = i + 1;
        candidateSet.set(pos, item);
      });
    }
    // MiniLM puede ordenar candidatos existentes con una señal moderada, pero
    // necesita una similitud más alta para añadir pasajes sin apoyo léxico.
    // Son umbrales prudentes, no una garantía de que el pasaje responda.
    const neural = [];
    if (o.neuralScores && parsed.uniqueTerms.length) {
      for (const [id, score] of o.neuralScores) {
        const pos = index.posById.get(id);
        if (pos == null || !Number.isFinite(score) || score < .42 || !eligible(index.sentences[pos])) continue;
        if (!candidateSet.has(pos) && score < .58) continue;
        neural.push({ pos, score });
      }
      neural.sort((a, b) => b.score - a.score || a.pos - b.pos);
      neural.slice(0, o.pool).forEach((entry, i) => {
        const item = candidateSet.get(entry.pos) || { pos: entry.pos, lexScore: 0, lexRank: 0, dense: 0, denseRank: 0 };
        item.neural = entry.score; item.neuralRank = i + 1;
        candidateSet.set(entry.pos, item);
      });
    }
    let ranked = [...candidateSet.values()].map(item => {
      const sentence = index.sentences[item.pos];
      const fuzzy = o.fuzzy ? U.trigramSim(parsed.cleaned || parsed.raw, sentence.text) : 0;
      // RRF favorece acuerdos entre rankings sin mezclar escalas incompatibles.
      const rrf = (item.lexRank ? 1 / (60 + item.lexRank) : 0) + (item.denseRank ? 1 / (60 + item.denseRank) : 0) + (item.neuralRank ? 1 / (60 + item.neuralRank) : 0);
      const adjustment = typeof o.scoreFactor === 'function' ? Number(o.scoreFactor(sentence)) : 1;
      const factor = Number.isFinite(adjustment) ? Math.max(.35, Math.min(1.65, adjustment)) : 1;
      // Solo se reordenan candidatos con evidencia; el feedback no crea hits.
      return { ...item, sentence, fuzzy, score: (rrf + fuzzy * 0.001) * factor };
    }).sort((a, b) => b.score - a.score || a.pos - b.pos);

    const deduped = [];
    for (const r of ranked) {
      const st = index.stems[r.pos] || new Set();
      const duplicate = deduped.find(d => U.jaccard(st, index.stems[d.pos] || new Set()) > 0.82);
      if (duplicate) { duplicate.merged = (duplicate.merged || 1) + 1; continue; }
      deduped.push(r);
    }
    let selected = deduped;
    if (o.diversify && deduped.length > 1) {
      const chosen = [], candidates = deduped.slice(0, Math.max(o.k * 4, 20));
      const maxScore = candidates[0].score || 1;
      const lambda = Math.min(1, Math.max(0, o.lambda));
      while (chosen.length < o.k && candidates.length) {
        let best = -Infinity, bestIdx = 0;
        for (let i = 0; i < candidates.length; i++) {
          let maxSim = 0;
          for (const prior of chosen) maxSim = Math.max(maxSim, U.jaccard(index.stems[candidates[i].pos], index.stems[prior.pos]));
          const mmr = lambda * candidates[i].score / maxScore - (1 - lambda) * maxSim;
          if (mmr > best) { best = mmr; bestIdx = i; }
        }
        chosen.push(candidates.splice(bestIdx, 1)[0]);
      }
      selected = chosen;
    }
    const took = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    const hits = selected.slice(0, o.k).map((r, i) => ({
      rank: i + 1, sentence: r.sentence, score: Number(r.score.toFixed(6)),
      lexScore: Number((r.lexScore || 0).toFixed(4)), fuzzy: Number((r.fuzzy * 100).toFixed(1)),
      dense: Number((r.dense || 0).toFixed(3)), neural: Number((r.neural || 0).toFixed(3)), merged: r.merged || 1
    }));
    return { hits, parsed, tookMs: Number(took.toFixed(2)), total: Math.max(lexList.length, candidateSet.size), pool: candidateSet.size,
      neuralUsed: hits.some(hit => hit.neural > 0),
      neuralOnly: hits.some(hit => hit.neural > 0 && !hit.lexScore && !hit.dense) };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ensamblado de contexto con ventana y citas
  // ─────────────────────────────────────────────────────────────────────────
  function buildContext(index, hits, opts) {
    const o = Object.assign({ window: 1, maxChars: 7000, maxChunks: 6 }, opts || {});
    const usedParts = new Set(), chunks = [];
    let chars = 0;

    for (const hit of hits || []) {
      if (chunks.length >= o.maxChunks) break;
      const pos = index.posById.get(hit.sentence.id);
      if (pos == null) continue;
      const base = index.sentences[pos];
      if (usedParts.has(base.id) || !passesFilters(base, o.filters) || containsExcluded(base, o.filters)) continue;
      const parts = new Map();
      for (let d = -o.window; d <= o.window; d++) {
        const s = index.sentences[pos + d];
        if (!s || s.docId !== base.docId || s.pageNum !== base.pageNum ||
            (s.sourcePage || null) !== (base.sourcePage || null) || (s.section || '') !== (base.section || '')) continue;
        // Las partes se identifican por ID, no por el texto: evita repetir las
        // ventanas solapadas, sin fusionar dos oraciones iguales del original.
        const components = Array.isArray(s.parts) ? s.parts : [{ id: s.id, text: s.text }];
        for (const part of components) {
          if (!usedParts.has(part.id) && !containsExcluded(part, o.filters) && !parts.has(part.id)) parts.set(part.id, part);
        }
      }
      if (!parts.has(base.id)) continue;
      const ordered = [...parts.values()].sort((a, b) => (index.posById.get(a.id) ?? pos) - (index.posById.get(b.id) ?? pos));
      let selected = ordered, text = ordered.map(part => part.text).join(' ');
      if (chars + text.length > o.maxChars && chunks.length > 0) break;
      if (text.length > o.maxChars) {
        if (o.maxChars <= 0) break;
        // Si el primer contexto excede el límite, la cita debe seguir
        // conteniendo su propia ancla, no solo una vecina larga anterior.
        const anchorIndex = ordered.findIndex(part => part.id === base.id);
        const anchor = ordered[anchorIndex];
        const keep = new Set([base.id]);
        let size = anchor.text.length;
        if (size <= o.maxChars) {
          for (let distance = 1; distance < ordered.length; distance++) {
            for (const i of [anchorIndex - distance, anchorIndex + distance]) {
              const part = ordered[i];
              if (part && size + 1 + part.text.length <= o.maxChars) { keep.add(part.id); size += 1 + part.text.length; }
            }
          }
        }
        selected = ordered.filter(part => keep.has(part.id));
        text = selected.map(part => part.id === base.id ? U.truncate(part.text, o.maxChars) : part.text).join(' ');
      }
      if (!text) continue;
      selected.forEach(part => usedParts.add(part.id));
      chars += text.length;
      chunks.push({
        index: chunks.length + 1,
        id: base.id,
        sentence: base,
        sentenceIds: selected.map(part => part.id),
        text,
        pageNum: base.pageNum,
        sourcePage: base.sourcePage || null,
        docId: base.docId,
        docName: base.docName,
        section: base.section || '',
        score: hit.score,
        fuzzy: hit.fuzzy,
        dense: hit.dense
      });
    }
    return chunks;
  }

  /** Comprueba existencia y solapamiento léxico. No demuestra verdad o causalidad. */
  function verifyCitations(text, sources) {
    const list = typeof sources === 'number' ? Array.from({ length: sources }, () => null) : (sources || []);
    const cited = [], re = /\[(\d{1,2})\]/g;
    const answer = String(text || '');
    let match;
    while ((match = re.exec(answer))) {
      const n = Number(match[1]), ok = n >= 1 && n <= list.length;
      let supported = null, overlap = 0;
      if (ok && list[n - 1] && list[n - 1].text) {
        const before = answer.slice(0, match.index).split('\n').pop().slice(-500);
        const terms = new Set(U.tokens(before));
        const sourceTerms = new Set(U.tokens(list[n - 1].text));
        for (const t of terms) if (sourceTerms.has(t)) overlap++;
        supported = overlap >= Math.min(2, sourceTerms.size) && sourceTerms.size > 0;
      }
      cited.push({ n, ok, supported, overlap });
    }
    const unverified = [...new Set(cited.filter(c => !c.ok).map(c => c.n))];
    const weak = [...new Set(cited.filter(c => c.ok && c.supported === false).map(c => c.n))];
    const used = [...new Set(cited.filter(c => c.ok).map(c => c.n))].sort((a, b) => a - b);
    return { cited, unverified, weak, used, coverage: list.length ? used.length / list.length : 0,
      allValid: unverified.length === 0, allSupported: unverified.length === 0 && weak.length === 0 };
  }

  /** Expansión de consulta por sinónimos aprendidos del grafo/vault. */
  function expandQuery(parsed, synonyms) {
    const extra = new Set();
    for (const t of parsed.uniqueTerms) {
      const list = synonyms && (synonyms[t] || synonyms[U.normalize(t)]);
      if (list) list.forEach(x => U.tokens(x).forEach(st => { if (st && !parsed.uniqueTerms.includes(st) && extra.size < 12) extra.add(st); }));
    }
    if (!extra.size) return parsed;
    const terms = parsed.terms.concat(Array.from(extra));
    return Object.assign({}, parsed, {
      terms,
      uniqueTerms: Array.from(new Set(terms)),
      expanded: Array.from(extra)
    });
  }

  return {
    SCHEMA,
    createIndex, addSentence, addSentences, rebuildFrom, removeDoc, stats,
    parseQuery, passesFilters, containsExcluded, projectExclusions,
    bm25Scores, fuzzyExpand, vectorScores, search,
    buildContext, verifyCitations, expandQuery
  };
});
