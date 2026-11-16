const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');

function storage() {
  const map = new Map();
  return new Proxy({
    getItem: k => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear()
  }, { ownKeys: () => [...map.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
}
async function createLegacy(indexedDB) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('NeuralSpiderDB', 2);
    request.onupgradeneeded = () => {
      const table = request.result.createObjectStore('patterns', { keyPath: 'hash' });
      table.put({ hash: 'old', text: 'Patrón anterior', label: 'anterior', cluster: 'AGT-01' });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
}

test('migración v2, persistencia, feedback, respaldo e importación validada', async () => {
  global.indexedDB = new IDBFactory();
  global.localStorage = storage();
  global.localStorage.setItem('neural_spider_os_v2', JSON.stringify({ consolidatedMemory: [{ fact: 'El dato recordado es local.' }] }));
  await createLegacy(global.indexedDB);
  require('../js/util'); require('../js/retrieval'); require('../js/analysis');
  require('../js/srs'); require('../js/embeddings');
  const DB = require('../js/db');
  const S = require('../js/store');
  const M = require('../js/memory');
  require('../js/providers'); const Rag = require('../js/rag'); Rag.init();
  const Parsers = require('../js/parsers');
  await S.init();
  assert.equal(DB.status().available, true);
  assert.equal(S.state.patterns[0].hash, 'old');
  assert.equal(S.state.consolidatedMemory[0].fact, 'El dato recordado es local.');
  const pages = Parsers.paginate('La sinapsis permite transmitir señales entre neuronas mediante neurotransmisores. Las dendritas reciben señales de otras neuronas.', 'doc1', 'biologia.txt');
  S.addDocument({ id: 'doc1', name: 'biologia.txt', pages });
  const result = await Rag.ask('¿Qué es la sinapsis?');
  assert.ok(result.sources.length);
  assert.ok(result.text.includes('[1]'));
  assert.equal(result.citations.allValid, true);
  const node = S.addPattern({ cluster: 'AGT-01', label: 'Sinapsis', text: pages[0].sentences[0].text, pageNum: 1, sentenceId: pages[0].sentences[0].id });
  const vault = M.vaultAdd({ phrase: 'Sinapsis', detail: 'Comunicación neuronal', docName: 'biologia.txt', sentenceId: pages[0].sentences[0].id, pageNum: 1 });
  M.recordFeedback({ question: 'sinapsis', answer: result.text, rating: 1, nodeIds: [node.id], vaultIds: [vault.id], sentenceIds: [pages[0].sentences[0].id] });
  assert.ok(node.weight > 1);
  assert.ok(vault.reinforcement > 1);
  S.state.cards.push(global.NCSRS.newCard({ id: 'card', front: 'sinapsis', back: 'comunicación' }));
  S.state.quizRuns.push({ correct: 1, total: 1, accuracy: 1 });
  S.setSetting('topK', 4);
  await S.savePersistent();
  const backup = await S.exportBrain();
  assert.equal(backup.data.docs.length, 1);
  assert.equal(backup.data.cards.length, 1);
  assert.equal(backup.data.feedback.length, 1);
  assert.ok(backup.data.chat.length >= 1);
  S.state.docs = []; S.state.cards = []; S.state.feedback = [];
  await S.init();
  assert.equal(S.state.docs.length, 1);
  assert.equal(S.state.cards.length, 1);
  assert.equal(S.state.feedback.length, 1);
  assert.equal(S.getSetting('topK'), 4);
  assert.ok(S.state.index.vectors.size);
  await assert.rejects(() => S.importBrain({ data: { docs: 'malformado' } }), /inválido/);
  assert.equal(S.state.docs.length, 1, 'una importación inválida no debe borrar el estado');
  // Un fallo de clonación durante la escritura debe revertir el clear de la misma transacción.
  await assert.rejects(() => DB.importAll({ data: { docs: [{ bad: () => {} }] } }));
  const actualDocs = await new Promise((resolve, reject) => {
    const request = global.indexedDB.open('NeuralSpiderDB', 3);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('kv', 'readonly').objectStore('kv').get('docs');
      get.onsuccess = () => { resolve(get.result.v); db.close(); };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  });
  assert.equal(actualDocs.length, 1, 'importación fallida debe preservar IndexedDB');
  await S.resetAll();
  assert.equal((await DB.get('docs')), null);
  assert.equal(global.localStorage.getItem('neural_spider_os_v2'), null);
  await S.importBrain(backup);
  assert.equal(S.state.docs.length, 1);
  assert.equal(S.state.cards.length, 1);
  assert.equal(S.state.feedback.length, 1);
  await S.resetAll({ keepSettings: false });
});

test('el feedback modifica el orden de pasajes de la misma consulta', async () => {
  const S = global.NeuralStore, M = global.NCMemory;
  // Páginas distintas: dos ventanas de la misma página con dos oraciones
  // serían idénticas y se deduplican antes de valorar las fuentes.
  const pages = [{ pageNum: 1, text: '', sentences: [
    { id: 'first', text: 'La sinapsis neuronal transmite señales eléctricas entre células especializadas.' }
  ] }, { pageNum: 2, text: '', sentences: [
    { id: 'second', text: 'La sinapsis neuronal comunica señales químicas entre células del cerebro.' }
  ] }];
  S.addDocument({ id: 'd', name: 'd.txt', pages });
  const first = S.search('sinapsis neuronal señales', { k: 2, diversify: false, expand: false }).hits;
  assert.equal(first.length, 2);
  M.recordFeedback({ question: 'sinapsis neuronal señales', answer: 'valoración', rating: -1, sentenceIds: [first[0].sentence.id] });
  const reordered = S.search('sinapsis neuronal señales', { k: 2, diversify: false, expand: false }).hits;
  assert.notEqual(reordered[0].sentence.id, first[0].sentence.id);
  await S.resetAll({ keepSettings: false });
});
