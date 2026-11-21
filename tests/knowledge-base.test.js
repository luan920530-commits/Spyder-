const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../js/knowledge-base.js');
const R = require('../js/retrieval.js');

test('la base tiene identificadores únicos, categorías, referencias HTTPS y fecha de revisión', () => {
  const entries = K.list(), info = K.info();
  assert.equal(info.count, entries.length);
  assert.ok(entries.length >= 40);
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  assert.ok(info.categories.some(category => category.includes('laboral')));
  assert.ok(info.categories.some(category => category.includes('salud')));
  for (const category of ['Biología', 'Ciencias', 'Química', 'Matemáticas', 'Desarrollo web']) assert.ok(info.categories.includes(category));
  for (const entry of entries) {
    assert.equal(K.get(entry.id), entry);
    assert.equal(entry.origin, 'knowledge');
    assert.match(entry.reviewed, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new URL(entry.sourceUrl).protocol, 'https:');
    assert.ok(entry.sourceName && entry.title && entry.sourceText);
    if (entry.legal) assert.ok(['www.funcionpublica.gov.co', 'normograma.mintic.gov.co'].includes(new URL(entry.sourceUrl).hostname));
  }
});

test('recupera de forma local las áreas solicitadas, acrónimos y números', () => {
  const cases = [
    ['qué es el SG-SST', 'kb:sst-sistema'],
    ['qué es SST', 'kb:sst-basica'],
    ['jornada laboral 42 horas Colombia', 'kb:jornada-42'],
    ['¿Cuántas horas se trabaja a la semana en Colombia?', 'kb:jornada-42'],
    ['horas nocturnas Colombia', 'kb:nocturno'],
    ['¿Cuál es el porcentaje del recargo nocturno en Colombia?', 'kb:recargo-nocturno'],
    ['¿Qué es el riesgo laboral?', 'kb:sst-riesgo'],
    ['comité de convivencia laboral', 'kb:convivencia'],
    ['qué es biología', 'kb:bio-general'],
    ['qué es el ADN', 'kb:bio-adn'],
    ['¿Qué es la fotosíntesis?', 'kb:bio-fotosintesis'],
    ['segunda ley de Newton', 'kb:ciencia-newton'],
    ['porcentaje y proporción', 'kb:matematica-porcentaje'],
    ['qué es química', 'kb:quimica-general'],
    ['cómo preparar una consulta PHP PDO', 'kb:php-pdo'],
    ['JS promesas', 'kb:js-promesa'],
    ['modelo de caja CSS', 'kb:css-caja']
  ];
  for (const [query, expected] of cases) {
    const result = K.search(query);
    assert.equal(result.hits[0]?.sentence.id, expected, query);
    const chunks = R.buildContext(result.contextIndex, result.hits, { window: 0, maxChunks: 6, filters: result.parsed.filters });
    assert.ok(chunks.some(chunk => chunk.id === expected), `${query}: contexto`);
    assert.equal(chunks[0].text, K.get(expected).sourceText, `${query}: sin palabras clave añadidas a la evidencia`);
  }
});

test('no inventa coincidencias por palabras genéricas, números no cubiertos o filtros', () => {
  for (const query of ['clima de hoy', 'qué es la seguridad social', 'red neuronal', 'trabajo nuclear marciano', 'jornada laboral 2047', 'xyzzyplugh']) {
    assert.equal(K.search(query).hits.length, 0, query);
  }
  assert.equal(K.search('ADN =pag:3').hits.length, 0);
  assert.equal(K.search('ADN =doc:privado').hits.length, 0);
  assert.ok(K.search('ADN =doc:"Base local"').hits.length > 0);
  assert.equal(K.search('ADN "frase no presente"').hits.length, 0);
  assert.ok(K.search('ADN "información genética"').hits.length > 0);
  assert.equal(K.search('ADN -genética').hits.length, 0);
  assert.equal(K.search('ADN', { k: 0 }).hits.length, 0);
});
