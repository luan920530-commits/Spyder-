/** Citas literales sobre el texto original del visor, nunca sobre ventanas de búsqueda. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCHighlights = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_QUOTE = 1200, MAX_QUESTION = 400;

  // Adaptado de range-to-selector.ts de @recogito/text-annotator 4.3.7
  // (BSD-3-Clause, vendor/recogito/LICENSE). El artículo de Spyder contiene
  // SOLO texto anotable: no contamos botones ni texto de otros paneles.
  function rangeToSelector(range, article) {
    if (!range || range.collapsed || !article.contains(range.startContainer) || !article.contains(range.endContainer)) return null;
    const before = range.cloneRange();
    before.selectNodeContents(article); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length, quote = range.toString();
    return { start, end: start + quote.length, quote };
  }

  // Mismo separador y mismas unidades UTF-16 que Range y DocViewer.render.
  function indexPage(doc, pageNum) {
    const page = doc?.pages[pageNum - 1];
    if (!page || doc.mediaType || !Number.isInteger(pageNum)) return null;
    let offset = 0;
    const blocks = page.sentences.map(s => {
      const start = offset; offset += s.text.length + 1;
      return { id: s.id, start, end: offset - 1, sourcePage: s.sourcePage ?? page.sourcePage ?? null };
    });
    return { docId: doc.id, docName: doc.name, pageNum, blocks, text: page.sentences.map(s => s.text + ' ').join('') };
  }
  function anchor(page, selector) {
    if (!page || !selector) return null;
    let { start, end, quote } = selector;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > page.text.length ||
        typeof quote !== 'string' || page.text.slice(start, end) !== quote) return null;
    start += quote.length - quote.trimStart().length; quote = quote.trim(); end = start + quote.length;
    if (!quote || quote.length > MAX_QUOTE) return null;
    const blocks = page.blocks.filter(b => b.end > start && b.start < end), first = blocks[0];
    if (!first || blocks.some(b => b.sourcePage !== first.sourcePage)) return null;
    return { docId: page.docId, docName: page.docName, pageNum: page.pageNum, sourcePage: first.sourcePage,
      sentenceId: first.id, selector: { start, end, quote, endSentenceId: blocks.at(-1).id } };
  }
  function resolve(page, source) {
    if (!source || !page || source.docId !== page.docId || source.pageNum !== page.pageNum) return null;
    const a = anchor(page, source.selector);
    return a && a.sentenceId === source.sentenceId && a.sourcePage === source.sourcePage &&
      a.selector.endSentenceId === source.selector.endSentenceId && a.selector.quote === source.selector.quote ? a : null;
  }
  return { MAX_QUOTE, MAX_QUESTION, rangeToSelector, indexPage, anchor, resolve };
});
