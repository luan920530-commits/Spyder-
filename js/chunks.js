/** Fragmentos derivados de las oraciones originales, sin cambiar sus identificadores ni el visor. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCChunks = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function contextText(section, text) {
    const title = String(section || '').trim();
    return title ? `${title}\n${text}` : text;
  }

  /**
   * Una ventana centrada por ancla: dos oraciones en los bordes y tres en el
   * interior. Nunca cruza páginas, páginas físicas de PDF ni secciones. Una
   * oración aislada se conserva cuando no tiene vecinas compatibles.
   * El ID del ancla sigue siendo el ID histórico de la cita y del visor.
   */
  function fromDocument(doc) {
    const chunks = [];
    (doc.pages || []).forEach((page, pageIndex) => {
      const pageNum = page.pageNum || pageIndex + 1;
      const sentences = page.sentences || [];
      sentences.forEach(sentence => {
        sentence.docId = doc.id;
        sentence.docName = doc.name;
        sentence.pageNum = pageNum;
        if (sentence.section === undefined) sentence.section = page.section || '';
        if (sentence.sourcePage == null && page.sourcePage != null) sentence.sourcePage = page.sourcePage;
      });
      const compatible = (a, b) => !!b && (a.section || '') === (b.section || '') &&
        (a.sourcePage || page.sourcePage || null) === (b.sourcePage || page.sourcePage || null);
      sentences.forEach((anchor, i) => {
        const neighbours = [];
        if (compatible(anchor, sentences[i - 1])) neighbours.push(sentences[i - 1]);
        neighbours.push(anchor);
        if (compatible(anchor, sentences[i + 1])) neighbours.push(sentences[i + 1]);
        const parts = neighbours.map(s => ({ id: s.id, text: s.text }));
        const text = parts.map(part => part.text).join(' ');
        const section = anchor.section || '';
        const chunk = {
          id: anchor.id, docId: doc.id, docName: doc.name, pageNum,
          sourcePage: anchor.sourcePage || page.sourcePage || null,
          section, sourceText: anchor.text, parts, text,
          contextText: contextText(section, text)
        };
        // El progreso se sigue guardando en las oraciones originales existentes.
        Object.defineProperty(chunk, 'harvested', {
          enumerable: true, get: () => !!anchor.harvested,
          set: value => { anchor.harvested = !!value; }
        });
        chunks.push(chunk);
      });
    });
    return chunks;
  }

  return { fromDocument, contextText };
});
