# NEURAL COMMAND // AI SPIDER OS

Espacio de estudio en el navegador con búsqueda, análisis y memoria **locales**. El texto de los documentos no se envía a un servidor ni a una API externa. No utiliza Ollama ni claves. Tanto el encoder semántico como el generador de personajes opcionales se ejecutan en el propio dispositivo.

## Iniciar

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`, carga un archivo, pega apuntes o pulsa **Demo**. Usa **Asistente** y **Estudio** en la barra superior para abrir el chat y las herramientas sin salir del panel. La aplicación no necesita npm para ejecutarse. Una vez completada la instalación del service worker, la interfaz y sus librerías básicas funcionan sin conexión. El funcionamiento sin conexión y el modelo opcional requieren HTTPS o localhost, almacenamiento disponible y un navegador compatible.

### Conversar con un personaje

1. Abre **Asistente** y elige **Conversación · personaje** en el selector de modo.
2. Sube el PDF de una novela o elige un libro ya cargado; también admite EPUB, TXT, Markdown y DOCX. Escribe el nombre del personaje tal como aparece en el texto extraído.
3. Saluda, pregunta por un tema de la obra o usa **Háblame de ti** y **¿Y después?**. Si hay un pasaje relacionado, su cita abre la página del libro; la continuación recorre el texto desde la última cita del mismo personaje y libro.

Por defecto funciona con **reglas y fragmentos literales**; opcionalmente puedes activar el generador local Qwen descrito abajo. Busca menciones del nombre y palabras cercanas solo en el libro elegido; puede no comprender una pregunta, confundir el contexto o revelar spoilers. Un pasaje puede ser narración o palabras de otra persona, no necesariamente diálogo del personaje. Ninguna ruta entrena el modelo con tu libro ni promete imitar fielmente su personalidad. Un PDF sin texto extraíble no se puede usar sin OCR.

Las respuestas de acompañamiento y crisis son frases básicas activadas por reglas muy limitadas: pueden pasar por alto situaciones importantes y no sustituyen ayuda profesional o de emergencia. El libro, el nombre y el historial se guardan en este navegador cuando hay almacenamiento disponible y pueden incluirse en respaldos JSON. **BORRAR** elimina todo el historial del chat, no los libros; quitar un libro tampoco elimina las citas que ya quedaron en el historial. Para retirar ambos, borra el chat y el libro o usa el reset completo. Los archivos de respaldo/exportación que hayas guardado aparte no se borran automáticamente.

### Generador de personajes opcional: Qwen3

1. En **MODELO**, elige **DESCARGAR Y ACTIVAR QWEN**. Spyder descarga el archivo [Qwen3-0.6B-Q4_K_M.gguf de Unsloth](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/blob/main/Qwen3-0.6B-Q4_K_M.gguf) de una revisión fija de Hugging Face: **396.705.472 bytes (397 MB, ~378 MiB)**, más aproximadamente 2,5 MB del motor local. También puedes importar ese GGUF exacto desde tu dispositivo mediante el selector del panel.
2. La descarga puede tardar y requiere espacio libre, memoria adicional y un navegador moderno con WebAssembly, Cache Storage y service worker en HTTPS o localhost. El modelo se verifica por tamaño y SHA-256 antes de guardarse y otra vez al cargarlo. Si falta espacio, se interrumpe o falla la comprobación, Spyder avisa y no activa una copia parcial. Se puede cancelar y volver a intentar; la descarga del GGUF no es reanudable.
3. Cuando indique **Qwen activo**, abre **Conversación · personaje**, selecciona un libro, escribe el nombre y pregunta. La primera carga y cada respuesta pueden tardar bastante: el motor usa CPU monohilo, no GPU. Usa **DETENER** para cancelar una respuesta. Al desactivar o si hay un fallo, vuelven las reglas; se informa en la respuesta. **ELIMINAR QWEN** elimina su caché, no los libros ni MiniLM. Cierra las otras pestañas antes de eliminar o reinstalar, porque cada una mantiene su propio estado.

Qwen es un LLM pequeño: puede inventar datos, no seguir el personaje, responder en otro idioma o confundir el pasaje, y su calidad en español no está garantizada. El fragmento enlazado es contexto consultado, **no una comprobación ni necesariamente palabras del personaje**; si no se encuentra un fragmento del tema, se avisa y puede responder sin fuente. Las respuestas generadas se etiquetan como tales. Las reglas limitadas de crisis se ejecutan antes del generador y no constituyen asistencia de emergencia.

Los fragmentos del libro, preguntas e historial usados en el prompt se procesan en este dispositivo, no se envían a Hugging Face. Al descargar, el navegador sí contacta a Hugging Face y a su infraestructura de archivos/redirecciones; el proveedor puede recibir metadatos de conexión. Después de instalar y verificar el modelo y el shell, pueden usarse sin conexión. El navegador podría borrar la caché por presión de almacenamiento. Libro e historial pueden persistir en IndexedDB y en el respaldo JSON; los pesos no se incluyen en ese respaldo. Código y licencias en [`vendor/NOTICE.md`](vendor/NOTICE.md) y [`models/qwen3/LICENSE`](models/qwen3/LICENSE).

### Encoder semántico opcional

1. Pulsa **MODELO** y después **DESCARGAR Y ACTIVAR**. Se descargan aproximadamente **42 MiB (44 MB)** desde la misma instalación de la aplicación, no desde un CDN ni una API de IA. El shell no descarga esos archivos automáticamente.
2. La ventana muestra el avance y cuántos pasajes se han indexado. Durante la indexación el chat sigue usando la búsqueda interna y los vectores que ya estén listos. Mantén activada la **búsqueda híbrida vectorial** en Ajustes para utilizar el modelo.
3. Cuando el modelo está descargado y el service worker controla la página, también se puede usar sin conexión. Sus vectores se mantienen en memoria y se reconstruyen al abrir la aplicación; un corpus grande puede tardar y consumir CPU/memoria. El navegador puede borrar su caché si necesita espacio.
4. **DESACTIVAR** detiene la inferencia; **ELIMINAR DESCARGA** borra sus archivos del almacenamiento de este navegador sin borrar tus documentos. Cierra otras pestañas de la aplicación antes de borrarlos: pueden conservar el modelo en memoria o volver a descargarlo. El respaldo JSON de tu conocimiento es independiente y no incluye los pesos del modelo.

El modelo `all-MiniLM-L6-v2` es un encoder de embeddings de 384 dimensiones, entrenado principalmente en inglés. Ayuda a encontrar y ordenar pasajes relacionados, pero **no genera texto** y su rendimiento en español puede variar. La búsqueda normal y las funciones de estudio siguen disponibles sin él. Consulta [`models/minilm/README.md`](models/minilm/README.md) y [`vendor/NOTICE.md`](vendor/NOTICE.md) para procedencia y licencias.

## Qué incluye

- **Arañas:** de una a cinco arañas articuladas alternan apoyos al caminar, frenan y giran antes de cambiar de dirección. Recorren hasta 18 palabras de cada pasaje y transportan una cápsula que acompaña sus movimientos hasta el nodo correspondiente. Cuando no hay análisis activo, pasean por la pantalla y tejen telarañas efímeras puramente decorativas; estas no crean patrones, reservas ni métricas. El análisis real tiene prioridad. La pausa y el movimiento reducido detienen el paseo.
- **Red interactiva:** la reina NC-00 permanece sobre su red y tira de sus hilos por turnos; emite una onda al asignarse trabajo real y los destellos apuntan únicamente a las arañas de ese despacho. La reina, la telaraña y las partículas son elementos visuales, no datos cosechados. Mueve el puntero para explorar y haz clic o pulsa Enter sobre la red para enviar hasta tres arañas libres a pasajes reales, sin interrumpir sus tareas. Los nodos de conceptos mantienen su inspector y sus citas. Pausa o activa **Reducir animaciones** en Ajustes para detener o simplificar el movimiento.
- **Recuperación híbrida:** índice invertido BM25, normalización y raíces en español, bigramas, corrección básica de erratas, diversificación MMR y una proyección vectorial local combinada mediante RRF y coseno. Con el modelo opcional se añade un ranking de embeddings ONNX. Filtros: `=doc:nombre`, `=pag:2`, `"frase exacta"` y `-excluir`.
- **Respuestas con fuentes:** modos automático, resumen, examen, socrático, crítico, redacción y conversación por personaje. Se puede abrir cada cita en el documento; en los modos de estudio, las valoraciones ajustan la prioridad del primer pasaje. El modo crítico señala *posibles* discrepancias, no pruebas definitivas.
- **Estudio:** guía editable, tarjetas con repetición espaciada (Leitner/SM-2 simplificado), exportación CSV para Anki, quiz con puntuación y temporizador opcional, bóveda de conocimiento y evaluación del corpus.
- **Persistencia:** documentos indexados, grafo, memoria, conversación, valoraciones y progreso en IndexedDB, con respaldo JSON e importación validada. Si IndexedDB no está disponible se intenta usar localStorage, sujeto a su cuota. Los datos pertenecen al navegador y al origen desde el que se abrió la aplicación; exporta un respaldo antes de limpiar sus datos.
- **Formatos:** texto, Markdown, código, CSV, SRT/VTT, HTML, PDF con texto, DOCX, PPTX, XLSX y EPUB. PDF.js, Mammoth, JSZip y D3 están empaquetados localmente.

## Límites importantes

- El compositor predeterminado es **extractivo y basado en reglas**; solo el modo personaje puede usar el generador Qwen opcional. La proyección vectorial incluida por defecto tampoco es un modelo neuronal. El encoder ONNX opcional mejora la búsqueda en algunos casos, pero no garantiza relevancia ni corrige por sí solo la redacción; se avisa cuando se utiliza una fuente seleccionada solo por similitud semántica. Los resúmenes generales usan una muestra de pasajes, no una lectura exhaustiva de documentos grandes.
- La comprobación de citas verifica el número de fuente y un solapamiento léxico básico; **no verifica la verdad de una afirmación**. Revisa siempre la fuente y las posibles contradicciones.
- La evaluación generada desde el propio corpus es una línea base potencialmente optimista. El conjunto de prueba incluido es pequeño y no garantiza resultados en otros temas. La demo es material sintético, no una medición científica.
- No se incluye OCR, transcripción de audio ni traducción automática. Si un PDF no devuelve texto, también puede deberse a páginas vacías o a fuentes/codificaciones no compatibles, no necesariamente a un escaneo. Los PDF protegidos por contraseña deben abrirse y guardarse sin contraseña antes de importarlos. Se procesan como máximo 500 páginas PDF y se avisa si la lectura es parcial o si alguna página no devuelve texto; las citas y el filtro `=pag:` usan el número de página PDF original. El lector, sus CMaps y sus fuentes son locales y quedan disponibles offline tras instalar el shell. El respaldo nativo anterior no se usa porque no conservaba páginas ni podía garantizar la codificación. El soporte XLSX extrae valores almacenados, no calcula fórmulas. Los archivos de imagen/vídeo pueden visualizarse durante la sesión, pero sus originales no se incluyen en el respaldo JSON y deben volver a seleccionarse tras recargar.
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
