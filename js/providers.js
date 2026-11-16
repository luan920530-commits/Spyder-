/** Enrutador de generación local. No carga código ni modelos de Internet. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCProviders = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const MODES = [
    { id: 'auto', label: 'Automático', description: 'Selecciona el formato según la pregunta.' },
    { id: 'resumen', label: 'Resumen', description: 'Ideas principales y evidencia.' },
    { id: 'examen', label: 'Examen', description: 'Definición, mecanismo, evidencia y límite.' },
    { id: 'socratico', label: 'Socrático', description: 'Preguntas y pistas para razonar.' },
    { id: 'critico', label: 'Crítico', description: 'Contrasta posibles contradicciones y vacíos.' },
    { id: 'redaccion', label: 'Redacción', description: 'Texto estructurado a partir de fuentes.' }
  ];
  const providers = new Map();
  let composer = null;
  const modeById = id => MODES.find(m => m.id === id) || MODES[0];
  function register(p) {
    if (!p || !p.id || typeof p.complete !== 'function') throw new Error('Proveedor inválido');
    providers.set(p.id, p);
  }
  function setInternalComposer(fn) { composer = fn; }
  register({
    id: 'internal', label: 'Motor interno extractivo', kind: 'extractive', streaming: false,
    description: 'Sin modelos preentrenados, servidores ni descargas. Usa fragmentos y análisis del corpus.',
    models: [{ id: 'kimi-core', label: 'KIMI-CORE local' }],
    available: async () => true,
    complete: async ctx => {
      if (!composer) throw new Error('El compositor interno no está inicializado');
      if (ctx.signal && ctx.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      return { text: composer(ctx), provider: 'internal', model: 'kimi-core' };
    }
  });
  function list() {
    return [...providers.values()].map(({ id, label, kind, streaming, description, models }) =>
      ({ id, label, kind, streaming, description, models: models || [] }));
  }
  async function availability() {
    return Promise.all([...providers.values()].map(async p => ({ id: p.id, available: p.available ? await p.available() : true })));
  }
  function get(id) { return providers.get(id); }
  async function run(ctx, opts) {
    const o = opts || {};
    const id = o.provider || ctx.settings?.provider || 'internal';
    const requested = providers.get(id);
    try {
      if (!requested || (requested.available && !(await requested.available()))) throw new Error('Proveedor no instalado');
      return { ...(await requested.complete(ctx, o)), provider: id, fallback: false };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (id === 'internal') throw error;
      if (root.NeuralStore) root.NeuralStore.emit('provider:fallback', { from: id, to: 'internal', error: error.message });
      return { ...(await providers.get('internal').complete(ctx, o)), provider: 'internal', fallback: true };
    }
  }
  function info() { return { modes: MODES, providers: list() }; }
  return { MODES, modeById, register, setInternalComposer, get, list, availability, run, info };
});
