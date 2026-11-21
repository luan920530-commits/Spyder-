/**
 * NEURAL COMMAND // AI SPIDER OS — v11
 * js/neural-graph.js — Grafo neuronal vivo: esfera KIMI-CORE, D3 incremental,
 * inspector con citas, tooltip, filtro por clúster, recentrado y ticker.
 *
 * Rendimiento: una sola simulación de fuerzas y actualizaciones incrementales
 * (antes se recreaba todo el grafo en cada nodo).
 */
(function (root) {
  'use strict';

  const U = root.NCUtil;
  const HUBS = [
    { id: 'AGT-01', label: 'AGT-01 DEF', color: '#38dcff', isHub: true, px: .36, py: .30 },
    { id: 'AGT-02', label: 'AGT-02 CAUSAL', color: '#8b5cf6', isHub: true, px: .67, py: .31 },
    { id: 'AGT-03', label: 'AGT-03 QUANT', color: '#f5aa3c', isHub: true, px: .66, py: .66 },
    { id: 'AGT-04', label: 'AGT-04 SYNTH', color: '#34e696', isHub: true, px: .37, py: .66 }
  ];

  let svg = null, gLinks = null, gNodes = null, simulation = null;
  let width = 460, height = 380;
  let sphereCtx = null, constellations = [], stars = [], ambientPackets = [];
  let rafSphere = null, rafStill = null, lastSphereTime = 0, visualTime = 0;
  let arcs = [], waves = [], commandWaves = [], deliveryPackets = [], queenPulse = 0, webVibration = 0, arcClock = 0;
  const probe = { x: 0, y: 0, inside: false };
  // La mirada usa coordenadas de pantalla, también sobre controles y fuera de la red.
  const pointer = { x: 0, y: 0, known: false };
  let queenAngle = 0, queenHeadAngle = 0;
  let highlighted = new Set();
  let activeCluster = null;
  let graphNodes = [], allGraphNodes = [];
  let graphLinks = [], allGraphLinks = [], graphNodeById = new Map(), graphNeighbors = new Map();
  let graphPage = 0, graphQuery = '', projection = null;
  let semanticMode = false, displayedTopics = [];
  // Los temas se derivan del corpus; paginar o buscar no debe reconstruir
  // miles de nodos temáticos mientras no cambien los datos ni el tamaño.
  let semanticCache = null, semanticDirty = true;
  const TOPIC_POSITIONS = [ { px: .36, py: .30 }, { px: .67, py: .31 },
    { px: .66, py: .66 }, { px: .37, py: .66 } ];
  let visible = true;
  let initialized = false;

  const store = () => root.NeuralStore;

  // Partículas decorativas: las entidades y citas reales siguen en el SVG D3.
  function init3DSphere() {
    const canvas = document.getElementById('core-3d-canvas');
    if (!canvas || !(sphereCtx = canvas.getContext('2d'))) return;
    constellations = [
      { id: 'AGT-01', label: 'AGT-01 · DEFINICIONES', x:.36, y:.30, r:.15, color:[56,220,255], count:52, rotation:.05 },
      { id: 'AGT-02', label: 'AGT-02 · CAUSAL', x:.67, y:.31, r:.12, color:[139,92,246], count:44, rotation:-.04 },
      { id: 'core', label: 'NEURAL CORE', x:.53, y:.50, r:.16, color:[70,180,255], count:66, rotation:.025 },
      { id: 'AGT-04', label: 'AGT-04 · SÍNTESIS', x:.37, y:.66, r:.14, color:[52,230,150], count:56, rotation:-.05 },
      { id: 'AGT-03', label: 'AGT-03 · MÉTRICAS', x:.66, y:.66, r:.12, color:[245,170,60], count:44, rotation:.04 }
    ];
    constellations.forEach(cluster => {
      cluster.walks = [];
      for (let i = 0; i < cluster.count; i++) {
        let angle = Math.random() * Math.PI * 2, x = (Math.random() - .5) * .4, y = (Math.random() - .5) * .4;
        const points = [];
        for (let j = 0; j < 14; j++) {
          angle += (Math.random() - .5) * 1.3;
          const step = .05 + Math.random() * .06;
          x += Math.cos(angle) * step; y += Math.sin(angle) * step;
          const distance = Math.hypot(x, y);
          if (distance > 1) { x *= .92 / distance; y *= .92 / distance; angle += Math.PI * .8; }
          points.push({ x, y, phase: Math.random() * 6.28, size: Math.random() < .06 ? 1.8 : .5 + Math.random() * .8 });
        }
        cluster.walks.push(points);
      }
    });
    stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), alpha: Math.random() * .3, size: .3 + Math.random() }));
    ambientPackets = Array.from({ length: 8 }, (_, i) => ({ target: [0,1,3,4][i % 4], offset: Math.random(), speed: .12 + Math.random() * .16 }));
    startSphere();
  }

  function motionStopped() {
    return isReducedMotion() || !!root.SpiderEngine?.getStatus().paused;
  }

  function startSphere() {
    if (rafSphere || !sphereCtx || document.hidden || !visible) return;
    lastSphereTime = 0;
    if (motionStopped()) { drawSphere(0); return; }
    let lastDraw = 0, previousFrame = 0, slowFrames = 0, fastSince = 0, limited = false;
    const loop = time => {
      const elapsed = previousFrame ? time - previousFrame : 0;
      previousFrame = time;
      if (!limited && elapsed) {
        slowFrames = elapsed > 85 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (elapsed > 250 || slowFrames >= 6) { limited = true; fastSince = 0; }
      } else if (limited) {
        // Volver gradualmente a la frecuencia normal si el navegador se
        // mantiene fluido; evitar oscilaciones en dispositivos sobrecargados.
        if (elapsed > 0 && elapsed < 34) {
          if (!fastSince) fastSince = time;
          else if (time - fastSince >= 5000) { limited = false; slowFrames = 0; }
        } else fastSince = 0;
      }
      // Solo se reduce la frecuencia de la decoración, no el ciclo de lectura,
      // las tareas de las arañas ni el trazado de sus ocho patas.
      if (time - lastDraw >= (limited ? 150 : 33)) { drawSphere(time); lastDraw = time; }
      rafSphere = requestAnimationFrame(loop);
    };
    rafSphere = requestAnimationFrame(loop);
  }

  function stopSphere() {
    if (rafSphere) cancelAnimationFrame(rafSphere);
    rafSphere = null; lastSphereTime = 0;
  }

  function redrawIfStill() {
    if (rafSphere || rafStill || !sphereCtx || !visible || document.hidden) return;
    // Agrupa eventos de puntero/estado sin reactivar una animación continua.
    rafStill = requestAnimationFrame(() => {
      rafStill = null;
      if (!rafSphere && visible && !document.hidden) drawSphere(0);
    });
  }

  function resetVisualEffects() {
    arcs = []; waves = []; commandWaves = []; deliveryPackets = [];
    queenPulse = 0; webVibration = 0; arcClock = 0;
  }

  function drawWeb(ctx, qx, qy, size, time, weavingLegs, bodyAngle) {
    const spokes = 16, rings = 7, radius = size * .19, rows = [];
    // El cuerpo gira, pero los vértices de la telaraña permanecen en la escena.
    // Cada pata tira del radio que realmente alcanza en su nueva orientación.
    const threads = weavingLegs.map(leg => ({
      spoke: ((Math.round((leg.angle + bodyAngle - .12) / (Math.PI * 2) * spokes) % spokes) + spokes) % spokes,
      tension: leg.tension
    }));
    for (let s = 0; s < spokes; s++) {
      const angle = s / spokes * Math.PI * 2 + .12, length = .82 + ((s * 7) % 5) / 22, row = [];
      const pull = threads.reduce((sum, thread) => {
        const gap = Math.min(Math.abs(thread.spoke - s), spokes - Math.abs(thread.spoke - s));
        return sum + thread.tension * (gap === 0 ? 1 : gap === 1 ? .3 : 0);
      }, 0);
      for (let r = 1; r <= rings; r++) {
        const rr = radius * r / rings * length + Math.sin(time * 18 + r * 1.7 + s) * webVibration * 3 * r / rings
          - size * .04 * .14 * pull * r / rings;
        row.push([qx + Math.cos(angle) * rr, qy + Math.sin(angle) * rr]);
      }
      rows.push(row);
    }
    ctx.lineWidth = .55; ctx.strokeStyle = `rgba(154,216,255,${.12 + .25 * webVibration})`;
    ctx.beginPath();
    rows.forEach(row => { ctx.moveTo(qx, qy); row.forEach(point => ctx.lineTo(point[0], point[1])); });
    for (let r = 0; r < rings; r++) {
      rows.forEach((row, s) => { if (s) ctx.lineTo(row[r][0], row[r][1]); else ctx.moveTo(row[r][0], row[r][1]); });
      ctx.lineTo(rows[0][r][0], rows[0][r][1]);
    }
    ctx.stroke();
    rows.forEach((row, s) => row.forEach((point, r) => {
      if ((s + r) % 3 === 0) {
        ctx.fillStyle = `rgba(210,240,255,${.35 + .3 * Math.sin(time * 2 + s + r)})`;
        ctx.fillRect(point[0] - .9, point[1] - .9, 1.8, 1.8);
      }
    }));
    return threads.map(thread => ({ x: rows[thread.spoke][rings - 2][0] - qx,
      y: rows[thread.spoke][rings - 2][1] - qy }));
  }

  function randomParticle(cluster) {
    const walk = cluster.walks[Math.floor(Math.random() * cluster.walks.length)];
    return walk[Math.floor(Math.random() * walk.length)];
  }

  function addArc(a, b, colorA, colorB, duration) {
    if (arcs.length >= 24) arcs.shift();
    arcs.push({ a, b, colorA, colorB, age: 0, duration, seed: Math.random() * 10 });
  }

  function drawArc(ctx, arc, time) {
    const { a, b } = arc;
    if (![a.sx, a.sy, b.sx, b.sy].every(Number.isFinite)) return;
    const alpha = Math.max(0, 1 - arc.age / arc.duration);
    const gradient = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
    gradient.addColorStop(0, `rgba(${arc.colorA.join(',')},${alpha * .8})`);
    gradient.addColorStop(1, `rgba(${arc.colorB.join(',')},${alpha * .8})`);
    ctx.strokeStyle = gradient; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(a.sx, a.sy);
    const nx = -(b.sy - a.sy), ny = b.sx - a.sx, length = Math.hypot(nx, ny) || 1;
    for (let s = 1; s < 7; s++) {
      const k = s / 7, jitter = Math.sin(time * 24 + s * 8 + arc.seed) * 6 * alpha;
      ctx.lineTo(a.sx + (b.sx - a.sx) * k + nx / length * jitter, a.sy + (b.sy - a.sy) * k + ny / length * jitter);
    }
    ctx.lineTo(b.sx, b.sy); ctx.stroke();
    const k = 1 - alpha;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.beginPath();
    ctx.arc(a.sx + (b.sx - a.sx) * k, a.sy + (b.sy - a.sy) * k, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  function drawProbe(ctx, status, rect, time) {
    if (!probe.inside) return;
    let count = 0;
    for (const cluster of constellations) {
      const rgb = cluster.color.join(',');
      for (const walk of cluster.walks) {
        for (const point of walk) {
          if (count >= 70) break;
          const distance = Math.hypot(point.sx - probe.x, point.sy - probe.y);
          if (distance < 100) {
            count++;
            ctx.strokeStyle = `rgba(${rgb},${(1 - distance / 100) * .85})`; ctx.lineWidth = .7;
            ctx.beginPath(); ctx.moveTo(probe.x, probe.y); ctx.lineTo(point.sx, point.sy); ctx.stroke();
            ctx.fillStyle = `rgba(255,255,255,${1 - distance / 100})`; ctx.fillRect(point.sx - 1.3, point.sy - 1.3, 2.6, 2.6);
          }
        }
        if (count >= 70) break;
      }
      if (count >= 70) break;
    }
    ctx.setLineDash([2, 4]);
    status.spiders.forEach(sp => {
      const x = sp.x - rect.left, y = sp.y - rect.top, distance = Math.hypot(x - probe.x, y - probe.y);
      if (distance >= 140) return;
      ctx.strokeStyle = `rgba(255,90,180,${(1 - distance / 140) * .8})`;
      ctx.beginPath(); ctx.moveTo(probe.x, probe.y); ctx.lineTo(x, y); ctx.stroke();
    });
    ctx.setLineDash([]);
    const radius = 11 + (isReducedMotion() ? 0 : Math.sin(time * 6) * 1.5);
    ctx.strokeStyle = 'rgba(56,220,255,.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(probe.x, probe.y, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([x, y]) => {
      ctx.moveTo(probe.x + x * (radius + 3), probe.y + y * (radius + 3));
      ctx.lineTo(probe.x + x * (radius + 9), probe.y + y * (radius + 9));
    });
    ctx.stroke();
  }

  function turnQueen(rect, x, y, dt) {
    if (!pointer.known || !dt) return;
    const dx = pointer.x - (rect.left + x), dy = pointer.y - (rect.top + y);
    if (Math.hypot(dx, dy) < 1) return; // En el mismo punto no hay dirección definida.
    const desired = Math.atan2(dy, dx);
    const delta = Math.atan2(Math.sin(desired - queenAngle), Math.cos(desired - queenAngle));
    const turn = Math.max(-3.4 * dt, Math.min(3.4 * dt, delta));
    queenAngle = Math.atan2(Math.sin(queenAngle + turn), Math.cos(queenAngle + turn));
    // Los ojos se adelantan un poco; después el cuerpo anclado se alinea.
    const remaining = Math.atan2(Math.sin(desired - queenAngle), Math.cos(desired - queenAngle));
    const headGoal = Math.max(-.65, Math.min(.65, remaining));
    queenHeadAngle += Math.max(-7 * dt, Math.min(7 * dt, headGoal - queenHeadAngle));
  }

  function drawSphere(time = 0) {
    const canvas = document.getElementById('core-3d-canvas'), ctx = sphereCtx;
    if (!canvas || !ctx || document.hidden || !visible) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width || 460, h = rect.height || 380, size = Math.min(w, h * 1.15);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.max(1, Math.round(w * ratio)); canvas.height = Math.max(1, Math.round(h * ratio));
    }
    const status = root.SpiderEngine?.getStatus() || { paused: false, spiders: [] };
    const moving = !isReducedMotion() && !status.paused;
    const dt = moving && time && lastSphereTime ? Math.max(0, Math.min(.15, (time - lastSphereTime) / 1000)) : 0;
    lastSphereTime = moving ? time : 0;
    visualTime += dt;
    const t = visualTime;
    if (dt) {
      queenPulse = Math.max(0, queenPulse - dt * 1.4);
      webVibration = Math.max(0, webVibration - dt * 1.1);
      arcs.forEach(arc => { arc.age += dt; }); arcs = arcs.filter(arc => arc.age < arc.duration);
      waves.forEach(wave => { wave.age += dt; }); waves = waves.filter(wave => wave.age < .8);
      commandWaves.forEach(wave => { wave.age += dt; }); commandWaves = commandWaves.filter(wave => wave.age < 1.4);
      deliveryPackets.forEach(packet => { packet.progress += dt * .7; }); deliveryPackets = deliveryPackets.filter(packet => packet.progress < 1);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w*.5, h*.48, 0, w*.5, h*.48, Math.max(w,h)*.7);
    bg.addColorStop(0, '#08111c'); bg.addColorStop(1, '#020408');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    stars.forEach(star => {
      ctx.fillStyle = `rgba(150,200,255,${star.alpha * (.6 + .4 * Math.sin(t * 2 + star.x * 20))})`;
      ctx.fillRect(star.x*w, star.y*h, star.size, star.size);
    });
    ctx.globalCompositeOperation = 'lighter';
    const core = constellations[2], cx = core.x*w, cy = core.y*h;
    const qx = w * .19, qy = h * .46, qSize = size * .04, hx = w * .42, hy = h * .49;
    turnQueen(rect, qx, qy, dt);
    const queen = { size: qSize, queen: true, weaving: true, phase: t * 2.6, time: t, headAngle: queenHeadAngle };
    const weavingLegs = root.NCSpiderVisual.pose(queen).legs.filter(leg => leg.index === 1 || leg.index === 2);
    const webAnchors = drawWeb(ctx, qx, qy, size, t, weavingLegs, queenAngle);
    const cosine = Math.cos(queenAngle), sine = Math.sin(queenAngle);
    // draw() gira las patas: convertir los anclajes de la escena al marco local
    // mantiene los extremos exactamente sobre los vértices de la telaraña.
    const threadAnchors = webAnchors.map(anchor => ({ x: anchor.x * cosine + anchor.y * sine,
      y: -anchor.x * sine + anchor.y * cosine }));
    constellations.forEach(cluster => {
      if (cluster.id === 'core') return;
      ctx.strokeStyle = `rgba(${cluster.color.join(',')},.13)`; ctx.lineWidth = 1; ctx.setLineDash([2,5]);
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cluster.x*w,cluster.y*h); ctx.stroke(); ctx.setLineDash([]);
    });
    // Destellos ambientales; no son nodos ni mediciones de datos.
    ambientPackets.forEach(packet => {
      const cluster = constellations[packet.target], k = (packet.offset + t * packet.speed) % 1;
      const x = cx + (cluster.x*w - cx) * k, y = cy + (cluster.y*h - cy) * k;
      const glow = ctx.createRadialGradient(x,y,0,x,y,6);
      glow.addColorStop(0, `rgba(${cluster.color.join(',')},.7)`); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill();
    });
    constellations.forEach(cluster => {
      const x0 = cluster.x*w, y0 = cluster.y*h, rgb = cluster.color.join(',');
      const running = !status.paused && status.spiders.some(sp => sp.cluster === cluster.id && sp.phase !== 'IDLE');
      const boost = cluster.id === 'core' ? 1 : (running ? 1.15 : .85);
      const radius = cluster.r * size * (1 + Math.sin(t*1.3+cluster.x*9)*.02);
      const angle = t*cluster.rotation, cosine = Math.cos(angle), sine = Math.sin(angle);
      const halo = ctx.createRadialGradient(x0,y0,0,x0,y0,radius*1.3);
      halo.addColorStop(0, `rgba(${rgb},${.16*boost})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x0,y0,radius*1.3,0,Math.PI*2); ctx.fill();
      if (cluster.id === 'core') {
        ctx.strokeStyle = `rgba(${rgb},.28)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x0,y0,radius*1.22,0,Math.PI*2); ctx.stroke();
        ctx.save(); ctx.translate(x0,y0); ctx.rotate(t*.15); ctx.setLineDash([3,9]);
        ctx.strokeStyle = `rgba(${rgb},.24)`; ctx.beginPath(); ctx.arc(0,0,radius*1.38,0,Math.PI*2); ctx.stroke();
        ctx.setLineDash([]); ctx.strokeStyle = `rgba(${rgb},.55)`; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(0,0,radius*1.38,0,.6); ctx.stroke();
        ctx.beginPath(); ctx.arc(0,0,radius*1.38,Math.PI,Math.PI+.35); ctx.stroke(); ctx.restore();
      }
      ctx.lineWidth = .6;
      cluster.walks.forEach(walk => {
        ctx.strokeStyle = `rgba(${rgb},${.2*boost})`; ctx.beginPath();
        walk.forEach((point, i) => {
          const jx = point.x + Math.sin(t*.9+point.phase)*.025, jy = point.y + Math.cos(t*.8+point.phase)*.025;
          const x = x0+(jx*cosine-jy*sine)*radius, y = y0+(jx*sine+jy*cosine)*radius;
          point.sx=x; point.sy=y;
          if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
        });
        ctx.stroke();
        walk.forEach(point => {
          const twinkle = .55+.45*Math.sin(t*3+point.phase*3);
          ctx.fillStyle = `rgba(${rgb},${Math.min(1,.75*twinkle*boost)})`;
          ctx.fillRect(point.sx-point.size/2,point.sy-point.size/2,point.size,point.size);
          if (point.size > 1.5) { ctx.fillStyle = `rgba(255,255,255,${.6*twinkle})`; ctx.fillRect(point.sx-.6,point.sy-.6,1.2,1.2); }
        });
      });
    });
    // Arcos ilustrativos, sin incrementar ninguna métrica de conocimiento.
    if (dt) {
      arcClock += dt;
      const working = status.spiders.some(sp => sp.phase !== 'IDLE');
      if (arcClock > (working ? .55 : 1.2)) {
        arcClock = 0;
        const first = Math.floor(Math.random() * constellations.length);
        const second = (first + 1 + Math.floor(Math.random() * (constellations.length - 1))) % constellations.length;
        const a = constellations[first], b = constellations[second];
        addArc(randomParticle(a), randomParticle(b), a.color, b.color, .7);
      }
    }
    arcs.forEach(arc => drawArc(ctx, arc, t));
    ctx.strokeStyle = 'rgba(154,216,255,.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(qx,qy); ctx.lineTo(hx,hy); ctx.lineTo(cx,cy); ctx.stroke();
    deliveryPackets.forEach(packet => {
      const k = packet.progress, x = k < .5 ? qx + (hx-qx)*k*2 : hx + (cx-hx)*(k-.5)*2;
      const y = k < .5 ? qy + (hy-qy)*k*2 : hy + (cy-hy)*(k-.5)*2;
      const glow = ctx.createRadialGradient(x,y,0,x,y,9);
      glow.addColorStop(0, `rgba(${packet.color.join(',')},1)`); glow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(x,y,9,0,Math.PI*2); ctx.fill();
    });
    // Hilos conectados a las posiciones verdaderas de las arañas que trabajan.
    status.spiders.forEach(sp => {
      if (sp.phase === 'IDLE') return;
      const x = sp.x - rect.left, y = sp.y - rect.top;
      ctx.strokeStyle = 'rgba(200,232,255,.13)'; ctx.lineWidth = .6;
      ctx.beginPath(); ctx.moveTo(qx,qy); ctx.quadraticCurveTo((qx+x)/2,(qy+y)/2+18,x,y); ctx.stroke();
    });
    const auraRadius = qSize * (3 + queenPulse * 2);
    const aura = ctx.createRadialGradient(qx,qy,0,qx,qy,auraRadius);
    aura.addColorStop(0, `rgba(255,90,180,${.18 + queenPulse * .35})`); aura.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=aura; ctx.beginPath(); ctx.arc(qx,qy,auraRadius,0,Math.PI*2); ctx.fill();
    if (queenPulse > 0) {
      ctx.strokeStyle=`rgba(255,90,180,${queenPulse*.7})`; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.arc(qx,qy,qSize*(1.5+(1-queenPulse)*3),0,Math.PI*2); ctx.stroke();
    }
    commandWaves.forEach(wave => {
      const progress = Math.min(1, wave.age / 1.4);
      // Solo se indican las arañas asignadas en este despacho; otras pueden
      // estar ocupadas por órdenes anteriores y no son sus destinatarias.
      const targets = status.spiders.filter(sp => wave.spiderIds.includes(sp.id) && sp.phase !== 'IDLE')
        .map(sp => ({ id: sp.id, x: sp.x - rect.left, y: sp.y - rect.top }));
      root.NCSpiderVisual.drawCommandWave(ctx, { x: qx, y: qy, progress, maxRadius: size * .58, targets });
    });
    ctx.globalCompositeOperation = 'source-over';
    // La reina gira sobre el mismo punto y sigue tejiendo; pausa y movimiento
    // reducido congelan tanto la mirada como el resto del tiempo visual.
    root.NCSpiderVisual.draw(ctx, { ...queen, x: qx, y: qy, angle: queenAngle,
      color: '#bee8ff', core: '#ff5ab4', threadAnchors });
    ctx.globalCompositeOperation = 'lighter';
    drawProbe(ctx, status, rect, t);
    waves.forEach(wave => {
      const progress = wave.age / .8, x = wave.x * w, y = wave.y * h;
      ctx.strokeStyle = `rgba(56,220,255,${(1-progress)*.8})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x,y,progress*size*.25,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle = `rgba(255,90,180,${(1-progress)*.5})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x,y,progress*size*.15,0,Math.PI*2); ctx.stroke();
    });
    const glow = ctx.createRadialGradient(hx,hy,0,hx,hy,22);
    glow.addColorStop(0,'rgba(120,220,255,.9)'); glow.addColorStop(.3,'rgba(56,190,255,.5)'); glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(hx,hy,22,0,Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function isReducedMotion() {
    const S = store();
    if (S && S.getSetting && S.getSetting('reduceMotion')) return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // La sonda examina la decoración, pero el despacho usa únicamente pasajes reales.
  function nearestCluster(x, y, w, h) {
    return constellations.reduce((best, cluster) => {
      const distance = Math.hypot(cluster.x * w - x, cluster.y * h - y);
      return !best || distance < best.distance ? { cluster, distance } : best;
    }, null);
  }

  function describeAt(x, y, rect) {
    const S = store(), status = root.SpiderEngine?.getStatus() || { paused: false, spiders: [] };
    const size = Math.min(rect.width, rect.height * 1.15);
    if (Math.hypot(x - rect.width * .19, y - rect.height * .46) < size * .072) {
      const harvested = S.state.allSentences.filter(sentence => sentence.harvested).length;
      const working = status.spiders.filter(sp => sp.phase !== 'IDLE').length;
      return { title: 'REINA · NC-00', color: '#ff78c4', lines: ['Coordinadora visual', `${harvested} pasajes cosechados · ${working}/${status.spiders.length} en tarea`] };
    }
    const spider = status.spiders.map(sp => ({ sp, distance: Math.hypot(sp.x - rect.left - x, sp.y - rect.top - y) }))
      .filter(item => item.distance < 18).sort((a, b) => a.distance - b.distance)[0]?.sp;
    if (spider) {
      const states = { IDLE: 'En espera', IR_A_PALABRA: 'Camino al texto', EXTRAER_DATOS: 'Leyendo un pasaje',
        ARRASTRAR_A_RED: 'Llevando un patrón', ALIMENTAR_NODO: 'Integrando en la red' };
      const sentence = spider.sentenceId && S.getSentence(spider.sentenceId);
      return { title: `${spider.id} · ${spider.role}`, color: '#bee8ff',
        lines: [status.paused ? `Pausada · ${states[spider.phase] || spider.phase}` : (states[spider.phase] || spider.phase),
          sentence ? `${sentence.docName || 'Documento'} · pág. ${sentence.sourcePage || sentence.pageNum}` : 'Disponible para textos reales'] };
    }
    if (semanticMode) {
      const hub = graphNodes.filter(node => node.isSemantic).map(node => ({ node, distance: Math.hypot(x - node.x, y - node.y) }))
        .filter(item => item.distance < size * .12).sort((a, b) => a.distance - b.distance)[0]?.node;
      if (!hub) return null;
      return { title: hub.label, color: hub.color,
        lines: [`${hub.count || 0} fragmentos · similitud MiniLM aproximada`, 'Clic: enviar arañas libres a este grupo'] };
    }
    const nearby = constellations.map(cluster => ({ cluster, distance: Math.hypot(x - cluster.x * rect.width, y - cluster.y * rect.height) }))
      .filter(item => item.distance < item.cluster.r * size * .95).sort((a, b) => a.distance - b.distance)[0];
    if (!nearby) return null;
    const { cluster } = nearby;
    const nodes = S.state.nodes.filter(node => !node.isHub && (cluster.id === 'core' || node.cluster === cluster.id)).length;
    const patterns = S.state.patterns.filter(pattern => cluster.id === 'core' || pattern.cluster === cluster.id).length;
    return { title: cluster.label, color: `rgb(${cluster.color.join(',')})`,
      lines: [`${nodes} conceptos · ${patterns} patrones reales`, 'Clic: enviar arañas libres al texto'] };
  }

  function showProbeTip(x, y, rect) {
    const tip = document.getElementById('swarm-tip'), info = describeAt(x, y, rect);
    if (!tip) return;
    if (!info) { tip.classList.add('hidden'); return; }
    const title = document.createElement('strong'); title.textContent = info.title; title.style.color = info.color;
    const lines = info.lines.map(text => { const line = document.createElement('span'); line.textContent = text; return line; });
    tip.replaceChildren(title, ...lines); tip.classList.remove('hidden');
    tip.style.left = `${Math.max(4, Math.min(x + 16, rect.width - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(4, Math.min(y + 16, rect.height - tip.offsetHeight - 8))}px`;
  }

  function burstAt(x, y, rect) {
    if (motionStopped()) return;
    if (waves.length >= 8) waves.shift();
    waves.push({ x: x / rect.width, y: y / rect.height, age: 0 });
    const near = [];
    constellations.forEach(cluster => cluster.walks.forEach(walk => walk.forEach(point => {
      if (!Number.isFinite(point.sx) || !Number.isFinite(point.sy)) return;
      const distance = Math.hypot(point.sx - x, point.sy - y);
      if (distance < 170) near.push({ distance, point, color: cluster.color });
    })));
    near.sort((a, b) => a.distance - b.distance).slice(0, 10).forEach(item => {
      addArc({ sx: x, sy: y }, item.point, [255,255,255], item.color, .9);
    });
  }

  let feedbackTimer = null;
  function activateNetworkAt(clientX, clientY, clusterOverride) {
    const stage = document.getElementById('arena-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    burstAt(x, y, rect);
    const nearest = semanticMode
      ? graphNodes.filter(node => node.isSemantic).map(node => ({ node, distance: Math.hypot(node.x - x, node.y - y) }))
        .sort((a, b) => a.distance - b.distance)[0]?.node
      : nearestCluster(x, y, rect.width, rect.height)?.cluster;
    const cluster = clusterOverride || activeCluster || (nearest?.id === 'core' ? null : nearest?.id);
    const result = root.SpiderEngine?.dispatchFromNetwork({ x: rect.left + x, y: rect.top + y, cluster }) || { sent: 0, reason: 'unavailable' };
    const messages = {
      'no-document': 'Carga un documento con texto extraíble para enviar arañas.',
      paused: 'El enjambre está pausado. Reanúdalo para enviar arañas.',
      complete: 'Ya se cosecharon todos los pasajes disponibles.',
      busy: 'Las arañas están ocupadas; sus tareas no se interrumpen.',
      unavailable: 'No hay pasajes libres aquí. Espera o activa AUTO para avanzar de página.'
    };
    const feedback = document.getElementById('swarm-feedback');
    if (feedback) {
      feedback.textContent = result.sent ? `${result.sent} ${result.sent === 1 ? 'araña enviada' : 'arañas enviadas'} a pasajes reales.` : messages[result.reason];
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 4500);
    }
    redrawIfStill();
  }

  function initNetworkInteraction() {
    const stage = document.getElementById('arena-stage');
    if (!stage) return;
    const trackPointer = ev => {
      if (ev.isPrimary === false || !Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) return;
      pointer.x = ev.clientX; pointer.y = ev.clientY; pointer.known = true;
    };
    // Captura también el puntero sobre otros paneles y controles sin interferir
    // con ellos. En pantallas táctiles se conserva la última posición tocada.
    window.addEventListener('pointermove', trackPointer, { capture: true, passive: true });
    window.addEventListener('pointerdown', trackPointer, { capture: true, passive: true });
    const interactive = target => target?.closest?.('button, input, select, textarea, a, .arena-tools, .node-group, #node-inspector');
    stage.addEventListener('pointermove', ev => {
      if (ev.pointerType === 'touch' || interactive(ev.target)) {
        probe.inside = false; document.getElementById('swarm-tip')?.classList.add('hidden'); redrawIfStill(); return;
      }
      const rect = stage.getBoundingClientRect();
      probe.x = ev.clientX - rect.left; probe.y = ev.clientY - rect.top; probe.inside = true;
      showProbeTip(probe.x, probe.y, rect); redrawIfStill();
    });
    stage.addEventListener('pointerleave', () => {
      probe.inside = false; document.getElementById('swarm-tip')?.classList.add('hidden'); redrawIfStill();
    });
    stage.addEventListener('click', ev => {
      if (!interactive(ev.target)) activateNetworkAt(ev.clientX, ev.clientY);
    });
    stage.addEventListener('keydown', ev => {
      if (ev.target !== stage || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault();
      const rect = stage.getBoundingClientRect();
      activateNetworkAt(rect.left + rect.width * .53, rect.top + rect.height * .5);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Grafo
  // ─────────────────────────────────────────────────────────────────────────
  function stageSize() {
    const stage = document.getElementById('arena-stage');
    if (!stage) return { width: 460, height: 380 };
    const rect = stage.getBoundingClientRect();
    return { width: Math.max(120, rect.width || 460), height: Math.max(120, rect.height || 380) };
  }

  function ensureHubs() {
    const S = store();
    if (!S) return;
    const { width: w, height: h } = stageSize();
    width = w; height = h;
    HUBS.forEach(hub => {
      const existing = S.state.nodes.find(n => n.id === hub.id);
      if (existing) return;
      S.state.nodes.unshift(Object.assign({}, hub, {
        x: w * hub.px, y: h * hub.py,
        fx: w * hub.px, fy: h * hub.py,
        weight: 1,
        pageNums: [],
        sentenceIds: []
      }));
    });
    // Enlaces básicos entre hubs si no existen
    HUBS.forEach((hub, i) => {
      const next = HUBS[(i + 1) % HUBS.length];
      if (S.addLink) S.addLink(hub.id, next.id, 'hierarchy');
    });
  }

  function buildGraphData() {
    const S = store();
    if (!S) return;
    const previous = new Map(graphNodes.map(n => [n.id, n]));
    const copy = n => {
      const old = previous.get(n.id);
      return Object.assign({}, old ? { x: old.x, y: old.y, vx: old.vx, vy: old.vy } : {}, n);
    };
    const semantic = root.NCSemantic;
    semanticMode = !!semantic?.info().active;
    if (!semanticMode) {
      // No copiamos el corpus completo para D3: la proyección trabaja sobre
      // datos originales de solo lectura y únicamente se copian los visibles.
      semanticCache = null; semanticDirty = true; displayedTopics = [];
      allGraphNodes = S.state.nodes;
      allGraphLinks = S.state.links || [];
    } else if (!semanticDirty && semanticCache && semanticCache.sourceNodes === S.state.nodes &&
               semanticCache.count === S.state.nodes.length && semanticCache.width === width && semanticCache.height === height) {
      displayedTopics = semanticCache.topics;
      allGraphNodes = semanticCache.nodes;
      allGraphLinks = semanticCache.links;
    } else {
      displayedTopics = semantic.topics();
      // Un nodo histórico podía fusionar una etiqueta de varios documentos.
      // Se separa visualmente por tema sin destruir las citas ni el respaldo.
      const groups = [];
      let hasPending = false;
      for (const node of S.state.nodes.filter(n => !n.isHub)) {
        const buckets = new Map();
        for (const id of node.sentenceIds || []) {
          const topic = semantic.topicId(id) || 'SEM-PENDING';
          if (!buckets.has(topic)) buckets.set(topic, []);
          buckets.get(topic).push(id);
        }
        if (!buckets.size) buckets.set('SEM-PENDING', []);
        if (buckets.has('SEM-PENDING')) hasPending = true;
        for (const [topicId, ids] of buckets) {
          groups.push({ node, topicId, ids, split: buckets.size > 1 });
        }
      }
      if (hasPending) displayedTopics.push({ id: 'SEM-PENDING', label: 'Sin vector todavía', color: '#778699', count: 0 });
      const weights = semantic.preferenceWeights(S.state.feedback);
      const hubs = displayedTopics.map(topic => {
        const position = topic.number ? TOPIC_POSITIONS[(topic.number - 1) % TOPIC_POSITIONS.length] :
          topic.id === 'SEM-PENDING' ? { px: .53, py: .78 } : { px: .53, py: .50 };
        return { ...topic, isHub: true, isSemantic: true, weight: 1,
          preference: weights.get(topic.id) || 0, px: position.px, py: position.py,
          x: width * position.px, y: height * position.py, fx: width * position.px, fy: height * position.py };
      });
      const hubsById = new Map(hubs.map(hub => [hub.id, hub]));
      const nodes = groups.map(({ node, topicId, ids, split }) => {
        const hub = hubsById.get(topicId);
        return { ...node, id: split ? `${node.id}::${topicId}` : node.id, originId: node.id,
          topicId, topicLabel: hub?.label || 'Sin vector todavía', sentenceIds: ids,
          text: split && ids.length ? (S.getSentence(ids[0])?.text || node.text) : node.text,
          color: hub?.color || '#778699' };
      });
      allGraphNodes = hubs.concat(nodes);
      allGraphLinks = nodes.map(node => ({ key: `topic:${node.topicId}>${node.id}`,
        source: hubsById.get(node.topicId), target: node, kind: 'semantic' })).filter(link => link.source);
      semanticCache = { nodes: allGraphNodes, links: allGraphLinks, topics: displayedTopics,
        sourceNodes: S.state.nodes, count: S.state.nodes.length, width, height };
      semanticDirty = false;
    }
    updateGroupingControls();
    // Solo esta muestra llega al DOM y a la simulación. El grafo completo y
    // todas sus citas/relaciones permanecen intactos en el store.
    projection = root.NCGraphProjection.project(allGraphNodes, allGraphLinks, {
      limit: width < 420 ? 24 : 40, edgeLimit: 90, page: graphPage, query: graphQuery,
      cluster: activeCluster, semantic: semanticMode
    });
    graphPage = projection.page;
    graphNodes = projection.nodes.map(copy);
    graphNodeById = new Map(graphNodes.map(node => [node.id, node]));
    // D3 modifica extremos y posiciones; estos objetos son copias de la página,
    // no los enlaces ni nodos persistidos o los de otras páginas.
    const endpoint = value => typeof value === 'object' && value ? value.id : value;
    graphLinks = projection.links.map(link => {
      const source = endpoint(link.source), target = endpoint(link.target);
      return { ...link, key: link.key || `${source}>${target}`, source: graphNodeById.get(source), target: graphNodeById.get(target), kind: link.kind || 'hierarchy' };
    }).filter(link => link.source && link.target);
    updateGraphBrowser();
    graphNeighbors = new Map();
    // Solo unas pocas conexiones por nodo se usan para el efecto visual;
    // los enlaces y sus posiciones siguen perteneciendo a la simulación D3.
    const rememberNeighbor = (id, neighbor) => {
      if (!graphNeighbors.has(id)) graphNeighbors.set(id, []);
      const list = graphNeighbors.get(id);
      if (list.length < 4 && !list.includes(neighbor)) list.push(neighbor);
    };
    graphLinks.forEach(link => {
      const a = link.source?.id, b = link.target?.id;
      if (a && b && a !== b) { rememberNeighbor(a, b); rememberNeighbor(b, a); }
    });
  }

  function updateGraphBrowser() {
    const status = document.getElementById('graph-page');
    if (status && projection) {
      status.textContent = `${projection.start}–${projection.end} / ${projection.filtered}`;
      status.title = `${projection.total} conceptos en total · página ${projection.page + 1} de ${projection.pages} · ${projection.links.length} de ${projection.matchingLinks} conexiones visibles. El inspector permite recorrer todas las relaciones guardadas.`;
    }
    const prev = document.getElementById('graph-prev'), next = document.getElementById('graph-next');
    if (prev) prev.disabled = !projection || projection.page <= 0;
    if (next) next.disabled = !projection || projection.page >= projection.pages - 1;
  }

  function updateGroupingControls() {
    const S = store(), semantic = root.NCSemantic, info = semantic?.info() || {};
    const status = document.getElementById('graph-grouping');
    const stage = document.getElementById('arena-stage');
    stage?.classList.toggle('semantic-mode', semanticMode);
    if (status) {
      status.textContent = semanticMode
        ? `TEMAS MINILM · ${info.indexed}/${info.total} VECTORES${info.indexing ? ' · INDEXANDO' : ''}`
        : info.modelEnabled && !S.getSetting('embedEnabled', true)
          ? 'POR AGENTE · ACTIVA VECTORES EN AJUSTES'
          : info.modelEnabled && !info.total
            ? 'MINILM ACTIVO · CARGA UN DOCUMENTO'
            : info.modelEnabled
              ? 'MINILM · PREPARANDO VECTORES; VISTA POR AGENTE'
              : 'POR AGENTE · ACTIVA MINILM PARA AGRUPAR POR TEMA';
      status.title = semanticMode ? 'Agrupación aproximada por coseno; los nombres son palabras frecuentes y pueden ser imprecisos.' :
        'Los roles DEF, CAUSAL, QUANT y SYNTH no son temas semánticos.';
    }
    const filters = document.getElementById('cluster-filters');
    if (!filters) return;
    const roles = [
      { id: 'AGT-01', short: 'DEF', label: 'definiciones', className: 'c-def' },
      { id: 'AGT-02', short: 'CAUSAL', label: 'relaciones causales', className: 'c-causal' },
      { id: 'AGT-03', short: 'QUANT', label: 'métricas', className: 'c-quant' },
      { id: 'AGT-04', short: 'SYNTH', label: 'síntesis', className: 'c-synth' }
    ];
    const weights = semanticMode ? semantic.preferenceWeights(S.state.feedback) : new Map();
    const options = semanticMode ? displayedTopics.map(topic => ({ ...topic,
      short: topic.number ? `T${topic.number}` : topic.id === 'SEM-PENDING' ? '…' : 'OTROS' })) : roles;
    if (activeCluster && !options.some(option => option.id === activeCluster)) activeCluster = null;
    const old = new Map([...filters.querySelectorAll('.cluster-pill')].map(button => [button.dataset.cluster, button]));
    options.forEach((option, i) => {
      const button = old.get(option.id) || document.createElement('button');
      old.delete(option.id);
      button.type = 'button'; button.className = `cluster-pill ${option.className || ''}`.trim();
      button.dataset.cluster = option.id; button.textContent = option.short;
      button.style.color = option.color || ''; button.style.borderColor = option.color || '';
      const preference = weights.get(option.id) || 0;
      const label = semanticMode ? `${option.label}${preference ? ` · preferencia ${preference > 0 ? '+' : ''}${Math.round(preference * 100)}%` : ''}` : option.label;
      button.title = `Filtrar ${label}`; button.setAttribute('aria-label', `Filtrar ${label}`);
      button.classList.toggle('active', activeCluster === option.id);
      button.setAttribute('aria-pressed', String(activeCluster === option.id));
      if (filters.children[i] !== button) filters.insertBefore(button, filters.children[i] || null);
    });
    old.forEach(button => button.remove());
  }

  function ensureD3() {
    if (!root.d3) {
      const stage = document.getElementById('arena-stage');
      const fallback = document.getElementById('graph-fallback');
      if (fallback) {
        fallback.classList.remove('hidden');
        const nodes = graphNodes.filter(n => !n.isHub);
        fallback.replaceChildren();
        const title = document.createElement('div'); title.className = 'fallback-title';
        title.textContent = nodes.length ? 'Grafo en modo texto (D3 no disponible)' : 'D3 no disponible: usa el ticker y el inspector.';
        fallback.appendChild(title);
        nodes.forEach(node => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'fallback-node';
          button.textContent = `[${semanticMode ? node.topicLabel : node.cluster}] ${node.label} ×${node.weight || 1}`;
          button.classList.toggle('is-dimmed', dimmed(node));
          button.addEventListener('click', event => { event.stopPropagation(); openInspector(node); });
          fallback.appendChild(button);
        });
      }
      if (stage) stage.classList.add('no-d3');
      return false;
    }
    return true;
  }

  function initD3() {
    const svgEl = document.getElementById('neural-svg');
    if (!svgEl || !root.d3) return false;
    svg = root.d3.select(svgEl);
    gLinks = svg.select('g.links');
    if (gLinks.empty()) gLinks = svg.append('g').attr('class', 'links');
    gNodes = svg.select('g.nodes');
    if (gNodes.empty()) gNodes = svg.append('g').attr('class', 'nodes');
    return true;
  }

  function render(full) {
    if (!root.d3 || !gNodes) { if (!root.d3) ensureD3(); return; }
    const d3 = root.d3;

    const linkSel = gLinks.selectAll('line').data(graphLinks, d => d.key);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('line')
      .attr('class', 'graph-link')
      .attr('stroke', d => (d.kind === 'synaptic' ? 'rgba(245,170,60,.32)' : 'rgba(56,220,255,.15)'))
      .attr('stroke-width', d => (d.kind === 'synaptic' ? 1.4 : 1))
      .attr('stroke-dasharray', d => (d.kind === 'synaptic' ? '3,3' : null))
      .attr('opacity', d => d.source.isHub && d.target.isHub ? 0 : 1);
    const allLinks = linkEnter.merge(linkSel)
      .attr('stroke', d => d.kind === 'semantic' ? d.target.color :
        d.kind === 'synaptic' ? 'rgba(245,170,60,.32)' : 'rgba(56,220,255,.15)')
      .attr('stroke-opacity', d => d.kind === 'semantic' ? .38 : 1)
      .attr('opacity', d => {
        if (d.source.isHub && d.target.isHub) return 0;
        if (!activeCluster) return 1;
        return [d.source, d.target].some(node => node.id === activeCluster ||
          (semanticMode ? node.topicId : node.cluster) === activeCluster) ? 1 : .15;
      });

    const nodeSel = gNodes.selectAll('g.node-group').data(graphNodes, d => d.id);
    nodeSel.exit().remove();

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')
      .on('click', (ev, d) => {
        ev.stopPropagation();
        if (d.isHub) activateNetworkAt(ev.clientX, ev.clientY, d.id); else openInspector(d);
      })
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', d => d.isHub ? 'Enviar arañas desde ' + d.label : 'Inspeccionar ' + d.label)
      .on('keydown', (ev, d) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault(); ev.stopPropagation();
        if (d.isHub) {
          const rect = document.getElementById('arena-stage').getBoundingClientRect();
          activateNetworkAt(rect.left + d.x, rect.top + d.y, d.id);
        } else openInspector(d);
      })
      .on('mouseenter', function(ev, d) { showTooltip(ev, d); if (!d.isHub) d3.select(this).select('.node-label').attr('opacity', 1); })
      .on('mouseleave', function(ev, d) { hideTooltip(); d3.select(this).select('.node-label')
        .attr('opacity', highlighted.has(d.id) || highlighted.has(d.originId) || d.isSemantic ? 1 : 0); });

    // Área táctil sin alterar el tamaño visual de los nodos reales.
    nodeEnter.append('circle').attr('r', d => d.isHub ? 14 : 10).attr('fill', 'transparent').attr('pointer-events', 'all');
    nodeEnter.append('circle')
      .attr('class', 'node-circle')
      .attr('fill', d => d.color || '#00f0ff')
      .attr('fill-opacity', d => (d.isHub ? 0.25 : 0.7))
      .attr('stroke', d => d.color || '#00f0ff');

    nodeEnter.append('text')
      .attr('class', 'node-label')
      .attr('dy', d => (d.isHub ? -18 : -12))
      .attr('text-anchor', 'middle')
      .attr('font-family', 'monospace')
      .text(d => d.label);

    const allNodes = nodeEnter.merge(nodeSel)
      .attr('aria-label', d => d.isHub ? 'Enviar arañas desde ' + d.label : 'Inspeccionar ' + d.label);

    const isHighlighted = d => highlighted.has(d.id) || (d.originId && highlighted.has(d.originId));
    allNodes.select('.node-circle')
      .attr('r', d => (d.isHub ? (d.isSemantic ? 5 : 2.5) : Math.min(7, 2.5 + Math.log2(d.weight || 1))))
      .attr('fill', d => d.color || '#00f0ff')
      .attr('stroke-width', d => (isHighlighted(d) ? 2 : d.isHub ? 0.5 : 0.8))
      .attr('stroke', d => (isHighlighted(d) ? '#fbbf24' : d.color || '#00f0ff'))
      .attr('opacity', d => dimmed(d) ? 0.18 : 1);

    // La distancia horizontal entre hubs se reduce en móvil; acotar los
    // rótulos visibles evita que se solapen. El nombre completo queda en el
    // filtro, el tooltip y la etiqueta accesible del hub.
    const topicLabelLimit = Math.max(10, Math.min(28, Math.floor(width * .28 / 5.4)));
    allNodes.select('.node-label')
      .attr('font-size', d => (d.isHub ? '9px' : '8.5px'))
      .attr('fill', d => (isHighlighted(d) ? '#fbbf24' : '#e2e8f0'))
      .attr('opacity', d => (isHighlighted(d) || d.isSemantic ? 1 : 0))
      .text(d => (d.isSemantic ? U.truncate(d.label, topicLabelLimit) : d.weight > 1 && !d.isHub ? `${d.label} ×${d.weight}` : d.label));

    if (full || !simulation) {
      if (simulation) simulation.stop();
      simulation = d3.forceSimulation(graphNodes)
        .force('link', d3.forceLink(graphLinks).id(d => d.id).distance(d => (d.kind === 'synaptic' ? 92 : 62)).strength(0.35))
        .force('charge', d3.forceManyBody().strength(-90))
        .force('collide', d3.forceCollide().radius(d => (d.isHub ? 26 : 18)))
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.06))
        .alphaDecay(0.035);
    } else {
      simulation.nodes(graphNodes);
      simulation.force('link').links(graphLinks);
      simulation.alpha(0.5).restart();
    }
    const topicHubs = new Map(graphNodes.filter(n => n.isSemantic).map(n => [n.id, n]));
    // Las fuerzas temáticas no dependen del agente que cosechó cada nodo.
    simulation.force('topic-x', d3.forceX(d => topicHubs.get(d.topicId)?.fx ?? width / 2)
      .strength(d => semanticMode && !d.isHub ? .22 : 0));
    simulation.force('topic-y', d3.forceY(d => topicHubs.get(d.topicId)?.fy ?? height / 2)
      .strength(d => semanticMode && !d.isHub ? .22 : 0));

    const placeGraph = () => {
      allLinks
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      allNodes.attr('transform', d => {
        d.x = Math.max(18, Math.min(width - 18, d.x));
        d.y = Math.max(18, Math.min(height - 18, d.y));
        return `translate(${d.x},${d.y})`;
      });
    };
    simulation.on('tick', placeGraph);
    if (isReducedMotion()) {
      // Pocos pasos síncronos evitan una transición visible sin bloquear corpus grandes.
      simulation.stop(); simulation.tick(8); placeGraph();
    } else if (document.hidden || root.SpiderEngine?.getStatus().paused) {
      simulation.stop(); placeGraph();
    }
  }

  function dimmed(d) {
    if (!activeCluster) return false;
    if (d.isHub) return d.id !== activeCluster;
    return (semanticMode ? d.topicId : d.cluster) !== activeCluster;
  }

  // Solo se exponen copias de posiciones de nodos reales y visibles. El reposo
  // no desplaza la simulación, no crea enlaces ni modifica el almacenamiento.
  function idleGraphRect(rect) {
    if (!gNodes || !root.d3 || !visible || document.hidden) return null;
    const bounds = rect || document.getElementById('arena-stage')?.getBoundingClientRect();
    return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
  }
  function idleNodePoint(node, rect) {
    if (!node || dimmed(node) || !Number.isFinite(node.x) || !Number.isFinite(node.y) ||
        node.x < 0 || node.y < 0 || node.x > rect.width || node.y > rect.height) return null;
    const x = rect.left + node.x, y = rect.top + node.y;
    // No enviar arañas a una parte de la red que esté fuera de la ventana.
    if (x < 16 || y < 16 || x > window.innerWidth - 16 || y > window.innerHeight - 16) return null;
    return { id: node.id, x, y };
  }
  function getIdleTargets(bounds) {
    const rect = idleGraphRect(bounds);
    if (!rect) return [];
    const targets = [];
    graphNodes.forEach(node => {
      if (node.isHub) return;
      const point = idleNodePoint(node, rect);
      if (point) targets.push(point);
    });
    return targets;
  }
  function getIdleTarget(id, bounds) {
    const rect = idleGraphRect(bounds), node = graphNodeById.get(id);
    if (!rect || !node || node.isHub) return null;
    const point = idleNodePoint(node, rect);
    if (!point) return null;
    point.links = (graphNeighbors.get(id) || []).map(neighbor => idleNodePoint(graphNodeById.get(neighbor), rect)).filter(Boolean);
    return point;
  }

  function showTooltip(ev, d) {
    const tip = document.getElementById('node-tooltip');
    if (!tip) return;
    tip.innerHTML = d.isHub
      ? `<strong>${U.escapeHtml(d.label)}</strong><div class="tip-meta">${d.isSemantic ? `${d.count || 0} fragmentos · ` : ''}Enviar arañas libres a pasajes reales</div>`
      : `<strong>[${U.escapeHtml(semanticMode ? d.topicLabel : d.cluster || 'KIMI')}]</strong> ${U.escapeHtml(d.label)}
        <div class="tip-meta">agente ${U.escapeHtml(d.cluster || 'KIMI')} · peso ×${U.escapeHtml(d.weight || 1)} · ${(d.sentenceIds || []).length} cita(s)</div>
        ${d.text ? `<div class="tip-text">${U.escapeHtml(U.truncate(d.text, 180))}</div>` : ''}`;
    tip.classList.remove('hidden');
    const rect = tip.getBoundingClientRect();
    const x = Math.min(window.innerWidth - rect.width - 12, ev.clientX + 14);
    const y = Math.min(window.innerHeight - rect.height - 12, ev.clientY + 14);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function hideTooltip() {
    document.getElementById('node-tooltip')?.classList.add('hidden');
  }

  let inspectorReturnFocus = null;
  function focusWithoutScroll(element) {
    if (!element?.focus) return;
    try { element.focus({ preventScroll: true }); } catch (_) { element.focus(); }
  }
  function closeInspector() {
    const insp = document.getElementById('node-inspector');
    const focusedInside = insp?.contains(document.activeElement);
    insp?.classList.add('hidden');
    if (focusedInside) focusWithoutScroll(inspectorReturnFocus?.isConnected ? inspectorReturnFocus : document.getElementById('arena-stage'));
    inspectorReturnFocus = null;
  }
  function openInspector(node) {
    if (!node || node.isHub) return;
    const insp = document.getElementById('node-inspector');
    if (!insp) return;
    if (insp.classList.contains('hidden')) {
      const active = document.activeElement;
      inspectorReturnFocus = active && active !== document.body && active !== document.documentElement
        ? active : document.getElementById('arena-stage');
    }
    document.getElementById('insp-cluster').textContent = semanticMode ? `${node.topicLabel} · ${node.cluster || 'KIMI'}` : node.cluster || 'KIMI';
    document.getElementById('insp-weight').textContent = `×${node.weight || 1}`;
    document.getElementById('insp-label').textContent = node.label;
    document.getElementById('insp-text').textContent = node.text || '';

    const citEl = document.getElementById('insp-citations');
    const citPages = document.getElementById('insp-citation-pages');
    const citPrev = document.getElementById('insp-citation-prev'), citNext = document.getElementById('insp-citation-next');
    const citStatus = document.getElementById('insp-citation-status'), citPage = document.getElementById('insp-citation-page');
    const citPageCount = document.getElementById('insp-citation-page-count');
    if (citEl) {
      // Un concepto muy frecuente puede tener miles de citas. Mantener todas
      // accesibles sin construir miles de botones al abrir el inspector.
      const ids = (node.sentenceIds || []).filter(sid => !!store()?.getSentence(sid));
      let page = 0;
      const drawCitations = () => {
        const pages = Math.max(1, Math.ceil(ids.length / 12));
        page = Math.max(0, Math.min(page, pages - 1));
        citEl.replaceChildren();
        ids.slice(page * 12, page * 12 + 12).forEach(sid => {
          const sentence = store()?.getSentence(sid);
          if (!sentence) return;
          const chip = document.createElement('button'); chip.type = 'button';
          chip.className = 'citation-chip';
          chip.textContent = `${sentence.docName || 'Documento'} · Pág ${sentence.sourcePage || sentence.pageNum}`;
          chip.title = 'Ir a la fuente';
          chip.addEventListener('click', () => { root.DocViewer?.goToSentence(sid); });
          citEl.appendChild(chip);
        });
        if (!ids.length) {
          const empty = document.createElement('span'); empty.className = 'muted'; empty.textContent = 'Sin página asociada';
          citEl.appendChild(empty);
        }
        if (citPages && citPrev && citNext && citStatus) {
          citPages.classList.toggle('hidden', ids.length <= 12);
          citStatus.textContent = `Citas ${ids.length ? page * 12 + 1 : 0}–${Math.min(ids.length, (page + 1) * 12)} / ${ids.length}`;
          citPrev.disabled = page === 0; citNext.disabled = page >= pages - 1;
          if (citPage) { citPage.max = String(pages); citPage.value = String(page + 1); }
          if (citPageCount) citPageCount.textContent = `/ ${pages}`;
        }
      };
      if (citPrev && citNext) { citPrev.onclick = () => { page--; drawCitations(); }; citNext.onclick = () => { page++; drawCitations(); }; }
      if (citPage) {
        const jump = () => { const n = Number(citPage.value); if (Number.isFinite(n)) page = Math.floor(n) - 1; drawCitations(); };
        citPage.onchange = jump;
        citPage.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); jump(); } };
      }
      drawCitations();
    }

    // La proyección puede omitir enlaces o poner el vecino en otra página. El
    // inspector permite recorrer las relaciones originales sin límite de datos.
    const details = document.getElementById('insp-connections');
    const list = document.getElementById('insp-connection-list');
    const prev = document.getElementById('insp-connection-prev'), next = document.getElementById('insp-connection-next');
    const status = document.getElementById('insp-connection-status'), pageInput = document.getElementById('insp-connection-page');
    const pageCount = document.getElementById('insp-connection-page-count');
    if (details && list && prev && next && status) {
      const original = node.originId || node.id;
      const endpoint = value => typeof value === 'object' && value ? value.id : value;
      const edges = (store()?.state.links || []).filter(link => endpoint(link.source) === original || endpoint(link.target) === original);
      let page = 0;
      details.querySelector('summary').textContent = `Conexiones guardadas (${edges.length})`;
      const draw = () => {
        const pages = Math.max(1, Math.ceil(edges.length / 12));
        page = Math.max(0, Math.min(page, pages - 1));
        list.replaceChildren();
        edges.slice(page * 12, page * 12 + 12).forEach(link => {
          const from = endpoint(link.source), to = endpoint(link.target), neighborId = from === original ? to : from;
          const neighbor = allGraphNodes.find(n => n.id === neighborId || n.originId === neighborId) ||
            (store()?.state.nodes || []).find(n => n.id === neighborId);
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'citation-chip';
          button.textContent = `${link.kind || 'relación'} · ${neighbor?.label || neighborId}`;
          button.title = 'Explorar conexión';
          button.addEventListener('click', () => {
            if (!neighbor) return;
            if (neighbor.isHub) setClusterFilter(neighbor.id);
            else openInspector(neighbor);
          });
          list.appendChild(button);
        });
        if (!edges.length) list.textContent = 'Sin relaciones guardadas.';
        status.textContent = `${edges.length ? page * 12 + 1 : 0}–${Math.min(edges.length, (page + 1) * 12)} / ${edges.length}`;
        prev.disabled = page === 0; next.disabled = page >= pages - 1;
        if (pageInput) { pageInput.max = String(pages); pageInput.value = String(page + 1); }
        if (pageCount) pageCount.textContent = `/ ${pages}`;
      };
      prev.onclick = () => { page--; draw(); }; next.onclick = () => { page++; draw(); };
      if (pageInput) {
        const jump = () => { const n = Number(pageInput.value); if (Number.isFinite(n)) page = Math.floor(n) - 1; draw(); };
        pageInput.onchange = jump;
        pageInput.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); jump(); } };
      }
      draw();
    }

    const askBtn = document.getElementById('btn-insp-ask');
    if (askBtn) {
      askBtn.onclick = () => {
        const S = store();
        if (S) S.emit('chat:askAbout', { node });
      };
    }

    insp.classList.remove('hidden');
    focusWithoutScroll(insp);
  }

  function scrollToSentence(sentenceId) {
    const el = root.DocViewer?.getSentenceElement(sentenceId) ||
      Array.from(document.querySelectorAll('.sentence-block')).find(x => x.dataset.sid === sentenceId);
    if (!el) return;
    el.classList.add('sentence-active');
    el.scrollIntoView({ behavior: isReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => el.classList.remove('sentence-active'), 2400);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ticker y telemetría
  // ─────────────────────────────────────────────────────────────────────────
  const TAGS = { 'AGT-01': 'SPDR-01 [DEF]', 'AGT-02': 'SPDR-02 [CAUSAL]', 'AGT-03': 'SPDR-03 [QUANT]', 'AGT-04': 'SPDR-04 [SYNTH]' };

  function appendTickerRow({ cluster, text, pageNum, color, sentenceId }) {
    const list = document.getElementById('ticker-list');
    const hashEl = document.getElementById('ticker-hashes');
    const S = store();
    const displayPage = S?.getSentence(sentenceId)?.sourcePage || pageNum;
    if (hashEl && S) hashEl.textContent = `${S.state.visitedPatternHashes.size} PATRONES`;
    if (!list) return;
    list.querySelector('.ticker-empty')?.remove();
    const row = document.createElement('div');
    row.className = 'ticker-row';
    row.innerHTML = `<span style="color:${U.escapeHtml(color || '#00f0ff')}; font-weight:700;">${U.escapeHtml(TAGS[cluster] || cluster)}</span> ` +
      `<span class="muted">[Pág ${U.escapeHtml(displayPage || 1)}]</span> “${U.escapeHtml(text || '')}”`;
    list.prepend(row);
    while (list.children.length > 40) list.removeChild(list.lastChild);
  }

  function updateTelemetry() {
    const S = store();
    if (!S) return;
    const nodes = S.state.nodes.filter(n => !n.isHub).length;
    const patterns = S.state.patterns.length;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('stat-nodes', nodes);
    setText('stat-patterns', patterns);
    setText('stat-sentences', S.state.allSentences.length);
    const hashEl = document.getElementById('ticker-hashes');
    if (hashEl) hashEl.textContent = `${S.state.visitedPatternHashes.size} PATRONES`;

    const harvested = S.state.allSentences.filter(s => s.harvested).length;
    const total = S.state.allSentences.length || 0;
    const bar = document.getElementById('harvest-bar');
    const label = document.getElementById('harvest-label');
    if (bar) bar.style.width = total ? Math.round((harvested / total) * 100) + '%' : '0%';
    if (label) label.textContent = `${harvested}/${total} pasajes cosechados`;
  }

  function recenter() {
    const { width: w, height: h } = stageSize();
    width = w; height = h;
    const S = store();
    HUBS.forEach(hub => {
      [S?.state.nodes.find(n => n.id === hub.id), graphNodes.find(n => n.id === hub.id)].forEach(n => {
        if (n) { n.x = n.fx = w * hub.px; n.y = n.fy = h * hub.py; }
      });
    });
    graphNodes.filter(n => n.isSemantic).forEach(n => { n.x = n.fx = w * n.px; n.y = n.fy = h * n.py; });
    probe.inside = false; document.getElementById('swarm-tip')?.classList.add('hidden');
    resetVisualEffects(); redrawIfStill();
    // La capacidad de la página cambia con el ancho real de la red.
    buildGraphData();
    if (!simulation) { render(false); return; }
    simulation.force('center', root.d3.forceCenter(w / 2, h / 2).strength(0.08));
    render(false);
    if (!motionStopped()) simulation.alpha(0.8).restart();
  }

  function setClusterFilter(cluster) {
    activeCluster = activeCluster === cluster ? null : cluster;
    graphPage = 0;
    buildGraphData(); render(false);
  }

  let highlightTimer = null;
  function highlightPath(nodeIds) {
    highlighted = new Set(nodeIds || []);
    const index = projection?.eligible.findIndex(node => highlighted.has(node.id) || highlighted.has(node.originId));
    if (index >= 0) {
      const page = Math.floor(index / projection.limit);
      if (page !== graphPage) { graphPage = page; buildGraphData(); }
    }
    render(false);
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => { highlighted.clear(); render(false); }, 4500);
  }
  function highlightSources(sentenceIds) {
    const ids = new Set(sentenceIds || []);
    highlightPath(allGraphNodes.filter(node => !node.isHub && (node.sentenceIds || []).some(id => ids.has(id))).map(node => node.id));
  }

  function getHubScreenPos(clusterId) {
    const svgEl = document.getElementById('neural-svg');
    if (!svgEl) return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
    const rect = svgEl.getBoundingClientRect();
    const hub = graphNodes.find(n => n.id === clusterId) || (store()?.state.nodes || []).find(n => n.id === clusterId);
    if (hub && hub.x != null) return { x: rect.left + hub.x, y: rect.top + hub.y };
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Arranque
  // ─────────────────────────────────────────────────────────────────────────
  function init() {
    if (initialized) return;
    initialized = true;
    const S = store();
    if (!S) return;
    document.documentElement.classList.toggle('motion-reduced', !!S.getSetting('reduceMotion'));

    ensureHubs();
    const hasD3 = ensureD3();
    if (hasD3) initD3();
    buildGraphData();
    init3DSphere();
    initNetworkInteraction();
    render(true);
    updateTelemetry();
    S.state.patterns.slice(-40).forEach(appendTickerRow);

    document.getElementById('btn-close-inspector')?.addEventListener('click', closeInspector);
    document.getElementById('node-inspector')?.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeInspector(); }
    });
    document.getElementById('btn-center-net')?.addEventListener('click', recenter);
    const search = document.getElementById('graph-search');
    search?.addEventListener('input', debounce(() => {
      graphQuery = search.value; graphPage = 0; buildGraphData(); render(false);
    }, 120));
    document.getElementById('graph-prev')?.addEventListener('click', () => {
      graphPage--; buildGraphData(); render(false);
    });
    document.getElementById('graph-next')?.addEventListener('click', () => {
      graphPage++; buildGraphData(); render(false);
    });

    document.getElementById('cluster-filters')?.addEventListener('click', event => {
      const pill = event.target.closest('.cluster-pill');
      if (pill) setClusterFilter(pill.dataset.cluster);
    });

    // Agrupar cosechas rápidas en corpus grandes evita reconstruir miles de
    // copias por cada entrega; el store y el ticker se actualizan al instante.
    let graphRefreshTimer = null;
    const scheduleGraphRefresh = () => {
      semanticDirty = true;
      if (S.state.nodes.length <= 64) { buildGraphData(); render(false); return; }
      if (!graphRefreshTimer) graphRefreshTimer = setTimeout(() => {
        graphRefreshTimer = null; buildGraphData(); render(false);
      }, 120);
    };
    S.on('node:added', ({ pattern }) => {
      scheduleGraphRefresh();
      appendTickerRow(pattern);
      updateTelemetry();
    });
    S.on('semantic:updated', scheduleGraphRefresh);

    S.on('node:removed', () => { semanticDirty = true; buildGraphData(); render(true); updateTelemetry(); closeInspector(); });
    S.on('doc:removed', () => { semanticDirty = true; buildGraphData(); render(true); updateTelemetry(); closeInspector(); document.getElementById('ticker-list')?.replaceChildren(); S.state.patterns.slice(-40).forEach(appendTickerRow); });
    S.on('brain:imported', () => {
      semanticDirty = true;
      ensureHubs(); buildGraphData(); render(true); updateTelemetry(); closeInspector();
      document.getElementById('ticker-list')?.replaceChildren(); S.state.patterns.slice(-40).forEach(appendTickerRow);
      updateMotionMode();
    });

    S.on('system:reset', () => {
      clearTimeout(graphRefreshTimer); graphRefreshTimer = null;
      semanticCache = null; semanticDirty = true;
      graphNodes = []; allGraphNodes = [];
      graphLinks = []; allGraphLinks = []; graphPage = 0; graphQuery = ''; activeCluster = null;
      const search = document.getElementById('graph-search'); if (search) search.value = '';
      if (simulation) simulation.stop();
      simulation = null;
      document.getElementById('ticker-list')?.replaceChildren();
      document.getElementById('swarm-tip')?.classList.add('hidden');
      const feedback = document.getElementById('swarm-feedback');
      if (feedback) feedback.textContent = '';
      clearTimeout(feedbackTimer); probe.inside = false; resetVisualEffects();
      ensureHubs();
      buildGraphData();
      render(true);
      updateTelemetry();
      closeInspector();
      updateMotionMode();
    });

    S.on('doc:pageChanged', () => updateTelemetry());
    S.on('retrieve:indexed', () => updateTelemetry());
    S.on('spider:delivered', ({ cluster }) => {
      if (!motionStopped()) {
        queenPulse = 1; webVibration = 1;
        const color = constellations.find(c => c.id === cluster)?.color || [70,180,255];
        if (deliveryPackets.length >= 12) deliveryPackets.shift();
        deliveryPackets.push({ progress: 0, color });
      }
      redrawIfStill();
    });
    S.on('spider:queryStart', () => {
      const feedback = document.getElementById('swarm-feedback');
      if (feedback) feedback.textContent = '';
      clearTimeout(feedbackTimer);
    });
    S.on('spiders:queryGuidance', detail => {
      const feedback = document.getElementById('swarm-feedback');
      if (!feedback) return;
      const label = detail.method === 'minilm' ? 'Guía MiniLM' : 'Guía local (sin señal MiniLM)';
      feedback.textContent = detail.sent ? `${label}: ${detail.sent} ${detail.sent === 1 ? 'araña enviada' : 'arañas enviadas'}${detail.pending ? ` · ${detail.pending} en espera` : ''}.` :
        detail.pending ? `${label}: ${detail.paused ? 'enjambre pausado' : 'esperando arañas o navegación AUTO'}.` : `${label}: sin pasajes disponibles para dirigir.`;
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 6000);
    });
    S.on('spiders:dispatched', detail => {
      if (detail?.count > 0 && !document.hidden && visible && !motionStopped()) {
        // Agrupa despachos simultáneos para que la señal no tape la red.
        if (!commandWaves.length || commandWaves[commandWaves.length - 1].age > .25) {
          if (commandWaves.length >= 3) commandWaves.shift();
          commandWaves.push({ age: 0, spiderIds: [] });
        }
        const wave = commandWaves[commandWaves.length - 1];
        for (const id of Array.isArray(detail.spiderIds) ? detail.spiderIds : []) {
          if (!wave.spiderIds.includes(id)) wave.spiderIds.push(id);
        }
        queenPulse = Math.max(queenPulse, .8); webVibration = Math.max(webVibration, .45);
      }
      redrawIfStill();
    });
    ['spiders:count', 'spider:scanStart', 'spider:extracted', 'harvest:progress'].forEach(event => S.on(event, redrawIfStill));
    function updateMotionMode() {
      document.documentElement.classList.toggle('motion-reduced', !!S.getSetting('reduceMotion'));
      stopSphere(); resetVisualEffects();
      if (simulation) {
        if (isReducedMotion()) render(false);
        else if (document.hidden || root.SpiderEngine?.getStatus().paused) simulation.stop();
        else simulation.alpha(.5).restart();
      }
      startSphere();
    }
    S.on('settings:changed', ({ key }) => { if (key === 'reduceMotion') updateMotionMode(); });
    S.on('spiders:paused', updateMotionMode);
    S.on('spider:thought', ({ text }) => {
      const badge = document.getElementById('hud-mode-badge');
      if (badge) badge.title = U.truncate(text, 120);
    });

    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (media?.addEventListener) media.addEventListener('change', updateMotionMode);
    else if (media?.addListener) media.addListener(updateMotionMode);
    document.addEventListener('visibilitychange', () => {
      visible = !document.hidden;
      if (visible) {
        startSphere();
        if (simulation && !motionStopped()) simulation.alpha(.3).restart();
      } else {
        stopSphere();
        if (simulation) simulation.stop();
      }
    });

    const onResize = debounce(recenter, 180);
    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(document.getElementById('arena-stage'));
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  root.NeuralGraph = { init, getHubScreenPos, getIdleTargets, getIdleTarget, highlightPath, highlightSources,
    recenter, setClusterFilter, scrollToSentence, updateTelemetry, ensureHubs };
})(typeof window !== 'undefined' ? window : globalThis);
