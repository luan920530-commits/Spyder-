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
  let lastScrollX = 0, lastScrollY = 0, lastDocScroll = 0, lastLayout = null;
  let harvestWindow = { at: 0, count: 0 };
  let lastProgressEmit = 0;
  // Cola efímera de la consulta más reciente; nunca es evidencia ni memoria.
  let guidance = null, dispatchingGuidance = false;

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
  function chunkElements(sentence) {
    const ids = Array.isArray(sentence?.parts) ? sentence.parts.map(part => part.id) : [sentence?.id];
    return ids.map(sentenceElement).filter(Boolean);
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
    if (reveal && r.height && z.height && !root.NCQuestionUI?.holdingPage() && Date.now() >= (store()?.state.autoNavigationPausedUntil || 0)) {
      let delta = 0;
      if (r.top < z.top + 6) delta = r.top - z.top - 6;
      else if (r.bottom > z.bottom - 6) delta = r.bottom - z.bottom + 6;
      // Solo desplaza el interior del documento, nunca la ventana completa.
      if (delta) { zone.scrollTop += delta; syncDocumentScroll(); r = rectOf(word); }
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function documentBusy(except) {
    return spiders.some(other => other !== except && other.targetSentence &&
      (other.phase === 'IR_A_PALABRA' || other.phase === 'EXTRAER_DATOS'));
  }
  function pickNextSentence(sp, topicId) {
    const S = store();
    if (!S) return null;
    const doc = S.getActiveDoc(), page = S.state.activePage;
    const available = candidates().filter(s => !s.harvested && !S.state.claimedTargets.has(s.id) &&
      (!topicId || (root.NCSemantic?.topicId(s.id) || 'SEM-PENDING') === topicId));
    if (!available.length) return null;
    const local = available.filter(s => doc && s.docId === doc.id && s.pageNum === page);
    const auto = document.getElementById('chk-auto-page');
    const mayNavigate = (!auto || auto.checked) && !root.NCQuestionUI?.holdingPage() && Date.now() >= (S.state.autoNavigationPausedUntil || 0);
    let pool;
    if (local.length) {
      const visible = local.filter(s => {
        const el = chunkElements(s)[0];
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
      const score = scoreSentenceForSpider(sp, sentence.contextText || sentence.text, i) + Math.random() * .35;
      if (score > bestScore) { bestScore = score; best = sentence; }
    }
    if (!best) return null;
    if ((!doc || best.docId !== doc.id) && mayNavigate) S.setActiveDoc(best.docId, best.pageNum);
    else if (best.pageNum !== page && mayNavigate) S.setActivePage(best.pageNum);
    S.state.claimedTargets.add(best.id);
    sp.thought = `${sp.id} [${sp.role}]: analizando «${U.truncate(best.text, 34)}»`;
    return best;
  }

  function sourceSignature(sentence) {
    return [sentence.docId, sentence.pageNum, sentence.sourcePage || '', sentence.contextText || sentence.text].join('\u0000');
  }
  function dispatchGuidedTargets(report) {
    const S = store();
    if (!guidance || !S || dispatchingGuidance) return;
    if (Date.now() > guidance.expiresAt) { guidance = null; return; }
    const current = guidance;
    // Un pasaje ya reservado está siendo atendido: no lanzar una segunda araña.
    current.targets = current.targets.filter(item => {
      const live = S.getSentence(item.sentence.id);
      return live && sourceSignature(live) === item.signature && !S.state.claimedTargets.has(item.sentence.id);
    });
    if (!current.targets.length) { guidance = null; return; }
    if (paused || document.hidden) {
      if (report) S.emit('spiders:queryGuidance', { method: current.method, sent: 0, pending: current.targets.length, paused: true });
      return;
    }
    dispatchingGuidance = true;
    const spiderIds = [];
    try {
      for (const sp of spiders.filter(candidate => candidate.phase === 'IDLE').slice(0, 3)) {
        if (!current.targets.length) break;
        const auto = document.getElementById('chk-auto-page');
        const mayNavigate = (!auto || auto.checked) && !root.NCQuestionUI?.holdingPage() && Date.now() >= (S.state.autoNavigationPausedUntil || 0);
        const local = item => item.sentence.docId === S.state.activeDocId && item.sentence.pageNum === S.state.activePage;
        let item = current.targets[0];
        if (!local(item) && (!mayNavigate || documentBusy(sp))) item = current.targets.find(local);
        if (!item) break;
        const sentence = item.sentence;
        if (!local(item)) {
          if (sentence.docId !== S.state.activeDocId) S.setActiveDoc(sentence.docId, sentence.pageNum);
          else S.setActivePage(sentence.pageNum);
        }
        current.targets = current.targets.filter(target => target !== item);
        S.state.claimedTargets.add(sentence.id);
        assignTarget(sp, sentence, animationTime, current.id);
        sp.thought = `${sp.id}: siguiendo ${current.method === 'minilm' ? 'similitud MiniLM' : 'la búsqueda local'} hacia «${U.truncate(sentence.sourceText || sentence.text, 34)}»`;
        spiderIds.push(sp.id);
      }
    } finally { dispatchingGuidance = false; }
    const pending = current.targets.length;
    if (!pending) guidance = null;
    if (spiderIds.length) S.emit('spiders:dispatched', { count: spiderIds.length, source: 'query', method: current.method, spiderIds });
    if (report || spiderIds.length) S.emit('spiders:queryGuidance', { method: current.method, sent: spiderIds.length, pending, paused: false });
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
    const spiderIds = [];
    for (const sp of idle.slice(0, 3)) {
      // pickNextSentence reserva el ID y respeta la página, el escáner y AUTO.
      // Un tema MiniLM filtra pasajes; no se confunde con el rol del agente.
      const topicId = typeof cluster === 'string' && cluster.startsWith('SEM-') ? cluster : null;
      const sentence = pickNextSentence(sp, topicId);
      if (!sentence) break;
      assignTarget(sp, sentence, animationTime);
      spiderIds.push(sp.id);
    }
    const sent = spiderIds.length;
    if (sent) S.emit('spiders:dispatched', { count: sent, source: 'network', spiderIds });
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
      angle: 0, speed: 0, motion: 0, motionActive: false, phase: 'IDLE', lastProgressAt: animationTime,
      targetSentence: null, extractedPattern: null, cargo: null, scanWords: [], scanIndex: -1,
      route: null, routeSignature: '', approach: false, lane: (index - 2) * 5, nextPickAt: animationTime,
      legPhase: Math.random() * Math.PI * 2, idle: null, idleStarted: false, wait: null,
      idleNext: 'network', idleVisits: 0, idleLastNode: null, harvestedCount: 0
    });
  }
  function assignTarget(sp, sentence, now, queryId) {
    // Solo interrumpir el reposo de la araña que recibe el trabajo.
    clearSpiderIdle(sp);
    sp.wait = null; sp.targetSentence = sentence; sp.queryId = queryId || null; sp.phase = 'IR_A_PALABRA'; sp.lastProgressAt = now;
    sp.route = null; sp.approach = 'pending';
  }
  function clearScan(sp) {
    (sp.scanElements || (sp.scanElement ? [sp.scanElement] : [])).forEach(element => {
      element.classList.remove('sentence-scanning');
      element.style.removeProperty('--spider-scan-color');
    });
    (sp.scanWords || []).forEach(word => word.classList.remove('word-scanned', 'word-scanning'));
    sp.scanWords = []; sp.scanElements = []; sp.scanElement = null; sp.scanIndex = -1; sp.scanHoldUntil = 0;
    if (scanOwner === sp) scanOwner = null;
  }
  function releaseClaim(sp) {
    const S = store();
    if (S && sp.targetSentence) S.state.claimedTargets.delete(sp.targetSentence.id);
  }
  function cancelTarget(sp) {
    clearScan(sp); releaseClaim(sp); clearSpiderIdle(sp);
    sp.phase = 'IDLE'; sp.targetSentence = null; sp.queryId = null; sp.extractedPattern = null; sp.cargo = null;
    sp.route = null; sp.routeSignature = ''; sp.approach = false; sp.wait = null;
    sp.lastProgressAt = animationTime; sp.nextPickAt = animationTime + 200;
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
    const label = U.words3(sentence.sourceText || sentence.text).replace(/[.,;:]$/, '');
    return { cluster: null, label, text: U.truncate(sentence.text, 1200), pageNum: sentence.pageNum,
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
      spiders.filter(sp => sp.phase === 'IDLE' || sp.approach || sp.wait).forEach(sp => {
        sp.x = sp.x / lastViewportWidth * width; sp.y = sp.y / lastViewportHeight * height;
        sp.idle = null; sp.speed = 0;
      });
      idleWebs = [];
    }
    if (dx || dy) {
      // Al entrar al panel, la tarea pasa del viewport a las coordenadas de la página.
      spiders.filter(sp => sp.phase !== 'IDLE' && !sp.approach && !sp.wait).forEach(sp => {
        sp.x -= dx; sp.y -= dy;
        if (sp.cargo) { sp.cargo.x -= dx; sp.cargo.y -= dy; }
      });
      shockwaves.forEach(sw => { sw.x -= dx; sw.y -= dy; });
    } else if (frame && lastLayout && frame.signature !== lastLayout.signature) {
      // Al cambiar de columnas a filas, conserva la posición relativa en el panel.
      spiders.filter(sp => sp.phase !== 'IDLE' && !sp.approach && !sp.wait).forEach(sp => {
        const useDoc = within(sp, lastLayout.doc) || (!within(sp, lastLayout.arena) &&
          distanceToRect(sp, lastLayout.doc) <= distanceToRect(sp, lastLayout.arena));
        const before = { x: sp.x, y: sp.y };
        projectBetween(sp, useDoc ? lastLayout.doc : lastLayout.arena, useDoc ? frame.doc : frame.arena);
        if (sp.cargo) { sp.cargo.x += sp.x - before.x; sp.cargo.y += sp.y - before.y; }
        sp.route = null; sp.speed = 0;
      });
    }
    lastViewportWidth = width; lastViewportHeight = height;
    lastScrollX = x; lastScrollY = y; lastLayout = frame;
  }
  function syncDocumentScroll() {
    const zone = document.getElementById('doc-dropzone');
    const current = zone?.scrollTop || 0, delta = current - lastDocScroll;
    lastDocScroll = current;
    if (!delta || !lastLayout) return;
    // La lectura sigue el contenido, también cuando el usuario desplaza el
    // visor o se revela una palabra de la siguiente línea.
    spiders.forEach(sp => {
      if (sp.phase === 'IDLE' || sp.approach || sp.wait || (sp.phase !== 'EXTRAER_DATOS' && !within(sp, lastLayout.doc))) return;
      sp.y -= delta;
      if (sp.cargo) sp.cargo.y -= delta;
      if (sp.phase !== 'EXTRAER_DATOS') sp.route = null;
    });
  }
  function spiderSize() {
    const frame = lastLayout || layout();
    // Un mínimo ligeramente mayor permite distinguir las articulaciones en móvil.
    return frame ? Math.max(7, Math.min(11, Math.min(frame.arena.width, frame.arena.height * 1.15) * .014)) : 8;
  }
  function walk(sp, waypoints, dt, maxSpeed, stopAtFirst = false, countsAsProgress = true) {
    const result = root.NCSpiderMotion.step(sp, waypoints, dt, { maxSpeed, stopAtFirst });
    const size = spiderSize();
    // La fase sigue el recorrido real; el giro en el sitio también requiere
    // pequeños pasos. Una araña detenida no camina en el aire.
    const equivalentDistance = result.distance + result.turn * size * .8;
    if (equivalentDistance > .0001) {
      sp.legPhase += equivalentDistance * Math.PI * 2 / root.NCSpiderVisual.gaitCycleDistance(size);
      sp.motionActive = true;
      // Un paseo decorativo de espera no reinicia el reloj de una tarea bloqueada.
      if (countsAsProgress) sp.lastProgressAt = animationTime;
    }
    return result;
  }
  function travel(sp, target, toDocument, dt) {
    const frame = layout();
    if (!frame) return false;
    const portal = root.NCSpiderPaths.portals(frame.doc, frame.arena, target, sp.lane);
    const inBridge = portal.bridge && within(sp, portal.bridge);
    if (sp.approach) {
      if (isReduced()) sp.approach = false;
      else if (sp.approach === 'pending') {
        if (within(sp, frame.doc) || within(sp, frame.arena) || inBridge) sp.approach = false;
        else sp.approach = distanceToRect(sp, frame.doc) < distanceToRect(sp, frame.arena) ? 'doc' : 'arena';
      }
      if (sp.approach) {
        // Si paseaba fuera de ambos paneles, vuelve caminando al más cercano
        // antes de entrar al corredor; no desaparece al recibir una tarea.
        const panel = frame[sp.approach];
        const insetX = Math.min(18, panel.width / 2), insetY = Math.min(18, panel.height / 2);
        const entry = { x: root.NCSpiderPaths.bound(sp.x, panel.left + insetX, panel.right - insetX),
          y: root.NCSpiderPaths.bound(sp.y, panel.top + insetY, panel.bottom - insetY) };
        if (walk(sp, [entry], dt, 190).done) { sp.approach = false; sp.route = null; }
        return false;
      }
    }
    if (!sp.route || sp.routeSignature !== frame.signature || (!sp.route.length && Math.hypot(target.x - sp.x, target.y - sp.y) > 2)) {
      const alreadyThere = toDocument ? within(sp, frame.doc) : within(sp, frame.arena);
      if (alreadyThere) sp.route = [target];
      else if (inBridge) sp.route = [toDocument ? portal.doc : portal.arena, target];
      else sp.route = root.NCSpiderPaths.route(frame.doc, frame.arena, target, toDocument, sp.lane);
      sp.routeSignature = frame.signature;
    } else if (sp.route.length) sp.route[sp.route.length - 1] = target;
    if (isReduced()) { sp.x = target.x; sp.y = target.y; sp.speed = 0; sp.route = []; return true; }
    return walk(sp, sp.route, dt, 190).done;
  }
  // ── Reposo visual ────────────────────────────────────────────────────────
  // El paseo usa el viewport y un reloj propio. Las visitas consultan solo
  // posiciones de nodos reales: el masaje y los hilos son puramente visuales.
  function clearSpiderIdle(sp) {
    idleWebs = idleWebs.filter(web => web.owner !== sp.id);
    sp.idle = null;
  }
  function chooseIdleDestination(sp, frame) {
    const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    const bound = root.NCSpiderPaths.bound, index = spiders.indexOf(sp);
    if (sp.idleNext !== 'roam') {
      const targets = root.NeuralGraph?.getIdleTargets?.(frame?.arena) || [];
      const occupied = new Set(spiders.filter(other => other !== sp && other.idle?.nodeId).map(other => other.idle.nodeId));
      const free = targets.filter(target => !occupied.has(target.id));
      const alternatives = free.filter(target => target.id !== sp.idleLastNode);
      const choices = alternatives.length ? alternatives : free;
      if (choices.length) {
        const target = choices[Math.floor(Math.random() * choices.length)];
        const bearing = Math.atan2(sp.y - target.y, sp.x - target.x);
        sp.idle = { kind: 'node-travel', nodeId: target.id, bearing, node: target };
        sp.idleLastNode = target.id; sp.idleNext = 'roam'; sp.idleStarted = true;
        return;
      }
    }
    const first = !sp.idleStarted, startNearby = first && index % 2 === 0;
    let radius = Math.min(62, Math.max(12, Math.min(width, height) * (.09 + Math.random() * .035)));
    if (startNearby) radius = Math.min(radius, 24); // Un primer tejido rápido; las demás ya salen a pasear.
    const insetX = Math.min(width / 2, radius + 18), insetY = Math.min(height / 2, radius + 18);
    const edgeX = Math.min(width / 2, 16), edgeY = Math.min(height / 2, 16);
    sp.x = bound(sp.x, edgeX, width - edgeX); sp.y = bound(sp.y, edgeY, height - edgeY);
    let x, y;
    if (startNearby) {
      x = bound(sp.x + (Math.random() - .5) * 48, insetX, width - insetX);
      y = bound(sp.y + (Math.random() - .5) * 48, insetY, height - insetY);
    } else {
      // Una permutación de 12 zonas evita quedarse en la misma esquina por azar.
      const cell = (sp.idleVisits * 5 + index * 3) % 12;
      const usableX = Math.max(0, width - 2 * edgeX), usableY = Math.max(0, height - 2 * edgeY);
      x = edgeX + (cell % 4 + .18 + Math.random() * .64) * usableX / 4;
      y = edgeY + (Math.floor(cell / 4) + .18 + Math.random() * .64) * usableY / 3;
      sp.idleVisits++;
    }
    sp.idleStarted = true; sp.idleNext = 'network';
    // La mayor parte del reposo se dedica a pasear y a visitar la red existente.
    const weaveAfter = first || sp.idleVisits % 4 === 0;
    if (weaveAfter) { x = bound(x, insetX, width - insetX); y = bound(y, insetY, height - insetY); }
    sp.idle = { kind: 'travel', target: { x, y }, radius, weaveAfter };
  }
  function beginIdleWeb(sp, radius) {
    const center = { x: sp.x, y: sp.y }, quick = radius <= 24, points = quick ? 5 : 7;
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
    // Primero los radios y después los anillos. El primer tejido es corto
    // para que la araña salga pronto a recorrer la pantalla.
    for (let i = 0; i < points; i++) { step(point(1, i), true); step(center, false); }
    step(point(.45, 0), true);
    for (let i = 1; i <= points; i++) step(point(.45, i), true);
    if (!quick) {
      step(point(1, 0), true);
      for (let i = 1; i <= points; i++) step(point(1, i), true);
    }
    idleWebs.push(web);
    if (idleWebs.length > 8) idleWebs.shift();
    sp.idle = { kind: 'weave', web, steps, index: 0 };
  }
  function turnTowardIdleNode(sp, node, dt) {
    const desired = Math.atan2(node.y - sp.y, node.x - sp.x);
    const difference = root.NCSpiderMotion.angleDelta(sp.angle, desired);
    const turn = Math.max(-5 * dt, Math.min(5 * dt, difference));
    sp.angle = Math.atan2(Math.sin(sp.angle + turn), Math.cos(sp.angle + turn));
    if (Math.abs(turn) > .0001) {
      const size = spiderSize();
      sp.legPhase += Math.abs(turn) * size * .8 * Math.PI * 2 / root.NCSpiderVisual.gaitCycleDistance(size);
      sp.motionActive = true;
    }
    return Math.abs(root.NCSpiderMotion.angleDelta(sp.angle, desired)) < .035;
  }
  function updateIdle(sp, dt, frame) {
    if (!sp.idle) chooseIdleDestination(sp, frame);
    const idle = sp.idle;
    if (idle.kind === 'travel') {
      if (walk(sp, [idle.target], dt, 130).done) {
        if (idle.weaveAfter) beginIdleWeb(sp, idle.radius);
        else sp.idle = null;
      }
      return;
    }
    if (idle.nodeId) {
      const node = root.NeuralGraph?.getIdleTarget?.(idle.nodeId, frame?.arena);
      if (!node) { sp.idle = null; sp.speed = 0; return; } // Filtro, borrado o nodo fuera del viewport.
      idle.node = node;
      const size = spiderSize(), marginX = Math.min(window.innerWidth / 2, size * 2.2), marginY = Math.min(window.innerHeight / 2, size * 2.2);
      const bound = root.NCSpiderPaths.bound, reach = size * 1.88;
      const target = { x: bound(node.x + Math.cos(idle.bearing) * reach, marginX, window.innerWidth - marginX),
        y: bound(node.y + Math.sin(idle.bearing) * reach, marginY, window.innerHeight - marginY) };
      if (idle.kind !== 'node-travel' && Math.hypot(sp.x - target.x, sp.y - target.y) > 7) idle.kind = 'node-travel';
      if (idle.kind === 'node-travel') {
        if (walk(sp, [target], dt, 130).done) idle.kind = 'node-turn';
      } else if (idle.kind === 'node-turn') {
        if (turnTowardIdleNode(sp, node, dt)) { idle.kind = 'massage'; idle.elapsed = 0; idle.duration = 3.2 + Math.random() * .8; }
      } else if (idle.kind === 'massage') {
        turnTowardIdleNode(sp, node, dt);
        idle.elapsed += dt;
        if (idle.elapsed >= idle.duration) sp.idle = null;
      }
      return;
    }
    const step = idle.steps[idle.index];
    if (!step) {
      idle.web.expiresAt = idleTime + 20000;
      sp.idle = null;
      return;
    }
    const result = walk(sp, [step], dt, 90);
    if (step.stroke) {
      const total = Math.hypot(step.stroke.x2 - step.stroke.x1, step.stroke.y2 - step.stroke.y1);
      const left = Math.hypot(step.stroke.x2 - sp.x, step.stroke.y2 - sp.y);
      step.stroke.progress = total ? Math.max(0, Math.min(1, 1 - left / total)) : 1;
    }
    if (result.done) {
      if (step.stroke) step.stroke.progress = 1;
      idle.index++;
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
  function drawIdleMassages(frame) {
    const size = spiderSize();
    ctx.save();
    spiders.forEach(sp => {
      const idle = sp.idle;
      if (sp.phase !== 'IDLE' || idle?.kind !== 'massage') return;
      const node = root.NeuralGraph?.getIdleTarget?.(idle.nodeId, frame?.arena);
      // Si se desplaza la página mientras está pausada, nunca dibujar el
      // contacto sobre una posición antigua o un nodo que ya no es visible.
      idle.contactVisible = !!node && Math.hypot(node.x - sp.x, node.y - sp.y) < size * 3;
      if (!idle.contactVisible) return;
      const pulse = (idle.elapsed * 1.6) % 1;
      ctx.strokeStyle = sp.color; ctx.fillStyle = sp.color; ctx.lineWidth = 1;
      ctx.globalAlpha = .55 * (1 - pulse);
      ctx.beginPath(); ctx.arc(node.x, node.y, 4 + pulse * 15, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = .35 + .25 * Math.sin(idle.elapsed * 8);
      ctx.beginPath(); ctx.arc(node.x, node.y, 3, 0, Math.PI * 2); ctx.fill();
      // Las chispas siguen únicamente enlaces que ya existen en el grafo.
      (node.links || []).slice(0, 2).forEach(link => {
        const k = (idle.elapsed * .65) % 1;
        ctx.globalAlpha = .35 * (1 - k);
        ctx.beginPath(); ctx.arc(node.x + (link.x - node.x) * k, node.y + (link.y - node.y) * k, 2, 0, Math.PI * 2); ctx.fill();
      });
    });
    ctx.restore();
  }
  function beginScan(sp, element, now) {
    scanOwner = sp;
    sp.scanElements = chunkElements(sp.targetSentence);
    if (!sp.scanElements.length) sp.scanElements = [element];
    sp.scanElement = sp.scanElements[0];
    sp.scanWords = sp.scanElements.flatMap(item => Array.from(item.querySelectorAll('.word-span'))).slice(0, 18);
    if (!sp.scanWords.length) sp.scanWords = [element];
    sp.scanIndex = -1;
    sp.scanElements.forEach(item => {
      item.classList.add('sentence-scanning');
      item.style.setProperty('--spider-scan-color', sp.color);
    });
    sp.phase = 'EXTRAER_DATOS'; sp.lastProgressAt = now; sp.route = null;
    store()?.emit('spider:scanStart', { spiderId: sp.id, sentenceId: sp.targetSentence.id });
  }
  function markScanWord(sp, index) {
    const words = sp.scanWords;
    if (sp.scanIndex >= 0 && words[sp.scanIndex]) words[sp.scanIndex].classList.remove('word-scanning');
    for (let i = Math.max(0, sp.scanIndex + 1); i <= index; i++) words[i].classList.add('word-scanned');
    words[index].classList.add('word-scanning');
    sp.scanIndex = index; sp.scanAdvanced = true; sp.lastProgressAt = animationTime;
  }
  function finishScan(sp, now) {
    const pattern = extractPattern(sp.targetSentence);
    pattern.cluster = sp.cluster; pattern.color = sp.color;
    sp.extractedPattern = pattern;
    clearScan(sp);
    sp.phase = 'ARRASTRAR_A_RED'; sp.lastProgressAt = now; sp.route = null;
    store()?.emit('spider:extracted', { spiderId: sp.id, sentenceId: sp.targetSentence.id, label: pattern.label });
  }
  function updateScan(sp, now, dt) {
    if (!sp.scanElement?.isConnected || (sp.scanElements || []).some(element => !element.isConnected)) { cancelTarget(sp); return; }
    const words = sp.scanWords;
    if (isReduced()) {
      // Sin recorrido prolongado: se procesa el mismo pasaje real y se libera
      // el resaltado al terminar, igual que en el modo anterior.
      markScanWord(sp, words.length - 1);
      const end = wordPosition(words[words.length - 1], true);
      if (end) { sp.x = end.x; sp.y = end.y; }
      sp.speed = 0; finishScan(sp, now); return;
    }
    // Aunque un frame tenga varios subpasos, cada palabra resaltada debe
    // permanecer visible al menos hasta el siguiente dibujo.
    if (sp.scanAdvanced) return;
    if (sp.scanIndex < 0) {
      markScanWord(sp, 0); sp.scanHoldUntil = now + 80; return;
    }
    if (now < sp.scanHoldUntil) return;
    if (sp.scanIndex >= words.length - 1) { finishScan(sp, now); return; }

    const index = sp.scanIndex + 1, target = wordPosition(words[index], true);
    if (!target) return;
    // Anticipar el siguiente centro evita frenazos entre palabras de la misma
    // línea; si cambia de línea, frena y gira antes de recorrerla sin saltos.
    const after = index + 1 < words.length && isWordVisible(words[index + 1])
      ? wordPosition(words[index + 1], false) : null;
    const route = after ? [target, after] : [target];
    const result = walk(sp, route, dt, 150, true);
    if (result.reached) {
      markScanWord(sp, index);
      sp.scanHoldUntil = index === words.length - 1 ? now + 100 : now;
    }
  }
  // La espera es solo visual: cada araña con reserva pasea por un carril
  // diferente sin resaltar palabras, desplazar el visor ni simular una lectura.
  function updateScanWait(sp, dt, frame) {
    const width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    const mx = Math.min(20, width / 2), my = Math.min(20, height / 2);
    let area = { left: mx, right: width - mx, top: my, bottom: height - my };
    if (frame?.doc) {
      const visible = { left: Math.max(area.left, frame.doc.left + mx), right: Math.min(area.right, frame.doc.right - mx),
        top: Math.max(area.top, frame.doc.top + my), bottom: Math.min(area.bottom, frame.doc.bottom - my) };
      if (visible.right - visible.left >= 150 && visible.bottom - visible.top >= 80) area = visible;
    }
    const index = spiders.indexOf(sp);
    const slots = [[.16, .27], [.5, .25], [.84, .27], [.28, .72], [.72, .72]];
    const slot = slots[index % slots.length], w = area.right - area.left, h = area.bottom - area.top;
    const radius = Math.min(26, w * .075, h * .12);
    const angle = sp.wait.turn * Math.PI / 2 + index * .8;
    const target = { x: area.left + w * slot[0] + Math.cos(angle) * radius,
      y: area.top + h * slot[1] + Math.sin(angle) * radius };
    if (walk(sp, [target], dt, 85, false, false).done) sp.wait.turn++;
  }

  function updateSpider(sp, now, dt, frame) {
    const S = store();
    if (!S) return;
    const waiting = sp.phase === 'IR_A_PALABRA' && scanOwner && scanOwner !== sp;
    if (waiting) {
      // El propietario tiene su propio límite de inactividad. La reserva que
      // espera no caduca antes de que el propietario pueda liberar el visor.
      sp.lastProgressAt = Math.max(sp.lastProgressAt, scanOwner.lastProgressAt);
    } else if (sp.wait) {
      // Al liberarse el visor, reanuda la ruta real con tiempo para alcanzarla.
      sp.wait = null; sp.route = null; sp.approach = 'pending'; sp.lastProgressAt = now;
    }
    // Una tarea inmóvil y bloqueada se libera; un recorrido largo que sí
    // avanza no se cancela solo por durar más de 30 segundos.
    if (sp.phase !== 'IDLE' && !waiting && now - sp.lastProgressAt > 30000) { cancelTarget(sp); return; }
    if (sp.targetSentence && !S.getSentence(sp.targetSentence.id)) { cancelTarget(sp); return; }
    if (sp.phase === 'IDLE') {
      // Una consulta pendiente tiene prioridad; espera sin desplazar otra lectura.
      if (guidance?.targets.length) return;
      // El trabajo real tiene prioridad sobre el paseo; no recorrer el corpus 60 veces/s.
      if (now < sp.nextPickAt) return;
      sp.nextPickAt = now + 300;
      const sent = pickNextSentence(sp);
      if (!sent) return;
      assignTarget(sp, sent, now);
      S.emit('spiders:dispatched', { count: 1, source: 'auto', spiderIds: [sp.id] });
      return;
    }
    if (sp.phase === 'IR_A_PALABRA') {
      // Si el usuario cambia de página, no se usa la posición obsoleta de otro texto.
      if (S.state.activeDocId !== sp.targetSentence.docId || S.state.activePage !== sp.targetSentence.pageNum) { cancelTarget(sp); return; }
      if (waiting) {
        if (!sp.wait) { sp.wait = { turn: 0 }; sp.route = null; sp.approach = false; }
        if (!isReduced()) updateScanWait(sp, dt, frame);
        return;
      }
      const element = chunkElements(sp.targetSentence)[0], word = firstWord(element);
      if (!element || !word) return; // El visor puede estar esperando su siguiente render.
      const pos = wordPosition(word, true);
      if (!pos) return;
      if (travel(sp, pos, true, dt)) beginScan(sp, element, now);
      return;
    }
    if (sp.phase === 'EXTRAER_DATOS') { updateScan(sp, now, dt); return; }
    if (sp.phase === 'ARRASTRAR_A_RED') {
      const destination = root.NCSemantic?.topicId(sp.targetSentence.id) || sp.cluster;
      const hub = root.NeuralGraph.getHubScreenPos(destination);
      if (travel(sp, hub, false, dt)) { sp.phase = 'ALIMENTAR_NODO'; sp.lastProgressAt = now; sp.route = null; }
      return;
    }
    if (sp.phase === 'ALIMENTAR_NODO') {
      if (sp.extractedPattern) {
        const p = sp.extractedPattern;
        // Un clic sobre un pasaje ya cosechado puede repetirse visualmente sin duplicar el aprendizaje.
        const canonical = S.getSentence(sp.targetSentence.id) || sp.targetSentence;
        const fresh = !canonical.harvested;
        canonical.harvested = true;
        sp.targetSentence.harvested = true;
        sentenceElement(sp.targetSentence.id)?.classList.add('sentence-harvested');
        if (fresh) {
          S.addPattern({ cluster: p.cluster, label: p.label, text: p.text, pageNum: p.pageNum,
            sentenceId: p.sentenceId, color: p.color, section: p.section });
          learnFromPattern(sp, p.section + ' ' + p.text + ' ' + p.label, 1);
          root.KimiAuxModel?.trainOnPattern(p.section + ' ' + p.text, 1);
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

  function updateCargo(sp, dt, reduced) {
    if (sp.phase !== 'ARRASTRAR_A_RED' || !sp.extractedPattern) { sp.cargo = null; return; }
    const desired = { x: sp.x - Math.cos(sp.angle) * 28, y: sp.y - Math.sin(sp.angle) * 28 };
    if (!sp.cargo || reduced) { sp.cargo = desired; return; }
    const follow = 1 - Math.exp(-12 * dt);
    sp.cargo.x += (desired.x - sp.cargo.x) * follow;
    sp.cargo.y += (desired.y - sp.cargo.y) * follow;
    const dx = sp.cargo.x - sp.x, dy = sp.cargo.y - sp.y, length = Math.hypot(dx, dy);
    if (length > 46) { sp.cargo.x = sp.x + dx * 46 / length; sp.cargo.y = sp.y + dy * 46 / length; }
  }
  function finishMotion(sp, dt, reduced) {
    if (reduced) { sp.motion = 0; sp.speed = 0; return; }
    if (!sp.motionActive) sp.speed = Math.max(0, sp.speed - 700 * dt);
    const goal = sp.motionActive ? 1 : 0;
    sp.motion += (goal - sp.motion) * (1 - Math.exp(-(goal ? 12 : 8) * dt));
    if (sp.motion < .001) sp.motion = 0;
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────
  function drawSpider(sp) {
    const size = spiderSize();
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
      const trailX = sp.cargo ? sp.cargo.x - sp.x : -Math.cos(sp.angle) * 28;
      const trailY = sp.cargo ? sp.cargo.y - sp.y : -Math.sin(sp.angle) * 28;
      ctx.strokeStyle = sp.color; ctx.shadowColor = sp.color; ctx.shadowBlur = 7; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-Math.cos(sp.angle) * size, -Math.sin(sp.angle) * size);
      ctx.quadraticCurveTo(trailX * .55, trailY * .55 + 3, trailX, trailY - 8); ctx.stroke();
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

    const lit = sp.phase === 'EXTRAER_DATOS' || (sp.phase === 'ARRASTRAR_A_RED' && sp.extractedPattern);
    const massage = sp.phase === 'IDLE' && sp.idle?.kind === 'massage' && !!sp.idle.contactVisible;
    // Entrar y salir del gesto gradualmente evita que las patas salten desde
    // la última postura de marcha. La pausa congela también esta transición.
    const blend = massage ? Math.max(0, Math.min(1, sp.idle.elapsed / .35, (sp.idle.duration - sp.idle.elapsed) / .35)) : 0;
    root.NCSpiderVisual.draw(ctx, { x: 0, y: 0, angle: sp.angle, size,
      color: lit ? sp.color : '#bee8ff', core: lit ? sp.color : null,
      phase: sp.legPhase, motion: isReduced() ? 0 : sp.motion,
      massaging: massage, massageWeight: blend * blend * (3 - 2 * blend),
      massagePhase: (sp.idle?.elapsed || 0) * 8,
      time: isReduced() ? 0 : animationTime / 1000 });
    ctx.restore();
  }

  function loop(now) {
    const elapsed = Math.max(0, lastFrameTime ? (now - lastFrameTime) / 1000 : .016);
    const dt = Math.min(.15, elapsed);
    fpsCounter = Math.round(fpsCounter * .9 + (1 / Math.max(.001, elapsed)) * .1);
    lastFrameTime = now;
    const fpsEl = document.getElementById('stat-fps');
    if (fpsEl && Math.random() < .08) fpsEl.textContent = Math.min(60, fpsCounter);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas && (canvas.width !== Math.round(window.innerWidth * ratio) || canvas.height !== Math.round(window.innerHeight * ratio))) {
      canvas.width = Math.round(window.innerWidth * ratio); canvas.height = Math.round(window.innerHeight * ratio);
    }
    if (ctx) { ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
    const frame = layout();
    syncViewport(frame); syncDocumentScroll();
    const running = !paused && !document.hidden, reduced = isReduced();
    if (running) {
      dispatchGuidedTargets(false);
      spiders.forEach(sp => { sp.scanAdvanced = false; });
      // En equipos lentos se recupera hasta 150 ms en pasos pequeños: evita
      // ralentizar todo el trabajo sin saltar esquinas ni omitir palabras.
      for (let remaining = dt; remaining > 1e-6;) {
        const step = Math.min(.05, remaining); remaining -= step;
        animationTime += step * 1000;
        spiders.forEach(sp => { sp.motionActive = false; updateSpider(sp, animationTime, step, frame); });
        if (!reduced) {
          idleTime += step * 1000;
          spiders.filter(sp => sp.phase === 'IDLE').forEach(sp => updateIdle(sp, step, frame));
          idleWebs = idleWebs.filter(web => web.expiresAt === null || web.expiresAt > idleTime);
        }
        spiders.forEach(sp => { finishMotion(sp, step, reduced); updateCargo(sp, step, reduced); });
      }
    }
    if (reduced) shockwaves = [];
    if (ctx) {
      // El reposo y la espera visual pueden aparecer en el viewport sin interceptar clics.
      drawIdleWebs(); drawIdleMassages(frame);
      spiders.filter(sp => sp.phase === 'IDLE' || sp.approach || sp.wait).forEach(drawSpider);
      // Las acciones de lectura y entrega siguen limitadas al visor, la red y su corredor.
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
      spiders.filter(sp => sp.phase !== 'IDLE' && !sp.approach && !sp.wait).forEach(drawSpider);
      shockwaves = shockwaves.filter(sw => sw.alpha > .05);
      shockwaves.forEach(sw => {
        if (running) { sw.r += 108 * dt; sw.alpha *= Math.exp(-6.3 * dt); }
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
    lastDocScroll = document.getElementById('doc-dropzone')?.scrollTop || 0;
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
    document.addEventListener('visibilitychange', () => { lastFrameTime = 0; });
    function setPaused(value) {
      paused = value; lastFrameTime = 0;
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
      const target = S.getSentence(sentence.id) || sentence;
      assignTarget(sp, target, animationTime);
      S.state.claimedTargets.add(target.id);
      S.emit('spiders:dispatched', { count: 1, source: 'sentence', spiderIds: [sp.id] });
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

    S.on('spider:queryStart', () => { guidance = null; });
    S.on('spider:queryCancelled', ({ requestId } = {}) => {
      if (guidance?.id === requestId) guidance = null;
      spiders.forEach(sp => { if (sp.queryId && sp.queryId === requestId) cancelTarget(sp); });
    });
    S.on('chat:clearing', () => {
      guidance = null;
      spiders.forEach(sp => { if (sp.queryId) cancelTarget(sp); });
    });
    S.on('spider:queryVisual', ({ nodeIds, hits, method, requestId } = {}) => {
      const sp = spiders[spiders.length - 1] || spiders[0];
      if (sp && !isReduced() && !paused) shockwaves.push({ x: sp.x, y: sp.y, r: 6, maxR: 54, color: '#fbbf24', alpha: 1 });
      if (nodeIds?.length) root.NeuralGraph?.highlightPath(nodeIds);
      if (!Array.isArray(hits)) return;
      const seen = new Set(), targets = [];
      for (const hit of hits) {
        const sentence = hit?.sentence, live = sentence && S.getSentence(sentence.id);
        if (!live || seen.has(sentence.id) || sentence.docId !== live.docId || sentence.pageNum !== live.pageNum) continue;
        if (method === 'minilm' && !(hit.neural >= .42)) continue;
        // Una proyección por exclusión solo puede contener partes auténticas.
        if (Array.isArray(sentence.parts) && Array.isArray(live.parts) && sentence.parts.some(part =>
          !live.parts.some(original => original.id === part.id && original.text === part.text))) continue;
        seen.add(sentence.id); targets.push({ sentence, signature: sourceSignature(live) });
      }
      root.NeuralGraph?.highlightSources?.(targets.map(item => item.sentence.id));
      guidance = targets.length ? { id: requestId, method: method === 'minilm' ? 'minilm' : 'local',
        targets, expiresAt: Date.now() + 45000 } : null;
      if (guidance) dispatchGuidedTargets(true);
      else S.emit('spiders:queryGuidance', { method: method === 'minilm' ? 'minilm' : 'local', sent: 0, pending: 0 });
    });
    S.on('model:status', info => { if (!info.enabled && guidance?.method === 'minilm') guidance = null; });
    S.on('settings:changed', ({ key, value }) => { if (key === 'embedEnabled' && !value && guidance?.method === 'minilm') guidance = null; });
    ['brain:importing', 'system:resetting'].forEach(event => S.on(event, () => { guidance = null; spiders.forEach(cancelTarget); }));

    S.on('system:reset', () => {
      guidance = null;
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
    getStatus: () => ({ paused, spiders: spiders.map(({ id, role, cluster, phase, x, y, scanIndex, targetSentence, idle }) => ({
      id, role, cluster, phase, x, y, scanIndex, sentenceId: targetSentence?.id || null,
      idleActivity: phase === 'IDLE' ? idle?.kind || null : null, idleNodeId: phase === 'IDLE' ? idle?.nodeId || null : null
    })) }) };
})(typeof window !== 'undefined' ? window : globalThis);
