const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const E = require('../js/education-knowledge.js');
const K = require('../js/knowledge-base.js');
const R = require('../js/retrieval.js');

test('las fichas educativas contienen síntesis y fuentes concretas, no solo enlaces', () => {
  const items = E.list();
  assert.equal(items.length, 50);
  assert.equal(E.info().count, items.length);
  assert.equal(K.info().educationCount, items.length);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  assert.equal(items.filter(item => item.collection.startsWith('Aprende.org')).length, 32);
  assert.equal(items.filter(item => item.collection === 'PruébaT').length, 17);
  assert.equal(items.filter(item => item.collection === 'Fundación Carlos Slim · artículos').length, 1);
  assert.equal(new Set(items.map(item => item.sourceUrl)).size, 29);
  const hosts = ['aprende.org', 'capacitateparaelempleo.org', 'pruebat.org', 'cdn.pruebat.org', 'pruebatcdn.aprende.org', 'fundacioncarlosslim.org'];
  for (const item of items) {
    assert.match(item.id, /^kb:educacion-/);
    assert.ok(Object.isFrozen(item));
    assert.ok(item.summary.length > 80 && item.title && item.keywords);
    assert.equal(item.reviewed, '2026-11-16');
    assert.equal(item.legal, false, 'una capacitación no es una norma colombiana');
    assert.equal(item.safety, item.category === 'Seguridad y salud en el trabajo');
    const url = new URL(item.sourceUrl);
    assert.equal(url.protocol, 'https:');
    assert.ok(hosts.includes(url.hostname));
    assert.ok(item.sourceName.includes(item.collection));
    assert.ok(item.sourceName.endsWith(`· ${item.sourceKind}`), 'la cita identifica el tipo de material realmente revisado');
    assert.ok(['actividad', 'infografía', 'presentación', 'material didáctico', 'interactivo', 'ayuda de estudio', 'ejercicio', 'artículo'].includes(item.sourceKind));
    const canonical = K.get(item.id);
    assert.equal(canonical.sourceUrl, item.sourceUrl);
    assert.equal(canonical.sourceText, `${item.title}. ${item.summary}`);
    assert.equal(canonical.collection, item.collection);
    assert.equal(canonical.origin, 'knowledge');
  }
  const code = items.find(item => item.id === 'kb:educacion-arreglo-paridad').summary.match(/`([^`]+)`/)[1];
  assert.deepEqual(Array.from(vm.runInNewContext(code, {}, { timeout: 50 })), [2, 4], 'el ejemplo propio produce el resultado indicado');
});

test('el índice recupera contenido educativo para preguntas reales, no solo metadatos', () => {
  const cases = [
    ['¿Qué es un algoritmo?', 'algoritmo'],
    ['¿Qué es programación?', 'programar-codificar'],
    ['Aprende programación', 'cap-programacion'],
    ['Código fuente', 'programar-codificar'],
    ['Desarrollo web', 'frontend'],
    ['Programación web', 'frontend'],
    ['Cómo programar variables en C', 'variable'],
    ['¿Qué dice Aprende.org sobre las variables?', 'variable'],
    ['Tipos de datos', 'tipos'],
    ['Alcance de una variable', 'alcance'],
    ['Capacítate para el Empleo operadores relacionales', 'relacionales'],
    ['¿Cómo funcionan los punteros en C?', 'puntero-c'],
    ['Cómo se realiza una prueba de escritorio', 'prueba-escritorio'],
    ['Arreglos y pares', 'arreglo-paridad'],
    ['Cómo funciona el front-end', 'frontend'],
    ['Qué hace el back-end', 'backend'],
    ['PruébaT qué es pseudocódigo', 'pseudocodigo'],
    ['Aprende.org pseudocódigo', 'cap-pseudocodigo'],
    ['Cómo hacer un diagrama de flujo', 'diagrama-flujo'],
    ['Cómo funciona un condicional', 'condicional'],
    ['¿Qué diferencia hay entre for y while?', 'bucle-comparar'],
    ['PruébaT bucle while', 'bucle-mientras'],
    ['¿Qué es hacer mientras?', 'bucle-hacer'],
    ['Diferencia entre datos cualitativos y cuantitativos', 'datos-cualitativos'],
    ['Qué es una encuesta', 'encuesta'],
    ['Qué es un CSV', 'csv'],
    ['Qué es IA', 'ia-general'],
    ['Qué es IA generativa', 'ia-generativa'],
    ['Aprende IA generativa', 'ia-generativa'],
    ['Qué es machine learning', 'machine-learning'],
    ['Aprende.org machine learning', 'proceso-ml'],
    ['Cómo proteger datos sensibles al usar IA', 'ia-datos-sensibles'],
    ['Cómo se crea un informe de riesgos informáticos', 'riesgo-informatico'],
    ['Cómo seleccionar equipo de protección personal', 'epp'],
    ['Cómo inspeccionar EPP', 'epp-cuidado'],
    ['Aprende.org SST alturas', 'alturas'],
    ['Qué es ergonomía en el trabajo', 'ergonomia'],
    ['Qué es un mapa de riesgos', 'mapa-riesgos'],
    ['Qué son organismos unicelulares', 'celulas'],
    ['Qué es el citoplasma', 'citoplasma'],
    ['PruébaT fuerza masa aceleración', 'fuerza-aceleracion'],
    ['Qué es una mezcla homogénea', 'mezclas'],
    ['Qué es la concentración de una disolución', 'concentracion'],
    ['Propiedades de una ecuación', 'ecuacion']
  ];
  for (const [question, suffix] of cases) {
    const result = K.search(question), id = `kb:educacion-${suffix}`;
    assert.equal(result.hits[0]?.sentence.id, id, question);
    const chunks = R.buildContext(result.contextIndex, result.hits, { window: 0, maxChunks: 6, filters: result.parsed.filters });
    assert.equal(chunks[0]?.text, K.get(id).sourceText, `${question}: la evidencia es la síntesis, sin palabras clave añadidas`);
    assert.ok(chunks[0].text.length > 80);
  }
  assert.equal(K.search('programación en PHP').hits[0]?.sentence.id, 'kb:php-basico', 'un término genérico no oculta las fichas previas');
});

test('la procedencia explícita y los filtros no convierten otras fichas en material de la fundación', () => {
  const aprende = K.search('Aprende.org variables').hits;
  assert.ok(aprende.length);
  assert.ok(aprende.every(hit => K.get(hit.sentence.id).collection === 'Aprende.org / Capacítate para el Empleo'));
  const pruebat = K.search('PruébaT pseudocódigo').hits;
  assert.ok(pruebat.length);
  assert.ok(pruebat.every(hit => K.get(hit.sentence.id).collection === 'PruébaT'));
  const all = K.search('Fundación Carlos Slim variables').hits;
  assert.ok(all.length);
  assert.ok(all.every(hit => K.get(hit.sentence.id).collection));
  assert.equal(K.search('Aprende.org recargo nocturno').hits.length, 0, 'no atribuir una norma al curso');
  assert.equal(K.search('PruébaT ergonomía').hits.length, 0, 'no atribuir la otra plataforma');
  assert.ok(K.search('Aprende.org machine learning').hits.every(hit => K.get(hit.sentence.id).collection.startsWith('Aprende.org')));
  assert.ok(K.search('Fundación Carlos Slim machine learning').hits.some(hit => K.get(hit.sentence.id).collection === 'Fundación Carlos Slim · artículos'));
  assert.equal(K.isBareAprendeQuery('Aprende SST alturas'), true);
  assert.equal(K.isBareAprendeQuery('Aprende IA generativa'), true);
  assert.equal(K.isBareAprendeQuery('Aprende cursos de programación'), true);
  assert.equal(K.isBareAprendeQuery('Aprende que me gusta programar'), false);
  assert.equal(K.isBareAprendeQuery('Aprende: mis notas de SST'), false);
  assert.equal(K.search('Aprende SST alturas').hits[0]?.sentence.id, 'kb:educacion-alturas');
  assert.equal(K.search('PruébaT pseudocódigo =doc:privado').hits.length, 0);
  assert.equal(K.search('PruébaT pseudocódigo =pag:2').hits.length, 0);
  assert.equal(K.search('PruébaT pseudocódigo "frase inexistente"').hits.length, 0);
  const excluded = K.search('variables -cadena');
  assert.ok(excluded.hits.length);
  assert.ok(excluded.hits.every(hit => !K.get(hit.sentence.id).sourceText.toLowerCase().includes('cadena')));
  for (const question of ['xyzzyplugh', 'seguridad social desconocida', 'Aprende.org medicina cuántica intergaláctica']) {
    assert.equal(K.search(question).hits.length, 0, question);
  }
});
