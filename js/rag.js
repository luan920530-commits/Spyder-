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
  const C = root.NCCharacter || ((typeof require === 'function' && typeof module !== 'undefined') ? require('./character.js') : {});
  const D = root.NCStudyDialogue || ((typeof module !== 'undefined' && module.exports) ? require('./study-dialogue.js') : {});
  const Talk = root.NCSmalltalk || ((typeof module !== 'undefined' && module.exports) ? require('./smalltalk.js') : null);
  const api = factory(U, R, A, P, M, C, D, Talk);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCRag = Object.assign(root.NCRag || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U, R, A, P, M, C, D, Talk) {
  'use strict';

  const MAX_CONTEXT_CHARS = 7000;
  let contradictionCache = { index: null, length: -1, value: [] };
  let activeLocalJob = null;
  const abortError = () => new DOMException('Generación cancelada', 'AbortError');

  const store = () => (typeof window !== 'undefined' ? window.NeuralStore : (globalThis.NeuralStore || null));

  // ─────────────────────────────────────────────────────────────────────────
  // Intención
  // ─────────────────────────────────────────────────────────────────────────
  function mathExpression(question) {
    const q = U.normalize(question).trim().replace(/^¿\s*/, '').replace(/\?$/, '').trim();
    if (/^calcula\b/.test(q)) return q.replace(/^calcula\b[:\s]*/, '');
    const expr = q.replace(/^(?:cuanto es|cuanto vale|resultado de)\s+/, '');
    // «¿Cuánto vale la latencia?» sigue siendo una consulta al material.
    if (expr !== q && /^(?:[.\d(+\-]|(?:sqrt|log|ln|abs|sin|cos|tan|exp|round|floor|ceil|pi)\b)/.test(expr)) return expr;
    return /\d/.test(q) && /^[\d\s().,+\-*/%^]+$/.test(q) ? q : null;
  }
  function taskIntent(question) {
    const q = U.normalize(question || '');
    if (/^(aprende|consolida|recuerda|guarda|memoriza)\b/.test(q)) return 'learn';
    if (mathExpression(question) !== null) return 'math';
    if (/(resum|sintetiza|sintesis|de que trata|idea principal|panorama)/.test(q)) return 'resumen';
    if (/(critic|debilidad|falla|sesgo|contradic|inconsisten|revisa|evalua)/.test(q)) return 'critico';
    if (/(redacta|ensayo|articulo|escribe un|escribe una|monografia)/.test(q)) return 'redaccion';
    if (/(guiame|preguntas|socratic|pista|hazme pensar|ensename a pensar)/.test(q)) return 'socratico';
    if (/(explica|por que|como funciona|mecanismo|define|que es|diferencia|compara)/.test(q)) return 'examen';
    return 'auto';
  }

  function detectIntent(question) {
    const { social, request } = Talk.parse(question);
    return social ? 'smalltalk' : taskIntent(request);
  }
  function modeFor(intent, requested) {
    if (requested && requested !== 'auto') return requested;
    if (['resumen', 'critico', 'redaccion', 'socratico', 'examen'].includes(intent)) return intent;
    return 'examen';
  }

  const resolveMode = (question, requested) => modeFor(detectIntent(question), requested);

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

  function contradictionScan(filters) {
    const S = store();
    if (!S) return { value: [], eligible: 0, sampled: 0 };
    const sents = S.state.allSentences || [], index = S.state.index;
    const scope = filters ? JSON.stringify(filters) : '';
    if (contradictionCache.index === index && contradictionCache.length === sents.length && contradictionCache.scope === scope) return contradictionCache;
    // Contrastar oraciones originales evita contar como afirmaciones distintas
    // el mismo número repetido en las ventanas solapadas.
    const literal = s => ({ id: s.id, docName: s.docName, docId: s.docId, pageNum: s.pageNum, sourcePage: s.sourcePage, text: s.sourceText ?? s.text });
    const eligible = filters ? sents.filter(s => {
      const item = literal(s);
      return R.passesFilters(item, filters) && !R.containsExcluded(item, filters);
    }) : sents;
    const sample = U.sampleEvenly(eligible, 1500).map(literal);
    let value = [];
    try { value = A.detectContradictions(sample, { max: 20 }); } catch (e) { console.warn('[RAG] contradicciones:', e.message); }
    contradictionCache = { index, length: sents.length, scope, value, eligible: eligible.length, sampled: sample.length };
    return contradictionCache;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Compositor interno (extractivo, verificable, sin descargas)
  // ─────────────────────────────────────────────────────────────────────────
  const contradictionsForAll = filters => contradictionScan(filters).value;
  const sourceOf = (side, chunks) => chunks.find(x => x.docId === side.docId && (x.id === side.id || x.sentenceIds?.includes(side.id)));

  function composeExtractive(ctx) {
    const chunks = ctx.chunks || [];
    const mode = ctx.mode || 'examen';

    if (!chunks.length) return noEvidenceAnswer(ctx);

    const items = chunks.map(c => ({ text: c.text, id: c.id, pageNum: c.pageNum, docName: c.docName }));
    const claims = A.extractClaims(items);
    const summary = A.summarize(items, Math.min(4, items.length));
    const keyphrases = A.keyphrases(items, 6);
    const contradictions = (ctx.contradictions || []).filter(pair => sourceOf(pair.a, chunks) && sourceOf(pair.b, chunks)).slice(0, 4);
    const critique = A.critique(chunks, claims, contradictions);

    if (mode === 'socratico') return composeSocratic(ctx, chunks, claims, keyphrases);
    if (mode === 'critico') return composeCritique(ctx, chunks, claims, contradictions, critique);
    if (mode === 'redaccion') return composeEssay(ctx, chunks, claims, keyphrases);
    if (mode === 'resumen') return composeResumen(ctx, chunks, claims, summary, critique);
    return composeExam(ctx, chunks, claims, summary, critique);
  }

  function noEvidenceAnswer(ctx) {
    const S = store();
    const candidates = ctx.suggestionSentences || S?.state.allSentences || [];
    const suggestions = candidates.length
      ? A.keyphrases(candidates.slice(0, 400), 5).map(k => k.surface || k.term)
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
    out += `${stripTrailingPunct(chunks[0].text)}${cite(1)}\n\n`;

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
    out += `Usa estas preguntas para orientar tu lectura. Para responder, pedir pistas y comparar tu explicación con el original, abre **Analizar → Tutor de estudio**.\n\n`;
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
        out += `- ${c.type === 'numeric' ? 'Cifras' : 'Tendencias'} discrepantes: ${c.reason}.\n`;
        for (const side of [c.a, c.b]) {
          const source = sourceOf(side, chunks);
          const page = side.sourcePage || side.pageNum;
          out += `  · «${U.truncate(side.text, 150)}» — ${side.docName || 'Documento'}${page ? ` · Pág ${page}` : ''}${cite(source.index)}\n`;
        }
      });
      out += `\n`;
    }

    if (ctx.coverage?.eligible > ctx.coverage?.sampled) out += `**Cobertura del detector:** muestra de ${ctx.coverage.sampled} de ${ctx.coverage.eligible} oraciones elegibles. No se contrastó el libro completo. Para revisar una parte concreta, usa =doc: o =pag:.\n\n`;
    if (ctx.contradictions?.length > contradictions.length) out += 'Solo se detallan pares con ambas fuentes en el contexto mostrado, hasta cuatro. Acota el tema o ajusta el máximo de fuentes.\n\n';
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
    out += `**Introducción.** ${stripTrailingPunct(chunks[0].text)}${cite(1)}\n\n`;
    chunks.slice(1, 4).forEach((chunk, i) => {
      const connector = connectors[i % connectors.length];
      out += `**Desarrollo ${i + 1}.** ${connector.charAt(0).toUpperCase() + connector.slice(1)}, ${stripTrailingPunct(chunk.text)}${cite(chunk.index)}\n\n`;
    });
    const topics = keyphrases.slice(0, 3).map(k => k.surface || k.term).join(', ');
    out += `**Cierre.** Estos fragmentos abordan ${topics || 'el tema consultado'}. Las relaciones y conclusiones adicionales deben contrastarse con las fuentes.\n\n`;
    out += `> Borrador extractivo local: revisa y reescribe antes de entregarlo.`;
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Generación opcional: evidencia local, historial aislado y cancelación.
  // ─────────────────────────────────────────────────────────────────────────
  async function askCharacterQwen({ q, name, doc, reply, qwen, promptBuilder, options, t0, S }) {
    const index = S?.state.index;
    let chunks = (reply.chunks || []).filter(chunk => chunk.docId === doc?.id).slice(0, 1);
    const noEvidence = reply.intent === 'no-evidence' || (reply.intent === 'continuation' && !chunks.length);
    // Solo un saludo recibe un fragmento de perfil. Si no se encuentra el tema,
    // no mostramos una cita irrelevante como si respondiera a la pregunta.
    if (!chunks.length && reply.intent === 'greeting' && doc && index) {
      const pos = C.profile(index, doc.id, name).mentions[0];
      if (pos != null) chunks = R.buildContext(index, [{ sentence: index.sentences[pos], score: 1 }], { window: 0, maxChunks: 1 });
    }
    // La selección por reglas centra la cita en la palabra buscada, incluso si
    // la oración es muy larga. Es también el fragmento que recibe el modelo.
    const excerpt = chunks.length ? (reply.reply?.excerpt || C.excerpt(chunks[0].sentence?.sourceText || chunks[0].text, [])) : '';
    const history = (S?.state.chat || []).filter(entry => entry.mode === 'conversacion' && entry.provider === 'qwen-local' &&
      entry.character?.docId === doc?.id && U.normalize(entry.character?.name) === U.normalize(name))
      .slice(-2).map(entry => ({ question: entry.question, answer: entry.characterReply?.lead || entry.text }));
    const job = new AbortController(), abortFromCaller = () => job.abort();
    if (options.signal?.aborted) throw abortError();
    activeLocalJob?.abort();
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    activeLocalJob = job;
    try {
      if (q.length > 1000) throw new Error('La pregunta supera 1.000 caracteres; prueba una más corta.');
      const prompt = promptBuilder.build({ name, question: q, snippets: excerpt ? [excerpt] : [], history, noEvidence });
      const output = await qwen.generate(prompt, { signal: job.signal, onToken: options.onToken });
      if (job.signal.aborted) throw abortError();
      const lead = promptBuilder.cleanOutput(output);
      if (!lead) throw new Error('El modelo no devolvió una respuesta.');
      const label = 'Fragmento consultado; no verifica lo generado y puede ser narración u otra voz:';
      const closing = noEvidence ? 'No se encontró un fragmento para esta pregunta; la respuesta es ficticia y podría inventar hechos.' : '';
      const characterReply = { lead, excerpt, excerptLabel: label, closing };
      const text = lead + (excerpt ? `\n\n${label}\n«${excerpt}» [1]` : '') + (closing ? `\n\n${closing}` : '');
      return finalize({ question: q, text, provider: 'qwen-local', model: 'Qwen3-0.6B Q4_K_M', mode: 'conversacion',
        chunks, citations: null, intent: reply.intent, character: reply.character, characterReply, t0, S });
    } catch (error) {
      if (job.signal.aborted || error?.name === 'AbortError') throw abortError();
      const notice = `Qwen no pudo generar (${error.message}). Continúo con reglas locales.\n\n`;
      return finalize({ question: q, text: notice + reply.text, provider: 'internal', model: 'personaje por reglas',
        mode: 'conversacion', chunks: reply.chunks, citations: reply.citations, intent: reply.intent, fallback: true,
        character: reply.character, characterReply: { ...reply.reply, lead: notice + reply.reply.lead }, t0, S });
    } finally {
      options.signal?.removeEventListener('abort', abortFromCaller);
      if (activeLocalJob === job) activeLocalJob = null;
    }
  }

  async function askStudy({ question, request, scope, o, t0, S }) {
    const index = S?.state.index, length = index?.sentences.length;
    const { reply, chunks } = D.prepare({ question: request, scope, index, history: S?.state.chat });
    const engine = typeof window !== 'undefined' && window.NCQwenModel;
    const withModel = reply.action !== 'practice' && chunks.length && S?.getSetting('dialogueQwen', false) === true && engine?.info?.().enabled;
    if (withModel) {
      const job = new AbortController(), cancel = () => job.abort();
      activeLocalJob?.abort(); activeLocalJob = job; o.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const prompt = window.NCQwenPrompt.buildStudy({ ...reply, question: request, chunks });
        o.onGenerating?.();
        const output = await engine.generate(prompt, { signal: job.signal });
        const clean = window.NCQwenPrompt.cleanOutput(output).slice(0,2000);
        if (!clean) throw new Error('Sin texto');
        reply.generated = clean;
      } catch (error) {
        if (job.signal.aborted || error?.name === 'AbortError') throw abortError();
        reply.notice = 'Qwen no pudo completar la explicación. Se conserva la lectura local con sus citas.';
      } finally {
        o.signal?.removeEventListener('abort',cancel);
        if (activeLocalJob === job) activeLocalJob = null;
      }
      if (job.signal.aborted || o.signal?.aborted || S.state.index !== index || index.sentences.length !== length) throw abortError();
    }
    return finalize({ question, text: D.transcript(reply,chunks), provider: reply.generated ? 'qwen-local' : 'internal',
      model: reply.generated ? 'Qwen3-0.6B Q4_K_M' : 'tutor documental', fallback: !!reply.notice,
      mode: 'tutor', intent: reply.action, dialogue: reply, chunks, t0, S });
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
    if (o.signal?.aborted) throw abortError();
    if (!q) return emptyResult(q);

    // Los dos chats dedicados no ejecutan comandos de memoria. Cada uno
    // construye su propio contexto: el tutor no hereda una ficción del personaje.
    const requestedMode = o.mode || (S ? S.getSetting('mode', 'auto') : 'auto');
    if (requestedMode === 'conversacion') {
      const docId = o.characterDocId ?? (S ? S.getSetting('characterDocId', '') : '');
      const name = o.characterName ?? (S ? S.getSetting('characterName', '') : '');
      const doc = S?.state.docs.find(item => item.id === docId) || null;
      const reply = C.respond({ question: q, name, doc, index: S?.state.index, history: S?.state.chat || [] });
      const qwen = typeof window !== 'undefined' ? window.NCQwenModel : null;
      const promptBuilder = typeof window !== 'undefined' ? window.NCQwenPrompt : null;
      // Las reglas básicas de crisis/acompañamiento y los errores de selección
      // conservan prioridad: no se prometen detección ni seguridad completas.
      const noContinuation = reply.intent === 'continuation' && !reply.chunks.length;
      if (qwen?.info().enabled && promptBuilder && !noContinuation && !['crisis', 'emotional', 'setup', 'missing-character', 'courtesy'].includes(reply.intent)) {
        return await askCharacterQwen({ q, name, doc, reply, qwen, promptBuilder, options: o, t0, S });
      }
      return finalize({ question: q, text: reply.text, provider: 'internal', model: 'personaje por reglas',
        mode: 'conversacion', chunks: reply.chunks, citations: reply.citations, intent: reply.intent,
        character: reply.character, characterReply: reply.reply, t0, S });
    }

    if (requestedMode === 'tutor' && q.length > D.MAX_QUESTION) throw new Error(`Escribe una pregunta de hasta ${D.MAX_QUESTION} caracteres.`);
    const scope = requestedMode === 'tutor' ? (o.dialogueScope ?? S?.getSetting('dialogueDocId', '') ?? '') : null;
    const last = S?.state.chat.at(-1);
    const previous = last?.mode === requestedMode && last?.intent === 'smalltalk' && last.smalltalk?.scope === scope ? last.smalltalk.kind : null;
    const { social, request } = Talk.parse(q, { afterCheckin: ['hello','checkin'].includes(previous) });
    if (social) {
      return finalize({ question:q, text:Talk.reply(social, { tutor:requestedMode === 'tutor', again:previous === 'hello' }),
        provider:'internal', model:'charla por reglas', mode:requestedMode, intent:'smalltalk', smalltalk:{ kind:social.kind, scope }, chunks:[], citations:null, t0, S });
    }
    if (requestedMode === 'tutor') return askStudy({question:q, request, scope, o, t0, S});
    const intent = taskIntent(request);

    // 1. Comandos directos
    if (intent === 'learn') {
      const fact = request.replace(/^(aprende|consolida|recuerda|guarda|memoriza)(\s+que)?[:;\s-]*/i, '').trim();
      const entry = M.addFact ? M.addFact(fact) : null;
      if (fact && M.vaultAdd) M.vaultAdd({ phrase: fact, detail: fact });
      const text = fact
        ? `✅ **Conocimiento consolidado.** Guardé: «${fact}».\n\nSe usará en futuras respuestas y en la Bóveda.`
        : `No detecté el contenido a memorizar. Escribe, por ejemplo: *Aprende que la latencia es 12 ms*.`;
      return finalize({ question: q, text, provider: 'internal', model: 'memoria', mode: 'learn', chunks: [], citations: null, intent, t0, S, extra: { fact: entry } });
    }

    if (intent === 'math') {
      const expr = mathExpression(request);
      const value = U.evaluateArithmetic(expr);
      const text = value == null
        ? `No pude evaluar «${expr}» como expresión aritmética. Admite + - * / % ^ y funciones como sqrt(), log(), sin().`
        : `🧮 **${expr} = ${value}**\n\nCalculado con el evaluador aritmético interno (sin ejecutar código).`;
      return finalize({ question: q, text, provider: 'internal', model: 'calculadora', mode: 'math', chunks: [], citations: null, intent, t0, S });
    }

    // 2. Recuperación
    const mode = modeFor(intent, requestedMode);
    const k = o.k || (S ? S.getSetting('topK', 6) : 6);
    const window_ = S ? S.getSetting('window', 1) : 1;

    let neuralScores = null;
    const localModel = typeof window !== 'undefined' ? window.NCLocalModel : null;
    const initialIndex = S?.state.index, initialLength = initialIndex?.sentences.length;
    if (S && S.getSetting('embedEnabled', true) && localModel?.info().enabled) {
      try { neuralScores = await localModel.scores(R.parseQuery(request).cleaned); }
      catch (_) { /* La búsqueda interna sigue operativa si se desactiva o falla el modelo. */ }
      if (o.signal?.aborted || S.state.index !== initialIndex || initialIndex.sentences.length !== initialLength) throw abortError();
      if (!S.getSetting('embedEnabled', true) || !localModel.info().enabled) neuralScores = null;
    }
    if (o.signal?.aborted) throw abortError();
    let searchResult = S ? S.search(request, { k, fuzzy: S.getSetting('fuzzy', true), neuralScores }) : { hits: [], tookMs: 0, total: 0 };
    const searchedIndex = S?.state.index, searchedLength = searchedIndex?.sentences.length;

    // Para una petición global, muestra una muestra del corpus en lugar de tratar
    // las palabras «resumir documento» como si fueran un tema presente en él.
    const genericWords = new Set(['resum', 'resumen', 'sintetiz', 'analiz', 'analisis', 'critic', 'evalu', 'revis', 'document', 'material', 'texto', 'complet', 'corpus', 'archiv', 'general', 'todo', 'principal', 'redact', 'contradicc', 'inconsist', 'compar', ...U.tokens('detecta contradicciones inconsistencias')]);
    // Las expansiones aprendidas de una consulta nunca cambian su alcance.
    const contentTerms = U.tokens(searchResult.parsed?.cleaned || '').filter(t => !genericWords.has(t));
    const filters = searchResult.parsed?.filters;
    const filteredIndex = searchResult.contextIndex || S?.state.index;
    const targetTerms = new Set(contentTerms);
    const scan = contradictionScan(searchResult.parsed?.hasFilters ? filters : null);
    const contradictions = scan.value
      .filter(c => !targetTerms.size || (c.sharedTerms || []).some(term => targetTerms.has(term)));
    if (S && ['resumen', 'critico', 'redaccion'].includes(mode) && !contentTerms.length && S.state.index.sentences.length) {
      const all = filteredIndex.sentences.filter(sentence => R.passesFilters(sentence, filters) && !R.containsExcluded(sentence, filters));
      const count = Math.min(k, all.length);
      const selected = new Map();
      // Al contrastar, mostrar primero las fuentes de ambos lados del hallazgo,
      // no una muestra que por casualidad podría no contener ninguno de ellos.
      if (mode === 'critico') for (const pair of contradictions.slice(0, 4)) {
        for (const side of [pair.a, pair.b]) {
          const source = filteredIndex.sentences[filteredIndex.posById.get(side.id)];
          if (source && R.passesFilters(source, filters) && !R.containsExcluded(source, filters)) selected.set(source.id, source);
        }
      }
      for (const sentence of U.sampleEvenly(all, count)) selected.set(sentence.id, sentence);
      const hits = [...selected.values()].slice(0, count).map(sentence => ({ sentence, score: 1 }));
      searchResult = { ...searchResult, hits, total: all.length, globalSample: true, neuralUsed: false, neuralOnly: false };
    }

    const chunks = S ? R.buildContext(searchResult.contextIndex || S.state.index, searchResult.hits,
      { window: window_, maxChars: MAX_CONTEXT_CHARS, maxChunks: k, filters: searchResult.parsed?.filters }) : [];
    // El enjambre recibe los mismos candidatos filtrados y ordenados mientras se
    // prepara la respuesta, no solo después de que esta ya esté terminada.
    if (typeof o.onRetrieved === 'function') {
      o.onRetrieved({ hits: searchResult.globalSample ? [] : searchResult.hits,
        method: searchResult.neuralUsed ? 'minilm' : 'local', globalSample: !!searchResult.globalSample });
    }
    const sourceRestricted = !!(filters?.docs?.length || filters?.pages?.length || filters?.phrases?.length);
    const safeText = text => !R.containsExcluded({ text: text || '' }, filters);
    const memoryQuery = searchResult.parsed?.cleaned || request;
    const graphNodes = relatedNodes(memoryQuery, 8).filter(node => {
      if (!safeText(`${node.label || ''} ${node.text || ''}`)) return false;
      if (!searchResult.parsed?.hasFilters) return true;
      return (node.sentenceIds || []).some(id => {
        const pos = filteredIndex?.posById.get(id), sentence = pos == null ? null : filteredIndex.sentences[pos];
        return sentence && R.passesFilters(sentence, filters) && !R.containsExcluded(sentence, filters);
      });
    });
    // La memoria personal no tiene una página demostrable: no se mezcla con
    // consultas restringidas a documento/página/frase y respeta exclusiones.
    const facts = sourceRestricted || !M.facts ? [] : M.facts(memoryQuery, 3).filter(item => safeText(item.fact));
    const vaultHits = sourceRestricted || !M.vaultSearch ? [] : M.vaultSearch(memoryQuery, { limit: 4 })
      .filter(item => safeText(`${item.phrase || ''} ${item.detail || ''}`));
    const fewShots = sourceRestricted || !M.fewShots ? [] : M.fewShots(memoryQuery, 2)
      .filter(item => safeText(`${item.question || ''} ${item.answer || ''}`));

    const ctx = {
      question: request,
      mode,
      chunks,
      graphNodes,
      facts,
      memory: facts.map(f => ({ fact: f.fact })).concat(vaultHits.map(v => ({ fact: v.phrase }))),
      fewShots,
      contradictions, coverage: { sampled: scan.sampled, eligible: scan.eligible },
      settings: S ? S.state.settings : {},
      signal: o.signal
    };

    // 3. Sin evidencia: respuesta honesta sin invocar LLM (evita alucinación)
    if (!chunks.length) {
      ctx.suggestionSentences = (filteredIndex?.sentences || []).filter(sentence =>
        R.passesFilters(sentence, filters) && !R.containsExcluded(sentence, filters)).slice(0, 400);
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
    if (o.signal?.aborted || (S && (S.state.index !== searchedIndex || searchedIndex.sentences.length !== searchedLength))) throw abortError();

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
      ...(p.dialogue ? { offset: c.offset } : {}),
      pageNum: c.pageNum,
      sourcePage: c.sourcePage || null,
      docName: c.docName,
      docId: c.docId,
      sentenceId: c.id || c.sentence?.id || null,
      partIds: c.sentenceIds || (c.id ? [c.id] : []),
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
      ...(p.smalltalk ? { smalltalk: p.smalltalk } : {}),
      fallback: !!p.fallback,
      ...(p.dialogue ? { dialogue: p.dialogue } : {}),
      character: p.character || null,
      characterReply: p.characterReply || null,
      nodeIds: (p.graphNodes || []).map(n => n.id),
      vaultIds: (p.vaultHits || []).map(v => v.id),
      fewShots: p.fewShots || [],
      at: Date.now()
    };

    const S = p.S || store();
    if (S) {
      S.state.chat.push({
        id: U.uid('msg'), role: 'assistant', question: p.question, text: p.text,
        mode: p.mode, provider: p.provider, model: p.model, intent: p.intent, fallback: !!p.fallback, citations: p.citations, sources, trace,
        ...(p.dialogue ? { dialogue: p.dialogue } : {}),
        ...(p.smalltalk ? { smalltalk: p.smalltalk } : {}),
        character: result.character, characterReply: result.characterReply,
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
        `${s.n}. ${s.excerpt}${s.docName ? ' — *' + s.docName + '*' : ''}${(s.sourcePage || s.pageNum) ? ' (Pág ' + (s.sourcePage || s.pageNum) + ')' : ''}`
      ).join('\n')
      : '';
    return head + body + sources + '\n';
  }

  function init() {
    if (P.setInternalComposer) P.setInternalComposer(composeExtractive);
    const S = store();
    const cancel = () => activeLocalJob?.abort();
    const invalidateContradictions = () => { contradictionCache = { index: null, length: -1, value: [] }; };
    ['doc:added', 'doc:removed', 'system:resetting', 'brain:importing'].forEach(event => S?.on(event, invalidateContradictions));
    ['system:resetting', 'brain:importing', 'doc:added', 'doc:removed', 'chat:clearing'].forEach(event => S?.on(event, cancel));
    S?.on('settings:changed', ({ key }) => { if (['mode', 'characterDocId', 'characterName', 'dialogueDocId', 'dialogueQwen'].includes(key)) cancel(); });
    return api;
  }

  const api = {
    init, ask, composeExtractive, toMarkdown,
    detectIntent, resolveMode,
    noEvidenceAnswer, contradictionsForAll, relatedNodes
  };
  return api;
});
