/**
 * NEURAL COMMAND // AI SPIDER OS
 * js/brain-rag.js - Cerebro conversacional local (KIMI-CORE) + BM25 + TextRank + Ollama
 */
(function () {
  function tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9áéíóúñü\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  function bm25Search(query, sentences, topK = 4) {
    const qTerms = tokenize(query);
    if (!qTerms.length || !sentences.length) return [];

    const avgLen = sentences.reduce((a, s) => a + s.text.length, 0) / sentences.length || 1;
    const k1 = 1.5, b = 0.75;

    const scored = sentences.map(s => {
      const sTerms = tokenize(s.text);
      let score = 0;
      qTerms.forEach(qt => {
        const tf = sTerms.filter(t => t === qt).length;
        if (tf > 0) {
          const df = sentences.filter(x => x.text.toLowerCase().includes(qt)).length || 1;
          const idf = Math.log((sentences.length - df + 0.5) / (df + 0.5) + 1);
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (s.text.length / avgLen))));
        }
      });
      return { sentence: s, score };
    });

    return scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
  }

  function tryMathEval(query) {
    const match = query.match(/([0-9]+(?:\.[0-9]+)?\s*[\+\-\*\/]\s*[0-9]+(?:\.[0-9]+)?(?:\s*[\+\-\*\/]\s*[0-9]+(?:\.[0-9]+)?)*)/);
    if (!match) return null;
    try {
      const expr = match[1];
      const result = Function(`"use strict"; return (${expr})`)();
      if (typeof result === 'number' && isFinite(result)) {
        return { expr, result };
      }
    } catch (_) {}
    return null;
  }

  function generateStructuredAnalysis() {
    const store = window.NeuralStore;
    const sents = store.state.allSentences;
    const nodes = store.state.nodes.filter(n => !n.isHub);
    if (!sents.length) {
      return {
        html: 'No hay documentos indexados aún. Carga un archivo o pulsa <strong>⚡ Demo</strong> para iniciar el análisis.',
        trace: 'Tool: check_index() -> 0 sentences.',
        nodeIds: []
      };
    }

    const thesis = sents[0];
    const quant = sents.find(s => /\d+%|\d+\s*(ms|s|kb|mb|épocas)/i.test(s.text)) || sents[Math.min(1, sents.length - 1)];
    const concl = sents[sents.length - 1];
    const topNodes = nodes.slice(0, 6);

    const html = `
      <strong>📊 Síntesis Estructurada (KIMI-CORE):</strong><br/>
      • <strong>Tesis Central:</strong> ${thesis.text} <span class="citation-chip" data-page="${thesis.pageNum}" data-sid="${thesis.id}">[Pág ${thesis.pageNum} · ${thesis.id.split('-').pop()}]</span><br/>
      • <strong>Conceptos del Grafo (${nodes.length}):</strong> ${topNodes.map(n => `<code>${n.label}</code>`).join(', ') || 'En proceso de cosecha...'}<br/>
      • <strong>Evidencia Cuantitativa/Causal:</strong> ${quant.text} <span class="citation-chip" data-page="${quant.pageNum}" data-sid="${quant.id}">[Pág ${quant.pageNum} · ${quant.id.split('-').pop()}]</span><br/>
      • <strong>Conclusión:</strong> ${concl.text} <span class="citation-chip" data-page="${concl.pageNum}" data-sid="${concl.id}">[Pág ${concl.pageNum} · ${concl.id.split('-').pop()}]</span>
    `;

    return {
      html,
      trace: `Tools: TextRank(${sents.length} sents) + GraphNodes(${nodes.length}) -> StructuredSynthesis`,
      nodeIds: topNodes.map(n => n.id)
    };
  }

  async function processQuery(query) {
    const store = window.NeuralStore;
    const lower = query.toLowerCase();

    // 1. Consolidación de aprendizaje manual
    if (lower.startsWith('aprende que ') || lower.startsWith('consolida:')) {
      const fact = query.replace(/^(aprende que |consolida:\s*)/i, '').trim();
      store.state.consolidatedMemory.push({ fact, date: new Date().toISOString() });
      store.savePersistent();
      return {
        html: `✅ <strong>Conocimiento consolidado en memoria persistente:</strong> "${fact}"`,
        trace: 'Tool: localStorage.savePersistent() -> OK',
        nodeIds: []
      };
    }

    // 2. Evaluador matemático
    const math = tryMathEval(query);
    if (math) {
      return {
        html: `🧮 <strong>Cálculo paso a paso:</strong> <code>${math.expr}</code> = <strong>${math.result}</strong>`,
        trace: `Tool: MathEvaluator("${math.expr}") -> ${math.result}`,
        nodeIds: []
      };
    }

    // 3. Análisis / Resumen completo
    if (/resum|analiz|síntesis|sintesis|tesis/i.test(lower)) {
      return generateStructuredAnalysis();
    }

    // 4. Búsqueda híbrida BM25 + Expansión de grafo 1-salto + Memoria consolidada
    const hits = bm25Search(query, store.state.allSentences, 3);
    const nodes = store.state.nodes.filter(n => !n.isHub);
    const matchedNodes = nodes.filter(n =>
      tokenize(query).some(qt => n.label.toLowerCase().includes(qt) || (n.text || '').toLowerCase().includes(qt))
    ).slice(0, 5);

    const memHits = store.state.consolidatedMemory.filter(m =>
      tokenize(query).some(qt => m.fact.toLowerCase().includes(qt))
    );

    if (!hits.length && !matchedNodes.length && !memHits.length) {
      return {
        html: 'No encontré coincidencias directas en el documento actual. Intenta con otros términos o carga un documento.',
        trace: `Tool: BM25(${store.state.allSentences.length} sents) -> 0 hits`,
        nodeIds: []
      };
    }

    // 5. Puente opcional 100% local con Ollama (http://localhost:11434)
    if (store.state.ollamaEnabled) {
      try {
        const contextText = hits.map(h => `[Pág ${h.sentence.pageNum}] ${h.sentence.text}`).join('\n');
        const graphText = matchedNodes.map(n => `[${n.cluster}] ${n.label}: ${n.text}`).join('\n');
        const prompt = `Eres KIMI-CORE, el cerebro de NEURAL COMMAND. Responde en español usando SOLO este contexto:\n${contextText}\n${graphText}\n\nPregunta: ${query}`;
        const resp = await fetch(`${store.state.ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: store.state.ollamaModel || 'llama3', prompt, stream: false })
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.response) {
            return {
              html: `🦙 <strong>Ollama (${store.state.ollamaModel}):</strong> ${data.response}`,
              trace: `Tools: BM25(${hits.length}) + Graph(${matchedNodes.length}) -> Ollama(${store.state.ollamaModel})`,
              nodeIds: matchedNodes.map(n => n.id)
            };
          }
        }
      } catch (err) {
        console.warn('[Ollama] No accesible, usando motor KIMI-CORE interno:', err.message);
      }
    }

    let html = '';
    if (hits.length) {
      html += hits.map(h =>
        `• ${h.sentence.text} <span class="citation-chip" data-page="${h.sentence.pageNum}" data-sid="${h.sentence.id}">[Pág ${h.sentence.pageNum}]</span>`
      ).join('<br/>');
    }
    if (memHits.length) {
      html += `<br/>💡 <strong>Memoria Consolidada:</strong> ${memHits.map(m => m.fact).join(' | ')}`;
    }

    return {
      html,
      trace: `Tools: BM25(${hits.length} hits) + Graph1Hop(${matchedNodes.length} nodes) + Memory(${memHits.length})`,
      nodeIds: matchedNodes.map(n => n.id)
    };
  }

  function appendMessage(role, html, trace) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    const div = document.createElement('div');
    div.className = `msg msg-${role}`;
    div.innerHTML = html;

    if (trace) {
      const det = document.createElement('details');
      det.className = 'trace-details';
      det.innerHTML = `<summary>Thinking & Tool Calls</summary><div>${trace}</div>`;
      div.appendChild(det);
    }

    div.querySelectorAll('.citation-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const p = parseInt(chip.dataset.page, 10);
        const sid = chip.dataset.sid;
        if (p) window.NeuralStore.setActivePage(p);
        if (sid) {
          setTimeout(() => {
            const el = document.querySelector(`.sentence-block[data-sid="${sid}"]`);
            if (el) {
              el.classList.add('sentence-active');
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(() => el.classList.remove('sentence-active'), 2500);
            }
          }, 80);
        }
      });
    });

    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function init() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');

    form?.addEventListener('submit', async e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      appendMessage('user', q);

      const res = await processQuery(q);
      appendMessage('ai', res.html, res.trace);
      if (res.nodeIds?.length) {
        window.NeuralGraph.highlightPath(res.nodeIds);
      }
    });

    document.querySelectorAll('.btn-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.prompt || '';
        if (p.endsWith(' ')) {
          input.value = p;
          input.focus();
        } else {
          input.value = p;
          form.dispatchEvent(new Event('submit'));
        }
      });
    });

    // Switcher de pestañas Chat / Bots
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
      });
    });

    // Puente Ollama 100% local
    document.getElementById('btn-ollama-cfg')?.addEventListener('click', () => {
      const st = window.NeuralStore.state;
      st.ollamaEnabled = !st.ollamaEnabled;
      const model = st.ollamaEnabled ? prompt('Modelo Ollama local (ej. llama3, qwen2.5:3b, phi3):', st.ollamaModel) : st.ollamaModel;
      if (model) st.ollamaModel = model.trim();
      window.NeuralStore.savePersistent();
      appendMessage('system', st.ollamaEnabled
        ? `🦙 Puente Ollama <strong>ACTIVADO</strong> (${st.ollamaUrl} · modelo: <code>${st.ollamaModel}</code>).`
        : '🦙 Puente Ollama <strong>DESACTIVADO</strong>. Usando motor KIMI-CORE 100% interno.');
    });

    // Monólogo metacognitivo de las arañas en el badge superior
    window.NeuralStore.on('spider:thought', ({ text }) => {
      const badge = document.getElementById('hud-mode-badge');
      if (badge) badge.textContent = text.slice(0, 38) + (text.length > 38 ? '…' : '');
    });
  }

  window.BrainRAG = { init, processQuery };
})();
