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
  let sphereCtx = null, constellations = [], stars = [];
  let rafSphere = null;
  let highlighted = new Set();
  let activeCluster = null;
  let graphNodes = [];
  let graphLinks = [];
  let visible = true;
  let initialized = false;

  const store = () => root.NeuralStore;

  // Constelaciones decorativas; los nodos interactivos reales se dibujan encima con D3.
  function init3DSphere() {
    const canvas = document.getElementById('core-3d-canvas');
    if (!canvas || !(sphereCtx = canvas.getContext('2d'))) return;
    constellations = [
      { id: 'AGT-01', x:.36, y:.30, r:.15, color:[56,220,255], count:52, rotation:.05 },
      { id: 'AGT-02', x:.67, y:.31, r:.12, color:[139,92,246], count:44, rotation:-.04 },
      { id: 'core', x:.53, y:.50, r:.16, color:[70,180,255], count:66, rotation:.025 },
      { id: 'AGT-04', x:.37, y:.66, r:.14, color:[52,230,150], count:56, rotation:-.05 },
      { id: 'AGT-03', x:.66, y:.66, r:.12, color:[245,170,60], count:44, rotation:.04 }
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
    startSphere();
  }

  function startSphere() {
    if (rafSphere || !sphereCtx) return;
    if (isReducedMotion()) { drawSphere(0); return; }
    let lastDraw = 0;
    const loop = time => {
      if (time - lastDraw >= 33) { drawSphere(time); lastDraw = time; }
      rafSphere = requestAnimationFrame(loop);
    };
    rafSphere = requestAnimationFrame(loop);
  }

  function stopSphere() {
    if (rafSphere) cancelAnimationFrame(rafSphere);
    rafSphere = null;
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
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w*.5, h*.48, 0, w*.5, h*.48, Math.max(w,h)*.7);
    bg.addColorStop(0, '#08111c'); bg.addColorStop(1, '#020408');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const t = isReducedMotion() ? 0 : time / 1000;
    stars.forEach(star => {
      ctx.fillStyle = `rgba(150,200,255,${star.alpha * (.6 + .4 * Math.sin(t * 2 + star.x * 20))})`;
      ctx.fillRect(star.x*w, star.y*h, star.size, star.size);
    });
    ctx.globalCompositeOperation = 'lighter';
    const core = constellations[2], cx = core.x*w, cy = core.y*h;
    const status = root.SpiderEngine?.getStatus();
    constellations.forEach(cluster => {
      if (cluster.id === 'core') return;
      ctx.strokeStyle = `rgba(${cluster.color.join(',')},.13)`; ctx.lineWidth = 1; ctx.setLineDash([2,5]);
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cluster.x*w,cluster.y*h); ctx.stroke(); ctx.setLineDash([]);
    });
    constellations.forEach(cluster => {
      const x0 = cluster.x*w, y0 = cluster.y*h, rgb = cluster.color.join(',');
      const running = status && !status.paused && status.spiders.some(sp => sp.cluster === cluster.id && sp.phase !== 'IDLE');
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
        ctx.setLineDash([]); ctx.restore();
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
    // Malla del documento, puramente decorativa.
    const baseX=w*.20, baseY=h*.47;
    const offsets=[[0,0],[-.06,-.11],[.05,-.08],[-.10,.04],[.07,.06],[-.03,.12],[.12,-.02],[-.13,-.06],[.02,.17],[.15,.12],[-.08,.19]];
    const edges=[[0,1],[0,2],[0,3],[0,4],[0,5],[1,2],[1,7],[3,7],[2,6],[4,6],[4,9],[5,8],[5,10],[3,10],[8,9],[6,9],[1,3]];
    const points=offsets.map(([x,y],i)=>[baseX+x*size+Math.sin(t+i)*2,baseY+y*size+Math.cos(t*1.1+i)*2]);
    ctx.lineWidth=.8; ctx.strokeStyle='rgba(154,216,255,.35)';
    edges.forEach(([a,b])=>{ctx.beginPath();ctx.moveTo(...points[a]);ctx.lineTo(...points[b]);ctx.stroke();});
    points.forEach((point,i)=>{
      const radius=i?4:8, glow=ctx.createRadialGradient(point[0],point[1],0,point[0],point[1],radius);
      glow.addColorStop(0,'rgba(220,240,255,.95)');glow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(point[0],point[1],radius,0,Math.PI*2);ctx.fill();
    });
    ctx.strokeStyle='rgba(154,216,255,.4)';ctx.beginPath();ctx.moveTo(...points[4]);ctx.lineTo(w*.42,h*.49);ctx.lineTo(cx,cy);ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function isReducedMotion() {
    const S = store();
    if (S && S.getSetting && S.getSetting('reduceMotion')) return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
    graphNodes = S.state.nodes.map(n => {
      const old = previous.get(n.id);
      return Object.assign({}, old ? { x: old.x, y: old.y, vx: old.vx, vy: old.vy } : {}, n);
    });
    const byId = new Map(graphNodes.map(n => [n.id, n]));
    graphLinks = [];
    (S.state.links || []).forEach(l => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!byId.has(s) || !byId.has(t)) return;
      graphLinks.push({ key: l.key || s + '>' + t, source: byId.get(s), target: byId.get(t), kind: l.kind || 'hierarchy' });
    });
  }

  function ensureD3() {
    if (!root.d3) {
      const stage = document.getElementById('arena-stage');
      const fallback = document.getElementById('graph-fallback');
      if (fallback) {
        fallback.classList.remove('hidden');
        const S = store();
        const nodes = S ? S.state.nodes.filter(n => !n.isHub).slice(0, 12) : [];
        fallback.innerHTML = nodes.length
          ? `<div class="fallback-title">Grafo en modo texto (D3 no disponible)</div>` +
            nodes.map(n => `<div class="fallback-node"><span>[${U.escapeHtml(n.cluster)}]</span> ${U.escapeHtml(n.label)} <em>×${U.escapeHtml(n.weight || 1)}</em></div>`).join('')
          : `<div class="fallback-title">D3 no disponible: usa el ticker y el inspector.</div>`;
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
    if (!root.d3 || !gNodes) return;
    const d3 = root.d3;

    const linkSel = gLinks.selectAll('line').data(graphLinks, d => d.key);
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('line')
      .attr('class', 'graph-link')
      .attr('stroke', d => (d.kind === 'synaptic' ? 'rgba(245,170,60,.32)' : 'rgba(56,220,255,.15)'))
      .attr('stroke-width', d => (d.kind === 'synaptic' ? 1.4 : 1))
      .attr('stroke-dasharray', d => (d.kind === 'synaptic' ? '3,3' : null))
      .attr('opacity', d => d.source.isHub && d.target.isHub ? 0 : 1);
    const allLinks = linkEnter.merge(linkSel);

    const nodeSel = gNodes.selectAll('g.node-group').data(graphNodes, d => d.id);
    nodeSel.exit().remove();

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')
      .on('click', (ev, d) => { ev.stopPropagation(); openInspector(d); })
      .attr('tabindex', d => d.isHub ? -1 : 0)
      .attr('role', d => d.isHub ? null : 'button')
      .attr('aria-label', d => d.isHub ? null : 'Inspeccionar ' + d.label)
      .on('keydown', (ev, d) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openInspector(d); } })
      .on('mouseenter', function(ev, d) { showTooltip(ev, d); if (!d.isHub) d3.select(this).select('.node-label').attr('opacity', 1); })
      .on('mouseleave', function(ev, d) { hideTooltip(); d3.select(this).select('.node-label').attr('opacity', highlighted.has(d.id) ? 1 : 0); });

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

    const allNodes = nodeEnter.merge(nodeSel);

    allNodes.select('.node-circle')
      .attr('r', d => (d.isHub ? 2.5 : Math.min(7, 2.5 + Math.log2(d.weight || 1))))
      .attr('stroke-width', d => (highlighted.has(d.id) ? 2 : d.isHub ? 0.5 : 0.8))
      .attr('stroke', d => (highlighted.has(d.id) ? '#fbbf24' : d.color || '#00f0ff'))
      .attr('opacity', d => dimmed(d) ? 0.18 : 1);

    allNodes.select('.node-label')
      .attr('font-size', d => (d.isHub ? '9px' : '8.5px'))
      .attr('fill', d => (highlighted.has(d.id) ? '#fbbf24' : '#e2e8f0'))
      .attr('opacity', d => highlighted.has(d.id) ? 1 : 0)
      .text(d => (d.weight > 1 && !d.isHub ? `${d.label} ×${d.weight}` : d.label));

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

    simulation.on('tick', () => {
      allLinks
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      allNodes.attr('transform', d => {
        d.x = Math.max(18, Math.min(width - 18, d.x));
        d.y = Math.max(18, Math.min(height - 18, d.y));
        return `translate(${d.x},${d.y})`;
      });
    });

    if (isReducedMotion()) {
      simulation.alphaDecay(0.3);
      setTimeout(() => { if (simulation) simulation.alpha(0); }, 1200);
    }
  }

  function dimmed(d) {
    if (!activeCluster) return false;
    if (d.isHub) return d.id !== activeCluster;
    return d.cluster !== activeCluster;
  }

  function showTooltip(ev, d) {
    const tip = document.getElementById('node-tooltip');
    if (!tip) return;
    tip.innerHTML = `<strong>[${U.escapeHtml(d.cluster || 'KIMI')}]</strong> ${U.escapeHtml(d.label)}
      <div class="tip-meta">peso ×${U.escapeHtml(d.weight || 1)} · ${(d.pageNums || []).length} cita(s)</div>
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

  function openInspector(node) {
    if (!node || node.isHub) return;
    const insp = document.getElementById('node-inspector');
    if (!insp) return;
    document.getElementById('insp-cluster').textContent = node.cluster || 'KIMI';
    document.getElementById('insp-weight').textContent = `×${node.weight || 1}`;
    document.getElementById('insp-label').textContent = node.label;
    document.getElementById('insp-text').textContent = node.text || '';

    const citEl = document.getElementById('insp-citations');
    if (citEl) {
      citEl.innerHTML = '';
      (node.sentenceIds || []).forEach(sid => {
        const sentence = store()?.getSentence(sid);
        if (!sentence) return;
        const chip = document.createElement('button');
        chip.className = 'citation-chip';
        chip.textContent = `${sentence.docName || 'Documento'} · Pág ${sentence.sourcePage || sentence.pageNum}`;
        chip.title = 'Ir a la fuente';
        chip.addEventListener('click', () => {
          store()?.holdAutoNavigation();
          store()?.setActiveDoc(sentence.docId, sentence.pageNum);
          setTimeout(() => scrollToSentence(sid), 90);
        });
        citEl.appendChild(chip);
      });
      if (!citEl.children.length) citEl.innerHTML = '<span class="muted">Sin página asociada</span>';
    }

    const askBtn = document.getElementById('btn-insp-ask');
    if (askBtn) {
      askBtn.onclick = () => {
        const S = store();
        if (S) S.emit('chat:askAbout', { node });
      };
    }

    insp.classList.remove('hidden');
  }

  function scrollToSentence(sentenceId) {
    const el = Array.from(document.querySelectorAll('.sentence-block')).find(x => x.dataset.sid === sentenceId);
    if (!el) return;
    el.classList.add('sentence-active');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.classList.remove('sentence-active'), 2400);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ticker y telemetría
  // ─────────────────────────────────────────────────────────────────────────
  const TAGS = { 'AGT-01': 'SPDR-01 [DEF]', 'AGT-02': 'SPDR-02 [CAUSAL]', 'AGT-03': 'SPDR-03 [QUANT]', 'AGT-04': 'SPDR-04 [SYNTH]' };

  function appendTickerRow({ cluster, text, pageNum, color }) {
    const list = document.getElementById('ticker-list');
    const hashEl = document.getElementById('ticker-hashes');
    const S = store();
    if (hashEl && S) hashEl.textContent = `${S.state.visitedPatternHashes.size} PATRONES`;
    if (!list) return;
    list.querySelector('.ticker-empty')?.remove();
    const row = document.createElement('div');
    row.className = 'ticker-row';
    row.innerHTML = `<span style="color:${U.escapeHtml(color || '#00f0ff')}; font-weight:700;">${U.escapeHtml(TAGS[cluster] || cluster)}</span> ` +
      `<span class="muted">[Pág ${U.escapeHtml(pageNum || 1)}]</span> “${U.escapeHtml(text || '')}”`;
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
    if (isReducedMotion()) drawSphere(0);
    if (!simulation) return;
    simulation.force('center', root.d3.forceCenter(w / 2, h / 2).strength(0.08));
    simulation.alpha(0.8).restart();
  }

  function setClusterFilter(cluster) {
    activeCluster = activeCluster === cluster ? null : cluster;
    document.querySelectorAll('.cluster-pill').forEach(p => {
      const selected = p.dataset.cluster === activeCluster;
      p.classList.toggle('active', selected); p.setAttribute('aria-pressed', String(selected));
    });
    render(false);
  }

  function highlightPath(nodeIds) {
    highlighted = new Set(nodeIds || []);
    render(false);
    setTimeout(() => { highlighted.clear(); render(false); }, 4500);
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

    ensureHubs();
    const hasD3 = ensureD3();
    if (hasD3) initD3();
    buildGraphData();
    init3DSphere();
    render(true);
    updateTelemetry();
    S.state.patterns.slice(-40).forEach(appendTickerRow);

    document.getElementById('btn-close-inspector')?.addEventListener('click', () => {
      document.getElementById('node-inspector')?.classList.add('hidden');
    });
    document.getElementById('btn-center-net')?.addEventListener('click', recenter);

    document.querySelectorAll('.cluster-pill').forEach(pill => {
      pill.addEventListener('click', () => setClusterFilter(pill.dataset.cluster));
    });

    S.on('node:added', ({ node, isNew, pattern }) => {
      if (isNew) {
        graphNodes.push(Object.assign({}, node));
        buildGraphData();
        render(false);
      } else {
        const g = graphNodes.find(n => n.id === node.id);
        if (g) { g.weight = node.weight; g.pageNums = node.pageNums; g.sentenceIds = node.sentenceIds; }
        render(false);
      }
      appendTickerRow(pattern);
      updateTelemetry();
    });

    S.on('node:removed', () => { buildGraphData(); render(true); updateTelemetry(); });
    S.on('doc:removed', () => { buildGraphData(); render(true); updateTelemetry(); document.getElementById('ticker-list')?.replaceChildren(); S.state.patterns.slice(-40).forEach(appendTickerRow); });
    S.on('brain:imported', () => { ensureHubs(); buildGraphData(); render(true); updateTelemetry(); document.getElementById('ticker-list')?.replaceChildren(); S.state.patterns.slice(-40).forEach(appendTickerRow); });

    S.on('system:reset', () => {
      graphNodes = [];
      graphLinks = [];
      if (simulation) simulation.stop();
      simulation = null;
      document.getElementById('ticker-list')?.replaceChildren();
      document.getElementById('node-inspector')?.classList.add('hidden');
      ensureHubs();
      buildGraphData();
      render(true);
      updateTelemetry();
    });

    S.on('doc:pageChanged', () => updateTelemetry());
    S.on('retrieve:indexed', () => updateTelemetry());
    S.on('settings:changed', ({ key }) => { if (key === 'reduceMotion') { stopSphere(); startSphere(); } });
    S.on('spider:thought', ({ text }) => {
      const badge = document.getElementById('hud-mode-badge');
      if (badge) badge.title = U.truncate(text, 120);
    });

    document.addEventListener('visibilitychange', () => {
      visible = !document.hidden;
      if (visible) startSphere(); else stopSphere();
    });

    window.addEventListener('resize', debounce(() => {
      if (simulation) recenter();
    }, 300));
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  root.NeuralGraph = { init, getHubScreenPos, highlightPath, recenter, setClusterFilter, scrollToSentence, updateTelemetry, ensureHubs };
})(typeof window !== 'undefined' ? window : globalThis);
