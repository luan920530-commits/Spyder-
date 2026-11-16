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
  // Las telarañas son efímeras y solo viven en el lienzo; nunca en el store.
  let idleWebs = [], idleTime = 0;
  let lastViewportWidth = 0, lastViewportHeight = 0;
  let paused = false;
  let activeCount = 1;
  let lastFrameTime = 0;
  let fpsCounter = 60;
  let animationTime = 0, scanOwner = null;
  let lastScrollX = 0, lastScrollY = 0, lastLayout = null;
  let harvestWindow = { at: 0, count: 0 };
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

  function sentenceElement(id) {
    if (root.DocViewer?.getSentenceElement) return root.DocViewer.getSentenceElement(id);
    const content = document.getElementById('doc-content');
    return content ? Array.from(content.querySelectorAll('.sentence-block')).find(el => el.dataset.sid === id) : null;
  }
  function firstWord(element) { return element?.querySelector('.word-span') || element; }
  function rectOf(element) {
    if (!element) return null;
    const rects = element.getClientRects ? Array.from(element.getClientRects()) : [];
    return rects.find(r => r.width && r.height) || element.getBoundingClientRect();
  }
  function isWordVisible(word) {
    const zone = document.getElementById('doc-dropzone');
    const r = rectOf(word), z = zone?.getBoundingClientRect();
    if (!r || !z) return false;
    // jsdom no calcula geometría; se mantiene ejecutable en las pruebas.
    if (!r.width && !r.height) return true;
    return r.top >= z.top + 2 && r.bottom <= z.bottom - 2;
  }
  function wordPosition(word, reveal) {
    const zone = document.getElementById('doc-dropzone');
    if (!word || !zone) return null;
    let r = rectOf(word), z = zone.getBoundingClientRect();
    if (!r) return null;
    if (reveal && r.height && z.height) {
      let delta = 0;
      if (r.top < z.top + 6) delta = r.top - z.top - 6;
      else if (r.bottom > z.bottom - 6) delta = r.bottom - z.bottom + 6;
      // Solo desplaza el interior del documento, nunca la ventana completa.
      if (delta) { zone.scrollTop += delta; r = rectOf(word); }
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function documentBusy(except) {
    return spiders.some(other => other !== except && other.targetSentence &&
      (other.phase === 'IR_A_PALABRA' || other.phase === 'EXTRAER_DATOS'));
  }
  function pickNextSentence(sp) {
    const S = store();
    if (!S) return null;
    const doc = S.getActiveDoc(), page = S.state.activePage;
    const available = candidates().filter(s => !s.harvested && !S.state.claimedTargets.has(s.id));
    if (!available.length) return null;
    const local = available.filter(s => doc && s.docId === doc.id && s.pageNum === page);
    const auto = document.getElementById('chk-auto-page');
    const mayNavigate = (!auto || auto.checked) && Date.now() >= (S.state.autoNavigationPausedUntil || 0);
    let pool;
    if (local.length) {
      const visible = local.filter(s => {
        const el = sentenceElement(s.id);
        return !el || isWordVisible(firstWord(el));
      });
      if (visible.length) pool = visible;
      else if (!documentBusy(sp)) pool = local;
      else return null; // No desplazar el texto que otra araña está escaneando.
    } else {
      if (!mayNavigate || documentBusy(sp)) return null;
      pool = available;
    }
    let best = null, bestScore = -Infinity;
    const step = Math.max(1, Math.floor(pool.length / 40));
    for (let i = 0; i < pool.length; i += step) {
      const sentence = pool[i];
      const score = scoreSentenceForSpider(sp, sentence.text, i) + Math.random() * .35;
      if (score > bestScore) { bestScore = score; best = sentence; }
    }
    if (!best) return null;
    if ((!doc || best.docId !== doc.id) && mayNavigate) S.setActiveDoc(best.docId, best.pageNum);
    else if (best.pageNum !== page && mayNavigate) S.setActivePage(best.pageNum);
    S.state.claimedTargets.add(best.id);
    sp.thought = `${sp.id} [${sp.role}]: analizando «${U.truncate(best.text, 34)}»`;
    return best;
  }

  // El clic en la red solicita trabajo real: no interrumpe ni inventa cosechas.
  function dispatchFromNetwork(options = {}) {
    const S = store();
    if (!S || !candidates().length) return { sent: 0, reason: 'no-document' };
    if (paused) return { sent: 0, reason: 'paused' };
    if (!candidates().some(sentence => !sentence.harvested)) return { sent: 0, reason: 'complete' };
    const { cluster, x, y } = options;
    const hasOrigin = Number.isFinite(x) && Number.isFinite(y);
    const idle = spiders.filter(sp => sp.phase === 'IDLE').sort((a, b) => {
      const preference = Number(b.cluster === cluster) - Number(a.cluster === cluster);
      return preference || (hasOrigin ? Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) : 0);
    });
    if (!idle.length) return { sent: 0, reason: 'busy' };
    let sent = 0;
    for (const sp of idle.slice(0, 3)) {
      // pickNextSentence reserva el ID y respeta la página, el escáner y AUTO.
      const sentence = pickNextSentence(sp);
      if (!sentence) break;
      sp.targetSentence = sentence; sp.phase = 'IR_A_PALABRA'; sp.phaseStart = animationTime; sp.route = null;
      sent++;
    }
    if (sent) S.emit('spiders:dispatched', { count: sent, source: 'network' });
    return { sent, reason: sent ? 'sent' : 'unavailable' };
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────
  function createSpider(index) {
    const spec = AGENT_SPECS[index % AGENT_SPECS.length];
    const arena = document.getElementById('arena-stage')?.getBoundingClientRect() || { left: 400, top: 200, width: 300, height: 300 };
    const size = Math.min(arena.width, arena.height * 1.15), angle = index * Math.PI * 2 / 5 + .3;
    return Object.assign({}, spec, {
      // En móvil la arena puede estar fuera de la pantalla al arrancar.
      x: root.NCSpiderPaths.bound(arena.left + arena.width * .19 + Math.cos(angle) * size * .085, 16, Math.max(16, window.innerWidth - 16)),
      y: root.NCSpiderPaths.bound(arena.top + arena.height * .46 + Math.sin(angle) * size * .085, 16, Math.max(16, window.innerHeight - 16)),
      angle: 0, phase: 'IDLE', phaseStart: animationTime,
      targetSentence: null, extractedPattern: null, scanWords: [], scanIndex: -1,
      route: null, routeSignature: '', lane: (index - 2) * 5, nextPickAt: animationTime,
      legPhase: Math.random() * Math.PI * 2, idle: null, idleStarted: false, harvestedCount: 0
    });
  }
  function clearScan(sp) {
    if (sp.scanElement) {
      sp.scanElement.classList.remove('sentence-scanning');
      sp.scanElement.style.removeProperty('--spider-scan-color');
    }
    (sp.scanWords || []).forEach(word => word.classList.remove('word-scanned', 'word-scanning'));
    sp.scanWords = []; sp.scanElement = null; sp.scanIndex = -1;
    if (scanOwner === sp) scanOwner = null;
  }
  function releaseClaim(sp) {
    const S = store();
    if (S && sp.targetSentence) S.state.claimedTargets.delete(sp.targetSentence.id);
  }
  function cancelTarget(sp) {
    clearScan(sp); releaseClaim(sp);
    if (sp.idle?.kind === 'weave') idleWebs = idleWebs.filter(web => web !== sp.idle.web);
    sp.phase = 'IDLE'; sp.targetSentence = null; sp.extractedPattern = null;
    sp.route = null; sp.routeSignature = ''; sp.idle = null; sp.phaseStart = animationTime; sp.nextPickAt = animationTime + 200;
  }
  function setSpiderCount(count) {
    const S = store(), max = 5;
    activeCount = Math.max(1, Math.min(max, count));
    while (spiders.length < activeCount) spiders.push(createSpider(spiders.length));
    if (spiders.length > activeCount) {
      const removed = spiders.slice(activeCount);
      const removedIds = new Set(removed.map(sp => sp.id));
      removed.forEach(cancelTarget);
      idleWebs = idleWebs.filter(web => !removedIds.has(web.owner));
      spiders = spiders.slice(0, activeCount);
    }
    const el = document.getElementById('stat-spiders');
    if (el) el.textContent = `${spiders.length}/${max}`;
    if (S) S.emit('spiders:count', { count: spiders.length });
  }
  function extractPattern(sentence) {
    const label = U.words3(sentence.text).replace(/[.,;:]$/, '');
    return { cluster: null, label, text: U.truncate(sentence.text, 240), pageNum: sentence.pageNum,
      sentenceId: sentence.id, section: sentence.section || '' };
  }
  function layout() {
    const doc = document.getElementById('doc-dropzone')?.getBoundingClientRect();
    const arena = document.getElementById('arena-stage')?.getBoundingClientRect();
    if (!doc || !arena) return null;
    const signature = [doc.left, doc.top, doc.right, doc.bottom, arena.left, arena.top, arena.right, arena.bottom].map(n => Math.round(n)).join(':');
    return { doc, arena, signature };
  }
  function within(point, r) {
    return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
  }
  function distanceToRect(point, r) {
    return Math.hypot(Math.max(r.left - point.x, 0, point.x - r.right), Math.max(r.top - point.y, 0, point.y - r.bottom));
  }
  function projectBetween(point, from, to) {
    if (!from.width || !from.height || !to.width || !to.height) return;
    const x = root.NCSpiderPaths.bound((point.x - from.left) / from.width, 0, 1);
    const y = root.NCSpiderPaths.bound((point.y - from.top) / from.height, 0, 1);
    point.x = to.left + x * to.width; point.y = to.top + y * to.height;
  }
  function syncViewport(frame) {
    const x = window.scrollX || 0, y = window.scrollY || 0;
    const dx = x - lastScrollX, dy = y - lastScrollY;
    const width = window.innerWidth || 1, height = window.innerHeight || 1;
    if (lastViewportWidth && (width !== lastViewportWidth || height !== lastViewportHeight)) {
      // Las decoraciones pertenecen a la pantalla, no a los paneles ni al documento.
      spiders.filter(sp => sp.phase === 'IDLE').forEach(sp => {
        sp.x = sp.x / lastViewportWidth * width; sp.y = sp.y / lastViewportHeight * height; sp.idle = null;
      });
      idleWebs = [];
    }
    if (dx || dy) {
      // Solo las tareas reales permanecen ancladas a la página al desplazarse.
      spiders.filter(sp => sp.phase !== 'IDLE').forEach(sp => { sp.x -= dx; sp.y -= dy; });
      shockwaves.forEach(sw => { sw.x -= dx; sw.y -= dy; });
    } else if (frame && lastLayout && frame.signature !== lastLayout.signature) {
      // Al cambiar de columnas a filas, conserva la posición relativa en el panel.
      spiders.filter(sp => sp.phase !== 'IDLE').forEach(sp => {
        const useDoc = within(sp, lastLayout.doc) || (!within(sp, lastLayout.arena) &&
          distanceToRect(sp, lastLayout.doc) <= distanceToRect(sp, lastLayout.arena));
        projectBetween(sp, useDoc ? lastLayout.doc : lastLayout.arena, useDoc ? frame.doc : frame.arena);
        sp.route = null;
      });
    }
    lastViewportWidth = width; lastViewportHeight = height;
    lastScrollX = x; lastScrollY = y; lastLayout = frame;
  }
  function travel(sp, target, toDocument, dt) {
    const frame = layout();
    if (!frame) return false;
    if (!sp.route || sp.routeSignature !== frame.signature || (!sp.route.length && Math.hypot(target.x - sp.x, target.y - sp.y) > 2)) {
      const alreadyThere = toDocument ? within(sp, frame.doc) : within(sp, frame.arena);
      sp.route = alreadyThere ? [target] : root.NCSpiderPaths.route(frame.doc, frame.arena, target, toDocument, sp.lane);
      sp.routeSignature = frame.signature;
    } else if (sp.route.length) sp.route[sp.route.length - 1] = target;
    if (isReduced()) { sp.x = target.x; sp.y = target.y; sp.route = []; return true; }
    const move = root.NCSpiderPaths.advance(sp, sp.route, 430 * dt);
    if (!move.done) sp.angle = move.angle;
    sp.legPhase += dt * 18;
    return move.done;
  }
  // ── Reposo visual ────────────────────────────────────────────────────────
  // El paseo usa coordenadas del viewport y un reloj propio. Ningún hilo o
  // destino decorativo es una frase, una reserva, un nodo ni un patrón.
  function clearIdleAnimations() {
    if (!idleWebs.length && !spiders.some(sp => sp.idle)) return;
    idleWebs = [];
    spiders.forEach(sp => { sp.idle = null; });
  }
  function chooseIdleDestination(sp) {
    const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    const first = !sp.idleStarted, startNearby = first && spiders.indexOf(sp) % 2 === 0;
    let radius = Math.min(62, Math.max(12, Math.min(width, height) * (.09 + Math.random() * .035)));
    if (startNearby) radius = Math.min(radius, 24); // Un primer tejido rápido; las demás ya salen a pasear.
    const insetX = Math.min(width / 2, radius + 18), insetY = Math.min(height / 2, radius + 18);
    const bound = root.NCSpiderPaths.bound;
    sp.x = bound(sp.x, 16, Math.max(16, width - 16));
    sp.y = bound(sp.y, 16, Math.max(16, height - 16));
    let x = startNearby ? bound(sp.x + (Math.random() - .5) * 48, insetX, width - insetX) :
      insetX + Math.random() * Math.max(0, width - insetX * 2);
    let y = startNearby ? bound(sp.y + (Math.random() - .5) * 48, insetY, height - insetY) :
      insetY + Math.random() * Math.max(0, height - insetY * 2);
    if (!startNearby && Math.hypot(x - sp.x, y - sp.y) < Math.min(width, height) * .18) {
      x = width - x; y = height - y;
    }
    sp.idleStarted = true;
    sp.idle = { kind: 'travel', target: { x, y }, radius };
  }
  function beginIdleWeb(sp, radius) {
    const center = { x: sp.x, y: sp.y }, points = 7;
    const rotation = Math.random() * Math.PI * 2;
    const web = { owner: sp.id, strokes: [], expiresAt: null };
    const steps = [];
    let previous = center;
    const point = (fraction, i) => ({ x: center.x + Math.cos(rotation + i * Math.PI * 2 / points) * radius * fraction,
      y: center.y + Math.sin(rotation + i * Math.PI * 2 / points) * radius * fraction });
    function step(next, draw) {
      const stroke = draw ? { x1: previous.x, y1: previous.y, x2: next.x, y2: next.y, progress: 0 } : null;
      if (stroke) web.strokes.push(stroke);
      steps.push({ x: next.x, y: next.y, stroke });
      previous = next;
    }
    // Primero los radios; después dos anillos. La araña recorre el mismo trazo
    // que aparece, en vez de crear de golpe una red de datos ficticia.
    for (let i = 0; i < points; i++) { step(point(1, i), true); step(center, false); }
    step(point(.45, 0), true);
    for (let i = 1; i <= points; i++) step(point(.45, i), true);
    step(point(1, 0), true);
    for (let i = 1; i <= points; i++) step(point(1, i), true);
    idleWebs.push(web);
    if (idleWebs.length > 8) idleWebs.shift();
    sp.idle = { kind: 'weave', web, steps, index: 0 };
  }
  function moveIdle(sp, target, distance) {
    const dx = target.x - sp.x, dy = target.y - sp.y, length = Math.hypot(dx, dy);
    const moved = Math.min(length, distance);
    if (length > .001) {
      sp.angle = Math.atan2(dy, dx);
      sp.x += dx / length * moved; sp.y += dy / length * moved;
      sp.legPhase += moved * .12;
    }
    return { arrived: length - moved < .01, remaining: Math.max(0, distance - moved) };
  }
  function updateIdle(sp, dt) {
    let remaining = 160 * dt, guard = 0;
    while (remaining > .001 && guard++ < 80) {
      if (!sp.idle) chooseIdleDestination(sp);
      const idle = sp.idle;
      if (idle.kind === 'travel') {
        const move = moveIdle(sp, idle.target, remaining); remaining = move.remaining;
        if (!move.arrived) break;
        beginIdleWeb(sp, idle.radius);
      } else {
        const step = idle.steps[idle.index];
        if (!step) {
          idle.web.expiresAt = idleTime + 20000;
          sp.idle = null;
          continue;
        }
        const move = moveIdle(sp, step, remaining); remaining = move.remaining;
        if (step.stroke) {
          const total = Math.hypot(step.stroke.x2 - step.stroke.x1, step.stroke.y2 - step.stroke.y1);
          const left = Math.hypot(step.stroke.x2 - sp.x, step.stroke.y2 - sp.y);
          step.stroke.progress = total ? Math.max(0, Math.min(1, 1 - left / total)) : 1;
        }
        if (!move.arrived) break;
        if (step.stroke) step.stroke.progress = 1;
        idle.index++;
      }
    }
  }
  function drawIdleWebs() {
    ctx.save();
    ctx.strokeStyle = '#83cce0'; ctx.lineWidth = .8; ctx.lineCap = 'round';
    idleWebs.forEach(web => {
      const fade = web.expiresAt === null ? 1 : Math.max(0, Math.min(1, (web.expiresAt - idleTime) / 5000));
      ctx.globalAlpha = .35 * fade;
      web.strokes.forEach(stroke => {
        if (stroke.progress <= 0) return;
        ctx.beginPath(); ctx.moveTo(stroke.x1, stroke.y1);
        ctx.lineTo(stroke.x1 + (stroke.x2 - stroke.x1) * stroke.progress,
          stroke.y1 + (stroke.y2 - stroke.y1) * stroke.progress);
        ctx.stroke();
      });
    });
    ctx.restore();
  }
  function beginScan(sp, element, now) {
    scanOwner = sp;
    sp.scanElement = element;
    sp.scanWords = Array.from(element.querySelectorAll('.word-span')).slice(0, 18);
    if (!sp.scanWords.length) sp.scanWords = [element];
    sp.scanIndex = -1;
    element.classList.add('sentence-scanning');
    element.style.setProperty('--spider-scan-color', sp.color);
    sp.phase = 'EXTRAER_DATOS'; sp.phaseStart = now; sp.route = null;
    store()?.emit('spider:scanStart', { spiderId: sp.id, sentenceId: sp.targetSentence.id });
  }
  function updateScan(sp, now) {
    if (!sp.scanElement?.isConnected) { cancelTarget(sp); return; }
    const words = sp.scanWords, durationPerWord = 105;
    const progress = isReduced() ? words.length : (now - sp.phaseStart) / durationPerWord;
    const index = Math.min(words.length - 1, Math.floor(progress));
    if (index !== sp.scanIndex) {
      if (sp.scanIndex >= 0 && words[sp.scanIndex]) words[sp.scanIndex].classList.remove('word-scanning');
      for (let i = Math.max(0, sp.scanIndex + 1); i <= index; i++) words[i].classList.add('word-scanned');
      words[index].classList.add('word-scanning');
      sp.scanIndex = index;
    }
    const current = wordPosition(words[index], true);
    const next = index + 1 < words.length && isWordVisible(words[index + 1]) ? wordPosition(words[index + 1], false) : current;
    if (current) {
      const fraction = Math.min(1, Math.max(0, progress - index));
      const eased = fraction * fraction * (3 - 2 * fraction);
      const x = current.x + ((next?.x ?? current.x) - current.x) * eased;
      const y = current.y + ((next?.y ?? current.y) - current.y) * eased;
      if (Math.hypot(x - sp.x, y - sp.y) > .5) sp.angle = Math.atan2(y - sp.y, x - sp.x);
      sp.x = x; sp.y = y;
    }
    sp.legPhase += .12;
    if (progress < words.length) return;
    const pattern = extractPattern(sp.targetSentence);
    pattern.cluster = sp.cluster; pattern.color = sp.color;
    sp.extractedPattern = pattern;
    clearScan(sp);
    sp.phase = 'ARRASTRAR_A_RED'; sp.phaseStart = now; sp.route = null;
    store()?.emit('spider:extracted', { spiderId: sp.id, sentenceId: sp.targetSentence.id, label: pattern.label });
  }
  function updateSpider(sp, now, dt) {
    const S = store();
    if (!S) return;
    if (sp.phase !== 'IDLE' && now - sp.phaseStart > 30000) { cancelTarget(sp); return; }
    if (sp.targetSentence && !S.getSentence(sp.targetSentence.id)) { cancelTarget(sp); return; }
    if (sp.phase === 'IDLE') {
      // El trabajo real tiene prioridad sobre el paseo; no recorrer el corpus 60 veces/s.
      if (now < sp.nextPickAt) return;
      sp.nextPickAt = now + 300;
      const sent = pickNextSentence(sp);
      if (!sent) return;
      sp.targetSentence = sent; sp.phase = 'IR_A_PALABRA'; sp.phaseStart = now; sp.route = null;
      return;
    }
    if (sp.phase === 'IR_A_PALABRA') {
      // Si el usuario cambia de página, no se usa la posición obsoleta de otro texto.
      if (S.state.activeDocId !== sp.targetSentence.docId || S.state.activePage !== sp.targetSentence.pageNum) { cancelTarget(sp); return; }
      const element = sentenceElement(sp.targetSentence.id), word = firstWord(element);
      if (!element || !word) return; // El visor puede estar esperando su siguiente render.
      if (!isWordVisible(word) && scanOwner && scanOwner !== sp) return;
      const pos = wordPosition(word, !scanOwner || scanOwner === sp);
      if (!pos) return;
      if (travel(sp, pos, true, dt) && (!scanOwner || scanOwner === sp)) beginScan(sp, element, now);
      return;
    }
    if (sp.phase === 'EXTRAER_DATOS') { updateScan(sp, now); return; }
    if (sp.phase === 'ARRASTRAR_A_RED') {
      const hub = root.NeuralGraph.getHubScreenPos(sp.cluster);
      if (travel(sp, hub, false, dt)) { sp.phase = 'ALIMENTAR_NODO'; sp.phaseStart = now; sp.route = null; }
      return;
    }
    if (sp.phase === 'ALIMENTAR_NODO') {
      if (sp.extractedPattern) {
        const p = sp.extractedPattern;
        // Un clic sobre un pasaje ya cosechado puede repetirse visualmente sin duplicar el aprendizaje.
        const fresh = !sp.targetSentence.harvested;
        sp.targetSentence.harvested = true;
        sentenceElement(sp.targetSentence.id)?.classList.add('sentence-harvested');
        if (fresh) {
          S.addPattern({ cluster: p.cluster, label: p.label, text: p.text, pageNum: p.pageNum,
            sentenceId: p.sentenceId, color: p.color, section: p.section });
          learnFromPattern(sp, p.text + ' ' + p.label, 1);
          root.KimiAuxModel?.trainOnPattern(p.text, 1);
          root.NCMemory?.vaultAdd({ phrase: p.label, detail: p.text, cluster: p.cluster,
            pageNum: p.pageNum, sentenceId: p.sentenceId, docName: sp.targetSentence.docName });
          sp.harvestedCount++; harvestWindow.count++;
        }
        if (!isReduced()) shockwaves.push({ x: sp.x, y: sp.y, r: 4, maxR: 38, color: sp.color, alpha: 1 });
        S.emit('spider:delivered', { spiderId: sp.id, sentenceId: p.sentenceId, cluster: p.cluster, fresh });
        S.emit('spider:thought', { spiderId: sp.id, role: sp.role, color: sp.color,
          text: `${sp.id} (${sp.role}) llevó «${p.label}» a la red` });
      }
      cancelTarget(sp); emitProgress(now);
    }
  }

  function isReduced() {
    const S = store();
    if (S && S.getSetting && S.getSetting('reduceMotion')) return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function emitProgress(now, force) {
    if (!force && now - lastProgressEmit < 900) return;
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

    if (sp.phase === 'IDLE' && sp.idle?.kind === 'travel') {
      // Un hilo tenue acompaña el paseo, sin textos ni señales de cosecha.
      ctx.strokeStyle = '#b6e3ed'; ctx.globalAlpha = .24; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-Math.cos(sp.angle) * 19, -Math.sin(sp.angle) * 19); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (sp.phase === 'ARRASTRAR_A_RED' && sp.extractedPattern) {
      // La cápsula contiene palabras reales del pasaje que viaja al nodo.
      const label = U.truncate(sp.extractedPattern.label || 'pasaje', 26);
      const trailX = -Math.cos(sp.angle) * 28, trailY = -Math.sin(sp.angle) * 28;
      ctx.strokeStyle = sp.color; ctx.shadowColor = sp.color; ctx.shadowBlur = 7; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(trailX, trailY); ctx.stroke();
      ctx.font = '600 9px monospace';
      const boxWidth = Math.min(160, ctx.measureText(label).width + 17);
      const boxX = trailX - boxWidth / 2, boxY = trailY - 24;
      ctx.fillStyle = 'rgba(4, 10, 16, .94)'; ctx.fillRect(boxX, boxY, boxWidth, 16);
      ctx.strokeStyle = sp.color; ctx.strokeRect(boxX, boxY, boxWidth, 16);
      ctx.fillStyle = sp.color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, boxX + 8, boxY + 8);
    }
    if (sp.phase === 'EXTRAER_DATOS') {
      // Los haces apuntan exclusivamente a palabras visibles del pasaje real.
      ctx.strokeStyle = sp.color; ctx.shadowColor = sp.color; ctx.shadowBlur = 5; ctx.lineWidth = .7;
      for (let i = Math.max(0, sp.scanIndex + 1); i < Math.min(sp.scanWords.length, sp.scanIndex + 4); i++) {
        const word = sp.scanWords[i];
        if (!isWordVisible(word)) continue;
        const pos = wordPosition(word, false);
        if (pos) { ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(pos.x - sp.x, pos.y - sp.y); ctx.stroke(); }
      }
      ctx.globalAlpha = .85; ctx.save(); ctx.rotate(isReduced() ? 0 : animationTime / 500);
      ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
    }

    const frame = lastLayout || layout();
    const size = frame ? Math.max(6, Math.min(11, Math.min(frame.arena.width, frame.arena.height * 1.15) * .014)) : 8;
    const lit = sp.phase === 'EXTRAER_DATOS' || (sp.phase === 'ARRASTRAR_A_RED' && sp.extractedPattern);
    root.NCSpiderVisual.draw(ctx, { x: 0, y: 0, angle: sp.angle, size,
      color: lit ? sp.color : '#bee8ff', core: lit ? sp.color : null,
      phase: sp.legPhase, moving: !isReduced() && (sp.phase === 'IR_A_PALABRA' || sp.phase === 'EXTRAER_DATOS' || sp.phase === 'ARRASTRAR_A_RED' || (sp.phase === 'IDLE' && !!sp.idle)),
      time: isReduced() ? 0 : animationTime / 1000 });
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(.05, (lastFrameTime ? (now - lastFrameTime) / 1000 : .016));
    fpsCounter = Math.round(fpsCounter * .9 + (1 / Math.max(.001, dt)) * .1);
    lastFrameTime = now;
    const fpsEl = document.getElementById('stat-fps');
    if (fpsEl && Math.random() < .08) fpsEl.textContent = Math.min(60, fpsCounter);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas && (canvas.width !== Math.round(window.innerWidth * ratio) || canvas.height !== Math.round(window.innerHeight * ratio))) {
      canvas.width = Math.round(window.innerWidth * ratio); canvas.height = Math.round(window.innerHeight * ratio);
    }
    if (ctx) { ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
    const frame = layout();
    syncViewport(frame);
    const running = !paused && !document.hidden;
    if (running) {
      animationTime += dt * 1000;
      spiders.forEach(sp => updateSpider(sp, animationTime, dt));
    }
    const working = spiders.some(sp => sp.phase !== 'IDLE');
    if (working) clearIdleAnimations();
    else if (running && !isReduced()) {
      idleTime += dt * 1000;
      spiders.forEach(sp => updateIdle(sp, dt));
      idleWebs = idleWebs.filter(web => web.expiresAt === null || web.expiresAt > idleTime);
    }
    if (ctx) {
      // El reposo puede aparecer en cualquier punto visible y no intercepta clics.
      if (!working) drawIdleWebs();
      spiders.filter(sp => sp.phase === 'IDLE').forEach(drawSpider);
      // El trabajo real sigue limitado al visor, la red y su corredor.
      ctx.save(); ctx.beginPath();
      if (frame) {
        const { doc, arena } = frame;
        ctx.rect(doc.left, doc.top, doc.width, doc.height);
        ctx.rect(arena.left, arena.top, arena.width, arena.height);
        const bridge = root.NCSpiderPaths.portals(doc, arena, { x: doc.left + doc.width / 2, y: doc.top + doc.height / 2 }).bridge;
        if (bridge && bridge.right > bridge.left && bridge.bottom > bridge.top)
          ctx.rect(bridge.left, bridge.top, bridge.right - bridge.left, bridge.bottom - bridge.top);
      }
      ctx.clip();
      spiders.filter(sp => sp.phase !== 'IDLE').forEach(drawSpider);
      shockwaves = shockwaves.filter(sw => sw.alpha > .05);
      shockwaves.forEach(sw => {
        if (running) { sw.r += 1.8; sw.alpha *= .9; }
        ctx.strokeStyle = sw.color; ctx.globalAlpha = sw.alpha; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      });
      ctx.restore();
    }
    requestAnimationFrame(loop);
  }

  // ── Arranque ─────────────────────────────────────────────────────────────
  function init() {
    const S = store();
    if (!S) return;
    initMicroBrains();
    lastScrollX = window.scrollX || 0; lastScrollY = window.scrollY || 0; lastLayout = layout();
    lastViewportWidth = window.innerWidth || 1; lastViewportHeight = window.innerHeight || 1;
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
    function setPaused(value) {
      paused = value;
      if (btnPause) {
        btnPause.textContent = paused ? '▶' : 'Ⅱ';
        btnPause.setAttribute('aria-label', paused ? 'Reanudar enjambre' : 'Pausar enjambre');
        btnPause.title = paused ? 'Reanudar enjambre' : 'Pausar enjambre';
      }
      S.emit('spiders:paused', { paused });
    }
    btnPause?.addEventListener('click', () => setPaused(!paused));

    S.on('doc:added', doc => {
      const totalChars = (doc.pages || []).reduce((acc, p) => acc + (p.text || '').length, 0);
      const target = Math.min(5, Math.max(1, Math.ceil(totalChars / 2200)));
      setSpiderCount(target);
      emitProgress(animationTime, true);
      if (S.getSetting('autoHarvest', true) === false) setPaused(true);
    });

    S.on('spider:dispatchToSentence', ({ sentence }) => {
      if (!sentence || S.state.claimedTargets.has(sentence.id)) return;
      const sp = spiders.find(candidate => candidate.phase === 'IDLE');
      if (!sp) { root.DocViewer?.toast('Las arañas están ocupadas; vuelve a intentarlo en un momento.'); return; }
      sp.targetSentence = sentence; sp.phase = 'IR_A_PALABRA'; sp.phaseStart = animationTime; sp.route = null;
      S.state.claimedTargets.add(sentence.id);
    });

    S.on('doc:pageChanged', ({ docId, pageNum }) => {
      spiders.forEach(sp => {
        if (sp.targetSentence && ['IR_A_PALABRA', 'EXTRAER_DATOS'].includes(sp.phase) &&
            (sp.targetSentence.docId !== docId || sp.targetSentence.pageNum !== pageNum)) cancelTarget(sp);
      });
    });
    S.on('doc:removed', () => {
      spiders.forEach(sp => { if (sp.targetSentence && !S.getSentence(sp.targetSentence.id)) cancelTarget(sp); });
      emitProgress(animationTime, true);
    });
    S.on('brain:imported', () => { spiders.forEach(cancelTarget); emitProgress(animationTime, true); });

    S.on('spider:queryVisual', ({ nodeIds }) => {
      const sp = spiders[spiders.length - 1] || spiders[0];
      if (!sp) return;
      if (!isReduced() && !paused) shockwaves.push({ x: sp.x, y: sp.y, r: 6, maxR: 54, color: '#fbbf24', alpha: 1 });
      const hub = root.NeuralGraph.getHubScreenPos(sp.cluster);
      sp.targetPos = hub;
      sp.angle = Math.atan2(hub.y - sp.y, hub.x - sp.x);
      if (nodeIds && nodeIds.length) root.NeuralGraph.highlightPath(nodeIds);
    });

    S.on('system:reset', () => {
      spiders.forEach(cancelTarget); spiders = []; shockwaves = []; idleWebs = []; idleTime = 0; scanOwner = null;
      resetMicroBrains(); setSpiderCount(1); setPaused(false); emitProgress(animationTime, true);
    });
    emitProgress(animationTime, true);

    // Ciclo de sueño: consolidación periódica de la bóveda
    setInterval(() => {
      if (document.hidden) return;
      if (root.NCMemory && S.state.vault.length > 20) root.NCMemory.consolidate();
    }, 45000);
  }

  root.SpiderEngine = { init, setSpiderCount, dispatchFromNetwork, AGENT_SPECS, microBrains, reloadMicroBrains: initMicroBrains,
    getStatus: () => ({ paused, spiders: spiders.map(({ id, role, cluster, phase, x, y, scanIndex, targetSentence }) => ({ id, role, cluster, phase, x, y, scanIndex, sentenceId: targetSentence?.id || null })) }) };
})(typeof window !== 'undefined' ? window : globalThis);
