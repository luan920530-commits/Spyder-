// Punto de entrada para el worker de módulo (y para el fallback import() de PDF.js).
// El mismo motor se carga como script clásico al abrir index.html desde disco.
import './pdf.worker.min.js';
export const WorkerMessageHandler = globalThis.pdfjsWorker.WorkerMessageHandler;
