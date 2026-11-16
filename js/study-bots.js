/**
 * NEURAL COMMAND // AI SPIDER OS
 * js/study-bots.js - Suite universitaria: Guía, Flashcards 3D, Quiz y Exportador .ZIP
 */
(function () {
  let activeBot = 'guide';
  let fcIndex = 0;

  function renderBot() {
    const stage = document.getElementById('bot-stage');
    if (!stage) return;
    const store = window.NeuralStore;
    const nodes = store.state.nodes.filter(n => !n.isHub);
    const sents = store.state.allSentences;

    if (activeBot === 'guide') {
      const md = `# GUÍA DE ESTUDIO // NEURAL COMMAND\n\n` +
        (nodes.length
          ? nodes.map(n => `## [${n.cluster}] ${n.label} (×${n.weight || 1})\n- ${n.text}\n- Citas: Pág ${(n.pageNums || []).join(', ')}`).join('\n\n')
          : 'Carga un documento y deja que las arañas cosechen patrones para generar la guía.');

      stage.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="color:var(--cyan); font-size:11px;">📘 Guía Editable (.MD)</span>
          <button class="btn-mini" id="btn-dl-guide">⬇ .MD</button>
        </div>
        <textarea id="guide-editor" style="width:100%; height:240px; background:var(--bg-void); color:var(--text-main); border:1px solid var(--border-hud); padding:8px; font-family:var(--font-mono); font-size:11.5px; border-radius:4px;">${md}</textarea>
      `;
      document.getElementById('btn-dl-guide')?.addEventListener('click', () => {
        const text = document.getElementById('guide-editor')?.value || '';
        const blob = new Blob([text], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'Guia_Estudio_Neural.md';
        a.click();
      });
    } else if (activeBot === 'flashcards') {
      if (!nodes.length) {
        stage.innerHTML = '<p style="color:var(--text-dim);">Aún no hay nodos cosechados para crear Flashcards 3D.</p>';
        return;
      }
      const card = nodes[fcIndex % nodes.length];
      stage.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="color:var(--violet); font-size:11px;">🃏 Tarjeta ${(fcIndex % nodes.length) + 1} / ${nodes.length}</span>
          <div>
            <button class="btn-mini" id="fc-prev">◀</button>
            <button class="btn-mini" id="fc-next">▶</button>
          </div>
        </div>
        <div class="flashcard-3d" id="fc-card">
          <div class="flashcard-inner">
            <div class="flashcard-face">
              <span class="badge badge-cyan" style="margin-bottom:8px;">${card.cluster}</span>
              <strong>${card.label}</strong>
              <small style="color:var(--text-dim); margin-top:10px;">(Clic para girar)</small>
            </div>
            <div class="flashcard-face flashcard-back">
              <p style="font-size:11.5px; line-height:1.4;">${card.text}</p>
            </div>
          </div>
        </div>
      `;
      document.getElementById('fc-card')?.addEventListener('click', e => e.currentTarget.classList.toggle('flipped'));
      document.getElementById('fc-prev')?.addEventListener('click', () => { fcIndex = (fcIndex - 1 + nodes.length) % nodes.length; renderBot(); });
      document.getElementById('fc-next')?.addEventListener('click', () => { fcIndex = (fcIndex + 1) % nodes.length; renderBot(); });
    } else if (activeBot === 'quiz') {
      if (sents.length < 2) {
        stage.innerHTML = '<p style="color:var(--text-dim);">Carga un documento con al menos 2 oraciones para generar el Quiz de Parcial.</p>';
        return;
      }
      const target = sents[Math.floor(Math.random() * sents.length)];
      const words = target.text.split(/\s+/).filter(w => w.length > 5);
      const answer = words[Math.floor(Math.random() * words.length)] || 'sistema';
      const blanked = target.text.replace(answer, '________');
      const options = [answer, 'entropía', 'latencia', 'algoritmo'].sort(() => Math.random() - 0.5);

      stage.innerHTML = `
        <div style="font-size:11.5px; margin-bottom:10px; line-height:1.5;">
          <strong style="color:var(--amber);">📝 Quiz de Parcial (Pág ${target.pageNum}):</strong><br/>
          ${blanked}
        </div>
        <div id="quiz-opts" style="display:flex; flex-direction:column; gap:6px;">
          ${options.map(o => `<button class="btn-hud btn-ghost quiz-opt" data-val="${o}">${o}</button>`).join('')}
        </div>
        <div id="quiz-feedback" style="margin-top:8px; font-size:11px;"></div>
      `;

      stage.querySelectorAll('.quiz-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          const fb = document.getElementById('quiz-feedback');
          if (btn.dataset.val === answer) {
            fb.innerHTML = '<span style="color:var(--emerald);">✅ ¡Correcto!</span>';
          } else {
            fb.innerHTML = `<span style="color:var(--coral);">❌ Incorrecto. Despachando araña a la oración exacta (Pág ${target.pageNum})...</span>`;
            window.NeuralStore.setActivePage(target.pageNum);
            setTimeout(() => {
              window.NeuralStore.emit('spider:dispatchToSentence', { sentence: target });
            }, 100);
          }
        });
      });
    } else if (activeBot === 'export') {
      stage.innerHTML = `
        <p style="font-size:11.5px; color:var(--text-dim); margin-bottom:10px;">
          Empaqueta los apuntes consolidados, nodos del grafo y memoria persistente en un archivo <code>.ZIP</code>.
        </p>
        <button class="btn-hud btn-cyan" id="btn-export-zip">📦 Descargar Paquete .ZIP</button>
      `;
      document.getElementById('btn-export-zip')?.addEventListener('click', async () => {
        const payload = JSON.stringify({
          nodes: store.state.nodes.filter(n => !n.isHub),
          patterns: store.state.patterns,
          consolidatedMemory: store.state.consolidatedMemory
        }, null, 2);

        if (window.JSZip) {
          const zip = new window.JSZip();
          zip.file('conocimiento_consolidado.json', payload);
          zip.file('README.txt', 'NEURAL COMMAND // AI SPIDER OS - Exportación Académica');
          const blob = await zip.generateAsync({ type: 'blob' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'Neural_Spider_OS_Export.zip';
          a.click();
        } else {
          const blob = new Blob([payload], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'conocimiento_consolidado.json';
          a.click();
        }
      });
    }
  }

  function init() {
    document.querySelectorAll('.bot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.bot-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeBot = btn.dataset.bot;
        renderBot();
      });
    });
    renderBot();
  }

  window.StudyBots = { init, renderBot };
})();
