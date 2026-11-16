/**
 * NEURAL COMMAND // AI SPIDER OS
 * js/neural-graph.js - Red neuronal viva D3.js v7 + Esfera central 3D de partículas
 */
(function () {
  const HUBS = [
    { id: 'AGT-01', label: 'AGT-01 DEF', color: '#00f0ff', isHub: true, angle: -Math.PI * 0.75 },
    { id: 'AGT-02', label: 'AGT-02 CAUSAL', color: '#a855f7', isHub: true, angle: -Math.PI * 0.25 },
    { id: 'AGT-03', label: 'AGT-03 QUANT', color: '#f59e0b', isHub: true, angle: Math.PI * 0.25 },
    { id: 'AGT-04', label: 'AGT-04 SYNTH', color: '#10b981', isHub: true, angle: Math.PI * 0.75 }
  ];

  let svg, gLinks, gNodes, simulation;
  let width = 400, height = 400;
  let sphereCtx, particles = [];
  let highlightedIds = new Set();

  function init3DSphere() {
    const canvas = document.getElementById('core-3d-canvas');
    if (!canvas) return;
    sphereCtx = canvas.getContext('2d');
    particles = [];
    const palette = ['#10b981', '#f43f5e', '#00f0ff', '#a855f7'];
    for (let i = 0; i < 220; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const color = palette[i % palette.length];
      particles.push({
        theta,
        phi,
        r: 52 + Math.random() * 24,
        speed: 0.0025 + Math.random() * 0.005,
        color,
        size: 1.1 + Math.random() * 1.6
      });
    }
    requestAnimationFrame(drawSphere);
  }

  function drawSphere() {
    const canvas = document.getElementById('core-3d-canvas');
    if (!canvas || !sphereCtx) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
      width = rect.width || 400;
      height = rect.height || 400;
    }

    sphereCtx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Halo central KIMI-CORE (esmeralda + coral + cian)
    const grad = sphereCtx.createRadialGradient(cx, cy, 8, cx, cy, 96);
    grad.addColorStop(0, 'rgba(244, 63, 94, 0.28)');
    grad.addColorStop(0.45, 'rgba(16, 185, 129, 0.14)');
    grad.addColorStop(0.8, 'rgba(0, 240, 255, 0.05)');
    grad.addColorStop(1, 'rgba(5, 8, 15, 0)');
    sphereCtx.fillStyle = grad;
    sphereCtx.beginPath();
    sphereCtx.arc(cx, cy, 96, 0, Math.PI * 2);
    sphereCtx.fill();

    // Filamentos sinápticos curvos laterales (estilo red neuronal de alta densidad)
    const sideColors = ['rgba(0, 240, 255, 0.18)', 'rgba(16, 185, 129, 0.18)', 'rgba(244, 63, 94, 0.16)'];
    for (let i = -4; i <= 4; i++) {
      sphereCtx.strokeStyle = sideColors[Math.abs(i) % sideColors.length];
      sphereCtx.lineWidth = 1;
      // Izquierda
      sphereCtx.beginPath();
      sphereCtx.moveTo(12, cy + i * 22);
      sphereCtx.bezierCurveTo(cx * 0.45, cy + i * 8, cx * 0.65, cy, cx - 55, cy);
      sphereCtx.stroke();
      // Derecha
      sphereCtx.beginPath();
      sphereCtx.moveTo(canvas.width - 12, cy + i * 22);
      sphereCtx.bezierCurveTo(canvas.width - cx * 0.45, cy + i * 8, canvas.width - cx * 0.65, cy, cx + 55, cy);
      sphereCtx.stroke();
    }

    particles.forEach(p => {
      p.theta += p.speed;
      const x3d = p.r * Math.sin(p.phi) * Math.cos(p.theta);
      const y3d = p.r * Math.cos(p.phi);
      const z3d = p.r * Math.sin(p.phi) * Math.sin(p.theta);
      const scale = 220 / (220 + z3d);
      const x2d = cx + x3d * scale;
      const y2d = cy + y3d * scale;
      const alpha = Math.max(0.18, Math.min(0.95, (z3d + 75) / 140));

      sphereCtx.globalAlpha = alpha;
      sphereCtx.fillStyle = p.color || '#00f0ff';
      sphereCtx.beginPath();
      sphereCtx.arc(x2d, y2d, (p.size || 1.5) * scale, 0, Math.PI * 2);
      sphereCtx.fill();
    });
    sphereCtx.globalAlpha = 1;

    sphereCtx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    sphereCtx.font = 'bold 9px monospace';
    sphereCtx.textAlign = 'center';
    sphereCtx.fillText('KIMI-CORE', cx, cy + 3);

    requestAnimationFrame(drawSphere);
  }

  function resetGraph() {
    const store = window.NeuralStore;
    const stage = document.getElementById('arena-stage');
    if (stage) {
      const rect = stage.getBoundingClientRect();
      width = rect.width || 400;
      height = rect.height || 400;
    }

    store.state.nodes = HUBS.map(h => ({
      ...h,
      x: width / 2 + Math.cos(h.angle) * Math.min(width, height) * 0.28,
      y: height / 2 + Math.sin(h.angle) * Math.min(width, height) * 0.28,
      fx: width / 2 + Math.cos(h.angle) * Math.min(width, height) * 0.28,
      fy: height / 2 + Math.sin(h.angle) * Math.min(width, height) * 0.28,
      weight: 1,
      pageNums: [],
      sentenceIds: []
    }));

    store.state.links = [
      { source: 'AGT-01', target: 'AGT-02' },
      { source: 'AGT-02', target: 'AGT-03' },
      { source: 'AGT-03', target: 'AGT-04' },
      { source: 'AGT-04', target: 'AGT-01' }
    ];

    updateTelemetry();
    renderGraph();
  }

  function renderGraph() {
    if (!window.d3 || !svg) return;
    const { nodes, links } = window.NeuralStore.state;

    const linkSel = gLinks.selectAll('line').data(links, d => {
      const s = typeof d.source === 'object' ? d.source.id : d.source;
      const t = typeof d.target === 'object' ? d.target.id : d.target;
      return `${s}->${t}`;
    });
    linkSel.exit().remove();
    const linkEnter = linkSel.enter().append('line')
      .attr('stroke', d => d.synaptic ? '#f59e0b' : 'rgba(0, 240, 255, 0.22)')
      .attr('stroke-width', d => d.synaptic ? 1.5 : 1)
      .attr('stroke-dasharray', d => d.synaptic ? '3,3' : null);
    const allLinks = linkEnter.merge(linkSel);

    const nodeSel = gNodes.selectAll('g.node-group').data(nodes, d => d.id);
    nodeSel.exit().remove();

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer')
      .on('click', (_, d) => openInspector(d));

    nodeEnter.append('circle')
      .attr('r', d => d.isHub ? 14 : Math.min(18, 7 + (d.weight || 1) * 2))
      .attr('fill', d => d.color || '#00f0ff')
      .attr('fill-opacity', d => d.isHub ? 0.25 : 0.75)
      .attr('stroke', d => d.color || '#00f0ff')
      .attr('stroke-width', d => d.isHub ? 2 : 1.2);

    nodeEnter.append('text')
      .attr('dy', d => d.isHub ? -18 : -12)
      .attr('text-anchor', 'middle')
      .attr('fill', '#e2e8f0')
      .attr('font-size', d => d.isHub ? '9px' : '8.5px')
      .attr('font-family', 'monospace')
      .text(d => d.label);

    const allNodes = nodeEnter.merge(nodeSel);
    allNodes.select('circle')
      .attr('r', d => d.isHub ? 14 : Math.min(18, 7 + (d.weight || 1) * 2))
      .attr('stroke', d => highlightedIds.has(d.id) ? '#fbbf24' : (d.color || '#00f0ff'))
      .attr('stroke-width', d => highlightedIds.has(d.id) ? 3 : (d.isHub ? 2 : 1.2));

    allNodes.select('text')
      .text(d => d.weight > 1 && !d.isHub ? `${d.label} ×${d.weight}` : d.label);

    if (simulation) simulation.stop();
    simulation = window.d3.forceSimulation(nodes)
      .force('link', window.d3.forceLink(links).id(d => d.id).distance(d => d.synaptic ? 85 : 58))
      .force('charge', window.d3.forceManyBody().strength(-75))
      .force('collide', window.d3.forceCollide().radius(d => (d.isHub ? 24 : 20)))
      .force('center', window.d3.forceCenter(width / 2, height / 2).strength(0.04))
      .on('tick', () => {
        allLinks
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);

        allNodes.attr('transform', d => {
          d.x = Math.max(20, Math.min(width - 20, d.x));
          d.y = Math.max(20, Math.min(height - 20, d.y));
          return `translate(${d.x},${d.y})`;
        });
      });
  }

  function addPatternNode({ cluster, label, text, pageNum, sentenceId, color }) {
    const store = window.NeuralStore;
    const norm = label.toLowerCase().trim();
    const existing = store.state.nodes.find(n => !n.isHub && n.label.toLowerCase().trim() === norm);

    if (existing) {
      existing.weight = (existing.weight || 1) + 1;
      if (!existing.pageNums.includes(pageNum)) existing.pageNums.push(pageNum);
      if (!existing.sentenceIds.includes(sentenceId)) existing.sentenceIds.push(sentenceId);
      // Sinapsis cruzada si proviene de otro clúster
      if (existing.cluster !== cluster) {
        store.state.links.push({ source: existing.id, target: cluster, synaptic: true });
      }
    } else {
      const hub = store.state.nodes.find(n => n.id === cluster) || store.state.nodes[0];
      const newNode = {
        id: 'N-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
        cluster,
        label: label.slice(0, 22),
        text,
        color: color || hub?.color || '#00f0ff',
        weight: 1,
        pageNums: [pageNum],
        sentenceIds: [sentenceId],
        x: (hub?.x || width / 2) + (Math.random() - 0.5) * 30,
        y: (hub?.y || height / 2) + (Math.random() - 0.5) * 30
      };
      store.state.nodes.push(newNode);
      store.state.links.push({ source: cluster, target: newNode.id });
    }

    store.state.patterns.push({ cluster, label, text, pageNum, sentenceId });
    if (store.persistPatternIDB) store.persistPatternIDB({ cluster, label, text, pageNum, sentenceId });
    appendTickerRow({ cluster, text, pageNum, color: color || '#00f0ff' });
    updateTelemetry();
    renderGraph();
  }

  function appendTickerRow({ cluster, text, pageNum, color }) {
    const list = document.getElementById('ticker-list');
    const hashEl = document.getElementById('ticker-hashes');
    if (hashEl) hashEl.textContent = `${window.NeuralStore.state.visitedPatternHashes.size} hashes únicos`;
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'ticker-row';
    const tagMap = { 'AGT-01': 'SPDR-01 [DEF]', 'AGT-02': 'SPDR-02 [CAUSAL]', 'AGT-03': 'SPDR-03 [QUANT]', 'AGT-04': 'SPDR-04 [SÍNTESIS]' };
    row.innerHTML = `<span style="color:${color}; font-weight:700;">${tagMap[cluster] || cluster}</span> <span style="color:var(--text-dim);">[Pág ${pageNum}]</span> "${text}"`;
    list.prepend(row);
    while (list.children.length > 30) list.removeChild(list.lastChild);
  }

  function openInspector(node) {
    if (node.isHub) return;
    const insp = document.getElementById('node-inspector');
    if (!insp) return;
    document.getElementById('insp-cluster').textContent = node.cluster || 'KIMI';
    document.getElementById('insp-weight').textContent = `×${node.weight || 1}`;
    document.getElementById('insp-label').textContent = node.label;
    document.getElementById('insp-text').textContent = node.text || '';

    const citEl = document.getElementById('insp-citations');
    citEl.innerHTML = '';
    (node.pageNums || []).forEach((p, idx) => {
      const chip = document.createElement('button');
      chip.className = 'citation-chip';
      chip.textContent = `Pág ${p}`;
      chip.addEventListener('click', () => {
        window.NeuralStore.setActivePage(p);
        const sid = node.sentenceIds?.[idx];
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
      citEl.appendChild(chip);
    });

    insp.classList.remove('hidden');
  }

  function getHubScreenPos(clusterId) {
    const svgEl = document.getElementById('neural-svg');
    if (!svgEl) return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
    const rect = svgEl.getBoundingClientRect();
    const hub = window.NeuralStore.state.nodes.find(n => n.id === clusterId);
    if (hub) {
      return { x: rect.left + hub.x, y: rect.top + hub.y };
    }
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function highlightPath(nodeIds) {
    highlightedIds = new Set(nodeIds);
    renderGraph();
    setTimeout(() => {
      highlightedIds.clear();
      renderGraph();
    }, 4500);
  }

  function updateTelemetry() {
    const nodesCount = window.NeuralStore.state.nodes.filter(n => !n.isHub).length;
    const patCount = window.NeuralStore.state.patterns.length;
    const elN = document.getElementById('stat-nodes');
    const elP = document.getElementById('stat-patterns');
    if (elN) elN.textContent = nodesCount;
    if (elP) elP.textContent = patCount;
  }

  function init() {
    const svgEl = document.getElementById('neural-svg');
    if (window.d3 && svgEl) {
      svg = window.d3.select(svgEl);
      gLinks = svg.append('g').attr('class', 'links');
      gNodes = svg.append('g').attr('class', 'nodes');
    }

    init3DSphere();
    resetGraph();

    document.getElementById('btn-close-inspector')?.addEventListener('click', () => {
      document.getElementById('node-inspector')?.classList.add('hidden');
    });

    window.NeuralStore.on('system:reset', resetGraph);
    window.NeuralStore.on('doc:added', () => {
      // Al cargar un documento nuevo, si no hay nodos de conocimiento aún, asegurar hubs limpios
      if (window.NeuralStore.state.nodes.length === 0) resetGraph();
    });
    window.NeuralStore.on('spider:manualPattern', data => addPatternNode(data));
  }

  window.NeuralGraph = { init, addPatternNode, getHubScreenPos, highlightPath };
})();
