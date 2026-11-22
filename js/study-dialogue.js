/** Tutor documental: el historial conserva el tema, no se convierte en una fuente. */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./util.js') : root.NCUtil, node ? require('./retrieval.js') : root.NCRetrieval,
    node ? require('./analysis.js') : root.NCAnalysis);
  if (node) module.exports = api;
  root.NCStudyDialogue = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U, R, A) {
  'use strict';
  const MAX_SOURCES = 4, MAX_QUOTE = 500, MAX_QUESTION = 1000;
  const filler = new Set(U.tokens('explica explícame explicar explicas define definición dime puedes quisiera quiero saber entender estudiar comparar compara contrasta contrastar fuente fuentes documento documentos libro libros informe informes texto textos apuntes material tema pregunta indica dicen dice significa según sobre respecto diferencia diferencias cuál cuánto cuánto es por qué cómo'));
  const clean = text => U.normalize(text).replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const normText = t => t.normalize('NFC').replace(/\s+/g, ' ').trim();
  const sourceText = s => s.sourceText ?? s.text;
  // Solo preguntas elípticas retoman el hilo: «¿Por qué flota el hielo?»
  // abre su propio tema. Un filtro nuevo no amplía el alcance del turno anterior.
  const follow = [
    ['practice', /^(?:hazme (?:una pregunta|pensar)|ponme a prueba|preguntame(?: (?:eso|sobre el tema))?|quiero practicar|practicar|repasemos)$/],
    ['why', /^(?:explica(?:r|me)? por que|por que(?: (?:dices|afirmas|piensas) eso| lo (?:dices|crees)| (?:llegas|llegaste) a esa conclusion| no (?:se contradicen|basta|es (?:necesariamente )?una contradiccion))?|de donde (?:sale|sacas) eso|en que te basas|como (?:llegaste a esa conclusion|lo sabes)|(?:explica(?:r|me)?|justifica(?:r)?) (?:eso|lo anterior|tu (?:respuesta|conclusion))(?: de nuevo)?|explicamelo)$/],
    ['compare', /^(?:(?:compara|contrasta)(?:r|las|rlas)?(?: (?:las |ambas |las dos )?fuentes| (?:los |ambos |los dos )?informes)?|(?:(?:las fuentes|los informes) )?se contradicen(?: entre si| las (?:dos )?fuentes| los (?:dos )?informes)?|(?:en que (?:difieren|coinciden)|que diferencias hay)(?: (?:las fuentes|entre (?:ambas|ellas)))?)$/],
    ['gap', /^(?:que (?:evidencia |informacion |datos? )?falta(?:n)?(?: para (?:saberlo|decidir))?|que (?:evidencia )?te haria cambiar(?: (?:de (?:opinion|idea)|la conclusion))?|que no sabemos)$/],
    ['revise', /^(?:(?:revisa|reconsidera|actualiza)(?:r|lo|rlo)?(?: (?:la|tu) (?:conclusion|respuesta|postura))?|que (?:ha )?cambi(?:o|a)|cambia(?:s)? (?:la|tu) (?:conclusion|respuesta)|cambias de opinion|vuelve a pensarlo|sigue siendo valida(?: la conclusion)?)$/]
  ];
  function actionFor(text) {
    let t = clean(text).replace(/^(?:(?:y|entonces|ahora) )+/, '').replace(/^(?:me )?(?:puedes|podrias) /,'').replace(/(?: por favor)$/, '');
    const context = '(?:(?:con|tras|a la luz de) (?:el anexo|este anexo|la (?:nueva evidencia|fuente nueva|nueva fuente)|las nuevas fuentes|el (?:nuevo documento|documento nuevo)|este documento|esta fuente)|a la luz del anexo)';
    t = t.replace(new RegExp('^' + context + ' '), '').replace(new RegExp(' ' + context + '$'), '');
    return follow.find(([,re]) => re.test(t))?.[0] || 'ask';
  }
  function lastTurn(history, scope) {
    // Una cortesía en el mismo tutor no es una lectura nueva. No cruzar
    // cambios de modo o de alcance, ni reutilizar el saludo como evidencia.
    let i = (history?.length || 0) - 1;
    while (i >= 0 && history[i]?.mode === 'tutor' && history[i].intent === 'smalltalk' && history[i].smalltalk?.scope === scope) i--;
    const last = history?.[i], d = last?.dialogue;
    return last?.mode === 'tutor' && d?.version === 1 && d.scope === scope && typeof d.topic === 'string' &&
      d.topic.trim() && d.topic.length <= MAX_QUESTION && Array.isArray(last.sources) ? last : null;
  }
  function resolveSource(index, src) {
    if (!index || !src || typeof src.text !== 'string' || !src.text.length || src.text.length > MAX_QUOTE || !Number.isSafeInteger(src.offset) || src.offset < 0) return null;
    const s = index.sentences[index.posById.get(src.sentenceId)];
    return s && s.docId === src.docId && s.pageNum === src.pageNum && (s.sourcePage ?? null) === (src.sourcePage ?? null) &&
      sourceText(s).slice(src.offset, src.offset + src.text.length) === src.text ? s : null;
  }
  const same = (a,b) => a.id === b.id && a.docId === b.docId && a.offset === b.offset && a.text === b.text;
  function chunk(s, offset, text) {
    return { id: s.id, docId: s.docId, docName: s.docName, pageNum: s.pageNum, sourcePage: s.sourcePage ?? null, offset, text, whole: text === sourceText(s).trim() };
  }
  function quote(s, terms) {
    const raw = sourceText(s);
    function slice(start,end) {
      // No separar un par sustituto al cortar una línea sin espacios.
      if (/[\uDC00-\uDFFF]/.test(raw.charAt(start))) start++;
      if (/[\uD800-\uDBFF]/.test(raw.charAt(end-1))) end--;
      const part = raw.slice(start,end), offset = start + part.length - part.trimStart().length;
      return chunk(s,offset,part.trim());
    }
    if (raw.length <= MAX_QUOTE) return slice(0,raw.length);
    let hit = 0;
    for (const m of raw.matchAll(/[\p{L}\p{N}]+/gu)) if (terms.has(U.stem(m[0]))) { hit = m.index; break; }
    let start = Math.max(0, hit - 100);
    if (start) { const space = raw.indexOf(' ', start); if (space >= start && space < hit) start = space + 1; }
    let end = Math.min(raw.length, start + MAX_QUOTE);
    if (end < raw.length) { const space = raw.lastIndexOf(' ', end); if (space > start + MAX_QUOTE / 2) end = space; }
    return slice(start,end); // ni puntos suspensivos sintéticos ni Markdown dentro de la cita
  }
  function permitted(s, scope, filters) {
    const literal = { ...s, text: sourceText(s) };
    return (!scope || s.docId === scope) && R.passesFilters(literal, filters) && !R.containsExcluded(literal, filters);
  }
  function checkpoint(index) {
    const n = index?.sentences.length || 0, tail = index?.sentences[n - 1];
    return { n, id: tail?.id ?? null, docId: tail?.docId ?? null };
  }
  function appendFrom(index, cursor) {
    if (!cursor || !Number.isSafeInteger(cursor.n) || cursor.n < 0 || cursor.n > index.sentences.length) return null;
    if (!cursor.n) return 0;
    const s = index.sentences[cursor.n-1]; return s.id === cursor.id && s.docId === cursor.docId ? cursor.n : null;
  }
  const methodWords = 'condición condiciones muestra muestras equipo equipos carga cargas método métodos metodología metodologías población poblaciones protocolo protocolos procedimiento procedimientos hardware temperatura temperaturas';
  const methodTerms = new Set(U.tokens(methodWords));
  const method = new RegExp('\\b(?:' + U.normalize(methodWords).split(' ').join('|') + ')\\b');
  const label = n => `${n.raw}${n.unit === 'pct' ? '%' : ' '+n.unit}`;
  // Los lados de la comparación citan una sola medición inequívoca en esa
  // unidad. Un anexo que enumera ambas no es una tercera medición independiente.
  function quantities(items) {
    return items.map(c => A.extractClaims([c])[0]?.numbers.filter(n => n.unit && !['años','veces'].includes(n.unit)) || []);
  }
  function measurementPair(items, terms) {
    const nums = quantities(items), words = items.map(s => new Set(U.tokens(s.text)));
    for (let i=0; i<items.length; i++) for (let j=i+1; j<items.length; j++) {
      if (![...terms].some(t => words[i].has(t) && words[j].has(t) && !/^\d/.test(t))) continue;
      for (const a of nums[i]) {
        if (nums[i].filter(n => n.unit === a.unit).length !== 1) continue;
        const other = nums[j].filter(n => n.unit === a.unit);
        if (other.length === 1 && other[0].value !== a.value) return { i, j, a, b: other[0] };
      }
    }
    return null;
  }
  function connects(text, pair) {
    if (!pair || !method.test(U.normalize(text))) return false;
    const ns = quantities([{ text }])[0];
    return [pair.a,pair.b].every(m => ns.some(n => m.unit === n.unit && m.value === n.value));
  }
  function positionsFor(index, terms, start = 0) {
    const positions = new Set();
    for (const t of terms) for (const pos of index.postings.get(t)?.keys() || []) if (pos >= start) positions.add(pos);
    return positions;
  }
  // Un anexo puede mencionar ambas mediciones sin repetir el nombre del tema.
  // En una biblioteca ya cargada visitamos los postings de método, no todos
  // los libros. Tras una adición pequeña basta el final del índice.
  function methodNotes(index, pair, filters, scope, start) {
    const end = index.sentences.length;
    if (!pair || start >= end) return [];
    const positions = start > 0 && end-start < 512 ? Array.from({length:end-start},(_,i) => start+i) : positionsFor(index,methodTerms,start);
    const notes = [];
    for (const pos of positions) {
      const s = index.sentences[pos];
      if (!permitted(s,scope,filters)) continue;
      const c = quote(s,methodTerms);
      if (R.passesFilters(c,filters) && connects(c.text,pair)) notes.push({ c,pos,bridge:true,score:0 });
    }
    return notes.sort((a,b) => a.pos-b.pos);
  }
  function candidates(index, terms, filters, scope, after, pair) {
    const ranked = new Map(methodNotes(index,pair,filters,scope,after ?? 0).map(r => [r.pos,r]));
    for (const pos of positionsFor(index,terms)) {
      if (ranked.has(pos)) continue;
      const s = index.sentences[pos]; if (!permitted(s, scope, filters)) continue;
      const c = quote(s, terms), words = new Set(U.tokens(c.text));
      let score = 0;
      for (const t of terms) if (words.has(t)) score += 1 + Math.log1p(index.sentences.length / (1 + (index.df.get(t) || 0)));
      if (score && R.passesFilters(c,filters)) ranked.set(pos,{ c,pos,score }); // no citar por la ventana vecina
    }
    return [...ranked.values()].sort((a,b) => b.score-a.score || a.pos-b.pos);
  }
  // La muestra es pequeña y diferenciada por documento; los cambios de orden
  // por sí solos no se cuentan como evidencia añadida en una revisión.
  function select(ranked, old, after, revision, prior) {
    const chosen = [], docs = new Set(), texts = new Set();
    function add(c) {
      if (!c || chosen.length >= MAX_SOURCES) return;
      const text = normText(c.text);
      if (!texts.has(text) && !chosen.some(k => k.id === c.id)) {
        chosen.push(c); texts.add(text); docs.add(c.docId);
      }
    }
    if (revision) {
      // Conservar las premisas del hallazgo, no necesariamente las dos
      // primeras filas. Priorizar el anexo que relaciona sus dos mediciones.
      const fresh = ranked.filter(r => (after === null || r.pos >= after) && !old.some(c => normText(c.text) === normText(r.c.text)));
      if (fresh.length) {
        prior.refs.slice(0,2).forEach(n => add(old[n-1]));
        add((fresh.find(r => r.bridge) || fresh[0]).c);
        prior.refs.slice(2).forEach(n => add(old[n-1]));
        fresh.forEach(r => { if (r.bridge) add(r.c); });
      }
      old.forEach(add);
    }
    ranked.forEach(r => { if (!docs.has(r.c.docId)) add(r.c); }); ranked.forEach(r => add(r.c));
    return chosen;
  }
  const uncertain = /\b(?:no|ignora|desconoc\w*|posible|podri\w*|si|quizas|deber\w*|hipotesis|duda)\b|[?¿]/;
  function conditions(c) {
    const txt = U.normalize(c.text);
    if (!c.whole || uncertain.test(txt) || !/\b(?:se (?:midieron|obtuvieron|usaron|utilizaron|registraron|realizaron)|corresponden a)\b/.test(txt)) return 'unspecified';
    const different = /\b(?:equipos|cargas|muestras|condiciones|poblaciones|metodos) (?:distint[oa]s|diferentes)\b/.test(txt);
    const shared = /\b(?:mismas condiciones|mismo protocolo|mismo equipo y (?:la )?misma carga)\b/.test(txt);
    return different === shared ? 'unspecified' : different ? 'different' : 'shared';
  }
  const numeric = new Set(['numbers','conditions','method','common-method','mixed-method']);
  function assess(items, terms) {
    if (!items.length) return { kind: 'none', reading: 'No encontré un pasaje pertinente en el material seleccionado.', refs: [], gap: 'Necesito un texto que trate el tema. Añade una fuente o reformula la pregunta con términos de tus apuntes.' };
    const pair = measurementPair(items, terms);
    if (pair) {
      const {i,j,a,b} = pair, refs = [i+1,j+1];
      const intro = `Los pasajes citan valores distintos: ${label(a)} y ${label(b)}. `;
      const notes = items.map((c,n) => n !== i && n !== j && connects(c.text,pair) ? n : -1).filter(n => n >= 0);
      if (notes.length) {
        const diff = notes.find(n => conditions(items[n]) === 'different'), shared = notes.find(n => conditions(items[n]) === 'shared');
        if (diff != null && shared != null) return { kind: 'mixed-method', refs: [...refs,diff+1,shared+1], reading: intro + `El pasaje [${diff+1}] menciona condiciones distintas y el [${shared+1}] una condición en común. No descarto ninguno: podrían referirse a aspectos diferentes.`,
          gap: 'Identifica la prueba, la carga, el equipo y la métrica de cada informe antes de decidir qué comparaciones son válidas.' };
        const k = diff ?? shared ?? notes[0]; refs.push(k+1);
        if (shared != null) return { kind: 'common-method', refs, reading: intro + `Según el pasaje [${k+1}], se usó un procedimiento o una condición en común. La diferencia merece investigarse; eso no demuestra que las dos fuentes sean incompatibles.`,
          gap: 'Comprueba si son la misma métrica y población, y qué variación o margen de error admite cada medición.' };
        return { kind: diff != null ? 'conditions' : 'method', reading: intro + (diff != null ? `El pasaje [${k+1}] atribuye esas cifras a condiciones distintas. Si se refiere a las dos pruebas anteriores, sus resultados no son intercambiables.` : `El pasaje [${k+1}] menciona ambas cifras y el método. Aporta contexto para compararlas, pero no verifica por sí solo que se trate de la misma prueba.`), refs,
          gap: 'Para decidir si hay una contradicción haría falta verificar la misma métrica, el mismo procedimiento y las condiciones de cada medición.' };
      }
      return { kind: 'numbers', reading: intro + 'La diferencia numérica no basta para afirmar que una fuente contradice a la otra.', refs,
        gap: '¿Se midió lo mismo con la misma carga, equipo o muestra? Busca la metodología de ambas mediciones.' };
    }
    const distinct = new Set(items.map(s => s.docId)).size;
    // Una salvedad explícita sí cambia lo que conviene buscar. No inferir que
    // desmiente otra fuente solo porque dos documentos compartan vocabulario.
    const k = items.findIndex(c => c.whole && !/[?¿]|\bno\b/.test(U.normalize(c.text)) && /\b(?:solo (?:si|cuando|en)|excepto|salvo|a diferencia de)\b/.test(U.normalize(c.text)));
    if (k >= 0 && items.length > 1) {
      return { kind: 'qualification', reading: `Conviene leer la afirmación del pasaje [${k ? 1 : 2}] junto con esta salvedad del [${k+1}]: «${items[k].text}» No está demostrado que ambos hablen del mismo caso.`,
        refs: [k ? 1 : 2,k+1], gap: '¿A qué situaciones se aplica la salvedad? Comprueba si la otra fuente incluye o excluye esas mismas situaciones.' };
    }
    for (const [i,c] of items.entries()) {
      if (!c.whole || uncertain.test(U.normalize(c.text))) continue;
      const cause = c.text.match(/^(.{4,120}?)\s+(?:porque|debido a que)\s+(.{4,230})$/iu);
      if (cause) return { kind: 'reason', reading: `El pasaje atribuye «${cause[1]}» a este motivo: «${cause[2]}». Es una explicación de la fuente, no una demostración independiente de causalidad.`, refs: [i+1], gap: '¿Qué observación permitiría distinguir ese motivo de otra explicación?' };
    }
    const description = items.map(c => c.whole && !uncertain.test(U.normalize(c.text)) && c.text.match(/^([^.!?;:]{2,80}?)\s+(?:es|son|se define como|consiste en)\s+([^!?;]{3,210})$/iu));
    const at = description.findIndex(m => m && U.tokens(m[1]).some(t => terms.has(t)));
    if (at >= 0 && items.length === 1) {
      const [, name, detail] = description[at];
      return { kind: 'description', reading: `Puedes explicar «${name}» con las palabras de la fuente: «${detail}»`, refs: [at+1], gap: '¿Qué ejemplo encaja en esa descripción y qué caso quedaría fuera?' };
    }
    if (items.length === 1) return { kind: 'one', reading: 'Solo encontré un pasaje pertinente. Úsalo como afirmación de esa fuente, no como una confirmación independiente.', refs: [1], gap: '¿Qué ejemplo, excepción o segunda fuente permitiría comprobar esa afirmación?' };
    // No deducir acuerdo, causalidad o independencia a partir de una palabra compartida.
    const detail = items.findIndex(c => /\b(por ejemplo|un ejemplo|en particular)\b/i.test(c.text));
    return { kind: detail >= 0 ? 'example' : 'several', reading: (distinct > 1 ? 'Hay pasajes de documentos distintos sobre el tema.' : 'Estos pasajes proceden del mismo documento.') +
        (detail >= 0 ? ` El pasaje [${detail+1}] presenta un ejemplo; un caso no establece una regla general.` : ' Que traten el mismo tema no demuestra que sostengan la misma tesis.'),
      refs: [...new Set([1, detail >= 0 ? detail+1 : 2])], gap: 'Compara qué afirma literalmente cada pasaje, a qué caso se refiere y qué parte necesitaría otra prueba.' };
  }
  function compare(items, terms) {
    if (items.length < 2) return 'No hay dos pasajes pertinentes que pueda poner en paralelo. Añade otra fuente si quieres comprobar la primera.';
    const pair = measurementPair(items,terms), i = pair?.i ?? 0;
    const other = items.findIndex(c => c.docId !== items[i].docId), j = pair?.j ?? (other >= 0 ? other : 1);
    const relation = items[i].docId === items[j].docId ? 'Son pasajes del mismo documento, no dos fuentes independientes.' : 'Son documentos distintos; eso no garantiza que sean pruebas independientes.';
    function subject(c) {
      for (const m of c.text.matchAll(/([\p{L}\p{N}]+)\s+(?:de(?: la| los| las)?|del)\s+[\p{L}\p{N}]+/giu)) if (terms.has(U.stem(m[1]))) return m[0];
      return '';
    }
    const a = subject(items[i]), b = subject(items[j]);
    return a && b && clean(a) !== clean(b) ? `Fíjate en los nombres: [${i+1}] dice «${a}» y [${j+1}] dice «${b}». ¿Designan lo mismo? ${relation}` :
      `Compara [${i+1}] con [${j+1}]: ¿qué observó cada uno y en qué condiciones? ${relation}`;
  }
  function prepare({ question, scope = '', index, history = [] }) {
    const q = String(question).trim();
    if (q.length > MAX_QUESTION) throw new Error(`Escribe una pregunta de hasta ${MAX_QUESTION} caracteres.`);
    const parsed = R.parseQuery(q), action = actionFor(parsed.cleaned), followup = action !== 'ask';
    const prev = followup && !parsed.hasFilters ? lastTurn(history, scope) : null;
    const topic = followup ? prev?.dialogue.topic || '' : q;
    const original = R.parseQuery(topic), terms = new Set(original.uniqueTerms.filter(t => !filler.has(t)).slice(0,24));
    const reply = { version: 1, scope, topic, action, cursor: checkpoint(index) };
    if (!topic || !terms.size) {
      Object.assign(reply, { topic: '', kind: 'setup', reading: parsed.hasFilters && followup ? 'Para cambiar filtros, escribe el tema y los filtros juntos en una nueva pregunta.' : '¿Qué tema de tus apuntes quieres estudiar? Empieza con una pregunta concreta; después puedes pedirme que la justifique o la revise.', refs: [], gap: 'Por ejemplo: «¿Qué es la mediana?» si aparece en tu material.' });
      return { reply, chunks: [] };
    }
    const valid = [], before = prev?.sources.slice(0,MAX_SOURCES) || [];
    for (const src of before) {
      const live = resolveSource(index,src);
      if (live && permitted(live,scope,original.filters)) {
        const c = chunk(live,src.offset,src.text);
        if (R.passesFilters(c,original.filters)) valid.push(c);
      }
    }
    // Un respaldo puede contener una cita auténtica pero de otro tema. Solo
    // se reutiliza si tiene términos del tema o conecta sus mediciones vivas.
    const matching = new Set(valid.filter(c => U.tokens(c.text).some(t => terms.has(t))));
    const pair = measurementPair([...matching],terms);
    const old = valid.filter(c => matching.has(c) || connects(c.text,pair)), prior = assess(old,terms);
    const retired = before.length-old.length, after = prev && index ? appendFrom(index,prev.dialogue.cursor) : null;
    const revisit = action === 'revise' || action === 'compare';
    let items;
    if (followup && !revisit) items = old;
    else {
      const ranked = index ? candidates(index,terms,original.filters,scope,after,pair) : [];
      items = select(ranked,old,after,revisit,prior);
      // Si la pareja aparece por primera vez, no importa si el anexo llegó
      // hoy, antes de los informes o antes de recargar la aplicación.
      if (!pair && index) {
        const notes = methodNotes(index,measurementPair(items,terms),original.filters,scope,0);
        if (notes.length) items = select(notes,items,0,true,assess(items,terms));
      }
    }
    const finding = assess(items,terms);
    Object.assign(reply, finding);
    if (action === 'why' && items.length) {
      const reasons = {
        description: 'La oración define el término. Por eso se puede atribuir esa definición a la fuente, sin suponer que incluya todos los usos del término.',
        reason: 'La fuente une una afirmación y un motivo. Puedo señalar esa relación en sus palabras, pero no demostrar que no haya otra explicación.',
        qualification: 'Hay una restricción explícita en el material. Ignorarla convertiría un caso particular en una afirmación más amplia de lo que dice la fuente.',
        example: 'Un ejemplo documenta un caso; no permite concluir que todos los casos sean iguales.'
      };
      reply.reason = numeric.has(finding.kind)
        ? 'Me baso en cifras literales con la misma unidad. Eso permite señalar una diferencia, no atribuirle una causa.'
        : reasons[finding.kind] || 'Los pasajes contienen términos de tu pregunta. Esa coincidencia orienta la lectura, pero no demuestra que respondan a toda la pregunta.';
    }
    if (action === 'compare') reply.reason = compare(items,terms);
    if (action === 'gap') reply.reason = 'Esto es lo que buscaría para poner a prueba la lectura anterior; no es otro hecho que afirme el documento.';
    if (revisit && prev) {
      const added = items.map((c,i) => old.some(o => same(c,o)) ? 0 : i+1).filter(Boolean);
      reply.changeRefs = added;
      if (retired) reply.change = 'Una o más citas anteriores ya no coinciden con el material vivo. Las retiré y reconstruí la lectura sin usarlas.';
      else if (!added.length) reply.change = 'No encontré evidencia distinta que añadir a las citas anteriores.';
      else {
        reply.before = prior.reading;
        reply.change = (prior.reading !== finding.reading ? 'Cambio la lectura provisional' : 'Mantengo la lectura provisional y amplío el contraste') + ` con ${added.length === 1 ? 'un pasaje que no figuraba' : 'pasajes que no figuraban'} en la respuesta anterior.`;
      }
    } else if (retired) reply.change = 'Una cita anterior ya no está disponible; no la uso como evidencia. Revisa con las fuentes actuales.';
    // Explicar/leer los límites NO consume las incorporaciones pendientes de revisión.
    if (prev && !revisit) reply.cursor = prev.dialogue.cursor;
    reply.practice = items.length ? (numeric.has(finding.kind)
      ? 'Sin mirar las cifras, explica qué tendrías que igualar para comparar las mediciones.'
      : `Intenta responder «${original.cleaned}» sin mirar. Después, identifica la frase que respalda tu respuesta.`) : '';
    return { reply, chunks: items.map((c,i) => ({ ...c, index: i+1 })) };
  }
  function transcript(d, chunks) {
    const refs = ns => (ns || []).map(n => `[${n}]`).join(' ');
    return [d.topic && `Tema: ${d.topic}`, ...chunks.map((c,i) => `Fuente [${i+1}]: «${c.text}»`),
      d.before && `Lectura anterior: ${d.before}`, d.change && `Revisión: ${d.change} ${refs(d.changeRefs)}`,
      `Lectura provisional: ${d.reading} ${refs(d.refs)}`, d.reason, `Qué falta: ${d.gap}`, d.practice,
      d.generated && `Explicación de Qwen (no verificada): ${d.generated}`, d.notice].filter(Boolean).join('\n\n');
  }
  return { prepare, lastTurn, resolveSource, transcript, MAX_SOURCES, MAX_QUESTION };
});
