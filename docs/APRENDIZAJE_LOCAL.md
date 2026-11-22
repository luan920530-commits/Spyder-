# Qué aprende la red de Spyder

**No era solo un archivo de recuerdos, pero el movimiento de la esfera tampoco demostraba aprendizaje.** Esta comprobación separa lo que se guarda, lo que modifica una decisión y lo que únicamente se dibuja.

| Antes de los vínculos de estudio | Comprobación |
|---|---|
| Documentos, citas, historial y «Aprende que…» | Se recupera información guardada. Recordar una nota no modifica por sí solo los pesos de un modelo. |
| Cosecha de las arañas | `learnFromPattern` aumenta pesos de términos; `scoreSentenceForSpider` los consulta para elegir otros pasajes. El auxiliar cuenta coapariciones y transiciones; `NeuralStore.search` puede usar los términos asociados para expandir consultas. [Arañas](../js/spiders.js) · [Auxiliar](../js/kimi-aux-model.js) |
| «Respuesta útil / poco útil» del asistente documental | `recordFeedback` refuerza o penaliza nodos y fuentes; la búsqueda reordena **candidatos con evidencia** antes del corte. La [prueba de persistencia](../tests/persistence.test.js) reproduce un cambio del primer resultado. Con MiniLM activo hay, además, ajuste por tema. Esto no reentrena el encoder. |
| Grafo y esfera | `addLink` no reforzaba una arista repetida: conservaba la existente. Las ramas de cosecha y las agrupaciones por similitud no aprendían qué pasajes le servía estudiar juntos a una persona. Los arcos de Canvas, los movimientos y el contador de experiencia no son ejemplos de entrenamiento. |

## Qué cambia ahora

En **Vínculos de estudio** se sugieren hasta tres pasajes del **mismo documento**. Se comparan las oraciones originales, no las ventanas solapadas del buscador. Sin términos afines no se propone un enlace. Puedes abrir cada fuente, ver por qué apareció y marcar **Vínculo útil** o **No útil**. Las mismas recomendaciones están en el inspector de la red y tras mostrar la respuesta de una tarjeta.

El [modelo](../js/passage-links.js) es una **neurona logística de cuatro pesos por documento**. Sus entradas son un sesgo, el solapamiento normalizado de raíces léxicas y dos señales de ubicación (misma/distinta página y sección). Inicialmente usa pesos fijos. Ante una etiqueta `y` (0 o 1), calcula `p = sigmoid(w · x)` y actualiza cada peso con `0,65 × (y − p) × x`, acotándolo a `[-4, 4]`. Los parámetros **se comparten entre pares**: no hay un bono por reconocer el ID ya votado. Por eso puede cambiar la preferencia entre dos pasajes distintos del ejemplo. La capa verde del [grafo](../js/neural-graph.js) usa esa puntuación tanto para elegir vecinos como para el grosor y la fuerza de sus enlaces. No crea cosechas ficticias.

Se conservan los **últimos 256 pares valorados entre todos los libros**, con ID de documento, dos anclas y una etiqueta; no una copia de los textos. Repetir el mismo voto no multiplica su efecto. Al corregirlo, restaurar o recargar, se recalculan los pesos desde los ejemplos vigentes, en orden. El índice de términos se construye al consultar el libro y se mantienen como máximo tres índices en memoria. En cada sugerencia se muestrean hasta 24 candidatos por cada uno de ocho términos (menos frecuentes primero), no todas las combinaciones de un libro.

**Qué no se usa como etiqueta:** abrir una fuente, girar la esfera, escribir el intento privado, calificar el recuerdo con FSRS o conversar con un personaje, con el [tutor documental](TUTOR_CON_FUENTES.md) o con [Spyder personal](SPYDER_PERSONAL.md). Los votos de vínculo no alteran el calendario ni las respuestas del chat. No se modifican los pesos de Qwen ni los de MiniLM. La afinidad no es una medida de verdad ni de comprensión.

### Hilos ámbar de las cosechas

Desde el shell 32, la red también dibuja afinidades automáticas entre **nodos ya cosechados**, incluso de libros distintos. Son independientes de este clasificador verde: requieren al menos dos raíces compartidas y conservan dos citas concretas. Se reconstruyen localmente y no se guardan como votos ni modifican los pesos del modelo de estudio. Un voto explícito **No útil** sí excluye esa pareja concreta de las afinidades ámbar; un voto útil permite volver a considerarla si sigue cumpliendo el umbral, pero no garantiza su selección. Compartir palabras puede enlazar frases contradictorias y no demuestra comprensión. [Algoritmo, límites y ejemplo de programación](IMPLEMENTACION_V11.md#afinidades-automáticas-de-cosecha-shell-32).

## Prueba reproducible sin consola ni modelos

Desmarca **AUTO** y pega lo siguiente como un documento nuevo. Los títulos separan las tres páginas:

```text
# Uno
Atlas incluye luna blanca. Atlas indica clima frío.
# Dos
Lago contiene agua dulce. Lago tiene peces rojos. Atlas registra canto largo.
# Tres
Lago cubre rocas grises.
```

1. En la **página 2**, activa **Vínculos de estudio → Valorar vínculos**. Para «Lago contiene agua dulce», observa el primer vecino. No votes. Cierra el inspector y desactiva **Vínculos de estudio**.
2. En la **página 1**, vuelve a activar los vínculos. Para «Atlas incluye luna blanca», marca **No útil** junto a «Atlas indica clima frío». La línea se adelgaza y cambia el primer vecino.
3. Recarga. En la **página 2**, abre **Subrayar · Crear mi pregunta** sin seleccionar texto, elige «Lago contiene agua dulce» y escribe «¿Qué contiene el lago?». Guarda, empieza **Mi repaso**, muestra la respuesta y despliega sus **Vínculos de estudio**. Ahora el primer vecino es otro, aunque **ningún par de “Lago” recibió un voto**.

| Candidato para «Lago contiene agua dulce» | Afinidad inicial | Tras el voto sobre «Atlas» |
|---|---:|---:|
| «Lago tiene peces rojos» (misma página) | **57/100** | 31/100 |
| «Lago cubre rocas grises» (otra página) | 41/100 | **49/100** |

Son puntuaciones redondeadas en este ejemplo controlado, **no porcentajes de acierto**. **Restablecer vínculos de este documento** deshace la adaptación sin borrar tarjetas ni material. Eliminar el documento retira sus preguntas subrayadas, votos e índice derivado; un respaldo válido permite reconstruirlos. Esto no equivale a borrar conversaciones anteriores ni a restar selectivamente coapariciones del auxiliar histórico, que son agregados globales. Usa el reset completo si quieres retirar todo el cerebro local.

## Qué se probó

- [Lógica y persistencia](../tests/passage-links.test.js): cambio de pesos y de orden en pares no vistos, efecto en el sentido contrario con un voto positivo, dos libros con igual nombre, límite de ejemplos, corrección, migración sin ejemplos, importación inválida sin reemplazar datos y retirada del documento. Citas con Unicode, dos oraciones y subrayados solapados.
- [Chromium](../tests/browser/questions-links.test.cjs): arrastre sobre la segunda aparición de una frase repetida, tarjeta FSRS y vuelta a **esa aparición** desde otro libro en una PWA con el servidor apagado. Desde disco, se observó el cambio en la línea D3 y en la recomendación después de recargar. En vista aislada, se creó una pregunta con teclado y se restablecieron las sugerencias sin perder la tarjeta.

Esto demuestra que una interacción cambia una decisión posterior del programa. **No demuestra** que las sugerencias sean siempre pertinentes ni que mejoren el aprendizaje de un estudiante; eso requeriría evaluación con lectores y material de curso.
