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
  const api = factory(U, R, DB, C);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NeuralStore = Object.assign(root.NeuralStore || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (U, R, DB, C) {
  'use strict';

  const DEFAULT_SETTINGS = {
    provider: 'internal',
    model: '',
    mode: 'auto',
    searchScope: 'both',
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
    consolidatedMemory: [],
    vault: [],
    chat: [],
    feedback: [],

    // Estudio
    cards: [],
    quizRuns: [],

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
  const ALL_COLLECTIONS = ['docs', 'nodes', 'links', 'patterns', 'vault', 'chat', 'feedback', 'cards', 'quizRuns', 'evalRuns', 'settings', 'memory'];
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

  /** Guardado inmediato (usado antes de exportar o al cerrar). */
  function savePersistent() {
    scheduleSave();
    clearTimeout(saveTimer);
    return flush();
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

    emit('doc:added', normalized);
    emit('doc:pageChanged', { docId: normalized.id, pageNum: 1 });
    emit('retrieve:indexed', { added, stats: R.stats(state.index) });
    scheduleSave();
    return normalized;
  }

  function removeDocument(docId) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    const removed = new Set(state.allSentences.filter(s => s.docId === docId).map(s => s.id));
    state.docs = state.docs.filter(d => d.id !== docId);
    exclusionCache = null; state.lastSearch = null;
    if (state.settings.characterDocId === docId) state.settings.characterDocId = '';
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
    state.cards = state.cards.filter(c => !removed.has(c.sentenceId));
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
    emit('doc:removed', { docId });
    emit('doc:pageChanged', { docId: state.activeDocId, pageNum: state.activePage });
    emit('retrieve:indexed', { stats: R.stats(state.index) });
    scheduleSave();
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

  function addPattern({ cluster, label, text, pageNum, sentenceId, color, section }) {
    if (!label || !text) return null;
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
      if (sentenceId && !existing.sentenceIds.includes(sentenceId)) existing.sentenceIds.push(sentenceId);
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
      const [settings, docs, nodes, links, patterns, vault, chat, feedback, cards, quizRuns, evalRuns, memory] = await Promise.all([
        DB.get('settings'), DB.get('docs'), DB.get('nodes'), DB.get('links'), DB.get('patterns'),
        DB.get('vault'), DB.get('chat'), DB.get('feedback'), DB.get('cards'), DB.get('quizRuns'),
        DB.get('evalRuns'), DB.get('consolidatedMemory')
      ]);

      state.settings = Object.assign({}, DEFAULT_SETTINGS, settings && typeof settings === 'object' ? settings : {});
      // Los proveedores de versiones anteriores no pueden descargar modelos.
      state.settings.provider = 'internal';
      state.docs = Array.isArray(docs) ? docs : [];
      state.nodes = Array.isArray(nodes) ? nodes : [];
      state.links = Array.isArray(links) ? links : [];
      state.patterns = Array.isArray(patterns) ? patterns : [];
      state.vault = Array.isArray(vault) ? vault : [];
      state.chat = Array.isArray(chat) ? chat : [];
      state.feedback = Array.isArray(feedback) ? feedback : [];
      state.cards = Array.isArray(cards) ? cards : [];
      state.quizRuns = Array.isArray(quizRuns) ? quizRuns : [];
      state.evalRuns = Array.isArray(evalRuns) ? evalRuns : [];
      state.consolidatedMemory = Array.isArray(memory) ? memory : [];
      if (!memory && !chat && typeof localStorage !== 'undefined') {
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
    state.index = R.rebuildFrom(state.allSentences);
    indexVectors();
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
    state.chat = [];
    state.quizRuns = [];
    state.evalRuns = [];
    if (!o.keepMemory) { state.vault = []; state.consolidatedMemory = []; state.cards = []; state.feedback = []; }
    else state.feedback.forEach(f => { if (Array.isArray(f.sentenceIds)) f.sentenceIds = []; });
    if (!o.keepSettings) state.settings = Object.assign({}, DEFAULT_SETTINGS);
    // El personaje y su libro son datos del usuario, no preferencias de interfaz.
    state.settings.characterDocId = '';
    state.settings.characterName = '';

    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem('neural_spider_os_v2');
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
    if (typeof localStorage === 'undefined') return out;
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
    const allowed = ['docs', 'nodes', 'links', 'patterns', 'vault', 'chat', 'feedback', 'cards', 'quizRuns', 'evalRuns', 'settings', 'consolidatedMemory', 'meta'];
    for (const key of allowed.filter(k => !['settings', 'meta'].includes(k))) {
      if (obj.data[key] !== undefined && !Array.isArray(obj.data[key])) throw new Error('Respaldo inválido: ' + key);
    }
    if (obj.data.docs && obj.data.docs.some(d => !d || typeof d.id !== 'string' || typeof d.name !== 'string' || !Array.isArray(d.pages) || d.pages.some(p => !p || !Array.isArray(p.sentences) || p.sentences.some(x => !x || typeof x.text !== 'string' || typeof x.id !== 'string')))) {
      throw new Error('Respaldo inválido: documentos mal formados');
    }
    if (obj.auxiliary && (typeof obj.auxiliary !== 'object' || Array.isArray(obj.auxiliary) || JSON.stringify(obj.auxiliary).length > 2000000)) throw new Error('Respaldo auxiliar inválido');
    const auxiliary = obj.auxiliary || {};
    obj = { ...obj, data: Object.fromEntries(allowed.filter(k => Object.prototype.hasOwnProperty.call(obj.data, k)).map(k => [k, obj.data[k]]) ) };
    // Una carga de libro anterior no debe mezclarse con el respaldo importado.
    emit('brain:importing');
    clearTimeout(saveTimer); dirty.clear();
    await flushChain;
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
    savePersistent, flush,
    addDocument, removeDocument, setActiveDoc, setActivePage, holdAutoNavigation, getActiveDoc, getSentence,
    addPattern, addLink, removeNode,
    search, synonyms,
    resetAll, exportBrain, importBrain, stats,
    hashPattern, persistPatternIDB
  };
});
