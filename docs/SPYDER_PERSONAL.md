# Spyder personal: hablar ahora, retomar otro día

Pulsa **✦ HABLAR** en la barra superior. También puedes abrir **Spyder personal ↗** desde el espacio de estudio. No necesitas un libro, una cuenta ni descargar un modelo. Es un asistente virtual con un estilo de conversación propio, no un personaje de una novela.

Los saludos, preguntas como «¿cómo estás?», agradecimientos y despedidas también funcionan en **3 · Asistente → Automático**. Allí no se usa tu nombre ni tu nota personal, y lo que escribes se guarda con el estudio.

### Prueba una conversación

1. Escribe **«Me preocupa mi examen de química»**. Spyder te pregunta si prefieres que te escuche o pensar en un paso pequeño.
2. Pulsa **Solo escúchame** y escribe **«Temo quedarme en blanco»**. Sigue hablando de esa preocupación sin ponerte a estudiar ni calificar tu respuesta.
3. Si ahora quieres actuar, pulsa **Un paso pequeño**. En este ejemplo propone ensayar en voz alta **una pregunta** del examen. Si prefieres parar, elige **Una pausa** o **Cambiar de tema**.
4. Para trabajar con evidencia, pulsa **Tutor con fuentes ↗**; para practicar tarjetas, **Mi repaso ↗**. Tú eliges el material allí: Spyder no copia la confidencia ni la convierte en una fuente o una tarjeta. Al volver a **HABLAR** en la misma pestaña, el hilo sigue ahí.

No tienes que estar pasando por un mal momento para usarlo. Prueba «Ayúdame a elegir entre caminar y leer» o «Tengo que preparar mi proyecto de acuarela» → «Solo tengo 15 minutos». En el segundo caso, propone 3 minutos para escoger un resultado, 9 para intentarlo y 3 para anotar el siguiente paso. No programa una alarma ni trabaja en segundo plano.

### Qué persiste y qué no

| Qué eliges | Qué pasa en este navegador |
|---|---|
| **Solo hablar** (por defecto) | Hasta 20 intercambios recientes en la pestaña. Cerrar el panel permite volver; recargar o cerrar la pestaña descarta el hilo temporal. No se añade al chat académico. |
| **Personalidad y memoria → Guardar perfil** | Conserva cómo quieres que te llame, el estilo **cálido y sereno**, **breve y práctico** o **curioso y reflexivo**, y **una nota editable**. No deduce un perfil emocional de lo que dices. |
| **«Recuerda que quiero ensayar mi presentación»** | Ofrece **Revisar la nota**. Aún es un borrador; solo **Guardar perfil** sustituye la nota anterior. Otro día, pulsa **Retomar mi nota**. |
| **Conservar los próximos turnos** | Empieza un hilo vacío, **sin copiar** la conversación temporal. Conserva hasta 20 intercambios personales en este origen si el navegador permite guardarlos. Puedes **Retomar el hilo** al volver. Los turnos que abren la ayuda urgente y su seguimiento inmediato no se escriben en el historial. Eso no significa que se detecte todo el contenido sensible. |
| **Borrar mi charla** / **Olvidar perfil y charla** | La primera borra los turnos y deja el perfil; la segunda borra además la nota, el nombre y las preferencias personales. Desactivar la conservación también borra el hilo guardado. Ninguna de estas acciones borra tus libros. |

**Local no significa secreto:** alguien con acceso al mismo navegador podría leer lo guardado. Spyder no cifra este registro con una contraseña. Si guardas el hilo, lo que escribiste puede seguir en mensajes antiguos aunque edites la nota: para quitar ambas cosas, usa **Olvidar perfil y charla**. Usa una pestaña a la vez; las copias ya abiertas no se sincronizan entre sí. Si no se puede confirmar la escritura, la interfaz avisa: no cuentes con recuperar el cambio al recargar.

El **respaldo JSON de estudio no contiene el perfil ni la charla personal**; tampoco los sustituye al importar. **BORRAR** en el chat académico no los elimina. El **RESET** global sí los borra, incluso si se conservan ajustes. Borrar los datos del sitio o cambiar de navegador puede dejarte sin la nota: no hay cuenta ni sincronización en la nube.

### Personalidad y límites del motor

Sin modelo, Spyder usa reglas de conversación en español: retoma palabras del hilo, distingue escuchar de proponer una acción y adapta preguntas y planes al tono que elegiste. Puede repetir una respuesta o no entender una expresión. No tiene sentimientos, no aprende a razonar entrenándose con tu intimidad y no tiene las capacidades de un modelo grande.

Para conversación abierta de texto, puedes activar el **Qwen3-0.6B** opcional desde **MODELO** y después marcar **Usar Qwen local en conversación cotidiana** en el perfil. Abrir **HABLAR** o los ajustes **no inicia la descarga**. Las respuestas generadas se identifican como tales. El modelo recibe el tono, el mensaje actual y hasta dos intercambios cotidianos consecutivos que ya usaron Qwen; no recibe automáticamente tu nota, nombre, libros, bóveda ni el chat del tutor. Los planes guiados y las rutas de apoyo reconocidas siguen por reglas. Si falla la generación, puedes seguir sin modelo. **Detener** cancela el turno sin añadir una respuesta tardía.

**El apoyo es conversacional, no clínico.** Spyder no diagnostica, no recomienda medicación y no contacta a nadie. **Ayuda urgente** está visible incluso durante la generación: orienta hacia emergencias de la localidad y una persona de confianza, sin pedir la dirección ni depender de que el programa reconozca una frase. Ni las reglas ni el modelo pueden evaluar de forma fiable si alguien está a salvo.

### Qué se comprobó

- [Reglas y contexto](../tests/companion.test.js): estilos diferentes, seguimiento del examen, petición de escucha, plan ajustado al tiempo, cambio de tema, memoria y límites.
- [Interfaz y datos](../tests/companion-dom.test.js): IndexedDB, localStorage y falta de cuota, nota revisada, consentimiento hacia adelante, restauración y olvido, exclusión del respaldo y cancelación de salidas tardías. La ruta Qwen se probó **con un generador controlado**; no se midió la calidad de este diálogo con pesos GGUF reales.
- [Chromium](../tests/browser/companion.test.cjs): PWA móvil instalada y recargada **con el servidor apagado**, archivo local sin red, y vista aislada sin permisos de almacenamiento. Se comprobaron el paso al tutor sin trasladar la charla, la nota conservada después de recargar y su desaparición después de olvidarla. Son pruebas de funcionamiento, no de eficacia clínica.
