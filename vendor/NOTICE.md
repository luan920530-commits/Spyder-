# Componentes incluidos localmente

Estas bibliotecas se distribuyen con la aplicación para que no requiera CDN en tiempo de ejecución. Sus archivos de licencia se conservan en las carpetas correspondientes.

| Componente | Versión | Uso | Licencia |
|---|---:|---|---|
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

Las bibliotecas se obtuvieron de sus paquetes publicados en npm. El modelo se obtuvo del paquete npm `plugin-embed-web-client@1.1.12` y el SHA-256 de los pesos coincide con el archivo publicado por Xenova. PDF.js se ejecuta con `isEvalSupported: false`. Los archivos ONNX y WASM son opcionales: no se precargan con el shell ni se accede a servicios externos para usarlos.
