# all-MiniLM-L6-v2 (ONNX cuantizado)

- Modelo original: [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), encoder de oraciones en inglés, declarado **Apache-2.0** en su ficha.
- Exportación ONNX: [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2), declarada **Apache-2.0** en su ficha. Una copia del texto de la licencia se encuentra en `LICENSE`.
- Procedencia de los archivos incluidos: paquete npm [`plugin-embed-web-client@1.1.12`](https://registry.npmjs.org/plugin-embed-web-client/-/plugin-embed-web-client-1.1.12.tgz), ruta `public/models/Xenova/all-MiniLM-L6-v2/`. Solo se incluyen los pesos, la configuración y el tokenizer, no el resto del paquete.
- El archivo `onnx/model_quantized.onnx` ocupa 22.972.370 bytes. Su SHA-256 es `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`, idéntico al [publicado para ese archivo de Xenova](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/main/onnx/model_quantized.onnx) (revisión del archivo `da5f6eac91a9596269707e15ec694e50e25a0d14`). Los JSON y el tokenizer proceden del paquete npm indicado; no se afirma aquí que sean idénticos byte a byte a los del repositorio original.

El modelo solo produce embeddings de 384 dimensiones; **no es un modelo de generación de texto**. La aplicación descarga estos archivos únicamente desde su propio origen, si el usuario lo solicita, y desactiva la carga de modelos remotos. La ficha original indica que está destinado a frases y párrafos cortos; en esta implementación los textos se truncan a 256 tokens.

Las longitudes y los hashes de los recursos opcionales están en `js/local-model.js`. `.gitattributes` conserva sus bytes originales también en sistemas que convierten finales de línea. Al actualizar estos recursos hay que actualizar el manifiesto y cambiar el nombre de la caché de modelo de forma coordinada en `js/local-model.js`, `js/onnx-worker.js` y `sw.js`.
