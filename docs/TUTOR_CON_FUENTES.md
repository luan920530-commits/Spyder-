# Estudiar conversando con Spyder

Abre **3 · Asistente → Tutor con fuentes**. Puedes trabajar con un libro o con toda tu biblioteca. No necesitas una cuenta, MiniLM ni Qwen. A diferencia de **Analizar → Tutor de estudio**, que propone ejercicios, este chat parte de una pregunta que tú eliges.

## Prueba una conversación que pueda cambiar de conclusión

1. Pulsa **Cargar demo**, deja seleccionado **Toda mi biblioteca** y envía **«¿Qué dicen los informes sobre la latencia?»**. Spyder encuentra un pasaje con **12 ms** y otro con **40 ms**. No concluye que un informe refute al otro. Pulsa **Contrastar fuentes**: en los pasajes elegidos aparecen «latencia de inferencia» y «latencia de consulta». Que dos cifras estén en milisegundos no demuestra que se midiera lo mismo.
2. Pregunta **«¿Por qué?»** o **«¿Qué evidencia falta?»**. No tienes que repetir «latencia». La respuesta conserva el tema y separa la lectura provisional, las citas literales y lo que haría falta comprobar.
3. Crea un archivo de texto `Anexo.txt` con esta oración de ejemplo: **«Las mediciones de 12 ms y 40 ms se obtuvieron con cargas diferentes.»** Pulsa **Añadir documento** y elígelo. La respuesta anterior no se reescribe. Si vuelves a pedir una justificación, Spyder explica esa lectura; eso no consume la incorporación pendiente.
4. Pulsa **Revisar conclusión**. Ahora verás **Lectura anterior**, **Qué ha cambiado** y el pasaje del anexo marcado como incorporado. El anexo atribuye las cifras a cargas distintas: **si se refiere a las dos pruebas anteriores**, no conviene comparar los resultados como si fueran intercambiables. Usa **Ver en la fuente** para comprobarlo en la página exacta. Si revisas otra vez sin evidencia distinta, el tutor te lo dice.

La demo y el anexo son **material sintético para probar el recorrido**, no resultados experimentales. Puedes repetirlo con otros apuntes: por ejemplo, una definición en un manual y una nota que limite su uso a ciertos casos. Si el material no trata lo que preguntas, el tutor debe reconocer que no encontró apoyo, no completar el hueco con un dato inventado.

## Del diálogo al estudio

- **Ponme a prueba** propone una pregunta sobre el hilo y oculta la lectura y sus fuentes hasta que abras **Comparar mi explicación con las fuentes**. El borrador de ese recuadro no se guarda, no se envía a un modelo y no recibe nota automática.
- **Crear mi pregunta** junto a una cita abre el editor. Comprueba el fragmento, ajusta la pregunta y decide si guardarla en **Mi repaso**. La respuesta de la tarjeta es el texto original, no la interpretación de Spyder ni la explicación de un modelo. Abrir una cita o practicar en el chat no mueve las fechas FSRS.
- Para cambiar de tema, escribe una pregunta con su propio asunto. El selector limita por **identidad de documento**, no por el título del libro abierto en el visor. Con **Toda mi biblioteca** puedes contrastar documentos. Siguen disponibles `=doc:nombre`, `=pag:12`, `"frase exacta"` y `-excluir`. Para cambiar filtros, escribe el tema y los filtros juntos.

## Qué recuerda y qué no

El hilo retoma el **último turno de estudio del tutor en la misma selección**. Un saludo o agradecimiento en ese mismo tutor no se usa como fuente ni corta el hilo. Conserva el tema, las referencias y la posición del índice al consultar. Cada cita guarda documento, oración, página del visor, página de origen cuando existe y desplazamiento UTF-16 dentro de la oración original. Antes de justificar o revisar, vuelve a cotejar el texto con la fuente. El historial, la Bóveda y las palabras generadas por Qwen **no son evidencia**.

Añadir apuntes amplía lo que puede consultar; no reentrena a un modelo. La lectura sin Qwen usa términos, expresiones y unidades reconocibles, con hasta **cuatro citas de 500 caracteres**. No es una lectura exhaustiva: puede no entender una reformulación, no enlazar un anexo o no detectar un contraejemplo. Reconocer una cita exacta comprueba **dónde lo dice**, no **si es cierto**. Los [vínculos que sí se aprenden de votos](APRENDIZAJE_LOCAL.md) son un mecanismo diferente.

Qwen es optativo también **si ya está instalado**: actívalo desde **MODELO** y marca **Tutor con fuentes → Motor y privacidad → Añadir explicación de Qwen local**. Recibe la pregunta, el tema, los pasajes seleccionados y la lectura provisional; no recibe el chat entero. Su explicación se rotula por separado porque puede equivocarse. No interviene sin fuentes ni en **Ponme a prueba**. Si falla, quedan las citas y la lectura por reglas; **DETENER** cancela el turno en curso.

El chat se guarda en este navegador si hay almacenamiento y entra en el respaldo JSON (hasta 200 turnos; la vista restaura los últimos 30). Lo que escribes en la **caja de chat** sí forma parte del historial. Quitar un documento deja sus citas en los mensajes históricos, marcadas como no disponibles y sin salto ni creación de tarjeta. **BORRAR** elimina el chat académico y de personajes, no los libros, las tarjetas guardadas ni el hilo separado de [Spyder personal](SPYDER_PERSONAL.md). No borra respaldos que ya descargaste.

## Cómo se comprobó

- [Motor y casos contrarios](../tests/study-dialogue.test.js): dos cifras, métodos distintos o en común, anexos discordantes, salvedades cualitativas, seguimiento sin material nuevo, filtros, citas obsoletas y posiciones en texto largo.
- [Integración DOM y persistencia](../tests/dialogue-dom.test.js): demo real de la app, borrador no exportado, reabrir IndexedDB, sustituir el literal manteniendo el ID, fallo/cancelación del generador y reset durante la lectura de un anexo. **La integración nueva con Qwen se prueba con un generador de prueba**, no mide la calidad de sus explicaciones.
- [Recorridos en Chromium](../tests/browser/dialogue.test.cjs): PWA sin servidor hasta guardar y abrir la tarjeta, biblioteca móvil desde disco sin red y chat en una vista aislada sin permisos de formularios ni modales del navegador. Son pruebas de comportamiento, no una medición del aprendizaje del estudiante.
