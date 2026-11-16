# AUDITORÍA Y PLAN DE TRABAJO — NEURAL COMMAND // AI SPIDER OS

**Repositorio:** `luan920530-commits/Spyder-`
**Rama auditada:** `arena/7f0fa194-spyder` @ `350cddb`
**Fecha:** 2026-11-16
**Objetivo del documento:** verificar el estado real del código y proponer un plan ejecutable para **darle más peso al modelo** (que el cerebro KIMI-CORE recupere, razone y genere mucho mejor) y **más opciones** (más backends de modelo, modos, herramientas y formatos).

---

## 0. Resumen ejecutivo

El proyecto es una aplicación web **estática, sin build, sin dependencias instaladas** (~3.260 líneas propias, 13 archivos) con una interfaz HUD muy cuidada y una idea de producto potente: un "sistema operativo de estudio" offline-first donde un enjambre de agentes cosecha conocimiento de documentos y lo teje en un grafo, con un chat RAG local.

**Veredicto:** la *interfaz* y el *concepto* están a nivel de producto; el **motor cognitivo está en estado de prototipo**. Hoy el "modelo" es, en la práctica, un buscador BM25 que devuelve frases citadas del documento. No hay generación real, no hay representación semántica, no hay memoria que sobreviva a un F5, y las piezas que prometen "más peso" (embeddings ONNX, detector de contradicciones, similitud de coseno, memoria negativa) **están escritas pero desconectadas**: nunca se invocan.

**Los 5 hallazgos que más limitan al modelo:**

| # | Hallazgo | Evidencia |
|---|---|---|
| 1 | **La búsqueda es cuadrática.** El `df` de BM25 se recalcula con un `filter` sobre *todo* el corpus dentro del bucle de términos y de oraciones | `js/brain-rag.js:65`. Medido: 500 oraciones = 35 ms · 2.000 = 429 ms · 5.000 = **3,4 s** · 15.000 = **25–40 s** de bloqueo del hilo principal. Con índice invertido: **2,5 ms** (`tests/bench-bm25.js`) |
| 2 | **No hay semántica.** Tokenización literal, sin normalización de acentos, sin stemming, sin stopwords, sin embeddings. `"definicion"` no encuentra `"definición"` | `js/brain-rag.js:28`. Probado en vivo: `Q="definicion de sinapsis"` → `No encontré coincidencias` con el demo cargado |
| 3 | **La "generación" es ensalada de n-gramas.** El modelo auxiliar encadena la palabra más probable y produce frases sin sentido; el chat devuelve viñetas con oraciones copiadas | `js/kimi-aux-model.js:98` (`generateNaturalText`) |
| 4 | **La memoria no persiste.** Al recargar se pierden documentos, oraciones, nodos y enlaces; las citas de los nodos restaurados apuntan a oraciones que ya no existen | `js/store.js:40` guarda solo 4 claves. Verificado: `["consolidatedMemory","chatHistory","ollamaUrl","ollamaModel"]` y `chatHistory` **nunca se llena** |
| 5 | **XSS almacenado.** El texto del documento se inyecta con `innerHTML` en chat, ticker e inspector. Un PDF/DOCX malicioso ejecuta JS | `js/brain-rag.js:266`, `js/neural-graph.js:267`. Verificado con payload `<img src=x onerror=...>`: ejecutado en chat y en ticker |

**Sobre "más opciones":** hoy hay exactamente **un** backend real (BM25 interno) y un **puente Ollama decorativo** (sin streaming, sin CORS, y el flag `ollamaEnabled` no se persiste, así que se apaga en cada recarga — `js/store.js:22`). El botón ONNX carga el modelo… y guarda la tubería en una variable local que nadie usa (`js/brain-rag.js:383`).

**La buena noticia:** el 80 % del trabajo es *conectar y endurecer*, no reescribir. La arquitectura modular ya separa store / parsers / grafo / agentes / cerebro, y el monolito anterior (v10, en `main`) **tenía piezas que la modularización perdió**: `escapeHtml`, `normalizeStr`, `stemWord`, `STOPWORDS`, `extractKeywords`, la Bóveda de conocimiento, puntaje de quiz y cajas Leitner. Recuperarlas es la vía más rápida a "más peso".

**Plan propuesto:** 6 fases (~4–5 semanas de trabajo efectivo, ejecutables por partes), empezando por una fase 0 de blindaje de 1–2 días. Cada fase tiene criterios de aceptación medibles con un arnés de pruebas que se entrega en la fase 0.

---

## 1. Método de verificación (y sus límites)

**Qué hice:**

1. Lectura completa de los 13 archivos (3.260 líneas) y de su historia (`main` = monolito v10 de 3.019 líneas; `350cddb` = división en módulos).
2. `node --check` sobre todos los JS → **sintaxis válida en 8/8**.
3. **Arranque real de la app** en un DOM instrumentado (jsdom + servidor HTTP local), con canvas y `scrollIntoView` simulados, cargando los módulos tal cual: `NeuralStore`, `NeuralGraph`, `SpiderEngine`, `DocParsers`, `BrainRAG`, `StudyBots`, `KimiAuxModel` → **todos inicializan, 0 errores de ejecución**.
4. **Prueba funcional end-to-end:** pulsar *Demo* → 1 documento / 1 página / 8 oraciones → las arañas cosechan **8/8 oraciones, 8 nodos, 8 patrones en ~8 s** con 2 agentes. El ciclo físico funciona.
5. **Batería de consultas al cerebro** (resumen, conceptos, latencia, enseñanza, matemática, generación de artefactos, paráfrasis) y captura de respuestas reales.
6. **Benchmarks propios:** consulta BM25 dentro de la app a 500/2.000/5.000 oraciones; copia fiel de la función en Node a 200/1.000/3.000/8.000/15.000 oraciones; `addPatternNode` a 50/150/400 inserciones.
7. **Prueba de seguridad:** documento con payload XSS → confirmado en burbuja de chat y en el *Live Pattern Ticker*.
8. **Prueba de persistencia:** inspección de `localStorage` tras una sesión completa.
9. **Comparación de inventario** entre el monolito v10 y la versión modular (74 IDs de control vs 58) para detectar regresiones.
10. Auditoría de a11y/PWA: `aria-*` = 0, `alt=` = 0, 1 media query, 0 `prefers-reduced-motion`, `manifest.json` sin iconos.

**Límites (lo que NO pude verificar y por qué):**

- No pude abrir un navegador real con GPU (el sandbox no tiene Chromium): **FPS, costo real de los `box-shadow` neón, consumo del canvas de 220 partículas y del overlay de arañas quedan pendientes** de medir en tu equipo/móvil.
- Los CDN (`d3`, `pdf.js`, `mammoth`, `jszip`, `tesseract`, `sql.js`) están **bloqueados** en el sandbox: la app arrancó en modo degradado. Es decir, validé el **camino offline**, que es justo el que promete el README; el camino con CDN no se ejercitó.
- El puente Ollama no se pudo probar contra un servidor real (sin red local a `:11434`): revisé el código y su contrato HTTP.
- Calidad de OCR, instalación PWA y calidad de los parsers binarios quedan como verificación manual.

---

## 2. Radiografía del repositorio

| Archivo | Líneas | Rol | Estado |
|---|---:|---|---|
| `index.html` | 255 | Shell HUD, 3 columnas, CDNs, registro de SW | Correcto, sin CSP ni a11y |
| `css/hud.css` | 646 | Sistema visual completo, 12 tokens | Buen nivel, 1 sola media query |
| `js/store.js` | 189 | Bus de estado + localStorage + IndexedDB + POST a PHP | **Persistencia incompleta** |
| `js/parsers.js` | 339 | PDF/DOCX/PPTX/XLSX/TXT/imagen/video, paginación 1.600 chars | Funciona; fallback PDF inservible |
| `js/neural-graph.js` | 363 | D3 v7 + esfera 3D + ticker + inspector | Re-render completo por nodo |
| `js/spiders.js` | 483 | Enjambre 1–5, física canvas, micro-IA por agente | Funciona; scoring sin techo |
| `js/brain-rag.js` | 477 | BM25 + sinónimos + grafo + Ollama + chat + artefactos | **Núcleo del problema** |
| `js/kimi-aux-model.js` | 184 | Co-ocurrencia hebbiana + Markov + XP/niveles | Efectivo decorativo |
| `js/study-bots.js` | 241 | Guía, flashcards, quiz, gráficas, SQLite, ZIP | Funciona, versión mínima |
| `api/save_db.php` | 22 | Persistencia SQLite vía PHP | Sin auth; DB en la raíz pública |
| `sw.js` | 38 | Service Worker | **Roto en offline** |
| `manifest.json` | 9 | PWA | Sin iconos → no instalable |

**Dependencias:** 6 librerías por CDN sin empaquetar ni *vendorizar*, cargadas de forma bloqueante en `<head>`. El badge dice `OFFLINE-READY`: es cierto para el motor propio, **falso para el parseo de PDF/DOCX/OCR** en la primera visita y falso tras limpiar caché.

**Flujo de datos actual:**

```
archivo → parsers.js → paginateText(1.600 ch) → NeuralStore.allSentences
                                                    │
                        arañas (1 página activa) ────┤ cosechan 1 oración → nodo + patrón
                                                    │
chat → BM25(allSentences, topK=3) ──┐               │
       + activación 2 saltos ────────┼→ HTML de viñetas con citas
       + memoria consolidada ────────┘               │
                                                     └→ IndexedDB (patrones) + POST PHP
```

Nada conecta las arañas con la recuperación (solo el resaltado visual), y la "red neuronal" no aporta señal al ranking salvo para resaltar nodos.

---

## 3. Promesa del README vs. realidad

| El README dice | Realidad verificada | Severidad |
|---|---|---|
| "Motor RAG **local**" | Es un BM25 con sintaxis literal; sin normalización ni semántica | Alta |
| "Recuperación **híbrida** BM25 + expansión de grafo + **TextRank**" | No hay TextRank implementado (solo se menciona en un `trace`); la expansión de grafo no reordena, solo ilumina | Alta |
| "Generador de artefactos HTML/PHP desde la red" | Genera plantillas con `<li>` de los nodos; **sí funciona**, pero sin escape | Media |
| "Puente opcional a Ollama" | Funciona si Ollama permite CORS; **el flag no persiste**, sin streaming, sin timeout, sin selección de modelo en UI | Alta |
| "Modelo neuronal ligero ONNX (`btn-onnx-cfg`)" | `onnxPipe` es una variable local de `init()` que **nunca se usa** en `processQuery` | Alta |
| "`cosineSim` + reranking ONNX" (mensaje del commit) | `cosineSim` (`:6`) se define y **nunca se llama**; no existe reranker | Alta |
| "Detector de contradicciones multi-documento" (mensaje del commit) | `detectContradictions` (`:16`) **nunca se invoca** y solo devuelve un texto contando documentos con números | Alta |
| "Persistencia permanente (localStorage + IndexedDB)" | Solo sobreviven 4 claves; documentos/oraciones/grafo se pierden; las citas restauradas quedan huérfanas | **Crítica** |
| "Micro-IA con aprendizaje en línea" | Aprende pesos, pero se guardan **las 150 últimas** claves, no las más fuertes (`kimi-aux-model.js:34`), y `markov` no se persiste nunca | Media |
| "Memoria negativa (👎)" | Se registra y **nunca se consulta**; `styleConnectors` y `episodes` tampoco se usan en la generación | Media |
| "100 % offline-first" | SW devuelve `undefined` si falla la red con un recurso no cacheado (`sw.js:35`) → error de red; `kimi-aux-model.js` y `manifest.json` no están precacheados | Alta |

---

## 4. Hallazgos priorizados

### 4.1 Rendimiento y escalabilidad (lo que impide "más peso")

El corpus es el músculo del modelo; hoy el motor se ahoga en cuanto crece.

**Medición de la consulta actual** (misma función, mismo query):

| Oraciones | Dentro de la app (jsdom) | Copia fiel en Node |
|---:|---:|---:|
| 200 | — | 14 ms |
| 500 | 35 ms | — |
| 1.000 | — | 214 ms |
| 2.000 | 429 ms | — |
| 3.000 | — | 1.509 ms |
| 5.000 | 3.382 ms | — |
| 8.000 | — | 11.052 ms |
| 15.000 | — | **25.316–40.455 ms** (dos corridas) |

Con el índice invertido propuesto (`node tests/bench-bm25.js`), **la misma consulta a 15.000 oraciones pasa a 2,5 ms: 10.180× más rápido**; a 8.000 oraciones, 7,5 s → 1,2 ms. El benchmark queda en el repo para que la mejora sea verificable y no una promesa.

Un TFG de 300 páginas ronda las 6.000–9.000 oraciones → **del orden de 5–12 s de congelación del navegador por pregunta**, y eso sin contar el re-render del grafo. La causa es `js/brain-rag.js:65`: `df` se recalcula recorriendo todo el corpus dentro del bucle de términos, dentro del bucle de oraciones → O(N²·Q).

**Solución:** índice invertido construido una sola vez (token → postings), `df`, longitud media y `avgLen` precalculados. Coste por consulta = suma de postings del query (típicamente < 1 % del corpus). Ver `SPD-06` en el backlog: **objetivo < 50 ms a 20.000 oraciones** (~100× más rápido).

**Otros puntos calientes:**

- `js/neural-graph.js:256`: cada nodo nuevo recrea toda la selección D3 **y una simulación de fuerzas nueva** (`forceSimulation` en `:201`). Medido: 150 `addPatternNode` = 111 ms; con 400 nodos el coste crece linealmente con N y destruye posiciones/estabilidad visual. Solución: `join` incremental + simulación única + `alphaTarget` al añadir.
- `js/neural-graph.js:232`: las sinapsis cruzadas se hacen `push` sin dedupe → enlaces duplicados indefinidos (medido: duplicados desde la primera fusión).
- `js/spiders.js:106`: el score de afinidad suma el peso aprendido de **cada** token presente; con vocabulario grande domina el ruido y las 5 "especialidades" convergen. Solución: normalizar (suma / √nº tokens) + techo por token.
- `js/spiders.js:115`: solo se cosecha la **página activa**; la "Auto-Pág" avanza cuando se agota. Un documento de 200 páginas tarda horas. Solución: cola de cosecha por prioridad global, con presupuesto por frame.

### 4.2 Seguridad

| Hallazgo | Ubicación | Impacto |
|---|---|---|
| **XSS almacenado** vía texto de documento | `brain-rag.js:266` (`div.innerHTML = html`), `neural-graph.js:267` (ticker), `openInspector` (`textContent`, correcto), artefactos (`code` sin escapar en PHP/HTML) | Ejecución de JS arbitrario desde un PDF/DOCX; robo de `localStorage` (memoria consolidada) y del contenido de los documentos |
| `innerHTML` con la pregunta del usuario | `brain-rag.js:265` (`appendMessage('user', q)`) | Auto-XSS y persistencia si algún día se guarda el historial |
| `new Function()` para evaluar matemáticas | `brain-rag.js:83` | Superficie de ejecución; hoy acotada por regex, pero es un patrón a eliminar |
| `api/save_db.php` sin autenticación y **DB en la raíz pública** | `api/…`, `store.js:165` | Cualquiera puede leer/escribir patrones; `neural_spider.sqlite` es descargable por HTTP |
| Service Worker con *cache-first* perpetuo y sin estrategia de actualización | `sw.js` | Código viejo servido indefinidamente; offline roto |
| Sin CSP ni `referrerpolicy` | `index.html` | Mitigación de XSS inexistente |

### 4.3 Persistencia y memoria

- `savePersistent()` guarda **solo** `consolidatedMemory`, `chatHistory`, `ollamaUrl`, `ollamaModel` (`store.js:40`). Documentos, páginas, oraciones, nodos, enlaces, `patterns`, `visitedPatternHashes` y `ollamaEnabled` **se pierden**.
- `chatHistory` **nunca recibe nada**: no hay un solo `push` en todo el código → se guarda un array vacío.
- Al recargar, `db:restored` re-inyecta patrones como nodos, pero sus `sentenceIds` apuntan a oraciones inexistentes: **las citas quedan muertas** (clic → nada).
- `resetAll()` (`store.js:109`) no borra `consolidatedMemory`, ni la Bóveda, ni IndexedDB, ni los `localStorage` de los modelos auxiliares; y las arañas conservan `targetSentence` obsoletos.
- `kimi-aux-model.js:34`: `slice(-150)` conserva las **últimas** 150 palabras insertadas (orden de inserción de JS), no las 150 con mayor peso. `markov` y `negativeEpisodes` no se serializan.

**Consecuencia para el producto:** hoy el sistema *no aprende entre sesiones*. Es la diferencia entre "una demo bonita" y "un segundo cerebro".

### 4.4 Calidad de recuperación (el corazón de "más peso")

1. **Sin normalización**: `tokenize` hace `toLowerCase` + regex, pero no elimina diacríticos. `"definición"` ≠ `"definicion"`, `"redes"` ≠ `"red"`, `"épocas"` ≠ `"epocas"`. En la prueba real, `definicion de sinapsis` devolvió **0 coincidencias** sobre el documento demo que sí habla de sinapsis.
2. **Sin stemming ni stopwords**: los términos funcionales inflan el ranking y las variantes morfológicas no se agrupan (el v10 ya tenía un stemmer español y un `STOPWORDS` de ~60 entradas: `normalizeStr` / `stemWord` / `extractKeywords`).
3. **Sin contexto**: se recuperan oraciones sueltas (`topK=3`), sin vecinos, sin encabezados, sin solapamiento → respuestas truncadas y citas sin marco.
4. **`df` por subcadena** (`includes`) en vez de por token: infla la frecuencia documental y aplana el IDF.
5. **Sin fusión ni diversidad**: no hay re-ranking, ni MMR, ni dedupe de casi-duplicados (las arañas generan muchos).
6. **Sin filtros**: no se puede preguntar "solo en el PDF de Raft", "solo página 12", ni excluir términos; no hay resolución de seguimientos ("¿y su latencia?" depende del turno anterior, que ni se guarda).
7. **La expansión de sinónimos es un diccionario de 6 palabras** (`brain-rag.js:35`) y está cableada al dominio de la demo.

**Respuesta típica hoy** (`Q="¿Qué es una red neuronal?"`):

> • Una red neuronal artificial es un modelo computacional inspirado en las conexiones sinápticas del cerebro bi… [Pág 1]

Es una **cita**, no una respuesta. Para dar "peso" hace falta: contexto ensamblado → síntesis extractiva (TextRank sobre los chunks) → si hay backend generativo, respuesta redactada con citas verificadas.

### 4.5 Generación

- `generateNaturalText` (`kimi-aux-model.js:98`) elige la transición Markov más probable: produce frases gramaticales por accidente y sin contenido. Presentarlo como "síntesis" resta credibilidad.
- No hay streaming, ni cancelación, ni *timeouts*, ni control de longitud, ni `system prompt` por modo.
- Los **modos** no existen: el chat es una sola caja. Faltan modos que sí aportan valor académico (socrático, examen, resumen ejecutivo, crítica metodológica, traducción, rúbrica).
- El **modo Redacción** rellena 5 párrafos con la primera frase del nodo de cada clúster: es plantilla, no redacción colaborativa.
- `Ollama` usa `/api/generate` sin `stream`, con prompt plano, sin presupuesto de tokens ni verificación de citas.

### 4.6 "Features fantasma" (código muerto que promete capacidad)

| Símbolo | Ubicación | Estado |
|---|---|---|
| `cosineSim` | `brain-rag.js:6` | Definido, **0 llamadas** |
| `detectContradictions` | `brain-rag.js:16` | Definido, **0 llamadas**, y no detecta nada |
| `onnxPipe` | `brain-rag.js:383` | Se asigna en `init`, ámbito local, **inaccesible** para el retrieval |
| `negativeEpisodes` | `kimi-aux-model.js:11` | Se escribe con 👎, **nunca se lee** |
| `styleConnectors` | `kimi-aux-model.js:13` | Definido, **nunca usado** |
| `episodes` | `kimi-aux-model.js:12` | Lo llena el ciclo de sueño, **nadie lo consume** |
| `chatHistory` | `store.js:19` | Se serializa, **nunca se llena** |

Esto importa estratégicamente: **son los cimientos ya escritos** del futuro motor (reranking vectorial, memoria negativa, consolidación). No hay que inventarlos, hay que conectarlos.

### 4.7 Regresiones de la modularización (v10 → módulos)

El paso de 1 archivo a 7 módulos fue correcto, pero **perdió capacidades**. Comparando el inventario de controles (74 → 58) y las funciones:

**Perdido de verdad (no renombrado):**

| Capacidad v10 | Qué aportaba | Dónde reincorporarla |
|---|---|---|
| `escapeHtml` + `renderMarkdownSafe` | Seguridad y render de markdown | `js/util.js` (nuevo) |
| `normalizeStr`, `stemWord`, `STOPWORDS`, `extractKeywords` | Recuperación insensible a acentos y morfología | `js/retrieval.js` (nuevo) — **la mejora más rentable del proyecto** |
| **Bóveda de conocimiento** (`loadVault/saveVault/consolidateIntoVault`, búsqueda, filtro por categoría, contador) | Memoria semántica persistente con dedupe por solapamiento de *stems* y `reinforcement` | `js/memory.js` (nuevo) + pestaña |
| **Puntaje de quiz** (`quizScoreSpan`, `examScore`) | Evaluación real del estudiante | `study-bots.js` |
| **Cajas Leitner** en flashcards (`box`, `btnFcKnow`, `btnFcAgain`) | Repetición espaciada | `study-bots.js` |
| Progreso y **tasa de cosecha** (`pageHarvestProgress`, `liveHarvestRate`, `hudNodesFedBadge`) | Feedback del motor | telemetría HUD |
| `docSelect`, `pageJumpSelect` | Navegación multi-documento y salto de página | `parsers.js` |
| `nodeHoverTooltip`, `inspSynapses`, `btnInspAskKimi`, `btnCenterNet` | Exploración del grafo y "preguntar por este nodo" | `neural-graph.js` |
| `showHudToast`, `parserMethodBadge`, `btnHarvestBurst`, `btnResetHarvest` | Feedback y control de la cosecha | varios |

**Nota importante:** el README actual describe un producto más ambicioso que el código modular. Conviene decidir si la v11 es "recuperar v10 + motor nuevo" — mi recomendación es **sí**, porque la Bóveda y el stemmer son exactamente lo que hace falta para el RAG.

### 4.8 Ingeniería y operación

- **Cero tests**, cero `package.json`, cero `.gitignore`, cero `LICENSE`, cero CI. Sin red de seguridad, cada mejora del modelo es una apuesta.
- Sin build ni *vendorizado*: 6 CDN en `<head>` bloqueantes; sin versiones fijadas más allá del propio CDN; sin `integrity`.
- Sin documentación de arquitectura ni de contrato entre módulos (todo se acopla por `window.*` y por eventos de `NeuralStore`).
- `main` y la rama de trabajo divergen por completo (monolito vs módulos): no hay estrategia de versiones ni changelog.

### 4.9 Accesibilidad, PWA y UX

- `manifest.json` **sin `icons`** → Chrome no ofrece instalar; `short_name` ok, sin `scope`, sin `id`, sin `display_override`.
- `sw.js` no precachea `kimi-aux-model.js` ni `manifest.json`; el `.catch(() => cached)` produce `respondWith(undefined)`.
- 0 atributos `aria-*`, 0 `alt`, un solo breakpoint (`max-width: 900px`), ningún `prefers-reduced-motion` pese a tener 220 partículas + 8 patas × 5 arañas + re-render D3.
- Botones sólo-icono sin `title`/`aria-label` en el panel del cerebro (`🧬`, `🦙`).
- El HUD es denso en móvil: 3 paneles + ticker + canvas; conviene una vista por pestañas en < 640 px.

---

## 5. Plan de trabajo

### 5.0 Estrategia

Tres principios:

1. **Medir antes de mejorar.** Fase 0 entrega un arnés reproducible (hoy no existe) → cada fase se acepta o se rechaza con números.
2. **Conectar antes de inventar.** El proyecto ya tiene los cimientos (grafo, agentes, memoria auxiliar, embeddings opcionales). Priorizamos cablearlos bien.
3. **Un backend, muchas opciones.** Interfaz única `ModelProvider` con capacidades declaradas (streaming, tamaño, idiomas, herramientas) y degradación elegante al motor extractivo. "Más opciones" = más *proveedores* intercambiables, no más ramas `if`.

### 5.1 Resumen de fases

| Fase | Objetivo | Entregables | Esfuerzo | Criterio de aceptación |
|---|---|---|---:|---|
| **F0. Blindaje** | Red de seguridad y deuda crítica | `package.json`, `tests/` (jsdom), CI, `.gitignore`, `LICENSE`, `escapeHtml`, arreglo de SW+manifest, CSP | 1–2 d | CI verde; 0 XSS en las 3 superficies; PWA instalable; offline sin errores |
| **F1. Retrieval v2** | Motor léxico serio y rápido | `js/retrieval.js` (índice invertido, normalización, stemmer ES, stopwords, chunking ±1, filtros, MMR) | 3–5 d | p95 < 50 ms a 20.000 oraciones; recall@5 ≥ 0,85 en el set dorado; `"definicion"` encuentra `"definición"` |
| **F2. Híbrido semántico** | Representación vectorial real | `js/embeddings.js` (ONNX multilingüe + caché IndexedDB) + fusión RRF + `cosineSim` conectado | 3–4 d | +15 pp recall@5 en paráfrasis; primera consulta < 3 s con caché caliente |
| **F3. Router de modelos** | Peso generativo y opciones | `js/providers/*`, streaming, cancelación, selector de modelo con requisitos, 5 modos de respuesta, citas verificadas | 5–7 d | 3 backends operativos (interno, Ollama, WebLLM); respuestas con citas clicables y verificadas |
| **F4. Memoria v3** | No perder nada; aprender de verdad | Esquema IndexedDB v3 + migración, Bóveda, consolidación por *stems*, feedback que reordena, import/export | 3–4 d | Recarga sin pérdida; export/import completo; 👍/👎 cambia el ranking |
| **F5. Evaluación y estudio** | Medir y enseñar | Set dorado, dashboard de métricas, quiz con puntaje y distractores reales, SRS Leitner, export Anki | 3–4 d | Benchmark reproducible en CI; progreso del estudiante persistente |
| **F6. Plataforma** (opcional) | Opciones de despliegue e ingesta | Proxy local (Node/FastAPI) + Docker, más parsers (EPUB/HTML/URL/audio), i18n ES/EN, API de plugins | 5–8 d | `docker compose up` funcional; 4 formatos nuevos |

**Ruta crítica:** F0 → F1 → F3 (F2 puede ir en paralelo a F3 si hay dos personas). F4 y F5 se pueden intercalar.

### 5.2 Fase 0 — Blindaje (1–2 días)

**Tareas**

| ID | Tarea | Archivos |
|---|---|---|
| SPD-01 | `package.json` + scripts (`test`, `bench`, `lint`, `serve`), `.gitignore`, `LICENSE` (MIT o la que elijas) | raíz |
| SPD-02 | Arnés de pruebas DOM con jsdom: arranque de la app, carga de demo, cosecha, consultas, aserciones de no-XSS, benchmark | `tests/` |
| SPD-03 | `js/util.js` con `escapeHtml`, `escapeAttr`, `safeMarkdown`, `normalizeStr`, `stemWord`, `STOPWORDS`, `tokenize` (portado de v10 y endurecido) | nuevo |
| SPD-04 | Aplicar escape en chat, ticker, inspector, guía, artefactos HTML/PHP y nombres de documento | `brain-rag.js`, `neural-graph.js`, `parsers.js`, `study-bots.js` |
| SPD-05 | Sustituir `new Function` por un evaluador aritmético propio (shunting-yard: `+ - * / % ^ ( )`, unario) | `brain-rag.js` |
| SPD-06 | SW v4: precache completo, estrategia *stale-while-revalidate*, fallback a `index.html`, sin `respondWith(undefined)` | `sw.js` |
| SPD-07 | PWA: iconos 192/512 + `maskable`, `scope`, `theme_color` en HTML, `apple-touch-icon` | `manifest.json`, `index.html` |
| SPD-08 | CSP meta (`default-src 'self'` + CDNs explícitos, `script-src` sin `unsafe-eval`) | `index.html` |
| SPD-09 | `api/save_db.php`: token compartido, validación de longitud/tipo, `.htaccess`/regla para no servir el `.sqlite`, CORS restringido | `api/` |
| SPD-10 | CI: `node --check`, tests jsdom, presupuesto de tamaño (< 120 KB de JS propio) | `.github/workflows/ci.yml` |

**Criterio de aceptación:** documento con `<img src=x onerror=alert(1)>` no ejecuta nada en chat, ticker ni artefacto; la app se instala como PWA; en modo avión no aparece ningún error de consola; CI verde.

### 5.3 Fase 1 — Retrieval v2 (3–5 días) · *la fase que da peso*

**Arquitectura propuesta** (`js/retrieval.js`):

```
Sentence[] ──► normalize + stem + stopwords ──► índice invertido (Map token → {docIdx: tf})
                                               ├── df, avgdl, N precalculados
                                               └── n-gramas (bigramas) para frases

query ──► parser de filtros (=doc:, =pág:, "frase", -excluir) ──► tokens normalizados
      ──► expansión (sinónimos + grafo 1 salto + variantes de stem)
      ──► BM25 sobre postings  ──► top-50
      ──► dedupe casi-duplicados (Jaccard de stems > 0,8)
      ──► MMR (λ=0,7) ──► top-k chunks (oración + vecino anterior/siguiente + sección)
```

**Puntos concretos**

1. **Índice invertido** (elimina el O(N²)): `df`, `postings`, `lens`, `avgdl` calculados al indexar; la consulta solo recorre postings.
2. **Normalización** NFD + eliminación de diacríticos, *lowercase*, stopwords ES/EN. **Crítico:** hoy `"definicion"` no encuentra nada.
3. **Stemmer español** portado y ampliado (v10 ya tenía una versión razonable): plurales, `-ción/-sión`, `-mente`, gerundios, participios. Aplicar al índice **y** al query.
4. **Bigramas**: indexar pares de stems para penalizar respuestas que solo comparten una palabra genérica y favorecer frases ("tolerancia a fallos", "función de pérdida").
5. **Chunking con contexto**: unidad de recuperación = oración + vecinos (±1) + encabezado detectado (línea corta sin punto final, numeración `1.2`), con presupuesto de caracteres.
6. **Filtros de consulta**: `=doc:raft`, `=pag:12`, `"texto exacto"`, `-excluir`. Se muestran como chips al usuario.
7. **MMR** para diversidad: evita tres oraciones casi iguales de la misma página.
8. **Caché**: índice en `IndexedDB` con *fingerprint* del documento (hash de contenido), invalidación por versión del esquema; tiempo de arranque en frío aceptable incluso con 10k oraciones.

**Métricas de aceptación**

| Métrica | Hoy | Objetivo |
|---|---|---|
| p95 de consulta a 20.000 oraciones | ~40 s (15k) | **< 50 ms** |
| recall@5 en set dorado (60 preguntas) | sin medir | **≥ 0,85** |
| Consultas con acentos/variantes morfológicas | fallan | **≥ 0,95 de acierto** |
| Consultas que devuelven 0 resultados con corpus relevante | sin medir (1 de 7 en la prueba: `definicion de sinapsis`) | **< 5 %** |

### 5.4 Fase 2 — Capa semántica híbrida (3–4 días)

**Modelos de embeddings (elegir por presupuesto):**

| Modelo | Tamaño | Idiomas | Uso recomendado |
|---|---:|---|---|
| `Xenova/all-MiniLM-L6-v2` | ~22 MB | inglés | rápido, pero malo en español académico |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | ~120 MB | 50+ | **recomendado** (ya hay un multilingüe empaquetado para transformers.js) |
| `Xenova/multilingual-e5-small` | ~120 MB | 100 | mejor recall con prefijos `query:`/`passage:` |
| `bge-m3` (cuantizado) | ~300 MB | 100 | máxima calidad, sólo escritorio |

**Plan:** `pipeline('feature-extraction', …)` en un *Web Worker*, lotes de 32, embeddings a `Float32Array` en IndexedDB, normalizados (L2) para que el coseno sea un producto punto. Fusión con BM25 por **RRF** (`1/(60+rango)`) y opción de re-ranking cruzado (top-20) si hay presupuesto de CPU. **Aquí se conecta el `cosineSim` que ya existe y el botón `🧬` deja de ser decorativo**: pasa a mostrar estado real (modelo, dimensiones, vectores indexados, ms/vector).

**Fallback garantizado:** si no hay WebGL/WASM/red, todo sigue funcionando en modo léxico (el botón se marca "no disponible" en vez de fallar a mitad).

### 5.5 Fase 3 — Router de modelos y modos (5–7 días) · *la fase que da opciones*

**Interfaz única** (`js/providers/index.js`):

```js
/**
 * @typedef {Object} ModelProvider
 * @property {string} id            'internal' | 'ollama' | 'webllm' | 'openai-compat' | 'transformersjs'
 * @property {string} label
 * @property {'local'|'lan'|'cloud'} privacy
 * @property {{minRAMmb:number, downloadMb:number, webgpu:boolean}} requirements
 * @property {boolean} streaming
 * @property {(msgs, opts) => Promise<{text:string, citations:number[], usage:any}>} complete
 * @property {(msgs, opts, onToken) => Promise<void>} stream
 * @property {() => Promise<'ok'|'offline'|'no-model'>} health
 */
```

**Catálogo propuesto (todas las opciones en un solo selector con requisitos visibles):**

| Backend | Modelos sugeridos | Requisitos | Privacidad | Estado |
|---|---|---|---|---|
| **KIMI-CORE interno** (extractivo + TextRank) | — | ninguno | local | existe (mejorar) |
| **Ollama** | `qwen2.5:3b`, `llama3.2:3b`, `phi3.5`, `gemma2:2b`, `mistral` | Ollama corriendo + `OLLAMA_ORIGINS` | LAN/local | **conectar bien** (streaming, health, persistencia, CORS) |
| **WebLLM / WebGPU** | `Qwen2.5-1.5B-Instruct-q4f16`, `Llama-3.2-1B/3B`, `Gemma-2-2B` | WebGPU + 1–2 GB de descarga | local | nuevo |
| **Transformers.js** | `SmolLM2-360M/1.7B`, `Qwen2.5-0.5B`, `LaMini-Flan-T5-248M` | WASM CPU, 300–900 MB | local | nuevo |
| **OpenAI-compatible** | LM Studio, llama.cpp server, vLLM, OpenRouter, OpenAI… | URL + clave del usuario | según | nuevo (decisión de privacidad) |
| **Embeddings** | ver 5.4 | 22–300 MB | local | Fase 2 |
| **Voz → texto** | Whisper tiny/base | 40–150 MB | local | opcional |

**Tareas clave**

1. `ModelRouter` con **cadena de degradación**: WebLLM → Ollama → interno extractivo, con mensaje claro al usuario de qué se usó y por qué.
2. **Streaming** real (`ReadableStream` en Ollama, *async iterator* en WebLLM), botón *Detener* (`AbortController`), *timeouts* y reintentos.
3. **Ensamblado de contexto con presupuesto**: tokens reservados para sistema + pregunta + citas; formato `[1] … [2] …`.
4. **Citas verificadas**: el modelo debe emitir `[n]`; post-proceso comprueba que `n` exista en el contexto y que la frase comparta ≥ 2 stems con la fuente; las citas no verificables se marcan en gris (transparencia, que es el diferencial académico).
5. **Modos** (un `system prompt` + política de citas + formato por modo):

| Modo | Comportamiento | Extra |
|---|---|---|
| **Socrático** | No da la respuesta: hace preguntas guiadas con pistas del documento | histórico del turno |
| **Examen** | Respuestas de examen (definición → mecanismo → evidencia → límite) con rúbrica | exportable `.md` |
| **Resumen ejecutivo** | 5 viñetas + 1 riesgo + 1 métrica, con página | TextRank |
| **Crítico** | Detecta afirmaciones sin respaldo, cifras inconsistentes y sesgos | usa el detector de contradicciones real |
| **Redacción** | Ensayo con estructura, conectores y bibliografía interna | tono configurable |
| **Traducción** | ES↔EN preservando citas | glosario del grafo |

6. **`Ollama` de verdad**: `ollamaEnabled` persistido, `keep_alive`, `/api/chat` (mejor que `generate`), listado de modelos instalados (`/api/tags`) en un desplegable, aviso accionable si CORS falla (`OLLAMA_ORIGINS=*`).
7. **Modo sin modelo**: plantilla de respuesta extractiva con estructura (tesis / evidencia / métrica / límite / fuente). Es lo que evita que el producto parezca roto cuando no hay LLM.

### 5.6 Fase 4 — Memoria v3 (3–4 días)

**Esquema IndexedDB `NeuralSpiderDB` v3** (con migración desde v2):

```
docs       {id, name, type, size, sha256, addedAt, pages[]}
sentences  {id, docId, pageNum, text, section, harvested}   // índices: docId, stem-key
nodes      {id, cluster, label, text, weight, pageNums[], sentenceIds[], firstSeen, lastRef}
links      {key, source, target, kind:'hierarchy'|'synaptic', strength}
patterns   {hash, cluster, label, text, pageNum, sentenceId, ts}   // ya existe
vault      {id, normKey, keywords[], sources[], reinforcement, cluster, updatedAt}
chat       {id, role, text, citations[], model, ts}
settings   {key, value}     // ollama*, provider, modos, preferencias de UI
meta       {schemaVersion, lastConsolidation, fingerprints[]}
```

- **Import/export** del cerebro completo (JSON + `.zip` con documentos).
- **Bóveda** (recuperada de v10): dedupe por solapamiento de stems, `reinforcement` y fuentes múltiples; búsqueda y filtro por clúster.
- **Consolidación** (ciclo de sueño real): fusiona nodos casi-duplicados, poda patrones con peso 1 y cero referencias, recalcula pesos por uso, registra `lastConsolidation`.
- **Feedback que cuenta**: 👍/👎 ajusta el peso del nodo y guarda un par (pregunta, respuesta, valoración) que actúa como *few-shot* en la siguiente consulta y penaliza patrones en la memoria negativa (ahora sí consultada).
- **Modelo auxiliar corregido**: guardar las 150 **más fuertes** (`sort` por peso), persistir `markov` (con presupuesto), usar `negativeEpisodes` y `styleConnectors` en la redacción, decaimiento exponencial para evitar que el vocabulario antiguo domine.

### 5.7 Fase 5 — Evaluación, estudio y métricas (3–4 días)

- **Set dorado** (`tests/golden/*.json`): 60–100 preguntas por corpus de prueba con respuestas esperadas (id de oración) y casos trampa (preguntas sin respuesta en el corpus → el sistema debe decir "no está").
- **Métricas**: recall@k, MRR@10, precisión de citas, tasa de "respondible", p50/p95 de latencia, % de tokens alucinados (cuando hay LLM), cobertura.
- **Dashboard** `🧪` en el HUD: estas métricas en vivo sobre tu corpus real, no solo en CI.
- **Quiz v2**: distractores generados del mismo clúster y del mismo documento, puntaje persistente, modo examen con temporizador, revisión con cita.
- **Flashcards SRS**: cajas Leitner (recuperadas de v10) + SM-2 simplificado, "due today", export **Anki** (`.apkg`/CSV).

### 5.8 Fase 6 — Plataforma (opcional, 5–8 días)

- **Proxy local** (Node o FastAPI, 150 líneas): resuelve CORS de Ollama, sirve escrituras SQLite con auth, cachea embeddings compartidos y permite `/health`. Docker + `compose` en un comando.
- **Ingesta ampliada**: `.epub`, HTML, URL con extracción de artículo, transcripciones (SRT/VTT ya hay base), audio con Whisper local, carpetas completas con *batching* y cola.
- **i18n** ES/EN (el `README` y la UI son solo ES; el modelo ya asume español).
- **API de plugins** para agentes (un agente = `{id, sistema, herramientas, cluster}`).

---

## 6. Victorias rápidas (primeras 48 h de código)

### SP-1 · Índice invertido (elimina el bloqueo de 40 s)

```js
// js/retrieval.js  (nuevo)
export function buildIndex(sentences) {
  const df = new Map(), postings = new Map(), lens = new Float64Array(sentences.length);
  sentences.forEach((s, i) => {
    const toks = tokenize(s.text);
    lens[i] = toks.length;
    const seen = new Set();
    for (const t of toks) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = new Map()));
      p.set(i, (p.get(i) || 0) + 1);
      if (!seen.has(t)) { seen.add(t); df.set(t, (df.get(t) || 0) + 1); }
    }
  });
  const avgdl = lens.reduce((a, b) => a + b, 0) / (sentences.length || 1);
  return { sentences, df, postings, lens, avgdl, N: sentences.length, version: 3 };
}

export function search(index, query, k = 8) {
  const { df, postings, lens, avgdl, N } = index, k1 = 1.5, b = 0.75, scores = new Map();
  for (const t of tokenize(query)) {
    const p = postings.get(t); if (!p) continue;
    const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
    for (const [i, tf] of p) {
      const denom = tf + k1 * (1 - b + b * lens[i] / avgdl);
      scores.set(i, (scores.get(i) || 0) + idf * (tf * (k1 + 1)) / denom);
    }
  }
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, k)
    .map(([i, score]) => ({ sentence: index.sentences[i], score }));
}
```

### SP-2 · Normalización + stemmer (portado de v10, endurecido)

```js
export const normalize = s => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const stem = w => {
  const t = normalize(w).replace(/[^a-z0-9]/g, '');
  if (t.length <= 4) return t;
  return t.replace(/(aciones|iciones|amiento|imiento|idades|adores)$/, '')
          .replace(/(acion|icion|mente|ador|ante|encia|ancia|able|ible|idad|ismo|ista)$/, '')
          .replace(/(ando|iendo|aron|ieron|aban|adas|idos|es|os|as|a|o|e)$/, '');
};
export function tokenize(text) {
  return normalize(text).replace(/[^a-z0-9áéíóúñü\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w)).map(stem);
}
```

### SP-3 · Escapado en las tres superficies con XSS

```js
export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// brain-rag.js:      div.innerHTML = esc(htmlWithPlaceholders)   // o construir con nodos DOM
// neural-graph.js:   row.innerHTML = `<span …>${esc(text)}</span>`
// study-bots.js:     guía y artefactos pasan por esc()
```

### SP-4 · Service Worker que sí funciona offline

```js
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    const network = fetch(event.request)
      .then(resp => { if (resp && resp.ok) cache.put(event.request, resp.clone()); return resp; })
      .catch(() => null);
    return cached || (await network) ||
      (await cache.match('./index.html')) ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
```

### SP-5 · Persistencia mínima mientras llega la Fase 4

Guardar en IndexedDB `docs` (metadatos + páginas), `sentences` y `settings` (incluido `ollamaEnabled`), y restaurar en `init()` antes de `NeuralGraph.init()`. Sin esto, cualquier mejora del modelo se pierde al recargar.

---

## 7. Matriz de "más opciones" para el usuario final

| Dimensión | Hoy | Objetivo |
|---|---|---|
| Backends de generación | 1 (+Ollama condicional) | 5 intercambiables con selector y health check |
| Idiomas de UI | ES | ES / EN |
| Formatos de ingesta | 11 | +EPUB, HTML, URL, audio, carpetas |
| Modos de respuesta | 1 | 6 modos con prompt y formato propios |
| Exportación | MD, ZIP, PNG, SQLite | +Anki, PDF, Obsidian, JSON del cerebro, backup/restore |
| Navegación del grafo | inspector básico | tooltip, sinapsis, recentrar, preguntar por nodo, filtros por clúster/peso |
| Memoria | efímera | bóveda + chat + grafo persistentes, import/export |
| Evaluación | quiz sin puntaje | quiz con puntaje, SRS, dashboard de dominio |
| Despliegue | `python -m http.server` | estático (PWA) o Docker con proxy |

---

## 8. Arquitectura objetivo

```
                        ┌───────────────────────────────────────────┐
   PDF/DOCX/IMG/URL ──► │  Ingesta + normalización + paginación     │
                        └───────────────┬───────────────────────────┘
                                        ▼
                        ┌───────────────────────────────────────────┐
                        │  Índice híbrido (persistido en IndexedDB) │
                        │  léxico (BM25 + stems + bigramas)         │
                        │  denso  (embeddings multilingües)         │
                        └───────────────┬───────────────────────────┘
                                        ▼
        pregunta ──► [Router de intención] ──► [Retrieval + RRF + MMR + rerank]
                                        │
                                        ▼
                        ┌───────────────────────────────────────────┐
                        │  Ensamblador de contexto con presupuesto  │
                        │  (chunks + vecinos + grafo + memoria)     │
                        └───────────────┬───────────────────────────┘
                                        ▼
                        ┌───────────────────────────────────────────┐
                        │  ModelRouter: WebLLM → Ollama → interno   │
                        │  streaming · cancelación · modos · tools   │
                        └───────────────┬───────────────────────────┘
                                        ▼
                  Respuesta + citas verificadas + traza de herramientas
                                        │
                                        ▼
              ┌─────────────────────────────────────────────────────┐
              │ Memoria v3: bóveda · chat · nodos · feedback · eval │
              └─────────────────────────────────────────────────────┘
```

---

## 9. Backlog priorizado

| ID | Área | Tarea | Archivos | Prio | Esf. | Impacto en el modelo |
|---|---|---|---|---|---|---|
| SPD-01 | Ingeniería | `package.json`, `.gitignore`, `LICENSE`, scripts | raíz | P0 | S | Habilita todo lo demás |
| SPD-02 | Ingeniería | Arnés de tests jsdom + benchmark | `tests/` | P0 | M | Mide el progreso |
| SPD-03 | Seguridad | `js/util.js`: escape + normalización + stem + stopwords | nuevo | P0 | S | Seguridad + base del retrieval |
| SPD-04 | Seguridad | Escapar chat/ticker/inspector/guía/artefactos | 4 archivos | P0 | S | Elimina XSS |
| SPD-05 | Seguridad | Evaluador matemático sin `Function` | `brain-rag.js` | P1 | S | Elimina superficie de ejecución |
| SPD-06 | Retrieval | Índice invertido + BM25 precalculado | `js/retrieval.js` | **P0** | M | 100× latencia, escala a 20k |
| SPD-07 | Retrieval | Stemming ES + stopwords + acentos | `js/retrieval.js` | **P0** | S | Recupera paráfrasis y variantes |
| SPD-08 | Retrieval | Chunking con vecinos y secciones | `js/retrieval.js` | P1 | M | Respuestas con contexto |
| SPD-09 | Retrieval | Bigramas + dedupe + MMR | `js/retrieval.js` | P1 | M | Precisión y diversidad |
| SPD-10 | Retrieval | Filtros (`=doc:`, `=pag:`, `"frase"`, `-x`) | `retrieval.js`, `brain-rag.js` | P1 | S | Control del usuario |
| SPD-11 | Semántica | Embeddings ONNX + caché IDB + worker | `js/embeddings.js` | P1 | L | +15 pp recall |
| SPD-12 | Semántica | Fusión RRF + rerank + `cosineSim` real | `retrieval.js` | P1 | M | Conecta el código muerto |
| SPD-13 | Semántica | Detector de contradicciones real (cifras + entailment) | `js/analysis.js` | P2 | M | Diferencial académico |
| SPD-14 | Persistencia | Esquema IDB v3 + migración + restore | `store.js` | **P0** | L | El sistema aprende entre sesiones |
| SPD-15 | Persistencia | `chatHistory` real + `ollamaEnabled` persistido | `store.js`, `brain-rag.js` | P0 | S | Contexto de seguimiento |
| SPD-16 | Persistencia | Bóveda (port v10) + consolidación + import/export | `js/memory.js` | P1 | M | Memoria semántica |
| SPD-17 | Modelos | `ModelProvider` + router con degradación | `js/providers/*` | **P0** | L | "Más opciones" |
| SPD-18 | Modelos | Ollama: streaming, `/api/tags`, health, aviso CORS | `providers/ollama.js` | P0 | M | Primer backend real |
| SPD-19 | Modelos | WebLLM (WebGPU) + Transformers.js (WASM) | `providers/*` | P1 | L | LLM local sin instalar nada |
| SPD-20 | Modelos | OpenAI-compatible (LM Studio, llama.cpp, vLLM) | `providers/openai.js` | P2 | S | Integración con lo que ya uses |
| SPD-21 | Modelos | 6 modos de respuesta + citas verificadas | `brain-rag.js` | P1 | M | Calidad percibida |
| SPD-22 | Modelos | Síntesis extractiva (TextRank) como fallback | `js/analysis.js` | P1 | M | Respuestas coherentes sin LLM |
| SPD-23 | Aprendizaje | Modelo auxiliar: top-150 real, markov persistido, memoria negativa activa | `kimi-aux-model.js` | P1 | S | Aprendizaje que sirve |
| SPD-24 | Agentos | Scoring normalizado + cola global + SPDR-05 con reglas propias | `spiders.js` | P2 | M | Cosecha más rápida y especializada |
| SPD-25 | Grafo | Updates incrementales + dedupe de sinapsis | `neural-graph.js` | P1 | M | Escala visual |
| SPD-26 | Grafo | Tooltip, sinapsis, "preguntar por nodo", recentrar | `neural-graph.js` | P2 | S | Exploración |
| SPD-27 | Estudio | Quiz con puntaje + distractores reales + modo examen | `study-bots.js` | P1 | M | Valor académico |
| SPD-28 | Estudio | SRS Leitner + export Anki | `study-bots.js` | P2 | M | Retención |
| SPD-29 | Eval | Set dorado + métricas + dashboard | `tests/`, `index.html` | P1 | M | Demuestra el peso |
| SPD-30 | Plataforma | Proxy local + Docker + más parsers + i18n | `server/`, `parsers.js` | P2 | L | Opciones de despliegue |

**Leyenda:** P0 = bloqueante · P1 = alto valor · P2 = mejora · S ≤ 1 día · M 1–3 días · L 3+ días.

---

## 10. Decisiones que necesito de ti

1. **Privacidad.** ¿El producto debe seguir siendo 100 % local (solo WebLLM/Ollama/Transformers.js) o aceptamos también APIs en la nube con la clave del usuario? Cambia qué backends entran en la Fase 3 y el mensaje de privacidad del HUD.
2. **Despliegue.** ¿Seguimos 100 % estático (abrir `index.html` / GitHub Pages), o añadimos el proxy local (Docker) para Ollama sin CORS, SQLite con auth y caché de embeddings compartida?
3. **Alcance de documentos.** ¿Cuál es el techo realista? (p. ej. 500 páginas / 20.000 oraciones). Define si la capa densa va en worker con cuantización agresiva o si basta el léxico para el público objetivo.
4. **Prioridad de producto.** ¿"Más peso" significa **calidad de respuesta** (F1–F3) o **más funciones de estudio** (F5)? Mi recomendación: primero motor (F0–F2), porque las funciones de estudio ya existen y lo que las hace útiles es que las respuestas sean buenas.

---

## 11. Cómo sabremos que ganamos peso

| Indicador | Hoy | Meta tras F1–F3 |
|---|---|---|
| Latencia p95 (20k oraciones) | ~40 s | < 50 ms (léxico) / < 1,2 s (híbrido + LLM en streaming) |
| Recall@5 en set dorado | no medido | ≥ 0,85 léxico · ≥ 0,92 híbrido |
| Consultas con 0 resultados sobre corpus relevante | sin medir (1 de 7 en la muestra) | < 5 % |
| Respuestas con cita verificable | 100 % (son citas) | ≥ 90 % con síntesis + cita |
| Sesiones que conservan conocimiento | 0 % | 100 % |
| Backends de modelo disponibles | 1 | 5 |
| Modos de respuesta | 1 | 6 |
| Cobertura de tests | 0 % | ≥ 70 % del núcleo (retrieval, store, memory) |
| Tiempo de arranque en frío con 10k oraciones | no soportado | < 2 s (índice cacheado) |

---

### Anexo A · Evidencia reproducible

```bash
# 1. Sintaxis de todos los módulos
for f in js/*.js sw.js; do node --check "$f"; done

# 2. Benchmark del motor: actual vs índice invertido propuesto
node tests/bench-bm25.js            # 200 / 1k / 3k / 8k / 15k oraciones
node tests/bench-bm25.js 20000      # un tamaño concreto
```

Salida real (2026-11-16):

```
oraciones │  actual (BM25 O(N²)) │  propuesto (índice) │ speedup
      200 │              11.3 ms │             0.42 ms │     27×
     1000 │             158.2 ms │             0.22 ms │    734×
     3000 │            1254.6 ms │             0.50 ms │   2504×
     8000 │            7480.6 ms │             1.22 ms │   6136×
    15000 │           25316.1 ms │             2.49 ms │  10180×
```

La prueba de arranque, cosecha, consultas, XSS y persistencia se ejecutó con **jsdom + `python3 -m http.server`** (sin dependencias en el repo); su versión automatizada, `tests/audit.dom.js`, se entrega en la Fase 0 (SPD-02).

### Anexo B · Comandos útiles

```bash
python3 -m http.server 8080        # servir la app
OLLAMA_ORIGINS='*' ollama serve    # permitir que el navegador hable con Ollama
ollama pull qwen2.5:3b             # modelo recomendado para empezar
```
