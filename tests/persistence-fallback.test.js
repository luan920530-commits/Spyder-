const test = require('node:test');
const assert = require('node:assert/strict');

function storage() {
  const map = new Map();
  let failKey = null;
  return new Proxy({
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem(key, value) {
      if (key === failKey) { failKey = null; throw new Error('cuota simulada'); }
      map.set(key, String(value));
    },
    removeItem: key => map.delete(key),
    failOnce: key => { failKey = key; },
    dump: () => Object.fromEntries(map)
  }, { ownKeys: () => [...map.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
}

test('el respaldo localStorage intenta revertir un fallo y el JSON conserva el estado en memoria', async () => {
  global.indexedDB = undefined;
  global.localStorage = storage();
  const S = require('../js/store');
  await S.init();
  const pattern = i => ({ cluster: 'AGT-01', label: `Concepto ${i}`, text: `Pasaje ${i}`, sentenceId: `s-${i}` });
  S.addPattern(pattern(1));
  assert.equal(await S.savePersistent(), true);
  assert.equal(S.state.persistence.fallback, true);
  const before = global.localStorage.dump();
  S.addPattern(pattern(2));
  const warnings = [], off = S.on('persistence:error', error => warnings.push(error));
  const oldWarn = console.warn; console.warn = () => {};
  try {
    global.localStorage.failOnce('nc11:nodes');
    assert.equal(await S.savePersistent(), false);
    assert.deepEqual(global.localStorage.dump(), before, 'una escritura parcial se revierte si hay espacio para restaurar');
    assert.equal((await global.NCDB.get('patterns')).length, 1, 'una lectura posterior consulta la copia durable');
    global.localStorage.failOnce('nc11:nodes');
    const backup = await S.exportBrain();
    assert.equal(backup.data.patterns.length, 2);
    assert.equal(backup.data.nodes.length, 2);
    assert.deepEqual(global.localStorage.dump(), before);
    assert.ok(warnings.length >= 2);
    assert.equal(await S.flush(), true);
    assert.equal(JSON.parse(global.localStorage.getItem('nc11:patterns')).length, 2);
  } finally {
    console.warn = oldWarn; off();
    await S.resetAll({ keepSettings: false });
  }
});
