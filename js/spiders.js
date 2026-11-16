/**
 * NEURAL COMMAND // AI SPIDER OS
 * js/spiders.js - Enjambre de 5 arañas IA con ciclo físico DOM-to-Canvas
 */
(function () {
  const AGENT_SPECS = [
    { id: 'SPDR-01', role: 'DEF-AI', cluster: 'AGT-01', color: '#00f0ff', seeds: ['definición', 'concepto', 'arquitectura', 'modelo', 'sistema', 'red'] },
    { id: 'SPDR-02', role: 'CAUSAL-AI', cluster: 'AGT-02', color: '#a855f7', seeds: ['cuando', 'porque', 'entonces', 'protocolo', 'función', 'causa'] },
    { id: 'SPDR-03', role: 'QUANT-AI', cluster: 'AGT-03', color: '#f59e0b', seeds: ['porcentaje', 'métrica', 'latencia', 'épocas', 'tasa', 'valor'] },
    { id: 'SPDR-04', role: 'SYNTH-AI', cluster: 'AGT-04', color: '#10b981', seeds: ['resumen', 'conclusión', 'contraste', 'además', 'permite', 'embargo'] },
    { id: 'SPDR-05', role: 'CORE-AI', cluster: 'AGT-01', color: '#f43f5e', seeds: ['sinapsis', 'grafo', 'conocimiento', 'núcleo', 'agente', 'memoria'] }
  ];

  const MICRO_AI_KEY = 'neural_spider_microai_v1';
  const microBrains = {};

  function initMicroBrains() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(MICRO_AI_KEY) || '{}'); } catch (_) {}
    AGENT_SPECS.forEach(spec => {
      const weights = new Map(Object.entries(saved[spec.id] || {}));
      spec.seeds.forEach(w => { if (!weights.has(w)) weights.set(w, 1.5); });
      microBrains[spec.id] = { weights, learnedTokens: weights.size };
    });
  }

  function saveMicroBrains() {
    try {
      const out = {};
      Object.keys(microBrains).forEach(id => {
        out[id] = Object.fromEntries(Array.from(microBrains[id].weights.entries()).slice(0, 120));
      });
      localStorage.setItem(MICRO_AI_KEY, JSON.stringify(out));
    } catch (_) {}
  }

  function learnFromPattern(sp, text, reward = 1.0) {
    const brain = microBrains[sp.id];
    if (!brain) return;
    const tokens = text.toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    tokens.forEach(t => {
      const prev = brain.weights.get(t) || 0.2;
      brain.weights.set(t, Math.min(5.0, prev + 0.25 * reward));
    });
    brain.learnedTokens = brain.weights.size;
    saveMicroBrains();
  }

  let canvas, ctx;
  let spiders = [];
  let shockwaves = [];
  let paused = false;
  let activeCount = 1;
  let lastFrameTime = performance.now();
  let fpsCounter = 60;

  function createSpider(specIdx) {
    const spec = AGENT_SPECS[specIdx % AGENT_SPECS.length];
    const arenaRect = document.getElementById('panel-arena')?.getBoundingClientRect() || { left: 400, top: 200, width: 300, height: 300 };
    return {
      ...spec,
      x: arenaRect.left + arenaRect.width * 0.5 + (Math.random() - 0.5) * 40,
      y: arenaRect.top + arenaRect.height * 0.5 + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
      angle: 0,
      phase: 'IDLE', // IDLE | IR_A_PALABRA | EXTRAER_DATOS | ARRASTRAR_A_RED | ALIMENTAR_NODO
      phaseStart: performance.now(),
      targetSentence: null,
      targetPos: null,
      extractedPattern: null,
      legPhase: Math.random() * Math.PI * 2
    };
  }

  function setSpiderCount(count) {
    activeCount = Math.max(1, Math.min(5, count));
    while (spiders.length < activeCount) {
      spiders.push(createSpider(spiders.length));
    }
    if (spiders.length > activeCount) {
      spiders = spiders.slice(0, activeCount);
    }
    const el = document.getElementById('stat-spiders');
    if (el) el.textContent = `${spiders.length}/5`;
  }

  function extractMultiWordPattern(sentenceText) {
    const words = sentenceText.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 4) return words.join(' ');
    const len = Math.min(14, Math.max(4, Math.floor(words.length * 0.65)));
    const start = Math.floor(Math.random() * Math.max(1, words.length - len));
    return words.slice(start, start + len).join(' ');
  }

  function scoreSentenceForSpider(sp, text) {
    const t = text.toLowerCase();
    let score = 0;
    if (sp.role === 'DEF-AI' && /(es un|define|significa|concepto|modelo|sistema|arquitectura)/i.test(t)) score += 3;
    if (sp.role === 'CAUSAL-AI' && /(cuando|si |entonces|porque|por lo tanto|causa|función|protocolo)/i.test(t)) score += 3;
    if (sp.role === 'QUANT-AI' && /(\d+%|\d+\s*(ms|s|kb|mb|épocas|años)|métrica|tasa)/i.test(t)) score += 4;
    if (sp.role === 'SYNTH-AI' && /(en resumen|en contraste|conclusión|sin embargo|además|permite)/i.test(t)) score += 3;

    // Inferencia con Micro-IA local (pesos aprendidos)
    const brain = microBrains[sp.id];
    if (brain) {
      const tokens = t.replace(/[^a-z0-9áéíóúñü\s]/g, ' ').split(/\s+/);
      tokens.forEach(tok => { if (brain.weights.has(tok)) score += brain.weights.get(tok); });
    }
    return score;
  }

  function pickNextSentence(spider) {
    const store = window.NeuralStore;
    const doc = store.getActiveDoc();
    if (!doc) return null;
    const page = doc.pages[store.state.activePage - 1];
    if (!page) return null;

    const available = page.sentences.filter(s => !s.harvested && !store.state.claimedTargets.has(s.id));
    if (available.length === 0) {
      // Auto-Pág si está activado
      const autoChk = document.getElementById('chk-auto-page');
      if (autoChk?.checked && store.state.activePage < doc.pages.length) {
        store.setActivePage(store.state.activePage + 1);
      }
      return null;
    }

    // Especialización semántica: elegir la oración con mayor afinidad para este agente
    available.sort((a, b) => scoreSentenceForSpider(spider, b.text) - scoreSentenceForSpider(spider, a.text));
    const topPool = available.slice(0, Math.min(2, available.length));
    const chosen = topPool[Math.floor(Math.random() * topPool.length)];
    store.state.claimedTargets.add(chosen.id);
    spider.thought = `${spider.id} [${spider.role}]: Analizando "${chosen.text.slice(0, 32)}..."`;
    return chosen;
  }

  function getSentenceScreenPos(sentenceId) {
    const el = document.querySelector(`.sentence-block[data-sid="${sentenceId}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const docZone = document.getElementById('doc-dropzone')?.getBoundingClientRect();
    if (!docZone || rect.bottom < docZone.top || rect.top > docZone.bottom) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return {
      x: rect.left + Math.min(rect.width * 0.5, 120),
      y: rect.top + rect.height * 0.5
    };
  }

  function updateSpider(sp, now, dt) {
    // Watchdog de 3.0 segundos por estado
    if (sp.phase !== 'IDLE' && now - sp.phaseStart > 3000) {
      if (sp.targetSentence) window.NeuralStore.state.claimedTargets.delete(sp.targetSentence.id);
      sp.phase = 'IDLE';
      sp.targetSentence = null;
      sp.extractedPattern = null;
      sp.phaseStart = now;
    }

    if (sp.phase === 'IDLE') {
      const sent = pickNextSentence(sp);
      if (sent) {
        sp.targetSentence = sent;
        sp.targetPos = getSentenceScreenPos(sent.id);
        if (sp.targetPos) {
          sp.phase = 'IR_A_PALABRA';
          sp.phaseStart = now;
        } else {
          window.NeuralStore.state.claimedTargets.delete(sent.id);
        }
      }
      return;
    }

    if (sp.phase === 'IR_A_PALABRA') {
      const pos = getSentenceScreenPos(sp.targetSentence.id) || sp.targetPos;
      if (!pos) { sp.phase = 'IDLE'; return; }
      const dx = pos.x - sp.x;
      const dy = pos.y - sp.y;
      const dist = Math.hypot(dx, dy);
      sp.angle = Math.atan2(dy, dx);

      if (dist < 14) {
        sp.phase = 'EXTRAER_DATOS';
        sp.phaseStart = now;
      } else {
        const speed = 260 * dt;
        sp.x += (dx / dist) * speed;
        sp.y += (dy / dist) * speed;
        sp.legPhase += dt * 18;
      }
      return;
    }

    if (sp.phase === 'EXTRAER_DATOS') {
      sp.legPhase += dt * 10;
      if (now - sp.phaseStart > 550) {
        const frag = extractMultiWordPattern(sp.targetSentence.text);
        const hash = window.NeuralStore.hashPattern(frag);
        if (!window.NeuralStore.state.visitedPatternHashes.has(hash)) {
          window.NeuralStore.state.visitedPatternHashes.add(hash);
          const label = frag.split(/\s+/).slice(0, 3).join(' ');
          sp.extractedPattern = {
            cluster: sp.cluster,
            label,
            text: frag,
            pageNum: sp.targetSentence.pageNum,
            sentenceId: sp.targetSentence.id,
            color: sp.color
          };
          sp.targetSentence.harvested = true;
          const el = document.querySelector(`.sentence-block[data-sid="${sp.targetSentence.id}"]`);
          if (el) el.classList.add('sentence-harvested');
          sp.phase = 'ARRASTRAR_A_RED';
          sp.phaseStart = now;
        } else {
          sp.targetSentence.harvested = true;
          sp.phase = 'IDLE';
        }
      }
      return;
    }

    if (sp.phase === 'ARRASTRAR_A_RED') {
      const hubPos = window.NeuralGraph.getHubScreenPos(sp.cluster);
      const dx = hubPos.x - sp.x;
      const dy = hubPos.y - sp.y;
      const dist = Math.hypot(dx, dy);
      sp.angle = Math.atan2(dy, dx);

      if (dist < 18) {
        sp.phase = 'ALIMENTAR_NODO';
        sp.phaseStart = now;
      } else {
        const speed = 280 * dt;
        sp.x += (dx / dist) * speed;
        sp.y += (dy / dist) * speed;
        sp.legPhase += dt * 18;
      }
      return;
    }

    if (sp.phase === 'ALIMENTAR_NODO') {
      if (sp.extractedPattern) {
        window.NeuralGraph.addPatternNode(sp.extractedPattern);
        learnFromPattern(sp, sp.extractedPattern.text, 1.0);
        shockwaves.push({ x: sp.x, y: sp.y, r: 4, maxR: 38, color: sp.color, alpha: 1 });
        sp.harvestedCount = (sp.harvestedCount || 0) + 1;
        const vocab = microBrains[sp.id]?.learnedTokens || 0;
        window.NeuralStore.emit('spider:thought', {
          spiderId: sp.id,
          role: sp.role,
          color: sp.color,
          text: `${sp.id} (${sp.role}) aprendió "${sp.extractedPattern.label}" [Vocab: ${vocab}]`
        });
      }
      sp.extractedPattern = null;
      sp.targetSentence = null;
      sp.phase = 'IDLE';
      sp.phaseStart = now;
    }
  }

  function applyRepulsion() {
    for (let i = 0; i < spiders.length; i++) {
      for (let j = i + 1; j < spiders.length; j++) {
        const dx = spiders[j].x - spiders[i].x;
        const dy = spiders[j].y - spiders[i].y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < 28) {
          const push = (28 - dist) * 0.25;
          spiders[i].x -= (dx / dist) * push;
          spiders[i].y -= (dy / dist) * push;
          spiders[j].x += (dx / dist) * push;
          spiders[j].y += (dy / dist) * push;
        }
      }
    }
  }

  function drawSpider(sp) {
    ctx.save();
    ctx.translate(sp.x, sp.y);

    // Hilo de seda y cápsula si está arrastrando
    if (sp.phase === 'ARRASTRAR_A_RED' && sp.extractedPattern) {
      ctx.save();
      ctx.fillStyle = sp.color;
      ctx.shadowColor = sp.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(-Math.cos(sp.angle) * 16, -Math.sin(sp.angle) * 16, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Láser de escaneo en EXTRAER_DATOS
    if (sp.phase === 'EXTRAER_DATOS') {
      ctx.strokeStyle = sp.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(sp.angle) * 18, Math.sin(sp.angle) * 18);
      ctx.stroke();
    }

    ctx.rotate(sp.angle);

    // 8 patas articuladas (cinemática inversa visual)
    ctx.strokeStyle = sp.color;
    ctx.lineWidth = 1.3;
    for (let side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const baseAngle = side * (0.45 + i * 0.38);
        const swing = Math.sin(sp.legPhase + i * 1.3 + (side > 0 ? 0 : Math.PI)) * 0.22;
        const kx = Math.cos(baseAngle + swing) * 9;
        const ky = Math.sin(baseAngle + swing) * 9;
        const fx = Math.cos(baseAngle + swing * 1.4) * 15;
        const fy = Math.sin(baseAngle + swing * 1.4) * 15;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(kx, ky);
        ctx.lineTo(fx, fy);
        ctx.stroke();
      }
    }

    // Cuerpo cyberpunk
    ctx.fillStyle = '#05080f';
    ctx.strokeStyle = sp.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Ojos neón
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.arc(4, -1.5, 1.2, 0, Math.PI * 2);
    ctx.arc(4, 1.5, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    fpsCounter = Math.round(fpsCounter * 0.9 + (1 / Math.max(0.001, dt)) * 0.1);
    lastFrameTime = now;

    const fpsEl = document.getElementById('stat-fps');
    if (fpsEl && Math.random() < 0.1) fpsEl.textContent = Math.min(60, fpsCounter);

    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Recorte estricto (ctx.clip) a #panel-doc y #panel-arena para jamás flotar sobre chat o botones móviles
    const docRect = document.getElementById('panel-doc')?.getBoundingClientRect();
    const arenaRect = document.getElementById('panel-arena')?.getBoundingClientRect();
    ctx.save();
    ctx.beginPath();
    if (docRect) ctx.rect(docRect.left, docRect.top, docRect.width, docRect.height);
    if (arenaRect) ctx.rect(arenaRect.left, arenaRect.top, arenaRect.width, arenaRect.height);
    ctx.clip();

    if (!paused) {
      spiders.forEach(sp => updateSpider(sp, now, dt));
      applyRepulsion();
    }

    spiders.forEach(drawSpider);

    // Ondas expansivas
    shockwaves = shockwaves.filter(sw => sw.alpha > 0.05);
    shockwaves.forEach(sw => {
      sw.r += 1.6;
      sw.alpha *= 0.9;
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = sw.alpha;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    ctx.restore();
    requestAnimationFrame(loop);
  }

  function init() {
    initMicroBrains();
    canvas = document.getElementById('spider-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    setSpiderCount(1);

    document.getElementById('btn-mitosis')?.addEventListener('click', () => {
      setSpiderCount(activeCount < 5 ? activeCount + 1 : 1);
    });

    const btnPause = document.getElementById('btn-toggle-spiders');
    btnPause?.addEventListener('click', () => {
      paused = !paused;
      btnPause.textContent = paused ? '▶ Reanudar' : '⏸ Pausar';
    });

    // Mitosis automática según densidad del documento
    window.NeuralStore.on('doc:added', doc => {
      const totalChars = doc.pages.reduce((acc, p) => acc + p.text.length, 0);
      const target = Math.min(5, Math.max(2, Math.ceil(totalChars / 1500)));
      setSpiderCount(target);
    });

    // Despacho instantáneo al hacer clic en una palabra o fallar un quiz
    window.NeuralStore.on('spider:dispatchToSentence', ({ sentence }) => {
      if (!sentence) return;
      const sp = spiders[0];
      if (!sp) return;
      sp.targetSentence = sentence;
      sp.targetPos = getSentenceScreenPos(sentence.id);
      sp.phase = 'IR_A_PALABRA';
      sp.phaseStart = performance.now();
    });

    requestAnimationFrame(loop);
  }

  window.SpiderEngine = { init, setSpiderCount };
})();
