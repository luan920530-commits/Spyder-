# Implementación v11: motor local y estudio

Esta nota describe lo implementado sobre la auditoría histórica [`AUDITORIA_Y_PLAN.md`](AUDITORIA_Y_PLAN.md). El objetivo acordado es mantener el procesamiento en el dispositivo, sin Ollama ni APIs externas.

## Fases implementadas

- **F0 — Seguridad y PWA:** el texto no confiable se inserta como texto o se escapa antes del formato; se eliminó el endpoint PHP. El service worker precarga el shell, las librerías y fuentes locales; se añadieron iconos PWA, navegación accesible y soporte de movimiento reducido.
- **F1 — Recuperación:** índice invertido, normalización y raíces españolas, bigramas, filtros de documento/página/frase/exclusión, recuperación por ventana, corrección básica de erratas y MMR.
- **F2 — Vector local:** proyección determinista compacta con familias explícitas de sinónimos, coseno y fusión RRF. **No es un modelo de embeddings neuronales preentrenado**, ni sustituye su cobertura semántica.
- **F3 — Respuestas:** enrutador local con compositor extractivo, seis modos (automático, resumen, examen, socrático, crítico y redacción), revisión de referencias, calculadora segura y navegación a las fuentes. No hay conexión a Ollama, API ni descarga de modelos.
- **F4 — Memoria:** IndexedDB v3 con migración de patrones v2, restauración del corpus y del grafo, ajustes, bóveda, chat, tarjetas, valoraciones y respaldo JSON. El feedback modifica el orden de recuperación para consultas similares. La importación usa una transacción IndexedDB y valida la estructura antes de sustituir datos.
- **F5 — Estudio y evaluación:** guía editable, quiz con puntuación/temporizador y revisión de fuentes, tarjetas SRS con CSV para Anki, bóveda, conjunto de prueba y dashboard de recuperación/citas.
- **F6 — Ingesta adicional:** EPUB, HTML y subtítulos se procesan localmente. Se conservan PDF, DOCX, PPTX y XLSX mediante librerías empaquetadas. No se instaló ningún proxy ni servidor de modelos.

El diseño del panel se adaptó al archivo visual proporcionado: tres columnas, actividad a la izquierda, constelaciones centrales y agentes/métricas a la derecha. No contiene panel de comentarios ni un marco de vista previa externo. En pantallas pequeñas se apilan los paneles y se puede abrir el asistente o las herramientas de estudio desde la barra superior.

## Verificaciones

- `npm test`: pruebas de recuperación y citas, aritmética segura, estudio, XSS en interfaz, migración IndexedDB v2, backup/restauración y precache. Las pruebas DOM usan `jsdom` y `fake-indexeddb` como dependencias de desarrollo; la aplicación no las necesita para ejecutarse.
- `tests/golden/corpus.json`: 72 preguntas con respuesta y 8 preguntas sin respuesta sobre 24 pasajes redactados para la prueba. La ejecución de referencia obtuvo **72/72 en recall@5 y 8/8 trampas sin resultados**. No implica ese rendimiento en otros corpus.
- `npm run bench -- 20000`: una ejecución en este entorno obtuvo **p50 5,42 ms y p95 6,82 ms** para la búsqueda híbrida de 20.000 oraciones sintéticas repetitivas; indexación y vectores: aproximadamente 1,02 s. La latencia depende del hardware, el corpus y la consulta.
- Se probó con Chromium sin conexión tras instalar el service worker: carga de PDF, DOCX, XLSX y EPUB locales, recarga sin red, persistencia de chat/tarjetas/quiz/feedback y ejecución de un PDF desde la caché. No se observaron solicitudes a dominios externos en esa prueba.

## Límites y tareas pendientes

No se han integrado pesos neuronales locales, WebLLM, Transformers.js, OCR, Whisper, traducción automática, `.apkg`, SQLite, i18n, API de plugins ni un set dorado amplio de varios corpus. Algunas de estas opciones eran opcionales o incompatibles con no instalar componentes adicionales; otras quedan como trabajo futuro y **no deben considerarse verificadas**. Los archivos multimedia originales y sus URL temporales no se incluyen en el respaldo. La comprobación de citas evalúa existencia y solapamiento léxico, no demuestra que una afirmación sea verdadera. La evaluación automática del corpus usa consultas generadas de los mismos pasajes y puede ser optimista.
