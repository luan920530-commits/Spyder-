# NEURAL COMMAND // AI SPIDER OS

Espacio de estudio en el navegador con búsqueda, análisis y memoria **locales**. El texto de los documentos no se envía a un servidor ni a una API externa. No utiliza Ollama ni claves. Tanto el encoder semántico como el generador de texto opcional se ejecutan en el propio dispositivo.

## Iniciar

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`, carga un archivo, pega apuntes o pulsa **Demo**. Pulsa **2 · Analizar** para ver el tutor junto a la red, **Asistente** para abrir el chat o **4 · Estudio → Mi repaso** para una sesión corta de tarjetas. La aplicación no necesita npm para ejecutarse. Una vez completada la instalación del service worker, la interfaz y sus librerías básicas funcionan sin conexión. El funcionamiento sin conexión y el modelo opcional requieren HTTPS o localhost, almacenamiento disponible y un navegador compatible.

### Charla básica en el chat principal

Abre **3 · Asistente → Automático** y escribe **«¡Buenos días!»**, **«¿Cómo estás?»**, **«Muchas gracias»** o **«Hasta luego»**. Spyder contesta sin buscar documentos ni descargar un modelo. Puedes responder «Bien, ¿y tú?» si te pregunta cómo va tu día. Si escribes **«Hola, ¿cuánto es 7 + 3?»**, usa la calculadora; **«Hola, resume mis apuntes»** sigue siendo una petición de estudio. En **Tutor con fuentes**, decir «gracias» no interrumpe el tema si mantienes la misma selección.

Este chat sí entra en el respaldo académico. Para una charla personal separada, usa **✦ HABLAR**.

### Hablar con Spyder, sin abrir un libro

Pulsa **✦ HABLAR**. Prueba «Me preocupa mi examen de química» y elige **Solo escúchame** o **Un paso pequeño**. Puedes hablar de otra cosa, hacer una pausa o pasar al tutor sin enviarle la charla. En **Personalidad y memoria** eliges cómo quieres que te llame y si prefieres un tono cálido, práctico o curioso.

La charla es **temporal por defecto**. Puedes guardar una nota con tus propias palabras o elegir conservar los próximos 20 turnos como máximo en este navegador. Ni el perfil ni la charla personal se exportan con tu estudio. El acompañamiento funciona por reglas; Qwen local es opcional para conversación abierta. No es terapia ni un servicio de emergencias. [Cómo probarlo, retomar el hilo y borrarlo](docs/SPYDER_PERSONAL.md).

### Conversar sobre tus apuntes

Abre **3 · Asistente → Tutor con fuentes**, pulsa **Cargar demo** y envía **«¿Qué dicen los informes sobre la latencia?»**. Sigue con **«¿Por qué?»** o **Contrastar fuentes**: el tutor mantiene el tema, muestra las palabras de cada informe y explica por qué 12 ms y 40 ms no demuestran por sí solos una contradicción. Si añades un anexo, pulsa **Revisar conclusión** para ver qué pasaje cambia la lectura —o si no encontró evidencia distinta—. Funciona sin descargar modelos.

**Ponme a prueba** oculta las fuentes mientras intentas explicarlo. **Crear mi pregunta** permite llevar una cita exacta a **Mi repaso**. [Prueba paso a paso con el anexo de ejemplo, privacidad y límites](docs/TUTOR_CON_FUENTES.md).

### Practicar con tus apuntes

1. Abre **2 · Analizar → Tutor de estudio**. Elige un documento con texto; si no tienes uno cargado, pulsa **Cargar demo** en el propio tutor.
2. En **Recuerdo activo**, completa la palabra que falta. Puedes pedir una pista o pulsar **No lo recuerdo**. En **Explicación propia**, lee el pasaje, pulsa **Ocultar y explicar** y escríbelo con tus palabras.
3. **Comparar con la fuente** muestra la oración original y un enlace a su página. El recuerdo se comprueba por palabra, sin distinguir tildes ni mayúsculas. Para una explicación, **tú** decides si recogiste la idea: compartir palabras no prueba que sea correcta.
4. Tras uno a tres pasajes, puedes repetir solo los que necesitaron ayuda o añadirlos a **Tarjetas** para repasarlos otro día. La siguiente sesión del mismo libro y habilidad empieza por los pendientes. Puedes consultar el chat, la guía o la red y volver sin perder la respuesta en curso. No necesitas MiniLM ni Qwen.

El tutor guarda en este navegador **hasta 50 balances de prácticas terminadas**, no las respuestas escritas ni las prácticas abandonadas. **Respaldo** incluye esos balances; retirar el libro elimina su progreso del tutor. Si el navegador bloquea el almacenamiento, exporta el JSON antes de cerrar. La **Guía** conserva tus ediciones entre herramientas durante la sesión; descárgala como Markdown antes de recargar, quitar material o importar un respaldo.

### De un subrayado a una pregunta propia

Selecciona en el visor hasta **1.200 caracteres de una página** y pulsa **Subrayar · Crear mi pregunta**. Si usas teclado o no quieres arrastrar, pulsa el mismo botón y elige un pasaje completo. Comprueba la cita, escribe qué quieres recordar y pulsa **Guardar en Mi repaso**. Tu pregunta es el anverso y el fragmento literal, la respuesta. El plan puede mostrar **solo mis preguntas subrayadas** sin mezclarlas con las tarjetas automáticas; usa el mismo calendario. **Volver al subrayado** enfoca exactamente la selección, incluso si la frase se repite. El visor trabaja sobre el texto extraído (también OCR), no sobre la imagen del PDF.

El subrayado, la pregunta y el calendario FSRS viajan juntos en el respaldo. Para quitar una tarjeta, abre **Crear mi pregunta → Mis preguntas de esta página**. Cerrar el editor sin guardar no crea ninguna tarjeta.

### Organizar tu propio repaso

1. En **4 · Estudio → Mi repaso**, elige un documento o todos y un máximo de **3, 5 o 10 tarjetas**. Si aún no tienes suficientes, pulsa **Preparar**: solo añade las que faltan para ese cupo a partir de tus pasajes. También sirven las que guardaste desde el tutor.
2. Pulsa **Empezar repaso**, intenta recordar sin mirar (puedes escribir un borrador) y después **Mostrar respuesta**. Comprueba la cita. Si no la recordaste, marca **Otra vez**; si sí, elige **Difícil**, **Bien** o **Fácil** según el esfuerzo.
3. El balance indica qué conviene reforzar y cuándo volver. **Terminar por ahora** conserva las calificaciones ya dadas sin mover las fechas de las demás tarjetas. Al recargar se mantienen la meta y el calendario, no la cola ni tu intento escrito.

La biblioteca local **ts-fsrs** calcula la siguiente fecha de cada tarjeta; la sesión atiende los repasos vencidos antes de introducir tarjetas nuevas. Si no hay pendientes, muestra el próximo vencimiento. Cambiar de herramienta o consultar el anverso **no** cuenta como un repaso. Las fechas de los mazos antiguos no cambian hasta que calificas la tarjeta. La programación se basa en **tu valoración**, no en una prueba automática de comprensión. Funciona sin modelos ni conexión; el calendario viaja en **Respaldo** y los textos y citas todavía se pueden exportar a Anki.

### Enseñarle a la red qué estudiar junto

En la red, pulsa **Vínculos de estudio → Valorar vínculos**, o abre **Vínculos de estudio** después de revelar una tarjeta. Verás pasajes del mismo libro con términos afines. Al marcar **Vínculo útil** o **No útil**, un modelo local ajusta sus pesos y recalcula los próximos vecinos, **también para pares que no votaste**. La capa verde dibuja esas sugerencias; un enlace más grueso indica mayor afinidad, no certeza. No necesita MiniLM ni Qwen ni modifica sus pesos. Restablecer los vínculos de un documento no toca tus tarjetas. [Auditoría con un ejemplo antes/después que puedes repetir](docs/APRENDIZAJE_LOCAL.md).

### Girar la red de conceptos

Activa **Órbita 3D** en la barra de la red. Arrastra con el ratón o con un dedo para girar la esfera; también puedes usar las flechas del teclado o los botones de dirección. **+ / −** cambia el zoom; **Inicio** o **◎ Centrar red** restaura la orientación y el tamaño. Vuelve a pulsar **Órbita 3D** para salir al plano y recuperar el desplazamiento táctil normal sobre la red.

Un arrastre solo mueve la vista. Un clic o toque breve en un concepto abre su inspector y sus fuentes; en el fondo o en un centro conserva la orden de enviar arañas. La rotación es manual y funciona con animaciones reducidas. La profundidad sirve para explorar la red: **no mide la importancia ni el dominio de un tema**.

### Revisar si un ejercicio sirve para tu asignatura

En **Analizar → Revisión docente** hay seis preguntas con explicaciones adaptadas de *Programming with Python* de The Carpentries, con la procedencia de cada caso. Por ejemplo, para trabajar los **índices negativos**, ¿sirve ocultar «posiciones»? Compara el objetivo del curso con el hueco, las opciones del quiz y la pista que propone la app. Registra tu dictamen y cualquier orientación que falte. **Ningún caso viene marcado como validado.**

Desde **Procedencia y archivos del curso** puedes descargar el banco como plantilla e importar el de tu asignatura. **Descargar informe JSON** conserva los dictámenes y permite reabrirlos. No modifica las tarjetas ni califica las explicaciones de los alumnos. [Protocolo, formato y límites](docs/AUDITORIA_ESTUDIO.md#revisión-docente).

### Si un PDF no se lee

- Para comprobar el lector, elige **+ ARCHIVO** y abre [`pdf-cmap-multipagina.pdf`](tests/fixtures/pdf-cmap-multipagina.pdf): deben aparecer tres páginas y en la segunda «Hola mundo. こんにちは 日本語». También funciona al abrir `index.html` desde disco con la carpeta del proyecto completa; para la PWA y los modelos opcionales usa el servidor indicado arriba.
- Si tenías la aplicación instalada, vuelve a abrirla con conexión y recarga después de que se actualice. **No hace falta borrar los datos ni los libros.**
- Si aparece **«El PDF se abrió, pero no se encontró texto extraíble»**, intenta copiar una frase en tu visor habitual. Si la página es una imagen, abre **Documento → Leer un escaneo · OCR**, indica la página física inicial y elige el PDF. También admite imágenes PNG, JPEG y WebP. Un aviso de **contraseña** es distinto: en ese caso se necesita una copia sin contraseña.

El OCR en español usa un motor local de **7 MB**, solo si hace falta. Cada importación OCR admite hasta **64 MiB** y añade un tramo de hasta **12 páginas PDF** como documento independiente: conserva la capa de texto donde existe, intenta reconocer el resto y cita la página física original. Puedes cancelar y elegir otro tramo. Revisa el texto antes de estudiar, especialmente cifras y fórmulas. Para usarlo sin conexión en la PWA, úsalo una vez con el service worker activo, conexión y espacio de caché. Desde disco basta la carpeta completa del proyecto.

### Conversar con un personaje

1. Abre **Asistente** y elige **Conversación · personaje** en el selector de modo.
2. Sube el PDF de una novela o elige un libro ya cargado; también admite EPUB, TXT, Markdown y DOCX. Escribe el nombre del personaje tal como aparece en el texto extraído.
3. Saluda, pregunta por un tema de la obra o usa **Háblame de ti** y **¿Y después?**. Si hay un pasaje relacionado, su cita abre la página del libro; la continuación recorre el texto desde la última cita del mismo personaje y libro.

Por defecto funciona con **reglas y fragmentos literales**; opcionalmente puedes activar el generador local Qwen descrito abajo. Busca menciones del nombre y palabras cercanas solo en el libro elegido; puede no comprender una pregunta, confundir el contexto o revelar spoilers. Un pasaje puede ser narración o palabras de otra persona, no necesariamente diálogo del personaje. Ninguna ruta entrena el modelo con tu libro ni promete imitar fielmente su personalidad. Un PDF sin texto extraíble no se puede usar sin OCR.

Las respuestas de acompañamiento y crisis son frases básicas activadas por reglas muy limitadas: pueden pasar por alto situaciones importantes y no sustituyen ayuda profesional o de emergencia. El libro, el nombre y el historial se guardan en este navegador cuando hay almacenamiento disponible y pueden incluirse en respaldos JSON. **BORRAR** elimina el historial académico y de personajes, no los libros ni la charla separada de Spyder personal; quitar un libro tampoco elimina las citas que ya quedaron en el historial. Para retirar ambos, borra el chat y el libro o usa el reset completo. Los archivos de respaldo/exportación que hayas guardado aparte no se borran automáticamente.

### Generador de texto opcional: Qwen3

1. En **MODELO**, elige **DESCARGAR Y ACTIVAR QWEN**. Spyder descarga el archivo [Qwen3-0.6B-Q4_K_M.gguf de Unsloth](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/blob/main/Qwen3-0.6B-Q4_K_M.gguf) de una revisión fija de Hugging Face: **396.705.472 bytes (397 MB, ~378 MiB)**, más aproximadamente 2,5 MB del motor local. También puedes importar ese GGUF exacto desde tu dispositivo mediante el selector del panel.
2. La descarga puede tardar y requiere espacio libre, memoria adicional y un navegador moderno con WebAssembly, Cache Storage y service worker en HTTPS o localhost. El modelo se verifica por tamaño y SHA-256 antes de guardarse y otra vez al cargarlo. Si falta espacio, se interrumpe o falla la comprobación, Spyder avisa y no activa una copia parcial. Se puede cancelar y volver a intentar; la descarga del GGUF no es reanudable.
3. Cuando indique **Qwen activo**, abre **Conversación · personaje**, selecciona un libro, escribe el nombre y pregunta. Para usarlo en estudio, marca **Tutor con fuentes → Motor y privacidad → Añadir explicación de Qwen local**. En **HABLAR → Personalidad y memoria** hay una elección independiente para conversación cotidiana. La primera carga y cada respuesta pueden tardar bastante: el motor usa CPU monohilo, no GPU. Usa **DETENER** para cancelar una respuesta. Al desactivar o si hay un fallo, vuelven las reglas; se informa en la respuesta. **ELIMINAR QWEN** elimina su caché, no los libros ni MiniLM. Cierra las otras pestañas antes de eliminar o reinstalar, porque cada una mantiene su propio estado.

Qwen es un LLM pequeño: puede inventar datos, no seguir el personaje, responder en otro idioma o confundir el pasaje, y su calidad en español no está garantizada. El fragmento enlazado es contexto consultado, **no una comprobación ni necesariamente palabras del personaje**; en modo personaje, si no se encuentra un fragmento del tema, se avisa y puede responder sin fuente. En el tutor, no se pide generación si no hay citas pertinentes. Las respuestas generadas se etiquetan como tales. Las reglas limitadas de crisis se ejecutan antes del generador y no constituyen asistencia de emergencia.

Los fragmentos del libro, preguntas e historial usados en el prompt se procesan en este dispositivo, no se envían a Hugging Face. Al descargar, el navegador sí contacta a Hugging Face y a su infraestructura de archivos/redirecciones; el proveedor puede recibir metadatos de conexión. Después de instalar y verificar el modelo y el shell, pueden usarse sin conexión. El navegador podría borrar la caché por presión de almacenamiento. Los libros y el historial académico pueden persistir en IndexedDB y en el respaldo JSON; los pesos no se incluyen en ese respaldo. Código y licencias en [`vendor/NOTICE.md`](vendor/NOTICE.md) y [`models/qwen3/LICENSE`](models/qwen3/LICENSE).

### Encoder semántico opcional

1. Pulsa **MODELO** y después **DESCARGAR Y ACTIVAR**. Se descargan aproximadamente **42 MiB (44 MB)** desde la misma instalación de la aplicación, no desde un CDN ni una API de IA. El shell no descarga esos archivos automáticamente.
2. La ventana muestra el avance y cuántos pasajes se han indexado. Durante la indexación el chat sigue usando la búsqueda interna y los vectores que ya estén listos. Mantén activada la **búsqueda híbrida vectorial** en Ajustes para utilizar el modelo.
3. Cuando el modelo está descargado y el service worker controla la página, también se puede usar sin conexión. Sus vectores se mantienen en memoria y se reconstruyen al abrir la aplicación; un corpus grande puede tardar y consumir CPU/memoria. El navegador puede borrar su caché si necesita espacio.
4. **DESACTIVAR** detiene la inferencia; **ELIMINAR DESCARGA** borra sus archivos del almacenamiento de este navegador sin borrar tus documentos. Cierra otras pestañas de la aplicación antes de borrarlos: pueden conservar el modelo en memoria o volver a descargarlo. El respaldo JSON de tu conocimiento es independiente y no incluye los pesos del modelo.

El modelo `all-MiniLM-L6-v2` es un encoder de embeddings de 384 dimensiones, entrenado principalmente en inglés. Ayuda a encontrar y ordenar pasajes relacionados, pero **no genera texto** y su rendimiento en español puede variar. La búsqueda normal y las funciones de estudio siguen disponibles sin él. Consulta [`models/minilm/README.md`](models/minilm/README.md) y [`vendor/NOTICE.md`](vendor/NOTICE.md) para procedencia y licencias.

### Fragmentos, temas y arañas

- El índice utiliza ventanas solapadas centradas en cada oración: normalmente dos o tres oraciones, sin cruzar sección ni página interna o física de PDF. El título de sección se incluye en el texto que recibe MiniLM. El visor conserva las oraciones originales y las citas conservan su ancla y página PDF. Una oración aislada sigue siendo un fragmento válido.
- Con MiniLM activo y **búsqueda híbrida vectorial** habilitada, la red agrupa por similitud de sus vectores en hasta cuatro temas, más un grupo sin afinidad cuando hace falta. Los botones **T1…** filtran la red y el texto en la cabecera indica cuántos vectores están listos. Los nombres usan palabras frecuentes y son orientativos; los grupos dependen del corpus y pueden cambiar al reconstruirse. Los puntos de conceptos aparecen a medida que las arañas cosechan. Los roles de los agentes DEF/CAUSAL/QUANT/SYNTH son independientes de los temas. Sin vectores, la red indica que muestra la vista por agente, no temas semánticos.
- Al hacer una pregunta de estudio o redacción con resultados, el enjambre intenta enviar hasta tres arañas libres a los pasajes recuperados con señal MiniLM suficiente. Si el encoder no aporta señal o falla, se indica **Guía local** y se usan los resultados de la búsqueda interna. La cola es temporal, no inventa fuentes y respeta pausa, visibilidad, reservas y navegación AUTO; una nueva pregunta reemplaza la cola anterior sin interrumpir tareas ya en curso. Los comandos directos, el muestreo global, el tutor conversacional y el modo personaje no realizan esta guía MiniLM.
- En los modos de estudio, **SÍ/NO** guarda la valoración de las fuentes citadas, o las consultadas si no hay citas válidas. Ajusta de forma acotada el orden de candidatos de consultas similares y, mientras MiniLM está activo, el de otros pasajes de los mismos temas. No crea resultados nuevos. Las valoraciones se guardan con IDs de fuente, no con nombres de temas; al quitar un documento se eliminan sus referencias. Ni el tutor conversacional ni el modo personaje registran estas valoraciones.

Los filtros siguen aplicándose al contexto y las citas; una ventana con vecinas excluidas se recorta y su vector original no se usa como evidencia. La primera consulta con una exclusión puede reconstruir un índice temporal y consumir tiempo y memoria en corpus grandes; se reutiliza solo la proyección más reciente. MiniLM trunca las entradas a 256 tokens y ni la similitud ni los nombres de los grupos garantizan relevancia.

## Qué incluye

- **Arañas:** de una a cinco arañas articuladas alternan apoyos al caminar, frenan y giran antes de cambiar de dirección. Recorren hasta 18 palabras de cada pasaje y transportan una cápsula que acompaña sus movimientos hasta el nodo correspondiente. Las arañas libres alternan recorridos por toda la pantalla con un masaje visual a los nodos de conceptos visibles, incluso mientras otra analiza un pasaje; respetan el filtro de la red y reajustan las seis patas de apoyo por turnos, sin deslizar los pies que permanecen apoyados. La transición desde y hacia la marcha es gradual. Cuando no hay nodos visibles siguen paseando y, ocasionalmente, tejen telarañas efímeras. Una araña con pasaje reservado se mueve mientras espera que quede libre el visor, sin simular otra lectura ni desplazar el texto. Ni el masaje, los hilos ni la espera visual crean patrones, reservas o métricas; el trabajo real tiene prioridad. La pausa y el movimiento reducido detienen estas animaciones decorativas.
- **Red interactiva:** la reina NC-00 permanece anclada, sigue el puntero por la ventana con la cabeza y gira el cuerpo sobre el mismo punto. Las ocho patas flexionan sus articulaciones: cuatro tiran de sus hilos y las otras reajustan el apoyo por turnos, con un movimiento más visible también en móvil. En dispositivos táctiles mira hacia el último toque. Emite una onda al asignarse trabajo real y los destellos apuntan únicamente a las arañas de ese despacho. La reina, la telaraña y las partículas son elementos visuales, no datos cosechados. Haz clic o pulsa Enter sobre la red para enviar hasta tres arañas libres a pasajes reales, sin interrumpir sus tareas. Los nodos de conceptos mantienen su inspector y sus citas. Pausa o activa **Reducir animaciones** en Ajustes para congelar la mirada y detener o simplificar el movimiento.
- **Recuperación híbrida:** ventanas solapadas, índice invertido BM25, normalización y raíces en español, bigramas, corrección básica de erratas, diversificación MMR y una proyección vectorial local combinada mediante RRF y coseno. Con el modelo opcional se añade un ranking de embeddings ONNX. Filtros: `=doc:nombre`, `=pag:2`, `"frase exacta"` y `-excluir`.
- **Respuestas con fuentes:** modos automático, resumen, examen, socrático, crítico, redacción, tutor con fuentes y conversación por personaje. Se puede abrir cada cita en el documento; las valoraciones de estudio ajustan de forma acotada las fuentes valoradas y, con MiniLM, sus temas. El modo crítico señala *posibles* discrepancias, no pruebas definitivas.
- **Analizar:** tutor local de recuerdo activo y explicación propia junto a la red, y revisión docente de ejercicios.
- **Estudio:** guía editable, Mi repaso por documento y tarjetas con repetición espaciada FSRS, exportación CSV para Anki, quiz con puntuación y temporizador opcional, bóveda de conocimiento y evaluación del motor de búsqueda.
- **Persistencia académica:** documentos indexados, grafo, memoria de estudio, chat académico y de personajes, valoraciones y progreso en IndexedDB, con respaldo JSON e importación validada. Si IndexedDB no está disponible se intenta usar localStorage, sujeto a su cuota. Los datos pertenecen al navegador y al origen desde el que se abrió la aplicación; exporta un respaldo antes de limpiar sus datos.
- **Formatos:** texto, Markdown, código, CSV, SRT/VTT (texto con intervalo de tiempo), HTML, PDF con texto o por OCR optativo, DOCX, PPTX, XLSX y EPUB. PDF.js, Mammoth, JSZip y D3 están empaquetados localmente.

## Límites importantes

- El compositor predeterminado es **extractivo y basado en reglas**; Qwen puede interpretar personajes, añadir una explicación opcional al tutor o conversar en Spyder personal. No verifica citas ni ofrece atención profesional. La proyección vectorial incluida por defecto tampoco es un modelo neuronal. El encoder ONNX opcional mejora la búsqueda en algunos casos, pero no garantiza relevancia ni corrige por sí solo la redacción; se avisa cuando se utiliza una fuente seleccionada solo por similitud semántica. Los resúmenes generales usan una muestra de pasajes, no una lectura exhaustiva de documentos grandes.
- La comprobación de citas verifica el número de fuente y un solapamiento léxico básico; **no verifica la verdad de una afirmación**. Revisa siempre la fuente y las posibles contradicciones.
- La evaluación generada desde el propio corpus es una línea base potencialmente optimista. El conjunto de prueba incluido es pequeño y no garantiza resultados en otros temas. La demo es material sintético, no una medición científica.
- No se incluye transcripción automática de audio ni traducción automática. Para estudiar un vídeo, importa sus subtítulos SRT/VTT o pega una transcripción. Si un PDF no devuelve texto, también puede deberse a páginas vacías o a fuentes/codificaciones no compatibles, no necesariamente a un escaneo. Los PDF protegidos por contraseña deben abrirse y guardarse sin contraseña antes de importarlos. La importación normal procesa como máximo las primeras 500 páginas PDF y se avisa si la lectura es parcial o si alguna página no devuelve texto; las citas y el filtro `=pag:` usan el número de página PDF original. El lector, sus CMaps y sus fuentes son locales y quedan disponibles offline tras instalar el shell. El respaldo nativo anterior no se usa porque no conservaba páginas ni podía garantizar la codificación. El soporte XLSX extrae valores almacenados, no calcula fórmulas. Los archivos de imagen/vídeo pueden visualizarse durante la sesión, pero sus originales no se incluyen en el respaldo JSON y deben volver a seleccionarse tras recargar.
- La importación de URL, el reconocimiento de voz del navegador y el antiguo endpoint PHP se retiraron para mantener la ruta independiente y evitar envíos de datos. No se incluye un modelo generativo WebLLM ni un servidor de modelos.

## Pruebas y rendimiento

Para ejecutar las pruebas de desarrollo se necesita Node.js 20+ y una instalación inicial de las dependencias de prueba:

```bash
npm ci
npm test
npm run bench -- 20000
```

Con Google Chrome instalado, `npm run test:browser` comprueba el lector PDF, OCR sobre píxeles reales, el tutor conversacional con revisión de evidencia, el tutor en Analizar, la revisión docente, Mi repaso offline, gestos de órbita (ratón, teclado y táctil emulado), Spyder personal (nota, hilo opcional, borrado) y los respaldos desde la interfaz. Incluye archivo local, vista previa aislada y una PWA bajo subruta con el servidor apagado. `npm run test:pdf-browser` ejecuta solo las pruebas del lector. Para usar otro ejecutable de Chromium, indica su ruta en `CHROMIUM_PATH`.

El benchmark mide la búsqueda determinista sobre oraciones sintéticas repetitivas, **sin** construcción de ventanas ni inferencia ONNX; no garantiza la misma latencia en otros dispositivos o documentos. El set dorado contiene 72 preguntas con respuesta y 8 preguntas trampa sobre 24 pasajes. La vista **Estudio → Métricas** evalúa el corpus cargado e incluye la inferencia del modelo cuando está activo y ha terminado de indexar.

- [`docs/AUDITORIA_ESTUDIO.md`](docs/AUDITORIA_ESTUDIO.md): habilidades verificadas, fallos reproducidos, funcionamiento y límites del tutor.
- [`docs/IMPLEMENTACION_V11.md`](docs/IMPLEMENTACION_V11.md): implementación, resultados y trabajo no incluido.
- [`docs/AUDITORIA_Y_PLAN.md`](docs/AUDITORIA_Y_PLAN.md): auditoría histórica y plan original.
- [`tests/bench-bm25.js`](tests/bench-bm25.js): comparación histórica con el motor anterior.
