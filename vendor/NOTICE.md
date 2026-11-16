# Componentes incluidos localmente

Estas bibliotecas se distribuyen con la aplicación para que no requiera CDN en tiempo de ejecución. Sus archivos de licencia se conservan en las carpetas correspondientes.

| Componente | Versión | Uso | Licencia |
|---|---:|---|---|
| D3.js | 7.9.0 | Grafo interactivo | ISC, `d3/LICENSE` |
| JSZip | 3.10.1 | Respaldo de descompresión ZIP | MIT / GPLv3, `jszip/LICENSE.markdown` |
| Mammoth | 1.8.0 | Extracción de DOCX | BSD-2-Clause, `mammoth/LICENSE` |
| PDF.js | 4.2.67 | Extracción de PDF con texto | Apache-2.0, `pdfjs/LICENSE` |
| JetBrains Mono | paquete Fontsource 5.3.0 | Tipografía local | SIL OFL 1.1, `fonts/JetBrains-LICENSE` |
| Chakra Petch | paquete Fontsource 5.3.0 | Tipografía local | SIL OFL 1.1, `fonts/Chakra-LICENSE` |

Los componentes se obtuvieron de sus paquetes publicados en npm. PDF.js se ejecuta con `isEvalSupported: false`; los modelos, OCR, analíticas y herramientas de diseño externas no se incluyen ni se cargan.
