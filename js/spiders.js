/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/spiders.js — Enjambre de agentes: ciclo físico DOM→lienzo, micro-IA por agente,
 * cola de cosecha global (todos los documentos y páginas) y telemetría de rendimiento.
 *
 * Mejoras v11:
 *  · scoring normalizado (antes el ruido dominaba con vocabularios grandes)
 *  · SPDR-05 CORE-AI con reglas propias
 *  · los claims se Liberan al terminar (antes quedaban reservados para siempre)
 *  · cola global con presupuesto por frame y cambio de página automático
 *  · respeta prefers-reduced-motion y pausa al ocultar la pestaña
 */
(function (root) {
  'use strict';

  const U = root.NCUtil;

  const AGENT_SPECS = [
    { id: 'SPDR-01', role: 'DEF-AI', cluster: 'AGT-01', color: '#00f0ff', seeds: ['definicion', 'concepto', 'arquitectura', 'modelo', 'sistema', 'red'] },
    { id: 'SPDR-02', role: 'CAUSAL-AI', cluster: 'AGT-02', color: '#a855f7', seeds: ['cuando', 'porque', 'entonces', 'protocolo', 'funcion', 'causa'] },
    { id: 'SPDR-03', role: 'QUANT-AI', cluster: 'AGT-03', color: '#f59e0b', seeds: ['porcentaje', 'metrica', 'latencia', 'epocas', 'tasa', 'valor'] },
    { id: 'SPDR-04', role: 'SYNTH-AI', cluster: 'AGT-04', color: '#10b981', seeds: ['resumen', 'conclusion', 'contraste', 'ademas', 'permite', 'embargo'] },
    { id: 'SPDR-05', role: 'CORE-AI', cluster: 'AGT-01', color: '#f43f5e', seeds: ['sinapsis', 'grafo', 'conocimiento', 'nucleo', 'agente', 'memoria'] }
  ];

  const MICRO_AI_KEY = 'neural_spider_microai_v2';
  const microBrains = {};

  let canvas, ctx;
  let spiders = [];
  let shockwaves = [];
  let paused = false;
  let activeCount = 1;
  let lastFrameTime = 0;
  let fpsCounter = 60;
  let posCache = new Map();
  let harvestWindow = { at: Date.now(), count: 0 };
  let lastProgressEmit = 0;

  const store = () => root.NeuralStore;

  // ── Micro-IA ─────────────────────────────────────────────────────────────
  function initMicroBrains() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(MICRO_AI_KEY) || '{}'); } catch (_) {}
    AGENT_SPECS.forEach(spec => {
      const weights = new Map(Object.entries(saved[spec.id] || {}).filter(([k, v]) => /^[a-z0-9%]{1,64}$/.test(k) && Number.isFinite(v) && v >= 0 && v <= 5));
      spec.seeds.forEach(w => { if (!weights.has(U.stem(w))) weights.set(U.stem(w), 1.5); });
      microBrains[spec.id] = { weights, learnedTokens: weights.size };
    });
  }

  function saveMicroBrains() {
    try {
      const out = {};
      Object.keys(microBrains).forEach(id => {
        const entries = Array.from(microBrains[id].weights.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 120);
        out[id] = Object.fromEntries(entries);
      });
      localStorage.setItem(MICRO_AI_KEY, JSON.stringify(out));
    } catch (_) {}
  }

  function learnFromPattern(sp, text, reward) {
    const brain = microBrains[sp.id];
    if (!brain) return;
    U.tokens(text).forEach(t => {
      const prev = brain.weights.get(t) || 0.2;
      brain.weights.set(t, Math.min(5, prev + 0.25 * (reward || 1)));
    });
    brain.learnedTokens = brain.weights.size;
    saveMicroBrains();
  }

  function resetMicroBrains() {
    try { localStorage.removeItem(MICRO_AI_KEY); } catch (_) {}
    initMicroBrains();
  }

  // ── Puntuación de afinidad (normalizada) ─────────────────────────────────
  const RULES = {
    'DEF-AI': { re: /(es un|es una|se define|significa|concepto|modelo|sistema|arquitectura|consiste)/i, weight: 3.2 },
    'CAUSAL-AI': { re: /(cuando|si .* entonces|porque|por lo tanto|debido|causa|funcion|protocolo|implica)/i, weight: 3.2 },
    'QUANT-AI': { re: /(\d+(?:[.,]\d+)?\s*%|\d+\s*(ms|milisegundos|s|kb|mb|gb|epocas|años|nodos|veces)|\d{2,})/i, weight: 4.0 },
    'SYNTH-AI': { re: /(en resumen|en sintesis|en contraste|conclusion|sin embargo|ademas|permite|por ultimo)/i, weight: 3.0 },
    'CORE-AI': { re: /(sinapsis|grafo|red neuronal|conocimiento|nucleo|agente|memoria|indice|ontolog)/i, weight: 3.0 }
  };

  function scoreSentenceForSpider(sp, text, sentenceIndex) {
    const t = text;
    let score = 0;
    const rule = RULES[sp.role];
    if (rule && rule.re.test(t)) score += rule.weight;

    const brain = microBrains[sp.id];
    if (brain) {
      const toks = U.tokens(t);
      let learned = 0, hits = 0;
      toks.forEach(tok => {
        if (brain.weights.has(tok)) { learned += brain.weights.get(tok); hits++; }
      });
      // Normalización: media por token presente, con techo, para que el tamaño del vocabulario no domine
      if (hits) score += Math.min(3.5, (learned / Math.sqrt(hits)) * 0.6);
    }
    // Bonificación por posición temprana (los documentos suelen definir al principio)
    if (sentenceIndex < 3) score += 0.6;
    // Penaliza fragmentos vacíos o sin contenido semántico
    if (t.length < 40) score -= 1.2;
    return score;
  }

  // ── Cola de cosecha global ───────────────────────────────────────────────
  function candidates() {
    const S = store();
    if (!S) return [];
    return S.state.allSentences || [];
  }

  function pickNextSentence(sp) {
    const S = store();
    if (!S) return null;
    const doc = S.getActiveDoc();
    const activePage = S.state.activePage;
    const list = candidates();
    if (!list.length) return null;

    const available = list.filter(s => !s.harvested && !S.state.claimedTargets.has(s.id));
    if (!available.length) return null;

    // Prioriza la página visible (para que la animación tenga un destino real)
    const local = available.filter(s => doc && s.docId === doc.id && s.pageNum === activePage);
    const auto = document.getElementById('chk-auto-page');
    const mayNavigate = (!auto || auto.checked) && Date.now() >= (S.state.autoNavigationPausedUntil || 0);
    const pool = local.length ? local : (mayNavigate ? available : []);
    if (!pool.length) return null;

    let best = null, bestScore = -Infinity;
    // Muestreo acotado para mantener el coste por frame bajo
    const step = Math.max(1, Math.floor(pool.length / 40));
    for (let i = 0; i < pool.length; i += step) {
      const s = pool[i];
      const sc = scoreSentenceForSpider(sp, s.text, i) + Math.random() * 0.35;
      if (sc > bestScore) { bestScore = sc; best = s; }
    }
    if (!best) return null;

    // Si el objetivo no está en la página visible, se navega (si hay auto-página)
    if ((!doc || best.docId !== doc.id) && mayNavigate) S.setActiveDoc(best.docId, best.pageNum);
    else if (best.pageNum !== activePage && mayNavigate) S.setActivePage(best.pageNum);

    S.state.claimedTargets.add(best.id);
    sp.thought = `${sp.id} [${sp.role}]: analizando «${U.truncate(best.text, 34)}»`;
    return best;
  }

  function getSentenceScreenPos(sentenceId) {
    const cached = posCache.get(sentenceId);
    if (cached && Date.now() - cached.at < 600) return cached.pos;
    const el = Array.from(document.querySelectorAll('.sentence-block')).find(x => x.dataset.sid === sentenceId);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return { x: rect.left, y: rect.top };
    const zone = document.getElementById('doc-dropzone')?.getBoundingClientRect();
    if (zone && (rect.bottom < zone.top || rect.top > zone.bottom)) {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    }
    const pos = { x: rect.left + Math.min(rect.width * 0.5, 130), y: rect.top + rect.height * 0.5 };
    if (posCache.size > 600) posCache.clear();
    posCache.set(sentenceId, { pos, at: Date.now() });
    return pos;
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────
  function createSpider(index) {
    const spec = AGENT_SPECS[index % AGENT_SPECS.length];
    const arena = document.getElementById('panel-arena')?.getBoundingClientRect() || { left: 400, top: 200, width: 300, height: 300 };
    return Object.assign({}, spec, {
      x: arena.left + arena.width * 0.5 + (Math.random() - 0.5) * 50,
      y: arena.top + arena.height * 0.5 + (Math.random() - 0.5) * 50,
      angle: 0,
      phase: 'IDLE',
      phaseStart: performance.now(),
      targetSentence: null,
      targetPos: null,
      extractedPattern: null,
      legPhase: Math.random() * Math.PI * 2,
      harvestedCount: 0
    });
  }

  function setSpiderCount(count) {
    const S = store();
    const max = 5;
    activeCount = Math.max(1, Math.min(max, count));
    while (spiders.length < activeCount) spiders.push(createSpider(spiders.length));
    if (spiders.length > activeCount) {
      spiders.slice(activeCount).forEach(sp => {
        if (sp.targetSentence && S) S.state.claimedTargets.delete(sp.targetSentence.id);
      });
      spiders = spiders.slice(0, activeCount);
    }
    const el = document.getElementById('stat-spiders');
    if (el) el.textContent = `${spiders.length}/${max}`;
    if (S) S.emit('spiders:count', { count: spiders.length });
  }

  function releaseClaim(sp) {
    const S = store();
    if (S && sp.targetSentence) S.state.claimedTargets.delete(sp.targetSentence.id);
  }

  function extractPattern(sentence) {
    const label = U.words3(sentence.text).replace(/[.,;:]$/, '');
    return {
      cluster: null,
      label,
      text: U.truncate(sentence.text, 240),
      pageNum: sentence.pageNum,
      sentenceId: sentence.id,
      section: sentence.section || ''
    };
  }

  function updateSpider(sp, now, dt) {
    const S = store();
    if (!S) return;

    if (sp.phase !== 'IDLE' && now - sp.phaseStart > 3200) {
      releaseClaim(sp);
      sp.phase = 'IDLE';
      sp.targetSentence = null;
      sp.extractedPattern = null;
      sp.phaseStart = now;
    }

    if (sp.phase === 'IDLE') {
      const sent = pickNextSentence(sp);
      if (!sent) return;
      sp.targetSentence = sent;
      sp.targetPos = getSentenceScreenPos(sent.id);
      if (sp.targetPos) {
        sp.phase = 'IR_A_PALABRA';
        sp.phaseStart = now;
      } else {
        S.state.claimedTargets.delete(sent.id);
      }
      return;
    }

    if (sp.phase === 'IR_A_PALABRA') {
      const pos = getSentenceScreenPos(sp.targetSentence.id) || sp.targetPos;
      if (!pos) { releaseClaim(sp); sp.phase = 'IDLE'; return; }
      const dx = pos.x - sp.x, dy = pos.y - sp.y;
      const dist = Math.hypot(dx, dy);
      sp.angle = Math.atan2(dy, dx);
      const snap = isReduced();
      if (dist < 16 || snap) {
        sp.x = pos.x; sp.y = pos.y;
        sp.phase = 'EXTRAER_DATOS';
        sp.phaseStart = now;
      } else {
        const speed = 300 * dt;
        sp.x += (dx / dist) * speed;
        sp.y += (dy / dist) * speed;
        sp.legPhase += dt * 18;
      }
      return;
    }

    if (sp.phase === 'EXTRAER_DATOS') {
      sp.legPhase += dt * 10;
      if (now - sp.phaseStart > 420) {
        const pattern = extractPattern(sp.targetSentence);
        pattern.cluster = sp.cluster;
        pattern.color = sp.color;
        sp.extractedPattern = pattern;
        sp.phase = 'ARRASTRAR_A_RED';
        sp.phaseStart = now;
      }
      return;
    }

    if (sp.phase === 'ARRASTRAR_A_RED') {
      const hub = root.NeuralGraph.getHubScreenPos(sp.cluster);
      const dx = hub.x - sp.x, dy = hub.y - sp.y;
      const dist = Math.hypot(dx, dy);
      sp.angle = Math.atan2(dy, dx);
      if (dist < 20 || isReduced()) {
        sp.phase = 'ALIMENTAR_NODO';
        sp.phaseStart = now;
      } else {
        const speed = 320 * dt;
        sp.x += (dx / dist) * speed;
        sp.y += (dy / dist) * speed;
        sp.legPhase += dt * 18;
      }
      return;
    }

    if (sp.phase === 'ALIMENTAR_NODO') {
      if (sp.extractedPattern) {
        const p = sp.extractedPattern;
        sp.targetSentence.harvested = true;
        Array.from(document.querySelectorAll('.sentence-block')).find(x => x.dataset.sid === sp.targetSentence.id)?.classList.add('sentence-harvested');
        S.addPattern({
          cluster: p.cluster, label: p.label, text: p.text,
          pageNum: p.pageNum, sentenceId: p.sentenceId, color: p.color, section: p.section
        });
        learnFromPattern(sp, p.text + ' ' + p.label, 1);
        if (root.KimiAuxModel) root.KimiAuxModel.trainOnPattern(p.text, 1);
        if (root.NCMemory) root.NCMemory.vaultAdd({
          phrase: p.label, detail: p.text, cluster: p.cluster,
          pageNum: p.pageNum, sentenceId: p.sentenceId,
          docName: sp.targetSentence.docName
        });
        shockwaves.push({ x: sp.x, y: sp.y, r: 4, maxR: 38, color: sp.color, alpha: 1 });
        sp.harvestedCount++;
        harvestWindow.count++;
        const vocab = microBrains[sp.id]?.learnedTokens || 0;
        S.emit('spider:thought', {
          spiderId: sp.id, role: sp.role, color: sp.color,
          text: `${sp.id} (${sp.role}) aprendió «${p.label}» [vocab ${vocab}]`
        });
        releaseClaim(sp);
      }
      sp.extractedPattern = null;
      sp.targetSentence = null;
      sp.phase = 'IDLE';
      sp.phaseStart = now;
      emitProgress(now);
    }
  }

  function isReduced() {
    const S = store();
    if (S && S.getSetting && S.getSetting('reduceMotion')) return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function emitProgress(now) {
    if (now - lastProgressEmit < 900) return;
    lastProgressEmit = now;
    const S = store();
    if (!S) return;
    const total = S.state.allSentences.length || 0;
    const harvested = S.state.allSentences.filter(s => s.harvested).length;
    const elapsed = Math.max(1, (now - harvestWindow.at) / 1000);
    const rate = harvestWindow.count / elapsed;
    harvestWindow = { at: now, count: 0 };
    S.emit('harvest:progress', { harvested, total, rate, spiders: spiders.length });
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────
  function drawSpider(sp) {
    ctx.save();
    ctx.translate(sp.x, sp.y);

    if (sp.phase === 'ARRASTRAR_A_RED' && sp.extractedPattern) {
      ctx.fillStyle = sp.color;
      ctx.shadowColor = sp.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(-Math.cos(sp.angle) * 16, -Math.sin(sp.angle) * 16, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (sp.phase === 'EXTRAER_DATOS') {
      ctx.strokeStyle = sp.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(sp.angle) * 18, Math.sin(sp.angle) * 18);
      ctx.stroke();
    }

    ctx.rotate(sp.angle);
    ctx.scale(1.3, 1.3);

    const legColors = ['#00f0ff', '#a855f7', '#f59e0b', '#10b981'];
    ctx.lineWidth = 1.4;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const lc = legColors[i];
        const baseAngle = side * (0.45 + i * 0.36);
        const swing = Math.sin(sp.legPhase + i * 1.3 + (side > 0 ? 0 : Math.PI)) * 0.2;
        const kx = Math.cos(baseAngle + swing) * 11;
        const ky = Math.sin(baseAngle + swing) * 11;
        const fx = Math.cos(baseAngle + swing * 1.2) * 21;
        const fy = Math.sin(baseAngle + swing * 1.2) * 21;
        ctx.strokeStyle = lc;
        ctx.shadowColor = lc;
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(kx, ky);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.fillStyle = lc;
        ctx.beginPath();
        ctx.arc(fx, fy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#05080f';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      const hx = -6 + Math.cos(a) * 6.5, hy = Math.sin(a) * 6.5;
      if (k === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      const hx = 4 + Math.cos(a) * 4.5, hy = Math.sin(a) * 4.5;
      if (k === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(4, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.05, (lastFrameTime ? (now - lastFrameTime) / 1000 : 0.016));
    fpsCounter = Math.round(fpsCounter * 0.9 + (1 / Math.max(0.001, dt)) * 0.1);
    lastFrameTime = now;

    const fpsEl = document.getElementById('stat-fps');
    if (fpsEl && Math.random() < 0.08) fpsEl.textContent = Math.min(60, fpsCounter);

    if (canvas && (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight)) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

    const docRect = document.getElementById('panel-doc')?.getBoundingClientRect();
    const arenaRect = document.getElementById('panel-arena')?.getBoundingClientRect();
    if (ctx) {
      ctx.save();
      ctx.beginPath();
      if (docRect) ctx.rect(docRect.left, docRect.top, docRect.width, docRect.height);
      if (arenaRect) ctx.rect(arenaRect.left, arenaRect.top, arenaRect.width, arenaRect.height);
      ctx.clip();
    }

    if (!paused && !document.hidden) {
      spiders.forEach(sp => updateSpider(sp, now, dt));
      applyRepulsion();
    }

    if (ctx) {
      spiders.forEach(sp => drawSpider(sp));

      shockwaves = shockwaves.filter(sw => sw.alpha > 0.05);
      shockwaves.forEach(sw => {
        sw.r += 1.8;
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
    }

    requestAnimationFrame(loop);
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

  // ── Arranque ─────────────────────────────────────────────────────────────
  function init() {
    const S = store();
    if (!S) return;
    initMicroBrains();
    canvas = document.getElementById('spider-canvas');
    if (canvas) {
      ctx = canvas.getContext('2d');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    setSpiderCount(1);
    if (ctx) requestAnimationFrame(loop);

    document.getElementById('btn-mitosis')?.addEventListener('click', () => {
      setSpiderCount(activeCount < 5 ? activeCount + 1 : 1);
      S.emit('spiders:mitosis', { count: activeCount });
    });

    const btnPause = document.getElementById('btn-toggle-spiders');
    btnPause?.addEventListener('click', () => {
      paused = !paused;
      btnPause.textContent = paused ? '▶' : 'Ⅱ';
      btnPause.setAttribute('aria-label', paused ? 'Reanudar enjambre' : 'Pausar enjambre');
      btnPause.title = paused ? 'Reanudar enjambre' : 'Pausar enjambre';
      S.emit('spiders:paused', { paused });
    });

    S.on('doc:added', doc => {
      const totalChars = (doc.pages || []).reduce((acc, p) => acc + (p.text || '').length, 0);
      const target = Math.min(5, Math.max(1, Math.ceil(totalChars / 2200)));
      setSpiderCount(target);
      emitProgress(performance.now());
      if (S.getSetting('autoHarvest', true) === false) paused = true;
    });

    S.on('spider:dispatchToSentence', ({ sentence }) => {
      if (!sentence) return;
      const sp = spiders[0];
      if (!sp) return;
      if (sp.targetSentence) S.state.claimedTargets.delete(sp.targetSentence.id);
      sp.targetSentence = sentence;
      sp.targetPos = getSentenceScreenPos(sentence.id);
      sp.phase = 'IR_A_PALABRA';
      sp.phaseStart = performance.now();
      S.state.claimedTargets.add(sentence.id);
    });

    S.on('spider:queryVisual', ({ nodeIds }) => {
      const sp = spiders[spiders.length - 1] || spiders[0];
      if (!sp) return;
      shockwaves.push({ x: sp.x, y: sp.y, r: 6, maxR: 54, color: '#fbbf24', alpha: 1 });
      const hub = root.NeuralGraph.getHubScreenPos(sp.cluster);
      sp.targetPos = hub;
      sp.angle = Math.atan2(hub.y - sp.y, hub.x - sp.x);
      if (nodeIds && nodeIds.length) root.NeuralGraph.highlightPath(nodeIds);
    });

    S.on('system:reset', () => {
      resetMicroBrains();
      posCache.clear();
      setSpiderCount(1);
      paused = false;
      if (btnPause) { btnPause.textContent = 'Ⅱ'; btnPause.title = 'Pausar enjambre'; btnPause.setAttribute('aria-label', 'Pausar enjambre'); }
    });

    // Ciclo de sueño: consolidación periódica de la bóveda
    setInterval(() => {
      if (document.hidden) return;
      if (root.NCMemory && S.state.vault.length > 20) root.NCMemory.consolidate();
    }, 45000);
  }

  root.SpiderEngine = { init, setSpiderCount, AGENT_SPECS, microBrains, reloadMicroBrains: initMicroBrains,
    getStatus: () => ({ paused, spiders: spiders.map(({ id, role, cluster, phase }) => ({ id, role, cluster, phase })) }) };
})(typeof window !== 'undefined' ? window : globalThis);
