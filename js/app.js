/** Arranque coordinado, navegación y ajustes. No se realizan llamadas externas. */
(function (root) {
  'use strict';
  const S = root.NeuralStore;
  function setupTabs() {
    const brain = document.getElementById('panel-brain');
    const agents = document.getElementById('agents-panel');
    const metrics = document.getElementById('metrics-panel');
    const workspace = document.getElementById('hud-workspace');
    function activateTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => {
        const active = b.dataset.tab === name;
        b.classList.toggle('active', active); b.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    }
    function setWorkspace(name, scroll) {
      const showBrain = name === 'chat' || name === 'study';
      brain.classList.toggle('hidden', !showBrain);
      agents.classList.toggle('hidden', showBrain);
      metrics.classList.toggle('hidden', showBrain);
      workspace.classList.toggle('brain-open', showBrain);
      document.querySelectorAll('.workspace-step').forEach(button => {
        const active = button.dataset.workspace === name;
        button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      });
      if (showBrain) activateTab(name === 'study' ? 'bots' : 'chat');
      requestAnimationFrame(() => {
        root.NeuralGraph?.recenter();
        if (scroll && window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
          const target = showBrain ? brain : name === 'network' ? document.getElementById('panel-arena') : document.getElementById('panel-doc');
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
    document.querySelectorAll('.workspace-step').forEach(button => button.addEventListener('click', () => setWorkspace(button.dataset.workspace, true)));
    document.getElementById('btn-close-brain').addEventListener('click', () => setWorkspace('extract', true));
    document.querySelectorAll('.tab-btn').forEach(button => button.addEventListener('click', () => {
      if (brain.classList.contains('hidden')) setWorkspace(button.dataset.tab === 'bots' ? 'study' : 'chat', false);
      activateTab(button.dataset.tab);
      const section = button.dataset.tab === 'bots' ? 'study' : 'chat';
      document.querySelectorAll('.workspace-step').forEach(step => {
        const active = step.dataset.workspace === section;
        step.classList.toggle('active', active); step.setAttribute('aria-pressed', String(active));
      });
    }));
    setWorkspace('extract', false);
  }

  function setupDashboard() {
    const matrix = document.getElementById('progress-matrix');
    const history = [];
    for (let i = 0; i < 36; i++) matrix.appendChild(document.createElement('i'));
    document.querySelectorAll('.agent-bars').forEach(bars => {
      for (let i = 0; i < 10; i++) bars.appendChild(document.createElement('i'));
    });
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    function update() {
      const total = S.state.allSentences.length;
      const harvested = S.state.allSentences.reduce((sum, sentence) => sum + (sentence.harvested ? 1 : 0), 0);
      const patterns = S.state.patterns;
      const status = root.SpiderEngine.getStatus();
      const fraction = total ? harvested / total : 0;
      const currentDoc = S.getActiveDoc();
      set('doc-stat-pages', currentDoc ? `${currentDoc.pages.length} PÁG.` : '0 PÁG.');
      set('stat-sentences', total);
      set('stat-harvested', harvested);
      set('stat-spiders', `${status.spiders.length}/5`);
      set('stat-nodes', S.state.nodes.filter(n => !n.isHub).length);
      set('stat-patterns', patterns.length);
      set('ticker-hashes', `${patterns.length} PATRONES`);
      [...matrix.children].forEach((cell, i) => cell.classList.toggle('lit', i < Math.round(fraction * 36)));
      const clusterIds = ['AGT-01','AGT-02','AGT-03','AGT-04'];
      const counts = Object.fromEntries(clusterIds.map(id => [id, 0]));
      patterns.forEach(pattern => { if (counts[pattern.cluster] !== undefined) counts[pattern.cluster]++; });
      clusterIds.forEach(id => {
        const card = document.querySelector(`[data-agent="${id}"]`);
        const spiders = status.spiders.filter(sp => sp.cluster === id);
        const working = !status.paused && spiders.some(sp => sp.phase !== 'IDLE');
        const label = status.paused && spiders.length ? 'PAUSADO' : working ? 'ACTIVO' : spiders.length ? 'LISTO' : 'EN ESPERA';
        card.classList.toggle('is-active', working);
        card.querySelector('.agent-status').textContent = label;
        card.querySelector('.agent-count').textContent = `${counts[id]} PATRONES`;
        const share = patterns.length ? counts[id] / patterns.length : 0;
        card.querySelector('.agent-progress i').style.width = `${Math.round(share * 100)}%`;
        card.querySelector('.agent-progress').title = `${Math.round(share * 100)}% de los patrones registrados`;
        [...card.querySelectorAll('.agent-bars i')].forEach((bar, i) => bar.classList.toggle('lit', i < Math.round(share * 10)));
        const orbit = document.querySelector(`[data-orbit="${id}"]`);
        if (orbit) orbit.textContent = label;
      });
      const timeline = document.querySelectorAll('.graph-timeline i');
      clusterIds.forEach((id, i) => { if (timeline[i]) timeline[i].style.width = `${Math.round((patterns.length ? counts[id] / patterns.length : 0) * 100)}%`; });
      if (timeline[4]) timeline[4].style.width = `${Math.round(fraction * 100)}%`;
    }
    function sample() {
      const count = S.state.allSentences.reduce((sum, sentence) => sum + (sentence.harvested ? 1 : 0), 0);
      history.push(count); if (history.length > 40) history.shift();
      const max = Math.max(1, ...history);
      const points = history.map((n, i) => `${history.length > 1 ? i * 200 / (history.length - 1) : 0},${86 - n / max * 76}`).join(' ');
      document.getElementById('chart-line').setAttribute('points', points);
      document.getElementById('chart-area').setAttribute('d', `M0 90 L${points.replaceAll(' ', ' L')} L200 90 Z`);
      document.getElementById('harvest-chart').setAttribute('aria-label', `Historial reciente: ${count} pasajes cosechados`);
    }
    let queued = false;
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); } };
    ['doc:added','doc:removed','doc:pageChanged','node:added','node:removed','harvest:progress','spiders:count','spiders:paused','system:reset','brain:imported'].forEach(event => S.on(event, schedule));
    S.on('system:reset', () => { history.length = 0; sample(); });
    const clock = () => set('system-clock', new Date().toLocaleTimeString('es-CO', { hour12: false }));
    update(); sample(); clock();
    setInterval(() => { if (!document.hidden) { update(); sample(); clock(); } }, 2000);
  }

  function setupSettings() {
    const mode = document.getElementById('mode-select');
    root.NCProviders.MODES.forEach(m => {
      const option = document.createElement('option'); option.value = m.id; option.textContent = m.label; mode.appendChild(option);
    });
    function sync() {
      mode.value = S.getSetting('mode', 'auto');
      document.getElementById('cfg-dense').checked = S.getSetting('embedEnabled', true);
      document.getElementById('cfg-fuzzy').checked = S.getSetting('fuzzy', true);
      document.getElementById('cfg-reduced').checked = S.getSetting('reduceMotion', false);
      document.getElementById('cfg-topk').value = String(S.getSetting('topK', 6));
      document.getElementById('cfg-window').value = String(S.getSetting('window', 1));
      const db = root.NCDB.status();
      document.getElementById('storage-status').textContent = db.available
        ? 'Persistencia: IndexedDB local.'
        : 'IndexedDB no disponible; se intenta guardar en localStorage. El espacio es limitado.';
    }
    mode.addEventListener('change', () => S.setSetting('mode', mode.value));
    [['cfg-dense', 'embedEnabled'], ['cfg-fuzzy', 'fuzzy'], ['cfg-reduced', 'reduceMotion']].forEach(([id, key]) => {
      document.getElementById(id).addEventListener('change', event => {
        S.setSetting(key, event.target.checked);
        if (key === 'embedEnabled' && event.target.checked) root.NCEmbeddings.indexAll(S.state.index);
      });
    });
    [['cfg-topk', 'topK'], ['cfg-window', 'window']].forEach(([id, key]) => {
      document.getElementById(id).addEventListener('change', event => S.setSetting(key, Number(event.target.value)));
    });
    const modal = document.getElementById('settings-modal');
    document.getElementById('btn-settings').addEventListener('click', () => { sync(); modal.classList.remove('hidden'); document.getElementById('btn-close-settings').focus(); });
    document.getElementById('btn-close-settings').addEventListener('click', () => { modal.classList.add('hidden'); document.getElementById('btn-settings').focus(); });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!modal.classList.contains('hidden')) { modal.classList.add('hidden'); document.getElementById('btn-settings').focus(); }
      const paste = document.getElementById('paste-modal');
      if (!paste.classList.contains('hidden')) { paste.classList.add('hidden'); document.getElementById('btn-paste-modal').focus(); }
    });
    S.on('brain:imported', sync); S.on('system:reset', sync); sync();
  }
  function setupActions() {
    document.querySelector('.file-label').addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.getElementById('file-input').click(); }
    });
    document.getElementById('btn-load-demo').addEventListener('click', () => {
      if (S.state.docs.some(d => d.method === 'demo')) { root.DocViewer.toast('La demo ya está cargada.'); return; }
      root.DocParsers.loadDemo(); root.DocViewer.toast('Dos documentos de ejemplo indexados.');
    });
    document.getElementById('btn-reset-all').addEventListener('click', async () => {
      if (!confirm('¿Borrar documentos, memoria, conversación y progreso de estudio de este navegador?')) return;
      await S.resetAll({ keepSettings: true, keepMemory: false });
      root.DocViewer.toast('Datos locales eliminados.');
    });
    S.on('persistence:error', error => root.DocViewer.toast('No se pudo guardar: ' + (error.message || error)));
  }
  async function boot() {
    try {
      await S.init();
      root.NCRag.init();
      root.DocParsers.init();
      root.DocViewer.init();
      root.NeuralGraph.init();
      root.SpiderEngine.init();
      setupTabs(); setupSettings(); setupActions(); setupDashboard();
      root.BrainRAG.init(); root.StudyBots.init();
      document.documentElement.dataset.appReady = 'true';
      if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('./sw.js').catch(error => console.warn('[PWA]', error));
      }
    } catch (error) {
      console.error('[Arranque]', error);
      const box = document.getElementById('chat-messages');
      if (box) box.textContent = 'No se pudo iniciar la aplicación: ' + error.message;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
