# Componentes incluidos localmente

Estas bibliotecas se distribuyen con la aplicación para que no requiera CDN en tiempo de ejecución. Sus archivos de licencia se conservan en las carpetas correspondientes.

| Componente | Versión | Uso | Licencia |
|---|---:|---|---|
| Tesseract.js-core (LSTM sin SIMD) | 6.1.2 | OCR opcional en un worker | Apache-2.0, `ocr/LICENSE`; licencias de los componentes nativos en `ocr/notices/` |
| tessdata_fast · español | `87416418657359cb625c412a48b6e1d6d41c29bd` | Pesos LSTM para texto impreso | Apache-2.0, `ocr/TESSDATA-LICENSE` |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 5.4.2 (algoritmo FSRS-6) | Próxima revisión de cada tarjeta | MIT, `fsrs/LICENSE` |
| [Recogito Text Annotator](https://github.com/recogito/text-annotator-js/tree/0d375b0cba2bf68378f1f6dff30ee8812df95c0c) | 4.3.7 | Adaptación de `rangeToSelector` en `js/highlights.js`; no se distribuye el editor ni sus dependencias | BSD-3-Clause, © 2023 Rainer Simon, [licencia original](recogito/LICENSE) |
| D3.js | 7.9.0 | Grafo interactivo | ISC, `d3/LICENSE` |
| JSZip | 3.10.1 | Respaldo de descompresión ZIP | MIT / GPLv3, `jszip/LICENSE.markdown` |
| Mammoth | 1.8.0 | Extracción de DOCX | BSD-2-Clause, `mammoth/LICENSE` |
| PDF.js (distribución legacy) | 4.2.67 | Extracción de PDF con texto | Apache-2.0, `pdfjs/LICENSE` |
| CMaps de Adobe (distribuidos con PDF.js) | 4.2.67 | Mapas de caracteres PDF | BSD-3-Clause, `pdfjs/cmaps/LICENSE` |
| Fuentes estándar de Foxit y Liberation (distribuidas con PDF.js) | 4.2.67 | Fuentes de respaldo PDF | BSD-3-Clause y SIL OFL 1.1, `pdfjs/standard_fonts/LICENSE_FOXIT` y `LICENSE_LIBERATION` |
| JetBrains Mono | paquete Fontsource 5.3.0 | Tipografía local | SIL OFL 1.1, `fonts/JetBrains-LICENSE` |
| Chakra Petch | paquete Fontsource 5.3.0 | Tipografía local | SIL OFL 1.1, `fonts/Chakra-LICENSE` |
| Transformers.js (`@xenova/transformers`) | 2.17.2 | Inferencia opcional de embeddings en el navegador | Apache-2.0, `transformers/LICENSE` |
| ONNX Runtime Web | 1.14.0 | Motor WASM incluido en Transformers.js | MIT, `transformers/ONNXRUNTIME-LICENSE` |
| `@huggingface/jinja` | dependencia `^0.2.2` de Transformers.js | Código incluido en su bundle | MIT, `transformers/JINJA-LICENSE` |
| `Xenova/all-MiniLM-L6-v2` | ONNX cuantizado | Encoder opcional, principalmente inglés | Apache-2.0, `../models/minilm/LICENSE`; procedencia y SHA-256 en `../models/minilm/README.md` |
| `@wllama/wllama` | 2.3.7 (llama.cpp `b7179-4abef75`) | Inferencia Qwen GGUF mediante WASM monohilo | MIT, `wllama/LICENSE` y `wllama/LLAMA-CPP-LICENSE` |
| `js-sha256` | 0.11.1 | SHA-256 incremental del GGUF | MIT, `sha256/LICENSE` |
| `unsloth/Qwen3-0.6B-GGUF` | Q4_K_M, revisión `50968a4468ef4233ed78cd7c3de230dd1d61a56b` | Generador opcional para personaje; pesos descargados aparte | Apache-2.0, `../models/qwen3/LICENSE`; [ficha del modelo](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF) |

Para regenerar `fsrs/ts-fsrs.umd.js`, descomprime `npm pack ts-fsrs@5.4.2` y ejecuta `node tools/package-fsrs.cjs /ruta/a/package`. El generador comprueba el SHA-256 del UMD original y omite cuatro extensiones globales de `Date.prototype` y la referencia al mapa de fuentes. No se modifican las fórmulas de programación. La biblioteca se carga localmente como script clásico tanto en la PWA como desde disco.

Los bundles legacy de PDF.js conservan su código de lectura; se adaptó el envoltorio ESM a scripts clásicos para poder abrir el lector desde disco. `pdfjs/pdf.worker.entry.js` expone el mismo motor como worker de módulo bajo HTTP(S). `pdfjs/packed-assets.js` contiene los mismos CMaps y fuentes en base64 para `file:` y vistas previas de origen opaco; se aplican las licencias de sus directorios originales. Para regenerarlos, descomprime el resultado de `npm pack pdfjs-dist@4.2.67` y ejecuta `node tools/package-pdfjs.cjs /ruta/a/package` desde la raíz del repositorio.

Las bibliotecas se obtuvieron de sus paquetes publicados en npm. El modelo MiniLM se obtuvo del paquete npm `plugin-embed-web-client@1.1.12` y el SHA-256 de los pesos coincide con el archivo publicado por Xenova. PDF.js se ejecuta con `isEvalSupported: false`. Los archivos ONNX y el motor de Qwen son opcionales y no se precargan con el shell. El GGUF Qwen no está en el repositorio: la aplicación lo descarga de Hugging Face tras autorización o acepta el archivo importado; verifica sus 396.705.472 bytes y SHA-256 `ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a`. El bundle `wllama.mjs` se modificó para resolver URLs en workers y propagar la cancelación durante el procesamiento del prompt; los hashes exactos del runtime están en `js/qwen-config.js`.

### OCR y material didáctico

`ocr/es-lstm-6.1.2.js` empaqueta sin cambiar sus bytes el glue y WASM LSTM del paquete npm `tesseract.js-core@6.1.2` y [`spa.traineddata` de tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast/blob/87416418657359cb625c412a48b6e1d6d41c29bd/spa.traineddata). Para regenerarlo, descomprime `npm pack tesseract.js-core@6.1.2` y ejecuta `node tools/package-ocr.cjs /ruta/a/package /ruta/a/spa.traineddata`. El generador comprueba los tres SHA-256. La app carga el resultado **desde su propia instalación**, no desde npm, GitHub o un servicio de OCR.

El WASM upstream se construye con las [dependencias de Tesseract.js-core v6.1.2](https://github.com/naptha/tesseract.js-core/tree/v6.1.2/third_party) y Emscripten. Se conservan avisos de Tesseract, Leptonica, giflib, libjpeg, libpng, libtiff, libwebp, OpenLibm, zlib y del runtime en [`ocr/notices/`](ocr/notices/). **This software is based in part on the work of the Independent JPEG Group.**

El banco de revisión no forma parte de los modelos: deriva de [*Programming with Python*](https://github.com/swcarpentry/python-novice-inflammation/tree/58e71d5ced80d5423edb186c9ebe6dd462146d66/episodes), © [The Carpentries](https://carpentries.org/). Preguntas y soluciones traducidas y adaptadas, con pasajes introductorios en español: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); ejemplos de código MIT. [Licencia original](../docs/fuentes/CARPENTRIES-LICENSE.md). Esto no implica aval ni revisión de estas adaptaciones por The Carpentries.
