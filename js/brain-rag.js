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

  const SEMANTIC_SYNONYMS = {
    latencia: ['tiempo', 'respuesta', 'milisegundos', 'ms', 'velocidad'],
    tiempo: ['latencia', 'milisegundos', 'ms'],
    red: ['neuronal', 'grafo', 'nodos', 'sinapsis'],
    error: ['fallo', 'fallos', 'bizantinos', 'tolerancia'],
    fallo: ['error', 'tolerancia', 'consenso'],
    resumen: ['síntesis', 'conclusión', 'tesis']
  };

  function expandQueryTerms(terms) {
    const expanded = new Set(terms);
    terms.forEach(t => {
      if (SEMANTIC_SYNONYMS[t]) SEMANTIC_SYNONYMS[t].forEach(s => expanded.add(s));
    });
    return Array.from(expanded);
  }

  function bm25Search(query, sentences, topK = 4) {
    const qTerms = expandQueryTerms(tokenize(query));
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
    const quantCount = sents.filter(s => /\d+/.test(s.text)).length;
    const confidence = Math.min(98, Math.round(45 + (nodes.length * 3) + (quantCount * 4)));
    const critique = quantCount < 2
      ? '⚠️ Baja densidad cuantitativa: las afirmaciones requieren mayor respaldo métrico o experimental.'
      : `✅ Respaldo empírico sólido (${quantCount} oraciones con datos cuantitativos verificables).`;

    const html = `
      <strong>🧠 ANÁLISIS CIENTÍFICO Y CRÍTICO (KIMI-CORE // MODO J.A.R.V.I.S.):</strong><br/>
      • <strong>1. Hipótesis / Tesis Central:</strong> ${thesis.text} <span class="citation-chip" data-page="${thesis.pageNum}" data-sid="${thesis.id}">[Pág ${thesis.pageNum}]</span><br/>
      • <strong>2. Evidencia Empírica:</strong> ${quant.text} <span class="citation-chip" data-page="${quant.pageNum}" data-sid="${quant.id}">[Pág ${quant.pageNum}]</span><br/>
      • <strong>3. Juicio Crítico:</strong> ${critique}<br/>
      • <strong>4. Nodos Clave (${nodes.length}):</strong> ${topNodes.map(n => `<code>${n.label}</code>`).join(', ') || 'En proceso de cosecha...'}<br/>
      • <strong>5. Conclusión Razonada (Confianza ${confidence}%):</strong> ${concl.text} <span class="citation-chip" data-page="${concl.pageNum}" data-sid="${concl.id}">[Pág ${concl.pageNum}]</span>
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

    // 3. Generador de Artefactos (HTML / PHP / Resumen) desde la Red Neuronal
    if (/(genera|crea|haz|escribe).*(html|php)/i.test(lower)) {
      const isPhp = /php/i.test(lower);
      const nodes = store.state.nodes.filter(n => !n.isHub);
      const title = store.getActiveDoc()?.name || 'Neural_Knowledge';
      let code = '';
      if (isPhp) {
        const items = nodes.map(n => `  ['cluster' => '${n.cluster}', 'label' => '${n.label.replace(/'/g, "\\'")}', 'text' => '${(n.text || '').replace(/'/g, "\\'")}']`).join(",\n");
        code = `<?php\n// Generado por NEURAL COMMAND // AI SPIDER OS\n$knowledgeGraph = [\n${items}\n];\necho "<h1>${title}</h1><ul>";\nforeach ($knowledgeGraph as $node) {\n  echo "<li><strong>[{$node['cluster']}] {$node['label']}:</strong> {$node['text']}</li>";\n}\necho "</ul>";\n?>`;
      } else {
        const items = nodes.map(n => `  <li><strong>[${n.cluster}] ${n.label}:</strong> ${n.text}</li>`).join('\n');
        code = `<!DOCTYPE html>\n<html lang="es">\n<head><meta charset="UTF-8"><title>${title}</title></head>\n<body style="background:#05080f;color:#e2e8f0;font-family:monospace;padding:20px;">\n  <h1>${title} (${nodes.length} nodos)</h1>\n  <ul>\n${items}\n  </ul>\n</body>\n</html>`;
      }
      return {
        html: `⚡ <strong>Artefacto ${isPhp ? 'PHP' : 'HTML'} generado desde ${nodes.length} nodos de la red:</strong><pre style="background:#04070d;padding:8px;border-radius:4px;overflow-x:auto;font-size:10.5px;margin-top:6px;">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`,
        trace: `Tool: ArtifactGenerator(${isPhp ? 'PHP' : 'HTML'}, ${nodes.length} nodes) -> OK`,
        nodeIds: nodes.slice(0, 5).map(n => n.id)
      };
    }

    // 4. Análisis / Resumen completo
    if (/resum|analiz|síntesis|sintesis|tesis/i.test(lower)) {
      return generateStructuredAnalysis();
    }

    // 4. Búsqueda híbrida BM25 + Propagación de Activación Sináptica (2 saltos en el grafo) + Memoria
    const hits = bm25Search(query, store.state.allSentences, 3);
    const nodes = store.state.nodes.filter(n => !n.isHub);
    const seedNodes = nodes.filter(n =>
      expandQueryTerms(tokenize(query)).some(qt => n.label.toLowerCase().includes(qt) || (n.text || '').toLowerCase().includes(qt))
    );

    // Propagación de activación por ramas neuronales (conectando clústeres relacionados)
    const activatedIds = new Set(seedNodes.map(n => n.id));
    for (let hop = 0; hop < 2; hop++) {
      store.state.links.forEach(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (activatedIds.has(s)) activatedIds.add(t);
        if (activatedIds.has(t)) activatedIds.add(s);
      });
    }
    const matchedNodes = nodes.filter(n => activatedIds.has(n.id)).slice(0, 6);
    const corePower = nodes.length * 10 + store.state.links.length * 5 + store.state.consolidatedMemory.length * 15;

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

    const aux = window.KimiAuxModel ? window.KimiAuxModel.reason(query) : null;
    if (aux && aux.associated.length) {
      html += `<br/>🧬 <strong>Inferencia Auxiliar (${aux.intent} · Nv.${aux.level}):</strong> Conceptos asociados: ${aux.associated.map(a => `<code>${a.word}</code>`).join(', ')}`;
      if (aux.naturalSynthesis) {
        html += `<br/>🗣️ <strong>Síntesis N-gram:</strong> <em>"${aux.naturalSynthesis}"</em>`;
      }
    }

    return {
      html,
      trace: `Tools: BM25(${hits.length}) + Synaptic2Hop(${matchedNodes.length}) + AuxModel(Nv.${aux?.level || 1}, XP:${aux?.xp || 0}) + CorePower(${corePower})`,
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

    if (role === 'ai') {
      const fb = document.createElement('div');
      fb.style.cssText = 'display:flex; gap:6px; margin-top:6px; align-items:center; font-size:10px; color:var(--text-dim);';
      fb.innerHTML = `<span>¿Útil?</span><button class="btn-mini btn-fb-up">👍</button><button class="btn-mini btn-fb-down">👎</button>`;
      const plainText = div.textContent || '';
      fb.querySelector('.btn-fb-up').addEventListener('click', e => {
        if (window.KimiAuxModel) window.KimiAuxModel.trainOnPattern(plainText, 2.0);
        fb.innerHTML = '<span style="color:var(--emerald);">✅ Reforzado (+XP en KimiAuxModel)</span>';
      });
      fb.querySelector('.btn-fb-down').addEventListener('click', e => {
        if (window.KimiAuxModel) {
          window.KimiAuxModel.trainOnPattern(plainText, -0.5);
          window.KimiAuxModel.recordNegativeEpisode(plainText);
        }
        fb.innerHTML = '<span style="color:var(--coral);">⚠️ Penalizado (Memoria Negativa actualizada)</span>';
      });
      div.appendChild(fb);
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
        window.NeuralStore.emit('spider:queryVisual', { query: q, nodeIds: res.nodeIds });
      }
    });

    // Asistente de Voz nativo (Web Speech API - inspirado en Nexi / Voicear)
    const micBtn = document.getElementById('btn-voice-mic');
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (micBtn && SpeechRec) {
      const rec = new SpeechRec();
      rec.lang = 'es-ES';
      rec.interimResults = false;
      micBtn.addEventListener('click', () => {
        micBtn.textContent = '🔴';
        rec.start();
      });
      rec.onresult = e => {
        const transcript = e.results[0][0].transcript;
        input.value = transcript;
        micBtn.textContent = '🎙️';
        form.dispatchEvent(new Event('submit'));
      };
      rec.onerror = () => { micBtn.textContent = '🎙️'; };
      rec.onend = () => { micBtn.textContent = '🎙️'; };
    } else if (micBtn) {
      micBtn.title = 'Reconocimiento de voz no soportado en este navegador';
      micBtn.disabled = true;
    }

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

    // Redacción colaborativa del enjambre (5 arañas interviniendo según su IA)
    document.getElementById('btn-run-writer')?.addEventListener('click', () => {
      const promptEl = document.getElementById('writer-prompt');
      const outEl = document.getElementById('writer-output');
      if (!promptEl || !outEl) return;
      const topic = promptEl.value.trim() || 'el documento indexado';
      const nodes = window.NeuralStore.state.nodes.filter(n => !n.isHub);

      const pick = (cluster, fallback) => {
        const found = nodes.filter(n => n.cluster === cluster).sort((a, b) => (b.weight || 1) - (a.weight || 1));
        return found.length ? found.slice(0, 2).map(n => n.text).join('; ') : fallback;
      };

      const topConcepts = nodes.slice(0, 4).map(n => n.label).join(', ') || topic;
      const sections = [
        { id: 'SPDR-01 [DEF-AI]', color: '#00f0ff', text: `**1. Marco Conceptual (${topic}):** A partir de los patrones comprendidos (${topConcepts}), se define que ${pick('AGT-01', 'la estructura central se fundamenta en nodos semánticos interconectados.')}` },
        { id: 'SPDR-02 [CAUSAL-AI]', color: '#a855f7', text: `**2. Argumentación y Mecanismos:** El análisis causal demuestra que ${pick('AGT-02', 'cada regla operativa desencadena una respuesta directa en el sistema.')}` },
        { id: 'SPDR-03 [QUANT-AI]', color: '#f59e0b', text: `**3. Evidencia y Métricas Clave:** Los datos extraídos respaldan esta tesis: ${pick('AGT-03', 'las métricas observadas validan la eficiencia del enfoque.')}` },
        { id: 'SPDR-04 [SYNTH-AI]', color: '#10b981', text: `**4. Síntesis Crítica:** En conclusión, ${pick('AGT-04', 'la convergencia de estos argumentos consolida una postura coherente sobre ' + topic + '.')}` },
        { id: 'SPDR-05 [CORE-AI]', color: '#f43f5e', text: `**5. Veredicto KIMI-CORE:** Documento redactado integrando ${nodes.length} nodos aprendidos de la red neuronal.` }
      ];

      outEl.innerHTML = '';
      sections.forEach((sec, idx) => {
        setTimeout(() => {
          const block = document.createElement('div');
          block.style.marginBottom = '10px';
          block.innerHTML = `<span style="color:${sec.color}; font-weight:700; font-size:10.5px;">[${sec.id}]</span><br/>${sec.text}`;
          outEl.appendChild(block);
          outEl.scrollTop = outEl.scrollHeight;

          if (idx === sections.length - 1) {
            const fb = document.createElement('div');
            fb.style.cssText = 'display:flex; gap:6px; margin-top:8px; align-items:center; font-size:10.5px; color:var(--text-dim);';
            fb.innerHTML = `<span>¿Calificar redacción?</span><button class="btn-mini" id="w-fb-up">👍</button><button class="btn-mini" id="w-fb-down">👎</button>`;
            const fullText = sections.map(s => s.text).join(' ');
            fb.querySelector('#w-fb-up').addEventListener('click', () => {
              if (window.KimiAuxModel) window.KimiAuxModel.trainOnPattern(fullText, 2.0);
              fb.innerHTML = '<span style="color:var(--emerald);">✅ Redacción reforzada (+XP en KimiAuxModel)</span>';
            });
            fb.querySelector('#w-fb-down').addEventListener('click', () => {
              if (window.KimiAuxModel) {
                window.KimiAuxModel.trainOnPattern(fullText, -0.5);
                window.KimiAuxModel.recordNegativeEpisode(fullText);
              }
              fb.innerHTML = '<span style="color:var(--coral);">⚠️ Penalizada (Memoria Negativa actualizada)</span>';
            });
            outEl.appendChild(fb);
          }
        }, idx * 450);
      });
    });
  }

  window.BrainRAG = { init, processQuery };
})();
