/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/rag.js — Tubería de respuesta (RAG local):
 *   consulta → filtros → recuperación híbrida → contexto con citas → router de modelos
 *   → verificación de citas → memoria/aprendizaje.
 *
 * El compositor interno (extractivo y local, sin modelo generativo) produce respuestas
 * estructuradas y verificables con TextRank, afirmaciones y crítica.
 */
(function (root, factory) {
  const U = root.NCUtil || {};
  const R = root.NCRetrieval || {};
  const A = root.NCAnalysis || {};
  const P = root.NCProviders || {};
  const M = root.NCMemory || {};
  const api = factory(U, R, A, P, M);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCRag = Object.assign(root.NCRag || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U, R, A, P, M) {
  'use strict';

  const MAX_CONTEXT_CHARS = 7000;
  let contradictionCache = { key: '', value: [] };

  const store = () => (typeof window !== 'undefined' ? window.NeuralStore : (globalThis.NeuralStore || null));

  // ─────────────────────────────────────────────────────────────────────────
  // Intención
  // ─────────────────────────────────────────────────────────────────────────
  function detectIntent(question) {
    const q = U.normalize(question || '');
    if (/^(hola|buenas|hey|que tal|saludos|buenos dias|buenas tardes|buenas noches)\b/.test(q) && q.split(/\s+/).length <= 14) return 'smalltalk';
    if (/^(aprende|consolida|recuerda|guarda|memoriza)\b/.test(q)) return 'learn';
    if (/^(calcula|cuanto es|cuanto vale|resultado de)\b/.test(q) || /^[\d\s().+\-*/%^]+$/.test(q)) return 'math';
    if (/(resum|sintetiza|sintesis|de que trata|idea principal|panorama)/.test(q)) return 'resumen';
    if (/(critic|debilidad|falla|sesgo|contradic|inconsisten|revisa|evalua)/.test(q)) return 'critico';
    if (/(redacta|ensayo|articulo|escribe un|escribe una|monografia)/.test(q)) return 'redaccion';
    if (/(guiame|preguntas|socratic|pista|hazme pensar|ensename a pensar)/.test(q)) return 'socratico';
    if (/(explica|por que|como funciona|mecanismo|define|que es|diferencia|compara)/.test(q)) return 'examen';
    return 'auto';
  }

  function resolveMode(question, requested) {
    if (requested && requested !== 'auto') return requested;
    const intent = detectIntent(question);
    if (['resumen', 'critico', 'redaccion', 'socratico', 'examen'].includes(intent)) return intent;
    return 'examen';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilidades de composición
  // ─────────────────────────────────────────────────────────────────────────
  const cite = n => ` [${n}]`;

  function stripTrailingPunct(t) {
    return String(t || '').trim().replace(/\s+$/, '');
  }

  function topNumberClaim(chunks, claims) {
    const ids = new Set(chunks.map(c => c.id));
    const local = claims.filter(c => ids.has(c.id) && c.numbers.some(n => n.unit));
    if (!local.length) return null;
    local.sort((a, b) => {
      const aPct = a.numbers.some(n => n.unit === 'pct') ? 1 : 0;
      const bPct = b.numbers.some(n => n.unit === 'pct') ? 1 : 0;
      return bPct - aPct || b.text.length - a.text.length;
    });
    return local[0];
  }

  const numberLabel = n => n.raw + (n.unit === 'pct' ? '%' : n.unit ? ' ' + n.unit : '');

  function chunkOf(claims, chunks, predicate) {
    for (const c of claims) {
      if (predicate(c)) {
        const idx = chunks.findIndex(x => x.id === c.id);
        if (idx >= 0) return { claim: c, citation: chunks[idx].index };
      }
    }
    return null;
  }

  function findMechanism(chunks) {
    const re = /\b(porque|mediante|cuando|implica|permite|gracias a|provoca|produce|aplica|recibe|transforma|conecta|debido a)\b/i;
    for (const chunk of chunks) {
      const sentence = U.sentenceSplit(chunk.text).find(text => re.test(text));
      if (sentence) return { claim: { text: sentence }, citation: chunk.index };
    }
    return null;
  }

  function relatedNodes(question, limit) {
    const S = store();
    if (!S) return [];
    const qs = new Set(U.tokens(question));
    return (S.state.nodes || [])
      .filter(n => !n.isHub)
      .map(n => {
        const ns = new Set(U.tokens((n.label || '') + ' ' + (n.text || '')));
        let overlap = 0;
        qs.forEach(t => { if (ns.has(t)) overlap++; });
        const direct = U.normalize(n.label).includes(U.normalize(question)) ? 2 : 0;
        return { n, score: overlap + direct + (n.weight || 1) * 0.05 };
      })
      .filter(x => x.score > (x.n.weight || 1) * 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.n);
  }

  function contradictionsForAll() {
    const S = store();
    if (!S) return [];
    const sents = S.state.allSentences || [];
    const key = sents.length + '|' + (S.state.docs || []).map(d => d.id).join('|');
    if (contradictionCache.key === key) return contradictionCache.value;
    const sample = sents.length > 1500 ? sents.slice(0, 1500) : sents;
    let value = [];
    try { value = A.detectContradictions(sample, { max: 20 }); } catch (e) { console.warn('[RAG] contradicciones:', e.message); }
    contradictionCache = { key, value };
    return value;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Compositor interno (extractivo, verificable, sin descargas)
  // ─────────────────────────────────────────────────────────────────────────
  function composeExtractive(ctx) {
    const chunks = ctx.chunks || [];
    const mode = ctx.mode || 'examen';

    if (!chunks.length) return noEvidenceAnswer(ctx);

    const items = chunks.map(c => ({ text: c.text, id: c.id, pageNum: c.pageNum, docName: c.docName }));
    const claims = A.extractClaims(items);
    const summary = A.summarize(items, Math.min(4, items.length));
    const keyphrases = A.keyphrases(items, 6);
    const contradictions = (ctx.contradictions || []).slice(0, 4);
    const critique = A.critique(chunks, claims, contradictions);

    if (mode === 'socratico') return composeSocratic(ctx, chunks, claims, keyphrases);
    if (mode === 'critico') return composeCritique(ctx, chunks, claims, contradictions, critique);
    if (mode === 'redaccion') return composeEssay(ctx, chunks, claims, keyphrases);
    if (mode === 'resumen') return composeResumen(ctx, chunks, claims, summary, critique);
    return composeExam(ctx, chunks, claims, summary, critique);
  }

  function noEvidenceAnswer(ctx) {
    const S = store();
    const suggestions = S && S.state.allSentences.length
      ? A.keyphrases(S.state.allSentences.slice(0, 400), 5).map(k => k.surface || k.term)
      : [];
    let out = `### Sin evidencia suficiente\n`;
    out += `No encontré fragmentos que respondan a «${ctx.question}» en los ${S ? S.state.allSentences.length : 0} pasajes indexados.\n\n`;
    if (ctx.facts && ctx.facts.length) out += `**Recuerdo guardado por ti (no verificado con documentos):** ${ctx.facts.map(f => f.fact).join('; ')}.\n\n`;
    if (suggestions.length) out += `**Términos que sí aparecen en el corpus:** ${suggestions.join(', ')}.\n\n`;
    out += `Puedes:\n- reformular con palabras del documento,\n- cargar más material,\n- o filtrar con \`=doc:nombre\`, \`=pag:12\` o \`"frase exacta"\`.`;
    return out;
  }

  function composeResumen(ctx, chunks, claims, summary, critique) {
    const first = chunks[0];
    const numeric = topNumberClaim(chunks, claims);
    const mechanism = findMechanism(chunks);
    const warn = critique.find(c => c.kind !== 'ok');

    let out = `### Síntesis del material\n`;
    const primary = summary[0] || { item: first };
    const primaryIndex = chunks.findIndex(c => c.id === primary.item.id) + 1;
    out += `**Tesis principal.** ${stripTrailingPunct(primary.item.text)}${cite(primaryIndex || 1)}\n\n`;

    if (summary.length > 1) {
      out += `**Ideas centrales.**\n`;
      summary.slice(1).forEach((s, i) => {
        const idx = chunks.findIndex(c => c.id === (s.item.id || '')) + 1;
        out += `- ${stripTrailingPunct(s.item.text).slice(0, 320)}${cite(idx > 0 ? idx : Math.min(i + 2, chunks.length))}\n`;
      });
      out += `\n`;
    }

    if (numeric) {
      const nums = numeric.numbers.filter(n => n.unit).slice(0, 3).map(numberLabel).join(', ');
      const idx = chunks.findIndex(c => c.id === numeric.id) + 1;
      out += `**Evidencia cuantitativa.** ${nums} — ${stripTrailingPunct(numeric.text).slice(0, 260)}${cite(idx || 1)}\n\n`;
    }
    if (mechanism) {
      out += `**Mecanismo.** ${stripTrailingPunct(mechanism.claim.text).slice(0, 300)}${cite(mechanism.citation)}\n\n`;
    }
    if (warn) out += `**Límite detectado.** ${warn.text}\n\n`;

    const last = summary[summary.length - 1];
    const lastIndex = chunks.findIndex(c => c.id === last.item.id) + 1;
    out += `**Conclusión.** ${stripTrailingPunct(last.item.text)}${cite(lastIndex || 1)}\n\n`;
    out += `> Basado en ${chunks.length} fragmento(s) de ${new Set(chunks.map(c => c.docName)).size} documento(s). Motor interno verificable.`;
    return out;
  }

  function composeExam(ctx, chunks, claims, summary, critique) {
    const numeric = topNumberClaim(chunks, claims);
    const mechanism = findMechanism(chunks);
    const limit = critique.find(c => c.kind !== 'ok');

    let out = `### 1. Definición\n`;
    out += `${stripTrailingPunct(chunks[0].sentence?.text || chunks[0].text)}${cite(1)}\n\n`;

    out += `### 2. Mecanismo\n`;
    if (mechanism) out += `${stripTrailingPunct(mechanism.claim.text)}${cite(mechanism.citation)}\n\n`;
    else out += `El material recuperado no describe claramente el mecanismo paso a paso.\n\n`;

    out += `### 3. Evidencia\n`;
    if (numeric) {
      const nums = numeric.numbers.filter(n => n.unit).slice(0, 3).map(numberLabel).join(', ');
      out += `Datos verificables: **${nums}**. ${stripTrailingPunct(numeric.text).slice(0, 300)}${cite(chunks.findIndex(c => c.id === numeric.id) + 1 || 1)}\n\n`;
    } else {
      out += `No hay cifras asociadas en los fragmentos recuperados.\n\n`;
    }

    out += `### 4. Límite o contraejemplo\n`;
    if (limit) out += `${limit.text}\n\n`;
    else out += `El material no explicita limitaciones; conviene contrastarlo con otra fuente.\n\n`;

    if (summary.length > 1) {
      const extra = summary[summary.length - 1];
      const idx = chunks.findIndex(c => c.id === extra.item.id) + 1;
      out += `**Cierre.** ${stripTrailingPunct(extra.item.text).slice(0, 320)}${cite(idx || chunks.length)}\n\n`;
    }
    out += `> ${chunks.length} fuente(s) · modo examen · sin datos inventados.`;
    return out;
  }

  function composeSocratic(ctx, chunks, claims, keyphrases) {
    const questions = A.socraticQuestions(chunks, claims, keyphrases);
    let out = `### Guía socrática\n`;
    out += `No te doy la respuesta: te doy el camino. Responde por escrito y vuelve a preguntarme.\n\n`;
    questions.forEach((q, i) => {
      const idx = Math.min(chunks.length, i + 1);
      out += `**${i + 1}.** ${q.q}\n   - *Por qué importa:* ${q.why} (pista en la fuente ${idx})\n`;
    });
    out += `\n**Pista de lectura.** Empieza por${cite(1)} y contrasta con${cite(Math.min(2, chunks.length))}. Si tus respuestas no se apoyan en el texto, vuelve a los fragmentos citados.`;
    return out;
  }

  function composeCritique(ctx, chunks, claims, contradictions, critique) {
    let out = `### Revisión crítica\n`;
    out += `**Fragmentos evaluados:** ${chunks.length} · **afirmaciones detectadas:** ${claims.length} · **contradicciones:** ${contradictions.length}.\n\n`;

    out += `**Solidez del respaldo.**\n`;
    critique.forEach(c => {
      const icon = c.kind === 'ok' ? '✅' : c.kind === 'alert' ? '⛔' : '⚠️';
      out += `- ${icon} ${c.text}\n`;
    });
    out += `\n`;

    if (contradictions.length) {
      out += `**Contradicciones entre fuentes.**\n`;
      contradictions.forEach(c => {
        const aPage = c.a.pageNum ? ` (Pág ${c.a.pageNum})` : '';
        const bPage = c.b.pageNum ? ` (Pág ${c.b.pageNum})` : '';
        out += `- ${c.type === 'numeric' ? 'Cifras' : 'Tendencias'} discrepantes: ${c.reason}.\n`;
        out += `  · «${U.truncate(c.a.text, 150)}»${aPage}\n`;
        out += `  · «${U.truncate(c.b.text, 150)}»${bPage}\n`;
      });
      out += `\n`;
    }

    const missing = [];
    if (!claims.some(c => c.numbers.length)) missing.push('ninguna cifra verificable');
    if (!chunks.some(c => /(metodolog|muestra|experimento|medici[oó]n)/i.test(c.text))) missing.push('descripción metodológica');
    if (new Set(chunks.map(c => c.pageNum)).size === 1 && chunks.length > 2) missing.push('diversidad de fuentes');
    if (missing.length) {
      out += `**Qué falta para sostener la tesis.**\n`;
      missing.forEach(m => { out += `- ${m}\n`; });
      out += `\n`;
    }

    out += `> Revisión automática sobre el corpus local. No sustituye la lectura crítica del original.`;
    return out;
  }

  function composeEssay(ctx, chunks, claims, keyphrases) {
    const title = U.truncate(ctx.question.replace(/^(redacta|escribe|elabora)\s+(un|una)?\s*/i, ''), 80) || 'Ensayo';
    const connectors = (typeof window !== 'undefined' && window.KimiAuxModel)
      ? window.KimiAuxModel.suggestConnectors(3) : ['además', 'en contraste', 'en síntesis'];
    let out = `### ${title}\n\n`;
    out += `**Introducción.** ${stripTrailingPunct(chunks[0].sentence?.text || chunks[0].text)}${cite(1)}\n\n`;
    chunks.slice(1, 4).forEach((chunk, i) => {
      const connector = connectors[i % connectors.length];
      out += `**Desarrollo ${i + 1}.** ${connector.charAt(0).toUpperCase() + connector.slice(1)}, ${stripTrailingPunct(chunk.sentence?.text || chunk.text)}${cite(chunk.index)}\n\n`;
    });
    const topics = keyphrases.slice(0, 3).map(k => k.surface || k.term).join(', ');
    out += `**Cierre.** Estos fragmentos abordan ${topics || 'el tema consultado'}. Las relaciones y conclusiones adicionales deben contrastarse con las fuentes.\n\n`;
    out += `> Borrador extractivo local: revisa y reescribe antes de entregarlo.`;
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Consulta principal
  // ─────────────────────────────────────────────────────────────────────────
  async function ask(question, opts) {
    const o = Object.assign({
      mode: null, provider: null, k: null, onToken: null, signal: null, forceProvider: false
    }, opts || {});
    const S = store();
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const q = String(question || '').trim();
    if (!q) return emptyResult(q);

    const intent = detectIntent(q);

    // 1. Comandos directos
    if (intent === 'learn') {
      const fact = q.replace(/^(aprende|consolida|recuerda|guarda|memoriza)(\s+que)?[:;\s-]*/i, '').trim();
      const entry = M.addFact ? M.addFact(fact) : null;
      if (fact && M.vaultAdd) M.vaultAdd({ phrase: fact, detail: fact });
      const text = fact
        ? `✅ **Conocimiento consolidado.** Guardé: «${fact}».\n\nSe usará en futuras respuestas y en la Bóveda.`
        : `No detecté el contenido a memorizar. Escribe, por ejemplo: *Aprende que la latencia es 12 ms*.`;
      return finalize({ question: q, text, provider: 'internal', model: 'memoria', mode: 'learn', chunks: [], citations: null, intent, t0, S, extra: { fact: entry } });
    }

    if (intent === 'math') {
      const expr = q.replace(/^(calcula|cuanto es|cuanto vale|resultado de)\s*/i, '').replace(/[?¿]/g, '').trim();
      const value = U.evaluateArithmetic(expr);
      const text = value == null
        ? `No pude evaluar «${expr}» como expresión aritmética. Admite + - * / % ^ y funciones como sqrt(), log(), sin().`
        : `🧮 **${expr} = ${value}**\n\nCalculado con el evaluador aritmético interno (sin ejecutar código).`;
      return finalize({ question: q, text, provider: 'internal', model: 'calculadora', mode: 'math', chunks: [], citations: null, intent, t0, S });
    }

    if (intent === 'smalltalk') {
      const st = S ? S.stats() : { docs: 0, sentences: 0, nodes: 0 };
      const refl = M.selfReflection ? M.selfReflection() : null;
      const text = `¡Hola! Soy **KIMI-CORE v11**, tu cerebro local. Tengo ${st.docs} documento(s), ${st.sentences} pasajes y ${st.nodes} conceptos en la red.` +
        (refl ? `\n\n${refl.text}` : '') +
        `\n\nPuedo resumir, explicar como en un examen, hacerte preguntas socráticas, criticar el material o redactar. También acepto filtros: \`=doc:nombre\`, \`=pag:12\`, \`"frase exacta"\` y \`-excluir\`.`;
      return finalize({ question: q, text, provider: 'internal', model: 'kimi-core', mode: 'auto', chunks: [], citations: null, intent, t0, S });
    }

    // 2. Recuperación
    const mode = resolveMode(q, o.mode || (S ? S.getSetting('mode', 'auto') : 'auto'));
    const k = o.k || (S ? S.getSetting('topK', 6) : 6);
    const window_ = S ? S.getSetting('window', 1) : 1;

    let neuralScores = null;
    const localModel = typeof window !== 'undefined' ? window.NCLocalModel : null;
    if (S && S.getSetting('embedEnabled', true) && localModel?.info().enabled) {
      try { neuralScores = await localModel.scores(R.parseQuery(q).cleaned); }
      catch (_) { /* La búsqueda interna sigue operativa si se desactiva o falla el modelo. */ }
      if (!S.getSetting('embedEnabled', true)) neuralScores = null;
    }
    let searchResult = S ? S.search(q, { k, fuzzy: S.getSetting('fuzzy', true), neuralScores }) : { hits: [], tookMs: 0, total: 0 };

    // Para una petición global, muestra una muestra del corpus en lugar de tratar
    // las palabras «resumir documento» como si fueran un tema presente en él.
    const genericWords = new Set(['resum', 'resumen', 'sintetiz', 'analiz', 'analisis', 'critic', 'evalu', 'revis', 'document', 'material', 'texto', 'complet', 'corpus', 'archiv', 'general', 'todo', 'principal', 'redact', 'contradicc', 'inconsist', 'compar']);
    const contentTerms = (searchResult.parsed?.uniqueTerms || []).filter(t => !genericWords.has(t));
    if (S && ['resumen', 'critico', 'redaccion'].includes(mode) && !contentTerms.length && S.state.index.sentences.length) {
      const filters = searchResult.parsed?.filters;
      const all = S.state.index.sentences.filter(sentence => R.passesFilters(sentence, filters) && !R.containsExcluded(sentence, filters));
      const count = Math.min(k, all.length);
      const hits = Array.from({ length: count }, (_, i) => ({ sentence: all[Math.floor(i * all.length / count)], score: 1 }));
      searchResult = { ...searchResult, hits, total: all.length, globalSample: true, neuralUsed: false, neuralOnly: false };
    }

    const chunks = S ? R.buildContext(S.state.index, searchResult.hits, { window: window_, maxChars: MAX_CONTEXT_CHARS, maxChunks: k, filters: searchResult.parsed?.filters }) : [];
    const graphNodes = relatedNodes(q, 8);
    const facts = M.facts ? M.facts(q, 3) : [];
    const vaultHits = M.vaultSearch ? M.vaultSearch(q, { limit: 4 }) : [];
    const fewShots = M.fewShots ? M.fewShots(q, 2) : [];
    const targetTerms = new Set(contentTerms);
    const contradictions = contradictionsForAll().filter(c => {
      if (!targetTerms.size) return true;
      return (c.sharedTerms || []).some(term => targetTerms.has(term));
    });

    const ctx = {
      question: q,
      mode,
      chunks,
      graphNodes,
      facts,
      memory: facts.map(f => ({ fact: f.fact })).concat(vaultHits.map(v => ({ fact: v.phrase }))),
      fewShots,
      contradictions,
      settings: S ? S.state.settings : {},
      signal: o.signal
    };

    // 3. Sin evidencia: respuesta honesta sin invocar LLM (evita alucinación)
    if (!chunks.length) {
      const text = composeExtractive(ctx);
      return finalize({ question: q, text, provider: 'internal', model: 'kimi-core', mode, chunks, citations: null, intent, t0, S, search: searchResult });
    }

    // 4. Router de modelos
    const provider = o.provider || (S ? S.getSetting('provider', 'internal') : 'internal');
    let result;
    try {
      result = await P.run(ctx, { provider, onToken: o.onToken });
    } catch (e) {
      result = { text: '', provider: 'none', error: e.message };
    }

    let text = (result.text || '').trim();
    if (searchResult.neuralOnly && !searchResult.globalSample) {
      text = `> ⚠️ Al menos una fuente se seleccionó solo por similitud semántica. Podría no responder a la pregunta; revisa el pasaje original.\n\n${text}`;
    }
    if (facts.length) text += `\n\n**Recuerdo guardado por ti (no verificado):** ${facts.map(f => f.fact).join('; ')}.`;
    let usedProvider = result.provider || 'internal';

    // 5. Verificación de citas (solo para backends generativos)
    let citations = null;
    if (usedProvider !== 'internal') {
      citations = R.verifyCitations(text, chunks);
      if (!text || citations.cited.length === 0) {
        // El modelo no citó: se añade el anexo de fuentes y se avisa
        const annex = chunks.map((c, i) => `[${c.index || i + 1}] ${U.truncate(c.text, 220)} (${c.docName}${c.pageNum ? ' · Pág ' + c.pageNum : ''})`).join('\n');
        text = (text || '') + `\n\n---\n**Fuentes recuperadas** (el modelo no citó explícitamente):\n${annex}`;
        citations = R.verifyCitations(text, chunks);
      }
      if (citations.unverified.length) {
        text += `\n\n> ⚠️ Citas no verificables: [${citations.unverified.join('], [')}]. Revisa las fuentes listadas.`;
      }
    } else {
      citations = R.verifyCitations(text, chunks);
    }

    return finalize({
      question: q, text, provider: usedProvider, model: result.model || '', mode, chunks,
      citations, intent, t0, S, search: searchResult, fallback: result.fallback,
      graphNodes, vaultHits, fewShots
    });
  }

  function emptyResult(q) {
    return { question: q, text: '', html: '', sources: [], provider: 'internal', mode: 'auto', citations: null, latencyMs: 0, trace: [] };
  }

  function finalize(p) {
    const latency = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - p.t0;
    const sources = (p.chunks || []).map((c, i) => ({
      n: c.index || i + 1,
      text: c.text,
      excerpt: U.truncate(c.text, 220),
      pageNum: c.pageNum,
      sourcePage: c.sourcePage || null,
      docName: c.docName,
      docId: c.docId,
      sentenceId: c.id || c.sentence?.id || null,
      score: c.score || 0
    }));

    const trace = [];
    trace.push(`intención: ${p.intent || 'auto'} → modo ${p.mode || 'auto'}`);
    if (p.search) {
      trace.push(`recuperación: ${p.search.hits.length} de ${p.search.total} candidatas en ${p.search.tookMs} ms`);
      if (p.search.neuralUsed) trace.push('recuperación semántica: MiniLM ONNX local');
      if (p.search.parsed && p.search.parsed.hasFilters) trace.push(`filtros: ${JSON.stringify(p.search.parsed.filters)}`);
    }
    trace.push(`proveedor: ${p.provider}${p.model ? ' · ' + p.model : ''}${p.fallback ? ' (degradado)' : ''}`);
    if (p.citations) {
      trace.push(`citas: ${p.citations.used.length}/${sources.length} fuentes · fuera de rango: ${p.citations.unverified.length} · poco solapamiento: ${(p.citations.weak || []).length}`);
    }
    trace.push(`latencia total: ${U.formatMs(latency)}`);

    const result = {
      question: p.question,
      text: p.text,
      provider: p.provider,
      model: p.model,
      mode: p.mode,
      citations: p.citations,
      sources,
      latencyMs: latency,
      trace,
      intent: p.intent,
      fallback: !!p.fallback,
      nodeIds: (p.graphNodes || []).map(n => n.id),
      vaultIds: (p.vaultHits || []).map(v => v.id),
      fewShots: p.fewShots || [],
      at: Date.now()
    };

    const S = p.S || store();
    if (S) {
      S.state.chat.push({
        id: U.uid('msg'), role: 'assistant', question: p.question, text: p.text,
        mode: p.mode, provider: p.provider, citations: p.citations, sources, trace,
        nodeIds: result.nodeIds, vaultIds: result.vaultIds, latencyMs: result.latencyMs, at: result.at
      });
      if (S.state.chat.length > 200) S.state.chat.shift();
      S.emit('rag:answer', result);
      S.savePersistent();
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Exportación
  // ─────────────────────────────────────────────────────────────────────────
  function toMarkdown(result) {
    if (!result) return '';
    const head = [
      `# ${U.truncate(result.question, 120)}`,
      '',
      `> Modo: ${result.mode} · Motor: ${result.provider}${result.model ? ' (' + result.model + ')' : ''} · ${U.formatMs(result.latencyMs)} · ${result.sources.length} fuente(s)`,
      ''
    ].join('\n');
    const body = result.text || '';
    const sources = result.sources.length
      ? '\n\n---\n## Fuentes\n' + result.sources.map(s =>
        `${s.n}. ${s.excerpt}${s.docName ? ' — *' + s.docName + '*' : ''}${s.pageNum ? ' (Pág ' + s.pageNum + ')' : ''}`
      ).join('\n')
      : '';
    return head + body + sources + '\n';
  }

  function init() {
    if (P.setInternalComposer) P.setInternalComposer(composeExtractive);
    return api;
  }

  const api = {
    init, ask, composeExtractive, toMarkdown,
    detectIntent, resolveMode,
    noEvidenceAnswer, contradictionsForAll, relatedNodes
  };
  return api;
});
