# NEURAL COMMAND // AI SPIDER OS

Espacio de estudio en el navegador con búsqueda, análisis y memoria **locales**. El texto de los documentos no se envía a un servidor ni a una API externa. No utiliza Ollama, claves ni descargas de modelos.

## Iniciar

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`, carga un archivo, pega apuntes o pulsa **Demo**. Usa **Asistente** y **Estudio** en la barra superior para abrir el chat y las herramientas sin salir del panel. La aplicación no necesita npm para ejecutarse. Una vez cargada por primera vez y completada la instalación del service worker, su interfaz y las librerías incluidas funcionan sin conexión. La instalación PWA requiere un contexto seguro (HTTPS o localhost) y un navegador compatible.

## Qué incluye

- **Recuperación híbrida:** índice invertido BM25, normalización y raíces en español, bigramas, corrección básica de erratas, diversificación MMR y una proyección vectorial local combinada mediante RRF y coseno. Filtros: `=doc:nombre`, `=pag:2`, `"frase exacta"` y `-excluir`.
- **Respuestas con fuentes:** modos automático, resumen, examen, socrático, crítico y redacción. Se puede abrir cada cita en el documento y valorar la respuesta para ajustar la prioridad del primer pasaje. El modo crítico señala *posibles* discrepancias, no pruebas definitivas.
- **Estudio:** guía editable, tarjetas con repetición espaciada (Leitner/SM-2 simplificado), exportación CSV para Anki, quiz con puntuación y temporizador opcional, bóveda de conocimiento y evaluación del corpus.
- **Persistencia:** documentos indexados, grafo, memoria, conversación, valoraciones y progreso en IndexedDB, con respaldo JSON e importación validada. Si IndexedDB no está disponible se intenta usar localStorage, sujeto a su cuota. Los datos pertenecen al navegador y al origen desde el que se abrió la aplicación; exporta un respaldo antes de limpiar sus datos.
- **Formatos:** texto, Markdown, código, CSV, SRT/VTT, HTML, PDF con texto, DOCX, PPTX, XLSX y EPUB. PDF.js, Mammoth, JSZip y D3 están empaquetados localmente; sus versiones y licencias están en [`vendor/NOTICE.md`](vendor/NOTICE.md).

## Límites importantes

- El motor incluido es **extractivo y basado en reglas**, no un LLM preentrenado. La capa vectorial es una proyección compacta de palabras y familias de sinónimos; no debe confundirse con embeddings neuronales. Puede no entender paráfrasis, producir respuestas incompletas o elegir evidencia irrelevante. Los resúmenes generales usan una muestra de pasajes, no una lectura exhaustiva de documentos grandes.
- La comprobación de citas verifica el número de fuente y un solapamiento léxico básico; **no verifica la verdad de una afirmación**. Revisa siempre la fuente y las posibles contradicciones.
- La evaluación generada desde el propio corpus es una línea base potencialmente optimista. El conjunto de prueba incluido es pequeño y no garantiza resultados en otros temas. La demo es material sintético, no una medición científica.
- No se incluye OCR, transcripción de audio ni traducción automática: un PDF escaneado puede no tener texto extraíble. El soporte XLSX extrae valores almacenados, no calcula fórmulas. Los archivos de imagen/vídeo pueden visualizarse durante la sesión, pero sus originales no se incluyen en el respaldo JSON y deben volver a seleccionarse tras recargar.
- La importación de URL, el reconocimiento de voz del navegador y el antiguo endpoint PHP se retiraron para mantener la ruta independiente y evitar envíos de datos. Tampoco se incluye un proveedor WebLLM/Transformers ni sus pesos: admitirlos exigiría instalar código y modelos locales por separado.

## Pruebas y rendimiento

Para ejecutar las pruebas de desarrollo se necesita Node.js 20+ y una instalación inicial de las dependencias de prueba:

```bash
npm ci
npm test
npm run bench -- 20000
```

El benchmark usa un corpus sintético repetitivo y no garantiza la misma latencia en otros dispositivos o documentos. El set dorado contiene 72 preguntas con respuesta y 8 preguntas trampa sobre 24 pasajes. La vista **Estudio → Métricas** permite evaluar el corpus cargado.

- [`docs/IMPLEMENTACION_V11.md`](docs/IMPLEMENTACION_V11.md): implementación, resultados y trabajo no incluido.
- [`docs/AUDITORIA_Y_PLAN.md`](docs/AUDITORIA_Y_PLAN.md): auditoría histórica y plan original.
- [`tests/bench-bm25.js`](tests/bench-bm25.js): comparación histórica con el motor anterior.
