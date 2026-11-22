/** Banco didáctico separado del corpus y del historial personal. */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(root, node ? require('./study-skills') : root.NCStudySkills, node ? require('./analysis') : root.NCAnalysis);
  if (node) module.exports = api;
  root.NCCourseReview = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, skills, analysis) {
  'use strict';
  const BANK = 'spyder-course-v1', REPORT = 'spyder-review-v1', MAX_CASES = 24;
  const axes = ['cloze', 'distractors', 'guidance'];
  function field(obj, key, max) {
    const s = obj?.[key];
    if (typeof s !== 'string' || !s.trim() || s.length > max) throw Error(`Campo «${key}» vacío, inválido o demasiado largo (máx. ${max}).`);
    return s.trim();
  }
  function readBank(data) {
    if (data?.format !== BANK) throw Error('Formato de banco desconocido. Usa el banco descargable como plantilla.');
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > MAX_CASES) throw Error(`El banco debe tener entre 1 y ${MAX_CASES} casos.`);
    const ids = new Set();
    return { format: BANK, subject: field(data, 'subject', 150), attribution: field(data, 'attribution', 1000),
      license: field(data, 'license', 500), source: field(data, 'source', 500), items: data.items.map(item => {
        const id = field(item, 'id', 64);
        if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw Error('Cada caso necesita un ID único con letras ASCII, números, guion o guion bajo.');
        ids.add(id);
        return { id, reference: field(item, 'reference', 500), target: field(item, 'target', 200), passage: field(item, 'passage', 1500),
          question: field(item, 'question', 1500), explanation: field(item, 'explanation', 2000) };
      }) };
  }
  function proposals(bank) {
    const pool = bank.items.map(({ id, passage }) => ({ id, text: passage, docId: 'course', docName: bank.subject }));
    // Misma generación que en Estudio, pero con un muestreo reproducible para
    // que volver a abrir un caso no cambie los distractores que se valoraron.
    let seed = 1;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
    const quiz = new Map(analysis.quizItems(pool, { n: pool.length, minLen: 35, random }).map(q => [q.sentence.id, q]));
    return pool.map(s => {
      const recall = skills.exercise(s, 'recall'), explain = skills.exercise(s, 'explain'), q = quiz.get(s.id);
      return { id: s.id, recall: recall ? { prompt: recall.prompt, answer: recall.answer, hint: recall.hint } : null,
        quiz: q ? { prompt: q.prompt, answer: q.answer, distractors: q.options.filter(word => word !== q.answer) } : null,
        explain: { prompt: explain.prompt, hint: explain.hint } };
    });
  }
  function verdict(values, proposal) {
    const result = {};
    for (const key of axes) {
      const missing = (key === 'cloze' && !proposal.recall) || (key === 'distractors' && !proposal.quiz);
      if (!(missing ? ['ausente'] : ['si', 'no']).includes(values?.[key])) throw Error('Indica un dictamen para cada criterio disponible.');
      result[key] = values[key];
    }
    if (typeof values.note !== 'string' || values.note.length > 1000) throw Error('La nota no puede superar los 1000 caracteres.');
    result.note = values.note.trim();
    if (result.guidance === 'no' && !result.note) throw Error('Describe la orientación que falta antes de registrar.');
    return result;
  }
  function open(data) {
    const report = data?.format === REPORT;
    const bank = readBank(report ? data.bank : data), cases = proposals(bank), reviews = new Map();
    if (report) {
      if (!Array.isArray(data.cases) || data.cases.length !== cases.length) throw Error('El informe no corresponde al banco.');
      cases.forEach((p, i) => {
        const row = data.cases[i];
        if (JSON.stringify(row?.proposal) !== JSON.stringify(p)) throw Error('Las propuestas cambiaron. Importa el banco sin los dictámenes para revisarlo de nuevo.');
        if (row.verdict !== null) reviews.set(p.id, verdict(row.verdict, p));
      });
    }
    return { bank, cases, reviews };
  }
  function summary(state) {
    const result = { total: state.cases.length, reviewed: state.reviews.size };
    const values = [...state.reviews.values()];
    for (const key of axes) result[key] = { positive: values.filter(v => v[key] === 'si').length, rated: values.filter(v => v[key] !== 'ausente').length };
    return result;
  }
  function report(state) {
    return { format: REPORT, bank: state.bank, cases: state.cases.map(proposal => ({ proposal, verdict: state.reviews.get(proposal.id) || null })), summary: summary(state) };
  }
  function init() {
    const el = key => document.getElementById('review-' + key);
    let state = open(root.NCCourseExample), index = 0, fileEpoch = 0, pending = null;
    const drafts = new Map(), status = message => { if (el('status').textContent !== message) el('status').textContent = message; };
    const chosen = () => state.cases[index];
    const values = () => Object.fromEntries([...axes, 'note'].map(key => [key, el(key).value]));
    function refreshSummary() {
      const s = summary(state), ratio = key => s[key].rated ? `${s[key].positive}/${s[key].rated}` : 'sin valorar';
      el('summary').textContent = `Casos con dictamen: ${s.reviewed}/${s.total}. Huecos útiles: ${ratio('cloze')}. Distractores plausibles: ${ratio('distractors')}. Orientación suficiente: ${ratio('guidance')}.`;
    }
    function renderCase() {
      const item = state.bank.items[index], p = chosen(), current = drafts.get(p.id) || state.reviews.get(p.id);
      for (const key of ['reference', 'question', 'explanation', 'passage']) el(key).textContent = item[key];
      el('gap').textContent = p.recall ? `${p.recall.prompt}\nTérmino: ${p.recall.answer}. Pista: ${p.recall.hint}` : 'Sin hueco: no hay un término elegible.';
      el('options').textContent = p.quiz ? `${p.quiz.prompt}\nCorrecta: ${p.quiz.answer}. Distractores: ${p.quiz.distractors.join(' · ')}.` : 'Sin pregunta de quiz para este pasaje. No se inventan distractores.';
      el('prompt').textContent = `${p.explain.prompt}\nPista: ${p.explain.hint}`;
      el('cloze').disabled = !p.recall; el('distractors').disabled = !p.quiz;
      for (const key of [...axes, 'note']) el(key).value = el(key).disabled ? 'ausente' : current?.[key] || '';
      status(state.reviews.has(p.id) ? 'Dictamen registrado.' : drafts.has(p.id) ? 'Borrador sin registrar.' : 'Pendiente de revisión.'); refreshSummary();
    }
    function renderBank() {
      const b = state.bank; index = 0; drafts.clear(); pending = null; el('replacement').hidden = true;
      el('subject').textContent = b.subject; el('origin').textContent = `${b.attribution}\n${b.license}\nFuente: ${b.source}`;
      el('case').replaceChildren(...b.items.map((it, i) => new Option(`${i + 1}. ${it.target}`, String(i))));
      renderCase();
    }
    el('case').addEventListener('change', () => { index = Number(el('case').value); renderCase(); });
    function edit() {
      drafts.set(chosen().id, values()); state.reviews.delete(chosen().id); status('Borrador sin registrar.'); refreshSummary();
    }
    for (const key of axes) el(key).addEventListener('change', edit);
    el('note').addEventListener('input', edit);
    el('save').addEventListener('click', () => {
      try {
        state.reviews.set(chosen().id, verdict(values(), chosen())); drafts.delete(chosen().id);
        status('Dictamen registrado.'); refreshSummary();
      } catch (error) { status(error.message); }
    });
    const download = (name, json) => root.BrainRAG.download(name, JSON.stringify(json, null, 2), 'application/json;charset=utf-8');
    el('template').addEventListener('click', () => download('banco-asignatura.json', state.bank));
    el('export').addEventListener('click', () => { download('informe-docente.json', report(state)); status('Informe preparado. Solo incluye dictámenes registrados.'); });
    // Confirmación en el panel: no necesita allow-modals en una vista aislada.
    function replaceWith(next) {
      if (state.reviews.size || drafts.size) {
        pending = next; el('replacement').hidden = false; el('keep').focus();
      } else { state = next; renderBank(); }
    }
    el('keep').addEventListener('click', () => { pending = null; el('replacement').hidden = true; el('case').focus(); });
    el('replace').addEventListener('click', () => { if (pending) { state = pending; renderBank(); el('case').focus(); } });
    el('example').addEventListener('click', () => { fileEpoch++; replaceWith(open(root.NCCourseExample)); });
    el('file').addEventListener('change', async event => {
      const f = event.target.files?.[0]; event.target.value = ''; if (!f) return;
      const epoch = ++fileEpoch; pending = null; el('replacement').hidden = true;
      try {
        if (f.size > 3 * 1024 * 1024) throw Error('El JSON supera los 3 MiB.');
        const next = open(JSON.parse(await f.text()));
        if (epoch === fileEpoch) replaceWith(next);
      } catch (error) { if (epoch === fileEpoch) status(`No se importó el archivo: ${error.message}`); }
    });
    root.NeuralStore.on('system:resetting', () => { fileEpoch++; state = open(root.NCCourseExample); renderBank(); });
    renderBank();
  }
  return { open, verdict, summary, report, init };
});
