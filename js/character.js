/** Selección de pasajes y respuestas por reglas; Qwen es una ruta opcional separada. */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined') ? require('./util.js') : root.NCUtil;
  const R = (typeof require === 'function' && typeof module !== 'undefined') ? require('./retrieval.js') : root.NCRetrieval;
  const api = factory(U, R);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCCharacter = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U, R) {
  'use strict';

  // Estas palabras describen la petición, no el tema del libro. Solo se usan
  // para este modo; no alteran el índice ni la búsqueda del resto de la app.
  const GENERIC = new Set(U.tokens(
    'dime decir dice dijo dices hablar hablas hablame habla cuentame cuenta contar ' +
    'sabes saber piensa piensas opina opinas siente sientes sentir parece recuerdas ' +
    'recuerda recordar explica explicar explicame pregunta quieres quiero gustaria ' +
    'podrias puedes puede paso pasa ocurrio sucede sucedio suceder personaje libro ' +
    'novela historia acerca cosa cosas hecho hiciste eres soy tuyo tuya ustedes '
  ));
  let cached = null;
  // El modo lectura conserva el avance por oración, aun si el índice utiliza
  // ventanas solapadas alrededor de cada ancla.
  const sourceText = sentence => sentence?.sourceText ?? sentence?.text ?? '';

  function normalizedWords(text) {
    return U.normalize(text).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }
  function mentions(text, name) {
    const needle = normalizedWords(name), haystack = normalizedWords(text);
    return !!needle && (' ' + haystack + ' ').includes(' ' + needle + ' ');
  }

  /** Menciones exactas y sus dos vecinas dentro del libro elegido; no infiere quién habla. */
  function profile(index, docId, name) {
    const key = normalizedWords(name);
    if (!index || !docId || !key) return { mentions: [], nearby: new Map() };
    if (cached && cached.index === index && cached.length === index.sentences.length && cached.docId === docId && cached.key === key) return cached.value;
    const anchors = [];
    index.sentences.forEach((sentence, pos) => {
      if (sentence.docId === docId && mentions(sourceText(sentence), name)) anchors.push(pos);
    });
    const nearby = new Map();
    anchors.forEach(pos => {
      for (let delta = -2; delta <= 2; delta++) {
        const candidate = index.sentences[pos + delta];
        if (!candidate || candidate.docId !== docId || !String(candidate.text || '').trim()) continue;
        const distance = Math.abs(delta), old = nearby.get(pos + delta);
        if (old === undefined || distance < old) nearby.set(pos + delta, distance);
      }
    });
    const value = { mentions: anchors, nearby };
    cached = { index, length: index.sentences.length, docId, key, value };
    return value;
  }

  function crisis(text) {
    const q = U.normalize(text);
    return /\b(?:quiero|quisiera|deseo|planeo|pienso|voy a|decidi)\s+(?:morir|suicidarme|matarme|quitarme la vida|acabar con mi vida|hacerme dano|lastimarme)\b/.test(q) ||
      /\bme\s+(?:quiero|voy a|pienso|voy)\s+(?:matar|suicidar|lastimar|hacer dano)\b/.test(q) ||
      /\b(?:pienso|pensando|he pensado) en (?:suicidarme|matarme|quitarme la vida|hacerme dano)\b/.test(q) ||
      /\b(?:pensamientos?|ideas?) suicidas?\b/.test(q) ||
      /\b(?:no quiero (?:seguir )?vivir|no quiero estar viv[oa]|me (?:hice|hare|he hecho|estoy haciendo) dano|intente suicidarme)\b/.test(q);
  }

  function emotionalKind(text) {
    const q = U.normalize(text);
    if (/\b(?:solo te tengo a ti|nadie mas que tu|solo te necesito a ti|eres lo unico que tengo)\b/.test(q)) return 'dependence';
    const firstPerson = /\b(?:me siento|estoy|me encuentro|siento|tengo|necesito hablar|me preocupa|me duele|perdi|he perdido)\b/.test(q);
    if (!firstPerson) return null;
    if (/\b(?:ansiedad|ansios[oa]|nervios[oa]|angustia|estresad[oa]|miedo|preocupad[oa])\b/.test(q)) return 'anxiety';
    if (/\b(?:sol[oa]|soledad|aislad[oa])\b/.test(q)) return 'lonely';
    if (/\b(?:triste|deprimid[oa]|desanimad[oa]|abatid[oa]|llorando|dolor|mal|perdi|perdido)\b/.test(q)) return 'sad';
    if (/\bnecesito hablar\b/.test(q)) return 'talk';
    return null;
  }

  function makeReply(lead, options) {
    const o = options || {};
    const reply = { lead, excerptLabel: o.excerptLabel || '', excerpt: o.excerpt || '', closing: o.closing || '' };
    let text = lead;
    if (reply.excerpt) text += `\n\n${reply.excerptLabel}\n«${reply.excerpt}» [1]`;
    if (reply.closing) text += `\n\n${reply.closing}`;
    return { text, reply, chunks: o.chunks || [], citations: o.citations || null, intent: o.intent || 'conversation' };
  }

  function topicTerms(question, name) {
    const nameTerms = new Set(U.tokens(name));
    return [...new Set(U.tokens(question).filter(term => !GENERIC.has(term) && !nameTerms.has(term)))].slice(0, 12);
  }

  // Limita la cita manteniendo un fragmento real y priorizando la palabra buscada.
  function excerpt(text, terms) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    const limit = 360;
    if (value.length <= limit) return value;
    let found = 0;
    if (terms && terms.length) {
      for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
        if (terms.includes(U.stem(match[0]))) { found = match.index; break; }
      }
    }
    let start = Math.max(0, found - 110);
    if (start) {
      const next = value.indexOf(' ', start);
      if (next >= 0 && next < found) start = next + 1;
    }
    let end = Math.min(value.length, start + limit);
    if (end < value.length) {
      const last = value.lastIndexOf(' ', end);
      if (last > start) end = last;
    }
    return (start ? '…' : '') + value.slice(start, end) + (end < value.length ? '…' : '');
  }

  function lastSource(history, docId, name, index) {
    const key = normalizedWords(name);
    for (const entry of [...(history || [])].reverse()) {
      if (entry.mode !== 'conversacion' || entry.character?.docId !== docId || normalizedWords(entry.character?.name) !== key) continue;
      const source = entry.sources?.[0];
      const pos = source?.sentenceId ? index.posById.get(source.sentenceId) : undefined;
      if (pos != null && index.sentences[pos]?.docId === docId) return pos;
    }
    return null;
  }

  function withSource(index, pos, lead, label, closing, terms, intent) {
    const sentence = index.sentences[pos];
    const chunks = R.buildContext(index, [{ sentence, score: 1 }], { window: 0, maxChunks: 1 });
    if (!chunks.length) return makeReply('No pude abrir ese pasaje del libro. Prueba otra pregunta.', { intent: 'no-evidence' });
    const quotation = excerpt(sourceText(sentence), terms);
    // Para una oración mayor que el límite de contexto, la cita centrada en el
    // término puede quedar fuera del comienzo truncado. Mostrar exactamente el
    // fragmento citado y no atribuirle vecinas que ya no aparecen.
    const plainQuote = quotation.replace(/^…|…$/g, '');
    if (plainQuote && !chunks[0].text.replace(/\s+/g, ' ').includes(plainQuote)) {
      chunks[0].text = quotation;
      chunks[0].sentenceIds = [sentence.id];
    }
    // Los corchetes que pertenecen al libro no son citas generadas por la app.
    const citationText = quotation.replace(/\[\d{1,2}\]/g, '') + ' [1]';
    const citations = R.verifyCitations(citationText, chunks);
    return makeReply(lead, { excerptLabel: label, excerpt: quotation, closing, chunks, citations, intent });
  }

  function respond(options) {
    const o = options || {}, question = String(o.question || '').trim();
    const name = String(o.name || '').trim().slice(0, 80), doc = o.doc || null, index = o.index;
    const character = { name, docId: doc?.id || null };
    const finish = result => ({ ...result, character });

    // Esta capa es deliberadamente básica y no puede detectar todas las crisis.
    // Prevalece sobre el personaje y sobre cualquier fragmento de la novela.
    if (crisis(question)) return finish(makeReply(
      'Siento que estés pasando por esto. Tu seguridad es lo primero. Si estás en peligro inmediato o ya te hiciste daño, llama a emergencias de tu localidad o acude a urgencias. Busca ahora a alguien de confianza y dile que necesitas compañía.',
      { closing: '¿Estás en peligro inmediato?', intent: 'crisis' }
    ));
    const emotion = emotionalKind(question);
    if (emotion) {
      const leads = {
        sad: 'Siento que estés pasando por un momento difícil. Si quieres, puedes contarme qué te está pesando más.',
        lonely: 'Sentirse así puede ser muy duro. Si te apetece, cuéntame un poco más; también puedes buscar compañía de alguien de confianza.',
        anxiety: 'Parece que estás pasando por algo que te inquieta. Podemos ir paso a paso: ¿qué es lo que más te preocupa ahora?',
        dependence: 'Me alegra que puedas expresarte aquí. También mereces apoyo fuera de esta pantalla; si puedes, habla con alguien de confianza.',
        talk: 'Estoy aquí para conversar. ¿Qué te gustaría compartir?'
      };
      return finish(makeReply(leads[emotion], { intent: 'emotional' }));
    }

    if (!doc || !index) return finish(makeReply('Para conversar con un personaje, sube un libro o elige uno de los documentos cargados.', { intent: 'setup' }));
    if (!normalizedWords(name)) return finish(makeReply('Escribe el nombre del personaje tal como aparece en el libro y después vuelve a preguntarme.', { intent: 'setup' }));
    const found = profile(index, doc.id, name);
    if (!found.mentions.length) return finish(makeReply(
      `No encontré «${name}» en el texto extraído de este libro. Comprueba la escritura o prueba otro nombre tal como aparece en la obra.`,
      { closing: 'Si el PDF es un escaneo, usa «Leer un escaneo · OCR» en Documento y selecciona el texto reconocido.', intent: 'missing-character' }
    ));

    const q = U.normalize(question);
    if (/^(?:hola|buenas|buenos dias|buenas tardes|buenas noches|saludos|hey)\b/.test(q) && U.words(q).length <= 12) {
      return finish(makeReply(`¡Hola! Soy una versión sencilla de ${name}, inspirada en el libro que elegiste. ¿Sobre qué te gustaría conversar?`, { intent: 'greeting' }));
    }
    if (/\b(?:como estas|como te encuentras)\b/.test(q) && U.words(q).length <= 9) {
      return finish(makeReply('Estoy aquí y listo para conversar. ¿Cómo te sientes tú?', { intent: 'greeting' }));
    }

    const previous = lastSource(o.history, doc.id, name, index);
    const forward = /\b(?:que paso despues|que sucede despues|que sucedio despues|y despues|que sigue|continua|siguiente pasaje|sigue leyendo)\b/.test(q);
    const backward = /\b(?:que paso antes|que sucedio antes|y antes|pasaje anterior)\b/.test(q);
    if (forward || backward) {
      if (previous == null) return finish(makeReply('Primero pregúntame por el personaje o por un tema del libro; después podremos seguir desde ese pasaje.', { intent: 'continuation' }));
      const pos = previous + (backward ? -1 : 1);
      if (!index.sentences[pos] || index.sentences[pos].docId !== doc.id) return finish(makeReply('No hay otro pasaje en esa dirección dentro de este libro.', { intent: 'continuation' }));
      return finish(withSource(index, pos, 'Sigamos leyendo desde el último fragmento que vimos.',
        backward ? 'Pasaje anterior del libro:' : 'Pasaje siguiente del libro:',
        'Puede ser narración o diálogo de otro personaje. ¿Quieres seguir leyendo?', [], 'continuation'));
    }

    const terms = topicTerms(question, name);
    const general = /\b(?:quien eres|como te llamas|hablame de ti|hablame sobre ti|cuentame de ti|cuentame tu historia|presentate)\b/.test(q);
    if (general || !terms.length) {
      const used = new Set((o.history || []).filter(entry => entry.mode === 'conversacion' && entry.character?.docId === doc.id && normalizedWords(entry.character?.name) === normalizedWords(name))
        .map(entry => entry.sources?.[0]?.sentenceId).filter(Boolean));
      const pos = found.mentions.find(i => !used.has(index.sentences[i].id)) ?? found.mentions[0];
      return finish(withSource(index, pos, 'Podemos explorar mi historia. Encontré este momento en el libro:',
        'Fragmento del libro; puede ser narración o diálogo de otra persona:',
        '¿Qué parte te gustaría explorar?', [], 'character-profile'));
    }

    let best = null;
    for (const [pos, distance] of found.nearby) {
      const stems = new Set(U.tokens(sourceText(index.sentences[pos])));
      const matches = terms.reduce((sum, term) => sum + (stems.has(term) ? 1 : 0), 0);
      if (!matches) continue;
      const score = matches * 10 + (2 - distance);
      if (!best || score > best.score || (score === best.score && pos < best.pos)) best = { pos, score, distance };
    }
    if (!best) return finish(makeReply(
      `No encontré ese tema cerca de una mención de ${name} en el libro elegido. No quiero inventar una respuesta.`,
      { closing: 'Prueba con otras palabras del libro o pregúntame «Háblame de ti».', intent: 'no-evidence' }
    ));
    const label = best.distance === 0
      ? 'Fragmento donde aparece el personaje; puede ser narración o diálogo de otra persona:'
      : 'Fragmento cercano a una mención del personaje; puede ser narración o diálogo de otra persona:';
    return finish(withSource(index, best.pos, 'Encontré este momento que podría relacionarse con tu pregunta:', label,
      '¿Qué te parece este fragmento?', terms, 'character-search'));
  }

  function clearCache() { cached = null; }
  return { respond, profile, mentions, crisis, emotionalKind, topicTerms, excerpt, clearCache };
});