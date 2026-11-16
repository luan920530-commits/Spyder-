/** Evaluación local: consultas sintéticas del corpus y métricas de respuestas. */
(function (root) {
  'use strict';
  const U = root.NCUtil, R = root.NCRetrieval;
  const store = () => root.NeuralStore;
  function buildQuestion(index, sentence) {
    const analyzed = U.analyze(sentence.text);
    const words = analyzed.raw.map((word, i) => ({ word, stem: analyzed.stems[i], df: index.df.get(analyzed.stems[i]) || 1 }));
    const unique = new Map(); words.forEach(w => { if (!unique.has(w.stem)) unique.set(w.stem, w); });
    const ranked = [...unique.values()].sort((a, b) => a.df - b.df).slice(0, 4);
    return ranked.length >= 2 ? ranked.map(x => x.word).join(' ') : null;
  }
  function run(opts) {
    const S = store();
    if (!S?.state.index) return { error: 'Sin índice' };
    const o = Object.assign({ sample: 40, k: 5 }, opts || {});
    const index = S.state.index, total = index.sentences.length;
    if (total < 5) return { error: 'Se necesitan al menos 5 pasajes indexados.' };
    const count = Math.min(total, o.sample), cases = [];
    for (let i = 0; i < count; i++) {
      const pos = Math.floor(i * total / count), sentence = index.sentences[pos];
      const q = buildQuestion(index, sentence);
      if (q) cases.push({ q, id: sentence.id, pos, docName: sentence.docName });
    }
    if (!cases.length) return { error: 'No hay suficiente texto para construir consultas.' };
    let hit1 = 0, hit3 = 0, hitK = 0, mrr = 0;
    const latencies = [], byDoc = new Map(), failures = [];
    for (const c of cases) {
      const t = performance.now();
      // Se mide la misma ruta híbrida que usa el chat.
      const result = S.search(c.q, { k: Math.max(10, o.k), diversify: false, expand: false });
      latencies.push(performance.now() - t);
      const rank = result.hits.findIndex(h => h.sentence.id === c.id) + 1;
      if (rank === 1) hit1++;
      if (rank > 0 && rank <= 3) hit3++;
      if (rank > 0 && rank <= o.k) hitK++;
      if (rank > 0 && rank <= 10) mrr += 1 / rank;
      if ((!rank || rank > o.k) && failures.length < 8) failures.push({ q: c.q, expected: U.truncate(index.sentences[c.pos].text, 120), docName: c.docName });
      const name = c.docName || 'Documento';
      if (!byDoc.has(name)) byDoc.set(name, { doc: name, total: 0, hits: 0 });
      const row = byDoc.get(name); row.total++; if (rank > 0 && rank <= o.k) row.hits++;
    }
    const n = cases.length;
    const result = {
      at: Date.now(), sample: n, k: o.k, recall1: hit1 / n, recall3: hit3 / n,
      recallK: hitK / n, mrr: mrr / n, p50: U.percentile(latencies, 50), p95: U.percentile(latencies, 95),
      byDoc: [...byDoc.values()].map(row => ({ ...row, recall: row.hits / row.total })),
      failures, stats: R.stats(index), vectors: index.vectors.size
    };
    S.state.evalRuns.push(result);
    if (S.state.evalRuns.length > 50) S.state.evalRuns.shift();
    S.savePersistent(); S.emit('eval:done', result);
    return result;
  }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function render() {
    const S = store(), box = document.getElementById('eval-results');
    if (!box || !S) return;
    box.replaceChildren();
    const last = S.state.evalRuns.at(-1);
    if (!last) box.appendChild(el('p', 'muted', 'Ejecuta una evaluación para medir la recuperación de tu corpus.'));
    else {
      const summary = el('div', 'eval-summary');
      const add = (value, label) => { const card = el('div', 'eval-kpi'); card.append(el('strong', '', value), el('small', '', label)); summary.appendChild(card); };
      add(U.pct(last.recallK), `recall@${last.k}`); add(U.pct(last.recall1), 'recall@1');
      add(Number(last.mrr).toFixed(2), 'MRR@10'); add(U.formatMs(last.p95), 'latencia p95');
      add(String(last.sample), 'consultas'); add(String(last.vectors), 'vectores locales');
      box.appendChild(summary);
      if (last.byDoc?.length) {
        box.appendChild(el('h4', '', 'Por documento'));
        const list = el('ul', 'metrics-list');
        last.byDoc.forEach(d => list.appendChild(el('li', '', `${d.doc}: ${U.pct(d.recall)} (${d.hits}/${d.total})`)));
        box.appendChild(list);
      }
      if (last.failures?.length) {
        const details = el('details', 'trace-details'); details.appendChild(el('summary', '', 'Ver casos no recuperados'));
        const list = el('ul');
        last.failures.forEach(f => list.appendChild(el('li', '', `${f.q} → ${f.expected} (${f.docName || ''})`)));
        details.appendChild(list); box.appendChild(details);
      }
      box.appendChild(el('p', 'muted small', 'Consultas sintéticas creadas con palabras de los propios pasajes: esta prueba puede ser optimista; no sustituye un set de preguntas humanas ni mide la redacción.'));
    }
    const answers = S.state.chat.filter(x => x.role === 'assistant');
    const citations = answers.flatMap(x => x.citations?.cited || []);
    if (answers.length) {
      box.appendChild(el('h4', '', 'Conversación'));
      const valid = citations.filter(c => c.ok).length;
      const supported = citations.filter(c => c.ok && c.supported === true).length;
      box.appendChild(el('p', 'muted', `${answers.length} respuestas · ${valid}/${citations.length} citas dentro de rango · ${supported}/${citations.length} con al menos dos términos compartidos.`));
      box.appendChild(el('p', 'muted small', 'El solapamiento de palabras no garantiza que una afirmación sea verdadera.'));
    }
  }
  root.NCEval = { run, render, buildQuestion };
})(typeof window !== 'undefined' ? window : globalThis);
