/** Estudio local: ejercicios sobre oraciones originales, no sobre ventanas de búsqueda. */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./util.js') : root.NCUtil, node ? require('./analysis.js') : root.NCAnalysis);
  if (node) module.exports = api;
  root.NCStudySkills = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U, A) {
  'use strict';
  const SKILLS = { recall: 'Recuerdo activo', explain: 'Explicación propia' };
  const SESSION_SIZE = 3;
  const literal = s => String(s.sourceText ?? s.text ?? '').trim();
  function anchor(s) {
    return { id: s.id, docId: s.docId, docName: s.docName, section: s.section,
      pageNum: s.pageNum, sourcePage: s.sourcePage || null, text: literal(s) };
  }
  // Muestra acotada a lo largo del corpus; el principio de un libro largo no
  // debe ocultar todos los documentos que se cargaron después.
  function sample(sentences, limit) {
    return U.sampleEvenly(sentences, limit).map(anchor);
  }
  function cloze(text) {
    const term = A.pickAnswerTerm(text);
    if (!term) return null;
    // term procede exclusivamente de palabras Unicode; ocultar la palabra entera.
    return { term, prompt: text.replace(new RegExp(`(^|[^\\p{L}])${term}(?!\\p{L})`, 'u'), '$1________') };
  }
  function cardFields(source, allowOpenQuestion = false) {
    const text = literal(source), gap = cloze(text);
    if (!text || (!gap && !allowOpenQuestion)) return null;
    return { id: 'fc-' + source.id, sentenceId: source.id, docId: source.docId, docName: source.docName,
      pageNum: source.pageNum, sourcePage: source.sourcePage || null,
      front: gap ? 'Completa: ' + gap.prompt : `Explica la idea del pasaje que empieza por «${U.words3(text)}».`,
      back: gap ? `${gap.term}\n\n${text}` : text };
  }
  /** Repara únicamente los dos campos de texto reconocibles del generador
   * anterior. Ni tarjetas personalizadas ni fechas de repaso se regeneran. */
  function upgradeCard(card, source) {
    if (!card || !source || card.id !== 'fc-' + source.id || Object.hasOwn(card, 'sourcePage') ||
        (card.docName && card.docName !== source.docName)) return card;
    const term = A.pickAnswerTerm(source.text);
    if (!term || card.back !== `${term}\n\n${source.text}` || card.front !== 'Completa: ' + source.text.replace(term, '________')) return card;
    const fields = cardFields(source, true);
    return fields ? { ...card, ...fields } : card;
  }
  function terms(text) {
    return (text.match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length >= 3 && !U.isStopword(U.normalize(w)));
  }
  function exercise(s, skill) {
    const source = anchor(s);
    if (!source.text) return null;
    if (skill === 'recall') {
      const gap = cloze(source.text);
      return gap && { source, prompt: gap.prompt, answer: gap.term,
        hint: `La palabra empieza por «${gap.term[0]}» y tiene ${Array.from(gap.term).length} letras.` };
    }
    const cue = terms(source.text)[0];
    return { source, prompt: '¿Qué idea transmite el pasaje? Explícasela con tus palabras a alguien que empieza.',
      hint: cue ? `Piensa en «${cue}». ¿Qué dice el pasaje al respecto?` : 'Recuerda la idea principal y un detalle que la apoye.' };
  }
  function plan(sentences, docId, skill, runs = []) {
    if (!Object.hasOwn(SKILLS, skill) || !docId) return [];
    const last = new Map();
    let order = 0;
    for (const run of runs) if (run.docId === docId && run.skill === skill) {
      for (const turn of run.turns) last.set(turn.sentenceId, { priority: turn.ok && !turn.hint ? 2 : 0, order: ++order });
    }
    // Primero lo que se quiso reforzar, después material nuevo, finalmente lo
    // practicado hace más tiempo. Una sesión jamás cruza de libro por nombre.
    const fresh = { priority: 1, order: 0 };
    const ranked = sentences.filter(s => s.docId === docId).sort((a, b) => {
      const x = last.get(a.id) || fresh, y = last.get(b.id) || fresh;
      return x.priority - y.priority || x.order - y.order;
    });
    const items = [], seen = new Set();
    for (const s of ranked) {
      const item = exercise(s, skill);
      if (!item || seen.has(item.source.text)) continue;
      items.push(item); seen.add(item.source.text);
      if (items.length === SESSION_SIZE) break;
    }
    return items;
  }
  function compare(item, skill, response) {
    const answer = String(response || '').trim();
    if (!answer) return null;
    if (skill === 'recall') {
      const clean = s => U.normalize(s).trim().replace(/^[¿¡«"“]+|[.,;:!?»"”]+$/gu, '').trim();
      return { ok: clean(answer) === clean(item.answer) };
    }
    // Coincidencias orientativas, nunca una calificación semántica. El alumno
    // compara su explicación con el original y decide qué volver a practicar.
    const stems = new Set(terms(answer).map(U.stem).filter(Boolean));
    const shared = [...new Set(terms(item.source.text).filter(w => stems.has(U.stem(w))))].slice(0, 4);
    return { ok: null, shared };
  }
  return { SKILLS, SESSION_SIZE, sample, cardFields, upgradeCard, exercise, plan, compare };
});
