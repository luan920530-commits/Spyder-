/**
 * NEURAL COMMAND // AI SPIDER OS
 * js/store.js - Bus de memoria compartida (NeuralStore)
 */
(function () {
  const STORAGE_KEY = 'neural_spider_os_v2';

  const state = {
    docs: [], // { id, name, type, pages: [{ pageNum, text, sentences: [] }], mediaUrl, mediaType }
    activeDocId: null,
    activePage: 1,
    allSentences: [], // Índice plano en RAM: { id, docId, docName, pageNum, text, harvested }
    nodes: [], // Nodos del grafo D3
    links: [], // Enlaces sinápticos
    patterns: [], // Patrones cosechados
    visitedPatternHashes: new Set(),
    claimedTargets: new Set(), // sentenceIds reservados por arañas
    consolidatedMemory: [], // Enseñanzas manuales ("Aprende que...") + patrones consolidados
    chatHistory: [],
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3',
    ollamaEnabled: false
  };

  const listeners = {};

  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach(cb => {
      try { cb(payload); } catch (e) { console.error(`[Store:${event}]`, e); }
    });
  }

  function savePersistent() {
    try {
      const data = {
        consolidatedMemory: state.consolidatedMemory.slice(-200),
        chatHistory: state.chatHistory.slice(-40),
        ollamaUrl: state.ollamaUrl,
        ollamaModel: state.ollamaModel
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[Store] localStorage lleno o no disponible:', e);
    }
  }

  function loadPersistent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.consolidatedMemory)) state.consolidatedMemory = data.consolidatedMemory;
      if (Array.isArray(data.chatHistory)) state.chatHistory = data.chatHistory;
      if (data.ollamaUrl) state.ollamaUrl = data.ollamaUrl;
      if (data.ollamaModel) state.ollamaModel = data.ollamaModel;
    } catch (e) {
      console.warn('[Store] Error leyendo localStorage:', e);
    }
  }

  function hashPattern(str) {
    const clean = str.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, '');
    let h = 2166136261;
    for (let i = 0; i < clean.length; i++) {
      h ^= clean.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function addDocument(doc) {
    state.docs.push(doc);
    doc.pages.forEach(p => {
      p.sentences.forEach(s => {
        state.allSentences.push(s);
      });
    });
    state.activeDocId = doc.id;
    state.activePage = 1;
    emit('doc:added', doc);
    emit('doc:pageChanged', { docId: doc.id, pageNum: 1 });
  }

  function setActiveDoc(docId, pageNum = 1) {
    const doc = state.docs.find(d => d.id === docId);
    if (!doc) return;
    state.activeDocId = docId;
    state.activePage = Math.max(1, Math.min(pageNum, doc.pages.length || 1));
    emit('doc:pageChanged', { docId, pageNum: state.activePage });
  }

  function setActivePage(pageNum) {
    const doc = getActiveDoc();
    if (!doc) return;
    const clamped = Math.max(1, Math.min(pageNum, doc.pages.length || 1));
    state.activePage = clamped;
    emit('doc:pageChanged', { docId: doc.id, pageNum: clamped });
  }

  function getActiveDoc() {
    return state.docs.find(d => d.id === state.activeDocId) || null;
  }

  function resetAll() {
    state.docs = [];
    state.activeDocId = null;
    state.activePage = 1;
    state.allSentences = [];
    state.nodes = [];
    state.links = [];
    state.patterns = [];
    state.visitedPatternHashes.clear();
    state.claimedTargets.clear();
    emit('system:reset');
  }

  function init() {
    loadPersistent();
    initIndexedDB();
    const btnReset = document.getElementById('btn-reset-all');
    if (btnReset) btnReset.addEventListener('click', resetAll);
  }

  let idb = null;
  function initIndexedDB() {
    if (!window.indexedDB) return;
    const req = indexedDB.open('NeuralSpiderDB', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('patterns')) {
        db.createObjectStore('patterns', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => {
      idb = e.target.result;
      try {
        const tx = idb.transaction('patterns', 'readonly');
        const getAll = tx.objectStore('patterns').getAll();
        getAll.onsuccess = () => {
          if (Array.isArray(getAll.result) && getAll.result.length) {
            emit('db:restored', getAll.result);
          }
        };
      } catch (_) {}
    };
  }

  function persistPatternIDB(pattern) {
    if (!idb) return;
    try {
      const tx = idb.transaction('patterns', 'readwrite');
      tx.objectStore('patterns').add({ ...pattern, ts: Date.now() });
    } catch (_) {}
  }

  on('spider:manualPattern', persistPatternIDB);

  window.NeuralStore = {
    state,
    on,
    emit,
    init,
    savePersistent,
    hashPattern,
    addDocument,
    setActiveDoc,
    setActivePage,
    getActiveDoc,
    resetAll,
    persistPatternIDB
  };
})();
