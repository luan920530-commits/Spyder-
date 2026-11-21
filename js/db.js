/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/db.js — Persistencia local robusta (IndexedDB v3) con migración desde v2,
 * exportación/importación del cerebro completo y respaldo en localStorage.
 *
 * Sin dependencias. Nunca lanza: si IndexedDB no está disponible, degrada a memoria.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCDB = Object.assign(root.NCDB || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DB_NAME = 'NeuralSpiderDB';
  const DB_VERSION = 3;
  const STORE = 'kv';
  const LEGACY_DB = 'NeuralSpiderDB';
  const LS_PREFIX = 'nc11:';

  let db = null;
  let opened = false;
  let failed = false;
  let opening = null;
  const memory = new Map();      // respaldo si IndexedDB no está disponible

  function hasIDB() {
    return typeof indexedDB !== 'undefined' && indexedDB && typeof indexedDB.open === 'function';
  }

  function open() {
    if (opened) return Promise.resolve(db);
    if (opening) return opening;
    if (!hasIDB()) { opened = true; failed = true; return Promise.resolve(null); }
    opening = new Promise(resolve => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (_) { opened = true; failed = true; resolve(null); return; }
      req.onupgradeneeded = ev => {
        const database = ev.target.result;
        const tx = ev.target.transaction;
        const store = database.objectStoreNames.contains(STORE)
          ? tx.objectStore(STORE) : database.createObjectStore(STORE, { keyPath: 'k' });
        if (!store.indexNames.contains('updatedAt')) store.createIndex('updatedAt', 'updatedAt');
        // Conserva la tabla antigua hasta que finalice la transacción de migración.
        if (ev.oldVersion < 3 && database.objectStoreNames.contains('patterns')) {
          const all = tx.objectStore('patterns').getAll();
          all.onsuccess = () => {
            if (all.result && all.result.length) store.put({ k: 'patterns', v: all.result, updatedAt: Date.now() });
          };
        }
      };
      req.onsuccess = ev => {
        db = ev.target.result; opened = true; failed = false;
        db.onversionchange = () => { db.close(); db = null; opened = false; opening = null; };
        resolve(db);
      };
      req.onerror = () => { opened = true; failed = true; resolve(null); };
      req.onblocked = () => console.warn('[DB] Cierra otras pestañas para completar la migración.');
    });
    return opening;
  }

  function put(k, v) {
    memory.set(k, v);
    return open().then(database => {
      if (!database) {
        try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); return true; } catch (_) { return false; }
      }
      return new Promise(resolve => {
        try {
          const tx = database.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ k, v, updatedAt: Date.now() });
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    });
  }

  function get(k) {
    return open().then(database => {
      if (!database) {
        // Leer primero la copia durable: las colecciones en memoria pueden
        // haberse mutado después de un guardado fallido por cuota.
        try {
          const raw = localStorage.getItem(LS_PREFIX + k);
          if (raw !== null) return JSON.parse(raw);
        } catch (_) {}
        return memory.has(k) ? memory.get(k) : null;
      }
      return new Promise(resolve => {
        try {
          const tx = database.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(k);
          req.onsuccess = () => {
            const row = req.result;
            resolve(row && row.v !== undefined ? row.v : null);
          };
          req.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
      });
    });
  }

  function getAllKeys() {
    return open().then(database => {
      if (!database) {
        const keys = new Set(memory.keys());
        try { Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX)).forEach(k => keys.add(k.slice(LS_PREFIX.length))); } catch (_) {}
        return Array.from(keys);
      }
      return new Promise(resolve => {
        try {
          const tx = database.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).getAllKeys();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (_) { resolve([]); }
      });
    });
  }

  function del(k) {
    memory.delete(k);
    return open().then(database => {
      if (!database) { try { localStorage.removeItem(LS_PREFIX + k); } catch (_) {} return; }
      return new Promise(resolve => {
        try {
          const tx = database.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(k);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (_) { resolve(false); }
      });
    });
  }

  function clearAll() {
    memory.clear();
    return open().then(database => {
      if (!database) {
        try {
          Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX)).forEach(k => localStorage.removeItem(k));
        } catch (_) {}
        return;
      }
      return new Promise(resolve => {
        try {
          const tx = database.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (_) { resolve(false); }
      });
    });
  }

  async function exportAll() {
    const keys = await getAllKeys();
    const out = { exportedAt: new Date().toISOString(), schema: DB_VERSION, data: {} };
    for (const k of keys) out.data[k] = await get(k);
    return out;
  }

  async function importAll(obj, opts) {
    const o = Object.assign({ merge: false, only: null }, opts || {});
    if (!obj || !obj.data || typeof obj.data !== 'object') throw new Error('Formato de respaldo no reconocido');
    const keys = o.only ? o.only.filter(k => Object.prototype.hasOwnProperty.call(obj.data, k)) : Object.keys(obj.data);
    const database = await open();
    if (database) {
      // Una única transacción: una cuota o un registro inválido no borra el estado previo.
      await new Promise((resolve, reject) => {
        let tx;
        try {
          tx = database.transaction(STORE, 'readwrite');
          const table = tx.objectStore(STORE);
          if (!o.merge) table.clear();
          for (const key of keys) table.put({ k: key, v: obj.data[key], updatedAt: Date.now() });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('No se pudo importar el respaldo'));
          tx.onabort = () => reject(tx.error || new Error('Importación cancelada'));
        } catch (error) { try { tx?.abort(); } catch (_) {} reject(error); }
      });
      if (!o.merge) memory.clear();
      keys.forEach(key => memory.set(key, obj.data[key]));
      return keys;
    }
    // localStorage no tiene transacciones; se conserva una copia para intentar revertir.
    const previous = new Map();
    try {
      for (const key of Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX))) previous.set(key, localStorage.getItem(key));
      const encoded = keys.map(key => [LS_PREFIX + key, JSON.stringify(obj.data[key])]);
      if (!o.merge) previous.forEach((_, key) => localStorage.removeItem(key));
      encoded.forEach(([key, value]) => localStorage.setItem(key, value));
      if (!o.merge) memory.clear();
      keys.forEach(key => memory.set(key, obj.data[key]));
      return keys;
    } catch (error) {
      try {
        for (const key of Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX))) localStorage.removeItem(key);
        previous.forEach((value, key) => localStorage.setItem(key, value));
      } catch (_) {}
      throw new Error('No se pudo importar el respaldo: ' + error.message);
    }
  }

  async function estimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }
    } catch (_) {}
    return { usage: 0, quota: 0 };
  }

  function status() {
    return { available: hasIDB() && !failed, opened, failed, fallback: failed };
  }

  return {
    DB_NAME, DB_VERSION, STORE,
    hasIDB, open, put, get, del, clearAll, getAllKeys,
    exportAll, importAll, estimate, status
  };
});
