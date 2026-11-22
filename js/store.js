/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/store.js — Bus de estado compartido + persistencia local + índice de recuperación.
 *
 * Responsabilidades:
 *  · Mantener el estado único de la aplicación (documentos, grafo, memoria, ajustes).
 *  · Construir y mantener el índice de recuperación (NCRetrieval).
 *  · Persistir todo en IndexedDB (NCDB) y restaurarlo al arrancar.
 *  · Emitir eventos para que los módulos de UI no se acoplen entre sí.
 *
 * Procesamiento local: los documentos no se envían; los modelos opcionales se gestionan por separado.
 */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined') ? require('./util.js') : (root.NCUtil || {});
  const R = (typeof require === 'function' && typeof module !== 'undefined') ? require('./retrieval.js') : (root.NCRetrieval || {});
  const DB = (typeof require === 'function' && typeof module !== 'undefined') ? require('./db.js') : (root.NCDB || {});
  const C = (typeof require === 'function' && typeof module !== 'undefined') ? require('./chunks.js') : root.NCChunks;
  const K = (typeof require === 'function' && typeof module !== 'undefined') ? require('./study-skills.js') : root.NCStudySkills;
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(U, R, DB, C, K, node ? require('./highlights.js') : root.NCHighlights,
    node ? require('./passage-links.js') : root.NCPassageLinks, node ? require('./srs.js') : root.NCSRS,
    node ? require('./companion.js') : root.NCCompanion, node ? require('./harvest-links.js') : root.NCHarvestLinks);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NeuralStore = Object.assign(root.NeuralStore || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U, R, DB, C, K, H, L, SRS, Companion, HarvestLinks) {
  'use strict';

  const DEFAULT_SETTINGS = {
    provider: 'internal',
    model: '',
    mode: 'auto',
    searchScope: 'both',
    dialogueDocId: '', dialogueQwen: false,
    characterDocId: '',
    characterName: '',
    qwenEnabled: false,
    topK: 6,
    window: 1,
    fuzzy: true,
    reduceMotion: false,
    stream: true,
    citations: true,
    showTrace: true,
    embedModel: '',
    embedEnabled: true,
    theme: 'hud'
  };

  const state = {
    // Documentos e índice
    docs: [],
    activeDocId: null,
    activePage: 1,
    autoNavigationPausedUntil: 0,
    allSentences: [],
    index: R.createIndex ? R.createIndex() : null,

    // Grafo
    nodes: [],          // incluye hubs (isHub) y nodos cosechados
    links: [],
    patterns: [],
    visitedPatternHashes: new Set(),
    claimedTargets: new Set(),

    // Memoria
    personal: Companion.record(null), // No forma parte de collections ni alimenta la recuperación.
    consolidatedMemory: [],
    vault: [],
    chat: [],
    feedback: [],

    // Estudio
    cards: [],
    relationVotes: [],
    quizRuns: [],
    tutorRuns: [],

    // Evaluación
    evalRuns: [],

    // Ajustes
    settings: Object.assign({}, DEFAULT_SETTINGS),

    // Estado de ejecución
    ready: false,
    persistence: { available: false, fallback: false, lastSave: null, bytes: 0 },
    lastSearch: null
  };

  const listeners = Object.create(null);
  let synonymsCache = null, exclusionCache = null;
  // Apunta a los fragmentos canónicos (el índice contiene copias). Así la
  // animación, las citas y la invalidación son O(1) por ID en corpus grandes.
  let sentenceById = new Map();
  function rememberSentences(sentences) {
    for (const sentence of sentences) if (!sentenceById.has(sentence.id)) sentenceById.set(sentence.id, sentence);
  }
  function rebuildSentenceLookup() {
    sentenceById = new Map();
    rememberSentences(state.allSentences);
  }

  function on(event, cb) {
    (listeners[event] || (listeners[event] = [])).push(cb);
    return () => off(event, cb);
  }

  function off(event, cb) {
    const list = listeners[event];
    if (!list) return;
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  }

  function emit(event, payload) {
    if (['node:added', 'node:removed', 'doc:removed', 'memory:changed', 'system:reset', 'store:ready', 'brain:imported'].includes(event)) synonymsCache = null;
    (listeners[event] || []).slice().forEach(cb => {
      try { cb(payload); } catch (e) { console.error(`[Store:${event}]`, e); }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ajustes
  // ─────────────────────────────────────────────────────────────────────────
  function getSetting(key, fallback) {
    const v = state.settings[key];
    return v === undefined ? (fallback !== undefined ? fallback : DEFAULT_SETTINGS[key]) : v;
  }

  function setSetting(key, value, opts) {
    state.settings[key] = value;
    if (!opts || opts.persist !== false) scheduleSave('settings');
    emit('settings:changed', { key, value, settings: state.settings });
    return value;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistencia (debounce por colección)
  // ─────────────────────────────────────────────────────────────────────────
  const dirty = new Set();
  const SAVE_DEBOUNCE = 900;
  const ALL_COLLECTIONS = ['docs', 'nodes', 'links', 'patterns', 'vault', 'chat', 'feedback', 'cards', 'relationVotes', 'quizRuns', 'tutorRuns', 'evalRuns', 'settings', 'memory'];
  let saveTimer = null;

  function scheduleSave(collection) {
    if (collection) dirty.add(collection);
    else ALL_COLLECTIONS.forEach(c => dirty.add(c));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DEBOUNCE);
  }

  function serializeNodes() {
    return state.nodes.filter(n => !n.isHub).map(n => ({
      id: n.id, cluster: n.cluster, label: n.label, text: n.text, color: n.color,
      weight: n.weight || 1, pageNums: n.pageNums || [], sentenceIds: n.sentenceIds || [], section: n.section || ''
    }));
  }

  function serializeLinks() {
    return state.links.map(l => ({
      key: l.key,
      source: typeof l.source === 'object' ? l.source.id : l.source,
      target: typeof l.target === 'object' ? l.target.id : l.target,
      kind: l.kind || (l.synaptic ? 'synaptic' : 'hierarchy'),
      strength: l.strength || 1
    }));
  }

  function snapshot(items, fullHistory = false) {
    const data = {}, tail = (array, limit) => fullHistory ? array : array.slice(-limit);
    // Las URL blob son efímeras; nunca se guardan como archivos originales.
    if (items.includes('docs')) data.docs = state.docs.map(doc => ({ ...doc, mediaUrl: null }));
    // Paginar la interfaz no debe descartar las cosechas más antiguas.
    if (items.includes('patterns')) data.patterns = state.patterns;
    if (items.includes('nodes')) data.nodes = serializeNodes();
    if (items.includes('links')) data.links = serializeLinks();
    if (items.includes('vault')) data.vault = state.vault;
    if (items.includes('chat')) data.chat = tail(state.chat, 200);
    if (items.includes('feedback')) data.feedback = tail(state.feedback, 400);
    if (items.includes('cards')) data.cards = state.cards;
    if (items.includes('relationVotes')) data.relationVotes = state.relationVotes;
    if (items.includes('tutorRuns')) data.tutorRuns = tail(state.tutorRuns, 50);
    if (items.includes('quizRuns')) data.quizRuns = tail(state.quizRuns, 50);
    if (items.includes('evalRuns')) data.evalRuns = tail(state.evalRuns, 50);
    if (items.includes('memory')) data.consolidatedMemory = tail(state.consolidatedMemory, 300);
    if (items.includes('settings')) data.settings = state.settings;
    data.meta = { schema: 11, savedAt: Date.now(), docs: state.docs.length,
      sentences: state.allSentences.length, nodes: state.nodes.filter(n => !n.isHub).length };
    return data;
  }

  function detachSnapshot(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    // Compatibilidad con navegadores sin structuredClone: las colecciones de la
    // aplicación son objetos y arreglos; conservar funciones para que IDB las
    // rechace en vez de descartarlas silenciosamente como haría JSON.stringify.
    const seen = new WeakMap();
    function copy(item) {
      if (!item || typeof item !== 'object') return item;
      if (seen.has(item)) return seen.get(item);
      if (!Array.isArray(item) && Object.prototype.toString.call(item) !== '[object Object]') return item;
      const result = Array.isArray(item) ? [] : {};
      seen.set(item, result);
      Object.keys(item).forEach(key => Object.defineProperty(result, key, {
        value: copy(item[key]), enumerable: true, configurable: true, writable: true
      }));
      return result;
    }
    return copy(value);
  }

  let flushChain = Promise.resolve(true);
  function flush() {
    clearTimeout(saveTimer);
    if (!dirty.size) return flushChain;
    const items = Array.from(dirty); dirty.clear();
    flushChain = flushChain.then(async () => {
      const started = Date.now();
      // Congelar una generación antes de esperar a la base evita que nuevas
      // cosechas muten unas colecciones pero no otras durante la transacción.
      // IndexedDB escribe juntas las claves; localStorage intenta revertir.
      await DB.importAll({ data: detachSnapshot(snapshot(items)) }, { merge: true });
      state.persistence.lastSave = Date.now();
      state.persistence.bytes = JSON.stringify(state.docs).length;
      state.persistence.available = DB.status ? DB.status().available : true;
      emit('persistence:saved', { tookMs: Date.now() - started, collections: items });
      return true;
    }).catch(error => {
      // No se pierde la intención de guardar: el siguiente intento las incluye.
      items.forEach(item => dirty.add(item));
      console.warn('[Store] No se pudo guardar:', error);
      emit('persistence:error', error);
      return false;
    });
    return flushChain;
  }

  /** Guardado inmediato de las colecciones actuales. */
  function saveCards() {
    scheduleSave('cards'); return flush();
  }

  function savePersistent() {
    scheduleSave();
    clearTimeout(saveTimer);
    return flush();
  }

  // Compartir la barrera de escritura con reset/import sin meter una charla
  // personal en las colecciones de estudio. Se guarda una copia acotada.
  function savePersonal(data) {
    const snapshot = Companion.record(data); state.personal = snapshot;
    flushChain = flushChain.then(() => data == null ? DB.del(DB.PERSONAL) : DB.put(DB.PERSONAL, snapshot)).catch(() => false);
    return flushChain;
  }

  function embeddings() {
    return typeof window !== 'undefined' ? window.NCEmbeddings : globalThis.NCEmbeddings;
  }
  function indexVectors() {
    const E = embeddings();
    if (E && state.index && getSetting('embedEnabled', true)) E.indexAll(state.index);
  }
  function exclusionIndex(filters) {
    const base = state.index, exclusions = filters?.exclude || [];
    if (!exclusions.length) return base;
    const key = [...new Set(exclusions.map(U.normalize))].sort().join('\u0000');
    if (exclusionCache?.base === base && exclusionCache.length === base.sentences.length && exclusionCache.key === key)
      return exclusionCache.index;
    const index = R.projectExclusions(base, filters);
    // Solo se retiene la proyección más reciente; los demás filtros no alteran
    // la proyección y se evalúan durante la recuperación.
    exclusionCache = { base, length: base.sentences.length, key, index };
    return index;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Documentos e índice
  // ─────────────────────────────────────────────────────────────────────────
  function addDocument(doc) {
    const normalized = Object.assign({
      id: U.uid('doc'),
      name: 'documento.txt',
      type: 'txt',
      addedAt: Date.now(),
      pages: []
    }, doc);

    // Evitar duplicados por huella de contenido
    const totalChars = normalized.pages.reduce((a, p) => a + (p.text || '').length, 0);
    normalized.chars = totalChars;
    normalized.year = new Date().getFullYear();

    state.docs.push(normalized);
    exclusionCache = null; state.lastSearch = null;
    // Las oraciones originales quedan en el documento. El índice y el enjambre
    // consumen ventanas solapadas con los mismos IDs de ancla de versiones previas.
    const chunks = C.fromDocument(normalized);
    // Evita exceder el límite de argumentos de push en libros muy grandes.
    for (const chunk of chunks) state.allSentences.push(chunk);
    rememberSentences(chunks);
    const added = state.index ? R.addSentences(state.index, chunks) : 0;

    indexVectors();
    state.activeDocId = normalized.id;
    state.activePage = 1;
    // También puede hacer válida una cita de un respaldo antiguo.
    rebuildHarvestIndex();

    emit('doc:added', normalized);
    emit('doc:pageChanged', { docId: normalized.id, pageNum: 1 });
    emit('retrieve:indexed', { added, stats: R.stats(state.index) });
    scheduleSave();
    return normalized;
  }

  // Solo conservar el progreso mínimo del tutor, nunca el texto escrito por el
  // alumno. Este mismo contrato se aplica al guardar, restaurar e importar.
  function tutorSummary(run) {
    if (!run || typeof run.skill !== 'string' || !Object.hasOwn(K.SKILLS, run.skill) || typeof run.docId !== 'string' || !run.docId || !Number.isFinite(run.at) ||
        !Array.isArray(run.turns) || !run.turns.length || run.turns.length > K.SESSION_SIZE || run.turns.some(t =>
          !t || typeof t.sentenceId !== 'string' || !t.sentenceId || typeof t.ok !== 'boolean' || typeof t.hint !== 'boolean')) return null;
    if (new Set(run.turns.map(t => t.sentenceId)).size !== run.turns.length) return null;
    return { docId: run.docId, skill: run.skill, at: run.at, turns: run.turns.map(({ sentenceId, ok, hint }) => ({ sentenceId, ok, hint })) };
  }
  function liveTutorRun(run) {
    return run && run.turns.every(t => getSentence(t.sentenceId)?.docId === run.docId);
  }
  function recordTutorRun(run) {
    const summary = tutorSummary(run);
    if (!liveTutorRun(summary)) return false;
    state.tutorRuns.push(summary);
    state.tutorRuns = state.tutorRuns.slice(-50);
    scheduleSave('tutorRuns'); flush();
    return true;
  }

  // El selector se vuelve a comprobar contra el documento vivo, también al
  // guardar desde un modal: una selección vieja nunca cita otra página/libro.
  function addQuestion(source, question) {
    const doc = getActiveDoc(), front = String(question || '').trim();
    if (!doc || !front || front.length > H.MAX_QUESTION || source?.pageNum !== state.activePage) return null;
    const a = H.resolve(H.indexPage(doc, state.activePage), source);
    if (!a) return null;
    const duplicate = state.cards.find(c => c.kind === 'highlight' && c.docId === a.docId && c.pageNum === a.pageNum &&
      c.selector.start === a.selector.start && c.selector.end === a.selector.end && c.front === front);
    if (duplicate) return duplicate;
    const card = SRS.newCard({ ...a, id: U.uid('mine'), kind: 'highlight', front, back: a.selector.quote });
    state.cards.push(card); saveCards(); emit('questions:changed', { docId: doc.id });
    return card;
  }
  function removeQuestion(id) {
    const i = state.cards.findIndex(c => c.id === id && c.kind === 'highlight');
    if (i < 0) return;
    const [card] = state.cards.splice(i, 1); saveCards(); emit('questions:changed', { docId: card.docId });
  }

  // Índices derivados, no se exportan. El entrenamiento se reproduce desde
  // señales explícitas y acotadas; un libro jamás entrena a otro por su nombre.
  const relationModels = new Map();
  function relationModel(docId) {
    if (relationModels.has(docId)) return relationModels.get(docId);
    const doc = state.docs.find(d => d.id === docId && !d.mediaType);
    if (!doc) return null;
    if (relationModels.size >= 3) relationModels.delete(relationModels.keys().next().value);
    const model = L.create(doc, state.relationVotes); relationModels.set(docId, model); return model;
  }
  function relatedPassages(id) {
    const docId = getSentence(id)?.docId;
    return relationModel(docId)?.suggest(id).filter(l => getSentence(l.id)?.docId === docId) || [];
  }
  function saveRelations(docId) { scheduleSave('relationVotes'); flush(); emit('relations:changed', { docId }); }
  function clearRelations(docId) {
    if (!state.relationVotes.some(v => v.docId === docId)) return false;
    state.relationVotes = state.relationVotes.filter(v => v.docId !== docId);
    relationModels.get(docId)?.fit([]); rebuildHarvestIndex(); saveRelations(docId); return true;
  }
  function rateRelation(id, other, useful) {
    const docId = getSentence(id)?.docId, v = L.example({ docId, a: id, b: other, useful });
    if (!v || getSentence(other)?.docId !== docId || !relationModel(docId)?.pair(id, other)) return false;
    const i = state.relationVotes.findIndex(r => r.docId === docId && r.a === v.a && r.b === v.b);
    if (i >= 0 && state.relationVotes[i].useful === useful) return false;
    if (i >= 0) state.relationVotes.splice(i, 1);
    state.relationVotes.push(v);
    const lost = state.relationVotes.length > L.MAX_VOTES && state.relationVotes.shift();
    if (lost && lost.docId !== docId) relationModels.delete(lost.docId);
    relationModel(docId).fit(state.relationVotes);
    rebuildHarvestIndex(); saveRelations(docId); return true;
  }

  function removeDocument(docId) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    const removed = new Set(state.allSentences.filter(s => s.docId === docId).map(s => s.id));
    state.docs = state.docs.filter(d => d.id !== docId);
    exclusionCache = null; state.lastSearch = null;
    if (state.settings.characterDocId === docId) state.settings.characterDocId = '';
    if (state.settings.dialogueDocId === docId) state.settings.dialogueDocId = '';
    state.allSentences = state.allSentences.filter(s => s.docId !== docId);
    rebuildSentenceLookup();
    state.patterns = state.patterns.filter(p => !removed.has(p.sentenceId));
    state.visitedPatternHashes = new Set(state.patterns.map(p => p.hash));
    const removedNodes = new Set();
    state.nodes = state.nodes.filter(n => {
      if (n.isHub) return true;
      const original = n.sentenceIds || [];
      n.sentenceIds = original.filter(id => !removed.has(id));
      if (original.length && !n.sentenceIds.length) { removedNodes.add(n.id); return false; }
      return true;
    });
    state.links = state.links.filter(l => !removedNodes.has(typeof l.source === 'object' ? l.source.id : l.source) &&
      !removedNodes.has(typeof l.target === 'object' ? l.target.id : l.target));
    state.cards = state.cards.filter(c => !removed.has(c.sentenceId) && !(c.kind === 'highlight' && c.docId === docId));
    state.relationVotes = state.relationVotes.filter(v => v.docId !== docId); relationModels.delete(docId);
    state.tutorRuns = state.tutorRuns.filter(run => run.docId !== docId);
    state.vault.forEach(v => { v.sources = (v.sources || []).filter(src => !removed.has(src.sentenceId)); });
    // Las preferencias no deben reaparecer si se vuelve a utilizar un ID borrado.
    state.feedback.forEach(f => { if (Array.isArray(f.sentenceIds)) f.sentenceIds = f.sentenceIds.filter(id => !removed.has(id)); });
    if (doc.mediaUrl && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(doc.mediaUrl);
    if (state.activeDocId === docId) {
      state.activeDocId = state.docs[0] ? state.docs[0].id : null;
      state.activePage = 1;
    }
    state.index = R.rebuildFrom(state.allSentences);
    indexVectors();
    rebuildHarvestIndex();
    emit('doc:removed', { docId });
    emit('doc:pageChanged', { docId: state.activeDocId, pageNum: state.activePage });
    emit('retrieve:indexed', { stats: R.stats(state.index) });
    savePersistent();
  }

  /** Deja tiempo para leer una página elegida manualmente antes del avance automático. */
  function holdAutoNavigation(durationMs) {
    state.autoNavigationPausedUntil = Date.now() + (durationMs == null ? 15000 : Math.max(0, durationMs));
  }

  function setActiveDoc(docId, pageNum) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    state.activeDocId = docId;
    state.activePage = Math.max(1, Math.min(pageNum || 1, doc.pages.length || 1));
    emit('doc:pageChanged', { docId, pageNum: state.activePage });
  }

  function setActivePage(pageNum) {
    const doc = getActiveDoc();
    if (!doc) return;
    state.activePage = Math.max(1, Math.min(pageNum, doc.pages.length || 1));
    emit('doc:pageChanged', { docId: doc.id, pageNum: state.activePage });
  }

  function getActiveDoc() {
    return state.docs.find(d => d.id === state.activeDocId) || null;
  }

  function getSentence(id) {
    return sentenceById.get(id) || null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Grafo y patrones
  // ─────────────────────────────────────────────────────────────────────────
  // Las afinidades se derivan de las citas cosechadas, no se confunden con los
  // enlaces guardados ni se exportan. Se reconstruyen incluso para respaldos
  // anteriores; una cita ausente o un voto «No útil» no puede producirlas.
  let harvestIndex = null, harvestNodes = null, harvestNodeCount = -1;
  let harvestEpoch = 0, harvestTimer = null, harvestTotal = 0, harvestPending = 0;
  function rebuildHarvestIndex() {
    const epoch = ++harvestEpoch;
    clearTimeout(harvestTimer); harvestTimer = null;
    const rejected = new Set(state.relationVotes.filter(v => v.useful === false).map(v => HarvestLinks.pairKey(v.a, v.b)));
    const model = HarvestLinks.create(getSentence, (a, b) => rejected.has(HarvestLinks.pairKey(a, b)));
    harvestIndex = model; harvestNodes = state.nodes; harvestNodeCount = state.nodes.length;
    const nodes = state.nodes.filter(n => !n.isHub);
    let cursor = 0; harvestTotal = nodes.length; harvestPending = nodes.length;
    function step(notify) {
      if (epoch !== harvestEpoch) return;
      const start = Date.now(); let count = 0;
      do { if (cursor >= nodes.length) break; model.add(nodes[cursor++]); count++; }
      while (count < 64 && Date.now() - start < 8);
      harvestPending = nodes.length - cursor;
      if (harvestPending) harvestTimer = setTimeout(() => step(true), 0);
      else harvestTimer = null;
      if (notify) emit('harvest:linksUpdated', harvestInfo());
    }
    // Un corpus pequeño queda listo antes del primer render; uno grande cede
    // el hilo principal entre lotes y admite nuevas entregas durante la carga.
    step(false);
    return model;
  }
  function ensureHarvestIndex() {
    return !harvestIndex || harvestNodes !== state.nodes || harvestNodeCount !== state.nodes.length
      ? rebuildHarvestIndex() : harvestIndex;
  }
  function harvestEdges() { return ensureHarvestIndex().edges(); }
  function harvestConnections(nodeId) { return ensureHarvestIndex().connections(nodeId); }
  function harvestCandidates(sentenceId) { return ensureHarvestIndex().suggest(sentenceId); }
  function harvestTargetValid(sourceId, target) { return !!target && ensureHarvestIndex().validTarget(sourceId, target.nodeId, target.sentenceId); }
  function harvestInfo() { return { indexed: harvestIndex?.size() || 0, total: harvestTotal, indexing: harvestPending > 0 }; }

  function linkKey(source, target, kind) {
    return `${source}>${target}:${kind || 'h'}`;
  }

  // Índices derivados: una cosecha no debe recorrer todos los nodos y enlaces
  // previos. Se reconstruyen si una importación, borrado o inserción externa
  // sustituye las colecciones o cambia su longitud; nunca se serializan.
  let indexedNodes = null, indexedNodeCount = -1, patternNodes = new Map(), unusualAnchors = false;
  let indexedLinks = null, indexedLinkCount = -1, linkKeys = new Set();
  function rememberPatternNode(node) {
    if (!node || node.isHub) return;
    const norm = U.normalize(node.label).trim();
    let anchors = patternNodes.get(norm);
    if (!anchors) { anchors = new Map(); patternNodes.set(norm, anchors); }
    const ids = node.sentenceIds || [];
    if (!Array.isArray(ids)) { unusualAnchors = true; return; }
    if (!ids.length) { if (!anchors.has(null)) anchors.set(null, node); }
    else ids.forEach(id => { if (id && !anchors.has(id)) anchors.set(id, node); });
  }
  function findPatternNode(norm, sentenceId) {
    if (indexedNodes !== state.nodes || indexedNodeCount !== state.nodes.length) {
      patternNodes = new Map(); unusualAnchors = false;
      state.nodes.forEach(rememberPatternNode);
      indexedNodes = state.nodes; indexedNodeCount = state.nodes.length;
    }
    if (unusualAnchors) return state.nodes.find(n => !n.isHub && U.normalize(n.label).trim() === norm &&
      (sentenceId ? (n.sentenceIds || []).includes(sentenceId) : !(n.sentenceIds || []).length));
    return patternNodes.get(norm)?.get(sentenceId || null);
  }
  function addLink(source, target, kind, strength) {
    if (indexedLinks !== state.links || indexedLinkCount !== state.links.length) {
      linkKeys = new Set(state.links.map(link => link.key));
      indexedLinks = state.links; indexedLinkCount = state.links.length;
    }
    const key = linkKey(source, target, kind);
    if (linkKeys.has(key)) return null;
    const link = { key, source, target, kind: kind || 'hierarchy', strength: strength || 1 };
    state.links.push(link); linkKeys.add(key); indexedLinkCount = state.links.length;
    return link;
  }

  function addPattern({ cluster, label, text, pageNum, sentenceId, color, section, relatedTarget }) {
    if (!label || !text) return null;
    const affinity = ensureHarvestIndex();
    const norm = U.normalize(label).trim();
    const hash = U.hash(text), alreadyVisited = state.visitedPatternHashes.has(hash);
    // La misma etiqueta genérica puede aparecer en temas distintos. Solo se
    // fusiona otra cosecha del mismo ancla; las etiquetas ya no definen temas.
    const existing = findPatternNode(norm, sentenceId);

    let node;
    const isNew = !existing;
    if (existing) {
      existing.weight = (existing.weight || 1) + 1;
      if (pageNum != null && !existing.pageNums.includes(pageNum)) existing.pageNums.push(pageNum);
      if (sentenceId && !existing.sentenceIds.includes(sentenceId)) {
        existing.sentenceIds.push(sentenceId);
        rememberPatternNode(existing);
        rebuildHarvestIndex();
      }
      if (existing.cluster !== cluster) {
        addLink(existing.id, cluster, 'synaptic');
      }
      node = existing;
      state.visitedPatternHashes.add(hash);
    } else {
      node = {
        id: U.uid('N'),
        cluster,
        label: label.slice(0, 40),
        text,
        color: color || '#00f0ff',
        weight: 1,
        pageNums: pageNum != null ? [pageNum] : [],
        sentenceIds: sentenceId ? [sentenceId] : [],
        section: section || '',
        createdAt: Date.now()
      };
      state.nodes.push(node);
      rememberPatternNode(node); indexedNodeCount = state.nodes.length;
      affinity.add(node, relatedTarget);
      harvestNodes = state.nodes; harvestNodeCount = state.nodes.length; harvestTotal++;
      addLink(cluster, node.id, 'hierarchy');
      state.visitedPatternHashes.add(hash);
    }

    if (!alreadyVisited) {
      state.patterns.push({ hash, cluster, label: node.label, text, pageNum, sentenceId, color, section: section || '', ts: Date.now() });
    }

    emit('node:added', { node, isNew, hash, pattern: { cluster, label: node.label, text, pageNum, sentenceId, color } });
    scheduleSave();
    return node;
  }

  function removeNode(nodeId) {
    state.nodes = state.nodes.filter(n => n.id !== nodeId);
    state.links = state.links.filter(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return s !== nodeId && t !== nodeId;
    });
    rebuildHarvestIndex();
    emit('node:removed', { nodeId });
    scheduleSave();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Búsqueda (con expansión de sinónimos desde el grafo y la bóveda)
  // ─────────────────────────────────────────────────────────────────────────
  function synonyms() {
    if (synonymsCache) return synonymsCache;
    const map = Object.create(null);
    const add = (from, to) => {
      const f = U.stem(from);
      if (!f || !to) return;
      if (!map[f]) map[f] = [];
      if (!map[f].includes(to)) map[f].push(to);
    };
    state.nodes.filter(n => !n.isHub).forEach(n => {
      U.tokens(n.label).forEach(t => add(t, n.label));
      U.tokens(n.text || '').slice(0, 6).forEach(t => add(t, n.label));
    });
    state.vault.forEach(v => {
      (v.keywords || []).forEach(k => add(k, v.phrase || v.term || k));
    });
    synonymsCache = map;
    return map;
  }

  function search(query, opts) {
    const o = Object.assign({
      k: getSetting('topK', 6),
      fuzzy: getSetting('fuzzy', true),
      diversify: true
    }, opts || {});
    if (!state.index) return { hits: [], tookMs: 0, total: 0 };
    const searchOpts = Object.assign({}, o), parsed = R.parseQuery(query);
    if (o.expand !== false) {
      const syn = Object.assign(Object.create(null), synonyms());
      // Términos asociados aprendidos por el modelo auxiliar (co-ocurrencia local)
      const aux = (typeof window !== 'undefined') ? window.KimiAuxModel : null;
      if (aux && aux.getAssociatedConcepts) {
        try {
          const related = aux.getAssociatedConcepts(parsed.cleaned, 4).map(x => x.word);
          parsed.uniqueTerms.forEach(term => { syn[term] = (syn[term] || []).concat(related); });
        } catch (_) {}
      }
      searchOpts.parsed = R.expandQuery(parsed, syn);
    }
    const E = embeddings();
    const index = exclusionIndex(parsed.filters);
    // Un vector calculado con texto o título excluido no puede aportar
    // evidencia a la proyección, incluso si el cuerpo no necesitó recorte.
    if (parsed.filters.exclude.length && o.neuralScores) {
      const safe = new Map();
      for (const [id, score] of o.neuralScores) {
        const a = state.index.posById.get(id), b = index.posById.get(id);
        if (a == null || b == null) continue;
        const original = state.index.sentences[a].contextText || state.index.sentences[a].text;
        const projected = index.sentences[b].contextText || index.sentences[b].text;
        if (original === projected && !R.containsExcluded({ text: projected }, parsed.filters)) safe.set(id, score);
      }
      searchOpts.neuralScores = safe;
    }
    if (index !== state.index && getSetting('embedEnabled', true) && E) E.indexAll(index);
    index.queryVectorCache = Object.create(null);
    if (getSetting('embedEnabled', true) && E && index.vectors.size) {
      index.queryVectorCache[query] = E.embedOne(parsed.cleaned);
      searchOpts.queryConcepts = E.concepts(parsed.cleaned);
    }
    // Ajuste acotado ANTES de deduplicar, diversificar y cortar el top-k.
    const queryTerms = new Set(U.tokens(query)), feedbackScores = new Map();
    (state.feedback || []).forEach(f => {
      const other = new Set(U.tokens(f.question));
      if (U.jaccard(queryTerms, other) < 0.35) return;
      (Array.isArray(f.sentenceIds) ? f.sentenceIds : []).slice(0, 100).forEach(id =>
        feedbackScores.set(id, (feedbackScores.get(id) || 0) + Math.sign(Number(f.rating) || 0)));
    });
    const semantic = typeof window !== 'undefined' ? window.NCSemantic : globalThis.NCSemantic;
    const weights = semantic?.preferenceWeights(state.feedback);
    searchOpts.scoreFactor = sentence => {
      const exact = Math.max(-.45, Math.min(.45, (feedbackScores.get(sentence.id) || 0) * .3));
      const topic = semantic?.preferenceFor(sentence.id, weights) || 0;
      return 1 + exact + topic;
    };
    const result = R.search(index, query, searchOpts);
    result.contextIndex = index;
    state.lastSearch = result;
    emit('retrieve:done', result);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Arranque / restauración
  // ─────────────────────────────────────────────────────────────────────────
  async function init() {
    if (typeof document !== 'undefined') {
      const status = DB.status ? DB.status() : { available: false };
      state.persistence.available = !!status.available;
    }

    try {
      const [settings, docs, nodes, links, patterns, vault, chat, feedback, cards, quizRuns, tutorRuns, evalRuns, memory, votes, personal] = await Promise.all([
        DB.get('settings'), DB.get('docs'), DB.get('nodes'), DB.get('links'), DB.get('patterns'),
        DB.get('vault'), DB.get('chat'), DB.get('feedback'), DB.get('cards'), DB.get('quizRuns'),
        DB.get('tutorRuns'), DB.get('evalRuns'), DB.get('consolidatedMemory'), DB.get('relationVotes'), DB.get(DB.PERSONAL)
      ]);

      state.settings = Object.assign({}, DEFAULT_SETTINGS, settings && typeof settings === 'object' ? settings : {});
      // Los proveedores de versiones anteriores no pueden descargar modelos.
      state.settings.provider = 'internal';
      state.docs = Array.isArray(docs) ? docs : [];
      state.nodes = Array.isArray(nodes) ? nodes : [];
      state.links = Array.isArray(links) ? links : [];
      state.patterns = Array.isArray(patterns) ? patterns : [];
      state.vault = Array.isArray(vault) ? vault : [];
      state.personal = Companion.record(personal);
      state.chat = Array.isArray(chat) ? chat : [];
      state.feedback = Array.isArray(feedback) ? feedback : [];
      state.cards = Array.isArray(cards) ? cards : [];
      state.relationVotes = Array.isArray(votes) ? votes : [];
      state.quizRuns = Array.isArray(quizRuns) ? quizRuns : [];
      state.tutorRuns = Array.isArray(tutorRuns) ? tutorRuns.slice(-50).map(tutorSummary).filter(Boolean) : [];
      state.evalRuns = Array.isArray(evalRuns) ? evalRuns : [];
      state.consolidatedMemory = Array.isArray(memory) ? memory : [];
      if (!memory && !chat) {
        try {
          const old = JSON.parse(localStorage.getItem('neural_spider_os_v2') || '{}');
          if (Array.isArray(old.consolidatedMemory)) state.consolidatedMemory = old.consolidatedMemory;
          if (Array.isArray(old.chatHistory)) state.chat = old.chatHistory;
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[Store] Error restaurando:', e);
    }

    // También migra respaldos anteriores: las citas históricas mantienen su ID.
    exclusionCache = null; state.lastSearch = null;
    state.allSentences = state.docs.flatMap(doc => C.fromDocument(doc));
    rebuildSentenceLookup();
    relationModels.clear();
    const votes = L.restoreVotes(state.relationVotes, v => getSentence(v.a)?.docId === v.docId && getSentence(v.b)?.docId === v.docId);
    if (votes.length !== state.relationVotes.length) scheduleSave('relationVotes');
    state.relationVotes = votes;
    const liveRuns = state.tutorRuns.filter(liveTutorRun);
    if (liveRuns.length !== state.tutorRuns.length) scheduleSave('tutorRuns');
    state.tutorRuns = liveRuns;
    state.cards = state.cards.map(card => {
      const upgraded = K.upgradeCard(card, getSentence(card?.sentenceId));
      if (upgraded !== card) dirty.add('cards');
      return upgraded;
    });
    if (dirty.has('cards')) scheduleSave('cards');
    state.index = R.rebuildFrom(state.allSentences);
    indexVectors();
    rebuildHarvestIndex();
    state.persistence = Object.assign(state.persistence, DB.status());
    state.visitedPatternHashes = new Set();
    state.patterns.forEach(p => { if (p.hash) state.visitedPatternHashes.add(p.hash); });

    if (state.docs.length && !state.docs.some(d => d.id === state.activeDocId)) {
      state.activeDocId = state.docs[state.docs.length - 1].id;
    }
    state.activePage = 1;
    state.ready = true;

    bindGlobalHandlers();
    emit('store:ready', {
      docs: state.docs.length,
      sentences: state.allSentences.length,
      nodes: state.nodes.filter(n => !n.isHub).length,
      stats: R.stats(state.index)
    });
    return state;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Reset y respaldos
  // ─────────────────────────────────────────────────────────────────────────
  async function resetAll(opts) {
    const o = Object.assign({ keepSettings: true, keepMemory: false }, opts || {});
    // Avisar antes de cualquier espera para cancelar lecturas aún en curso.
    emit('system:resetting', o);
    clearTimeout(saveTimer); dirty.clear();
    await flushChain;
    state.docs = [];
    state.activeDocId = null;
    state.activePage = 1;
    state.autoNavigationPausedUntil = 0;
    state.allSentences = [];
    exclusionCache = null; state.lastSearch = null;
    sentenceById.clear();
    state.index = R.createIndex();
    state.nodes = [];
    state.links = [];
    state.patterns = [];
    state.visitedPatternHashes = new Set();
    state.claimedTargets = new Set();
    state.personal = Companion.record(null);
    state.chat = [];
    state.quizRuns = [];
    state.relationVotes = []; relationModels.clear();
    rebuildHarvestIndex();
    state.tutorRuns = [];
    state.evalRuns = [];
    if (!o.keepMemory) { state.vault = []; state.consolidatedMemory = []; state.cards = []; state.feedback = []; }
    else {
      state.feedback.forEach(f => { if (Array.isArray(f.sentenceIds)) f.sentenceIds = []; });
      state.cards = state.cards.filter(c => c.kind !== 'highlight');
    }
    if (!o.keepSettings) state.settings = Object.assign({}, DEFAULT_SETTINGS);
    // El personaje y su libro son datos del usuario, no preferencias de interfaz.
    state.settings.characterDocId = '';
    state.settings.characterName = '';
    state.settings.dialogueDocId = '';

    try { localStorage.removeItem('neural_spider_os_v2'); } catch (_) {}
    try {
      await DB.clearAll();
      if (o.keepSettings) await DB.put('settings', state.settings);
      if (o.keepMemory) {
        await DB.put('vault', state.vault); await DB.put('consolidatedMemory', state.consolidatedMemory);
        await DB.put('cards', state.cards); await DB.put('feedback', state.feedback);
      }
    } catch (_) {}

    emit('system:reset', { keepSettings: o.keepSettings, keepMemory: o.keepMemory });
    emit('doc:pageChanged', { docId: null, pageNum: 1 });
  }

  function auxiliarySnapshot() {
    const out = {};
    for (const key of ['kimi_aux_brain_v2', 'neural_spider_microai_v2']) {
      try { const value = localStorage.getItem(key); if (value) out[key] = JSON.parse(value); } catch (_) {}
    }
    return out;
  }

  async function exportBrain() {
    // También si la cuota impide guardar, un respaldo debe contener el estado
    // actual completo, no una mezcla de claves antiguas y nuevas en IndexedDB.
    await savePersistent();
    const data = JSON.parse(JSON.stringify(snapshot(ALL_COLLECTIONS, true)));
    return {
      app: 'NEURAL COMMAND // AI SPIDER OS',
      version: 11,
      exportedAt: new Date().toISOString(),
      stats: R.stats(state.index),
      auxiliary: auxiliarySnapshot(),
      data
    };
  }

  async function importBrain(obj, opts) {
    if (!obj || !obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) throw new Error('Respaldo inválido: falta el campo data');
    const allowed = [...ALL_COLLECTIONS.map(key => key === 'memory' ? 'consolidatedMemory' : key), 'meta'];
    for (const key of allowed.filter(k => !['settings', 'meta'].includes(k))) {
      if (obj.data[key] !== undefined && !Array.isArray(obj.data[key])) throw new Error('Respaldo inválido: ' + key);
    }
    if (obj.data.docs && obj.data.docs.some(d => !d || typeof d.id !== 'string' || typeof d.name !== 'string' || !Array.isArray(d.pages) || d.pages.some(p => !p || !Array.isArray(p.sentences) || p.sentences.some(x => !x || typeof x.text !== 'string' || typeof x.id !== 'string')))) {
      throw new Error('Respaldo inválido: documentos mal formados');
    }
    if (obj.auxiliary && (typeof obj.auxiliary !== 'object' || Array.isArray(obj.auxiliary) || JSON.stringify(obj.auxiliary).length > 2000000)) throw new Error('Respaldo auxiliar inválido');
    const auxiliary = obj.auxiliary || {};
    obj = { ...obj, data: Object.fromEntries(allowed.filter(k => Object.prototype.hasOwnProperty.call(obj.data, k)).map(k => [k, obj.data[k]]) ) };
    if (obj.data.tutorRuns) {
      const summaries = obj.data.tutorRuns.slice(-50).map(tutorSummary);
      if (summaries.some(run => !run)) throw new Error('Respaldo inválido: progreso del tutor');
      obj.data.tutorRuns = summaries;
    }
    const studyDocs = obj.data.docs ?? (opts?.merge ? state.docs : []);
    if (obj.data.relationVotes?.length) {
      obj.data.relationVotes = L.restoreVotes(obj.data.relationVotes, undefined, true);
      const missing = new Map();
      for (const { docId, a, b } of obj.data.relationVotes) {
        if (!missing.has(docId)) missing.set(docId, new Set());
        missing.get(docId).add(a).add(b);
      }
      for (const doc of studyDocs) {
        const ids = missing.get(doc.id);
        if (ids && !doc.mediaType) for (const p of doc.pages) for (const s of p.sentences) ids.delete(s.id);
      }
      if ([...missing.values()].some(ids => ids.size)) throw new Error('Respaldo inválido: vínculo sin fuente');
    }
    if (obj.data.cards?.some(c => c?.kind === 'highlight')) {
      const docs = new Map(studyDocs.map(d => [d.id, d]));
      const pages = new Map();
      for (const c of obj.data.cards.filter(c => c?.kind === 'highlight')) {
        const key = JSON.stringify([c.docId, c.pageNum]);
        if (!pages.has(key)) pages.set(key, H.indexPage(docs.get(c.docId), c.pageNum));
        if (!H.resolve(pages.get(key), c) || !c.id || typeof c.front !== 'string' || !c.front.trim() ||
            c.front.length > H.MAX_QUESTION || c.back !== c.selector.quote) throw new Error('Respaldo inválido: pregunta sin cita literal');
      }
    }
    // Una carga de libro anterior no debe mezclarse con el respaldo importado.
    emit('brain:importing');
    try {
      await flush();
      await DB.importAll(obj, opts);
      try {
        if (typeof localStorage !== 'undefined') {
          for (const key of ['kimi_aux_brain_v2', 'neural_spider_microai_v2']) {
            const value = auxiliary[key];
            if (value && typeof value === 'object' && !Array.isArray(value)) localStorage.setItem(key, JSON.stringify(value));
            else localStorage.removeItem(key);
          }
        }
        if (typeof window !== 'undefined') {
          if (window.KimiAuxModel) window.KimiAuxModel.restore(auxiliary.kimi_aux_brain_v2);
          if (window.SpiderEngine) window.SpiderEngine.reloadMicroBrains();
        }
      } catch (_) {}
      await init();
      emit('brain:imported', { stats: R.stats(state.index) });
    } catch (error) { emit('brain:importFailed', error); throw error; }
    return state;
  }

  function stats() {
    return {
      docs: state.docs.length,
      pages: state.docs.reduce((a, d) => a + (d.pages || []).length, 0),
      sentences: state.allSentences.length,
      harvested: state.allSentences.filter(s => s.harvested).length,
      nodes: state.nodes.filter(n => !n.isHub).length,
      links: state.links.length,
      patterns: state.patterns.length,
      vault: state.vault.length,
      cards: state.cards.length,
      quizRuns: state.quizRuns.length,
      tutorRuns: state.tutorRuns.length,
      index: R.stats(state.index)
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Integración con el DOM (progreso de cosecha, atajos, cierre)
  // ─────────────────────────────────────────────────────────────────────────
  let handlersBound = false;
  function bindGlobalHandlers() {
    if (typeof document === 'undefined' || handlersBound) return;
    handlersBound = true;
    window.addEventListener('beforeunload', () => { flush(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  function hashPattern(str) { return U.hash(str); }

  // Compatibilidad con la API anterior
  const persistPatternIDB = pattern => {
    if (!pattern || !pattern.text) return;
    addPattern(pattern);
  };

  return {
    state, DEFAULT_SETTINGS,
    on, off, emit,
    init,
    getSetting, setSetting,
    savePersistent, saveCards, savePersonal, flush, recordTutorRun,
    addDocument, removeDocument, setActiveDoc, setActivePage, holdAutoNavigation, getActiveDoc, getSentence,
    addPattern, addLink, removeNode, addQuestion, removeQuestion, relatedPassages, rateRelation, clearRelations,
    harvestEdges, harvestConnections, harvestCandidates, harvestTargetValid, harvestInfo,
    search, synonyms,
    resetAll, exportBrain, importBrain, stats,
    hashPattern, persistPatternIDB
  };
});
