# NEURAL COMMAND // AI SPIDER OS

Espacio de estudio en el navegador con búsqueda, análisis y memoria **locales**. El texto de los documentos no se envía a un servidor ni a una API externa. No utiliza Ollama ni claves. El modelo semántico opcional se ejecuta en el propio dispositivo.

## Iniciar

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`, carga un archivo, pega apuntes o pulsa **Demo**. Usa **Asistente** y **Estudio** en la barra superior para abrir el chat y las herramientas sin salir del panel. La aplicación no necesita npm para ejecutarse. Una vez completada la instalación del service worker, la interfaz y sus librerías básicas funcionan sin conexión. El funcionamiento sin conexión y el modelo opcional requieren HTTPS o localhost, almacenamiento disponible y un navegador compatible.

### Modelo semántico opcional

1. Pulsa **MODELO** y después **DESCARGAR Y ACTIVAR**. Se descargan aproximadamente **42 MiB (44 MB)** desde la misma instalación de la aplicación, no desde un CDN ni una API de IA. El shell no descarga esos archivos automáticamente.
2. La ventana muestra el avance y cuántos pasajes se han indexado. Durante la indexación el chat sigue usando la búsqueda interna y los vectores que ya estén listos. Mantén activada la **búsqueda híbrida vectorial** en Ajustes para utilizar el modelo.
3. Cuando el modelo está descargado y el service worker controla la página, también se puede usar sin conexión. Sus vectores se mantienen en memoria y se reconstruyen al abrir la aplicación; un corpus grande puede tardar y consumir CPU/memoria. El navegador puede borrar su caché si necesita espacio.
4. **DESACTIVAR** detiene la inferencia; **ELIMINAR DESCARGA** borra sus archivos del almacenamiento de este navegador sin borrar tus documentos. Cierra otras pestañas de la aplicación antes de borrarlos: pueden conservar el modelo en memoria o volver a descargarlo. El respaldo JSON de tu conocimiento es independiente y no incluye los pesos del modelo.

El modelo `all-MiniLM-L6-v2` es un encoder de embeddings de 384 dimensiones, entrenado principalmente en inglés. Ayuda a encontrar y ordenar pasajes relacionados, pero **no genera texto** y su rendimiento en español puede variar. La búsqueda normal y las funciones de estudio siguen disponibles sin él. Consulta [`models/minilm/README.md`](models/minilm/README.md) y [`vendor/NOTICE.md`](vendor/NOTICE.md) para procedencia y licencias.

## Qué incluye

- **Arañas:** recorren el texto visible, destacan sus palabras y transportan una cápsula con el fragmento al nodo correspondiente. Se coordinan para no escanear el mismo pasaje; los controles de pausa, número de arañas y páginas permanecen disponibles. Con movimiento reducido, las transiciones se simplifican.
- **Recuperación híbrida:** índice invertido BM25, normalización y raíces en español, bigramas, corrección básica de erratas, diversificación MMR y una proyección vectorial local combinada mediante RRF y coseno. Con el modelo opcional se añade un ranking de embeddings ONNX. Filtros: `=doc:nombre`, `=pag:2`, `"frase exacta"` y `-excluir`.
- **Respuestas con fuentes:** modos automático, resumen, examen, socrático, crítico y redacción. Se puede abrir cada cita en el documento y valorar la respuesta para ajustar la prioridad del primer pasaje. El modo crítico señala *posibles* discrepancias, no pruebas definitivas.
- **Estudio:** guía editable, tarjetas con repetición espaciada (Leitner/SM-2 simplificado), exportación CSV para Anki, quiz con puntuación y temporizador opcional, bóveda de conocimiento y evaluación del corpus.
- **Persistencia:** documentos indexados, grafo, memoria, conversación, valoraciones y progreso en IndexedDB, con respaldo JSON e importación validada. Si IndexedDB no está disponible se intenta usar localStorage, sujeto a su cuota. Los datos pertenecen al navegador y al origen desde el que se abrió la aplicación; exporta un respaldo antes de limpiar sus datos.
- **Formatos:** texto, Markdown, código, CSV, SRT/VTT, HTML, PDF con texto, DOCX, PPTX, XLSX y EPUB. PDF.js, Mammoth, JSZip y D3 están empaquetados localmente.

## Límites importantes

- El compositor de respuestas es **extractivo y basado en reglas**, no un LLM preentrenado. La proyección vectorial incluida por defecto tampoco es un modelo neuronal. El encoder ONNX opcional mejora la búsqueda en algunos casos, pero no garantiza relevancia ni corrige por sí solo la redacción; se avisa cuando se utiliza una fuente seleccionada solo por similitud semántica. Los resúmenes generales usan una muestra de pasajes, no una lectura exhaustiva de documentos grandes.
- La comprobación de citas verifica el número de fuente y un solapamiento léxico básico; **no verifica la verdad de una afirmación**. Revisa siempre la fuente y las posibles contradicciones.
- La evaluación generada desde el propio corpus es una línea base potencialmente optimista. El conjunto de prueba incluido es pequeño y no garantiza resultados en otros temas. La demo es material sintético, no una medición científica.
- No se incluye OCR, transcripción de audio ni traducción automática: un PDF escaneado puede no tener texto extraíble. El soporte XLSX extrae valores almacenados, no calcula fórmulas. Los archivos de imagen/vídeo pueden visualizarse durante la sesión, pero sus originales no se incluyen en el respaldo JSON y deben volver a seleccionarse tras recargar.
- La importación de URL, el reconocimiento de voz del navegador y el antiguo endpoint PHP se retiraron para mantener la ruta independiente y evitar envíos de datos. No se incluye un modelo generativo WebLLM ni un servidor de modelos.

## Pruebas y rendimiento

Para ejecutar las pruebas de desarrollo se necesita Node.js 20+ y una instalación inicial de las dependencias de prueba:

```bash
npm ci
npm test
npm run bench -- 20000
```

El benchmark mide la búsqueda determinista sobre un corpus sintético repetitivo, **sin** inferencia ONNX; no garantiza la misma latencia en otros dispositivos o documentos. El set dorado contiene 72 preguntas con respuesta y 8 preguntas trampa sobre 24 pasajes. La vista **Estudio → Métricas** evalúa el corpus cargado e incluye la inferencia del modelo cuando está activo y ha terminado de indexar.

- [`docs/IMPLEMENTACION_V11.md`](docs/IMPLEMENTACION_V11.md): implementación, resultados y trabajo no incluido.
- [`docs/AUDITORIA_Y_PLAN.md`](docs/AUDITORIA_Y_PLAN.md): auditoría histórica y plan original.
- [`tests/bench-bm25.js`](tests/bench-bm25.js): comparación histórica con el motor anterior.
