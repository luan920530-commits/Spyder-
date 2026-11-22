/** Interfaz independiente: no llama a RAG, no hace búsquedas ni publica el texto en el bus de estudio. */
(function (root) {
  'use strict';
  const C = root.NCCompanion, S = root.NeuralStore, $ = id => document.getElementById('personal-' + id);
  const button = (label, action) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-mini'; b.textContent = label;
    b.addEventListener('click',action); return b;
  };
  let turns = [], job = null, opener, confirmation, replacing = false, writeId = 0, storageFailed = false, writing = false, view = 0;
  const data = () => S.state.personal, modelReady = () => root.NCQwenModel?.info()?.enabled === true;
  const isOpen = () => $('dialog').hasAttribute('open');
  const notice = text => { $('status').textContent = text; };
  function syncEngine() {
    const enabled = modelReady(), opted = data().useQwen;
    $('qwen').checked = opted; $('qwen').disabled = !enabled && !opted;
    $('badge').textContent = `${C.TONES[data().profile.tone]} · ${opted && enabled ? 'Qwen + reglas' : 'Reglas locales'}`;
    $('model').hidden = enabled;
    $('engine').textContent = enabled ? 'Motor disponible. Si lo eliges, Qwen recibe el mensaje y hasta dos turnos cotidianos generados. Puede equivocarse. La escucha guiada y la ayuda urgente siguen por reglas.' : 'Se puede conversar sin descargar nada. Para la generación opcional, activa Qwen en MODELO y marca esta casilla.';
  }
  function syncPrefs() {
    const { profile, keep } = data();
    $('alias').value = profile.alias; $('tone').value = profile.tone; $('note').value = profile.note; $('keep').checked = keep;
    storageLabel(); syncEngine();
  }
  function storageLabel() {
    $('storage').textContent = writing ? 'Guardando en este navegador…' : storageFailed ? 'Sin guardado confirmado en disco' : data().keep ? 'Hilo local · hasta 20 turnos' : 'Hilo temporal · hasta recargar';
  }
  // El texto de éxito solo aparece después del commit real; una promesa más
  // antigua no puede anunciar guardado tras borrar, cerrar o reemplazar.
  async function save(snapshot, success) {
    const id = ++writeId, atView = view; writing = true; storageLabel();
    const ok = await S.savePersonal(snapshot);
    if (writeId !== id) return;
    writing = false; storageFailed = !ok; storageLabel();
    if (view !== atView || replacing || !isOpen()) return;
    if (!ok) notice('El cambio solo se aplicó en esta pestaña. No se pudo confirmar la escritura local.');
    else if (success) notice(success);
  }
  function message(label, text, cls) {
    const row = document.createElement('div'), sender = document.createElement('small'), body = document.createElement('p');
    row.className = 'personal-message ' + cls; sender.textContent = label; body.textContent = text;
    row.append(sender,body); return row;
  }
  function addTurn(t) {
    const row = document.createElement('article'); row.className = 'personal-turn'; row.dataset.intent = t.intent;
    row.append(message('Tú',t.question,'personal-user'),message(t.engine === 'qwen' ? 'Spyder · generado con Qwen local (puede equivocarse)' : 'Spyder · reglas locales',t.text,'personal-reply'));
    $('log').append(row);
    // Acotar también el DOM, no solo lo que se conserva en IndexedDB.
    const first = $('log').querySelector('.personal-turn');
    if ($('log').querySelectorAll('.personal-turn').length > C.LIMIT) first.remove();
  }
  function choices(resume = false) {
    const wrap = $('choices'); wrap.replaceChildren();
    if (job || replacing) return;
    const last = turns.at(-1), intent = last?.intent;
    const quick = (label, phrase = label) => wrap.append(button(label,() => send(phrase)));
    if (intent === 'urgent') { quick('Estoy a salvo'); quick('No estoy a salvo'); quick('Cambiar de tema','Cambiemos de tema'); return; }
    if (intent === 'care') { quick('Cambiar de tema','Cambiemos de tema'); return; }
    if (resume && last && !['hello','identity','switch','remember'].includes(intent)) quick('Retomar el hilo');
    if (intent === 'remember') {
      wrap.append(button('Revisar la nota',() => {
        const note = C.noteDraft(last.question); $('prefs').open = true; $('note').value = note;
        $('note').focus(); notice('Es un borrador. Guardar perfil sustituye la nota anterior.');
      })); if (data().profile.note) quick('Retomar mi nota'); return;
    }
    if (['offer','listen','health','people','pause','step'].includes(intent)) {
      if (intent !== 'listen') quick('Solo escúchame');
      if (intent !== 'step') quick('Un paso pequeño');
      if (intent !== 'pause') quick('Una pausa'); quick('Cambiar de tema','Cambiemos de tema'); return;
    }
    if (intent === 'plan') { quick('Solo tengo 15 minutos'); quick('Ya lo hice'); }
    else if (intent === 'ideas') quick('Dame un ejemplo');
    else { quick('Quiero desahogarme'); quick('Organizar mi día'); }
    if (data().profile.note) quick('Retomar mi nota');
  }
  function draw() {
    $('log').replaceChildren(message('Spyder', C.hello(data().profile),'personal-welcome'));
    for (const t of turns) addTurn(t);
    choices(true); $('log').scrollTop = $('log').scrollHeight;
  }
  function busy(on) {
    $('send').disabled = on && !C.needsImmediateHelp($('input').value); $('stop').hidden = !on; choices();
  }
  function cancel() {
    const old = job; job = null; old?.abort(); busy(false);
  }
  function dismissConfirm() {
    confirmation = null; $('confirm').hidden = true; $('confirm').firstElementChild.textContent = '';
  }
  function confirmAction(label, action) {
    cancel(); confirmation = action; $('confirm').firstElementChild.textContent = label;
    $('confirm').hidden = false; notice(''); $('confirm-no').focus();
  }
  function close() {
    const visible = isOpen(); ++view; cancel(); dismissConfirm();
    if (isOpen()) { if ($('dialog').close) $('dialog').close(); else $('dialog').removeAttribute('open'); }
    $('input').value = ''; $('prefs').open = false; $('log').replaceChildren(); $('choices').replaceChildren();
    $('alias').value = $('note').value = ''; notice(''); if (visible) opener?.focus({ preventScroll:true });
  }
  function open(e) {
    if (replacing || isOpen()) return;
    opener = e.currentTarget; syncPrefs(); notice('');
    if ($('dialog').showModal) $('dialog').showModal(); else $('dialog').setAttribute('open','');
    draw(); $('input').focus({ preventScroll:true });
  }
  async function send(raw, forceUrgent = false) {
    if (!isOpen() || replacing) return null;
    if (forceUrgent || C.needsImmediateHelp(raw)) { cancel(); dismissConfirm(); $('prefs').open = false; }
    else if (job || confirmation) return null;
    const text = String(raw || '').trim(); if (!text) return null;
    let reply;
    try { reply = C.respond(text,data().profile,turns,forceUrgent); }
    catch (error) { notice(error.message); return null; }
    const controller = new AbortController(); job = controller; notice('');
    let fallback = '';
    try {
      if (data().useQwen && modelReady() && C.canGenerate(reply)) {
        busy(true); notice('Qwen está redactando en este dispositivo…');
        const prompt = root.NCQwenPrompt.buildPersonal({ tone:data().profile.tone, question:text, history:C.modelHistory(turns) });
        try {
          // No hacer streaming: una salida parcial no es un turno, ni se usa
          // antes de quitar marcadores del modelo y comprobar sus límites.
          const output = await root.NCQwenModel.generate(prompt,{ signal:controller.signal });
          const answer = C.generated(root.NCQwenPrompt.cleanOutput(output));
          if (answer) reply = { ...reply, engine:'qwen', text:answer };
          else fallback = 'Usé la respuesta por reglas en lugar de la salida del modelo.';
        } catch (_) {
          if (controller.signal.aborted) return null;
          fallback = 'Qwen no pudo responder. Seguimos con reglas locales.';
        }
      }
      if (controller.signal.aborted || job !== controller || replacing || !isOpen()) return null;
      turns = [...turns,reply].slice(-C.LIMIT); addTurn(reply);
      $('log').scrollTop = $('log').scrollHeight;
      notice(fallback || (C.canKeep(reply) ? '' : 'Este intercambio de ayuda no se conserva al recargar.'));
      if (data().keep && C.canKeep(reply)) void save({ ...data(), turns },'');
      return reply;
    } finally { if (job === controller) { job = null; busy(false); } }
  }
  function init() {
    turns = data().turns.slice();
    document.querySelectorAll('.personal-launch').forEach(b => b.addEventListener('click',open));
    $('close').addEventListener('click',close);
    $('dialog').addEventListener('cancel', e => { e.preventDefault(); close(); });
    const submit = e => {
      e.preventDefault(); const q = $('input').value.trim();
      if (!q || replacing || ((job || confirmation) && !C.needsImmediateHelp(q))) return;
      $('input').value = ''; void send(q);
    };
    $('input').addEventListener('input',() => { if (job) $('send').disabled = !C.needsImmediateHelp($('input').value); });
    $('form').addEventListener('submit',submit); $('send').addEventListener('click',submit);
    $('stop').addEventListener('click',() => { cancel(); notice('Generación detenida; no se añadió el turno.'); $('input').focus(); });
    $('urgent').addEventListener('click',() => { $('input').value = ''; void send('Necesito ayuda urgente',true); });
    $('save').addEventListener('click',() => {
      if (replacing || confirmation) return;
      cancel(); const profile = C.profile({ alias:$('alias').value, tone:$('tone').value, note:$('note').value });
      void save({ ...data(), profile },'Perfil guardado en este navegador.'); syncPrefs(); draw();
    });
    $('qwen').addEventListener('change',() => {
      if (replacing || confirmation) { syncEngine(); return; }
      cancel(); void save({ ...data(), useQwen:$('qwen').checked && modelReady() },'Preferencia del motor guardada.'); syncEngine();
    });
    const clear = (keep, forget, success) => {
      if (replacing) return;
      cancel(); turns = []; $('input').value = ''; $('prefs').open = false;
      void save(forget ? null : { ...data(), keep, turns:[] },success); syncPrefs(); draw(); $('input').focus();
    };
    $('keep').addEventListener('change',() => {
      const keep = $('keep').checked; $('keep').checked = data().keep;
      if (replacing || confirmation) return;
      const change = () => clear(keep,false,keep ? 'Los próximos turnos se conservarán aquí.' : 'Hilo borrado. La conversación vuelve a ser temporal.');
      if (turns.length) confirmAction(keep ? '¿Empezar un hilo guardado sin copiar la charla anterior?' : '¿Borrar el hilo guardado y pasar a temporal?',change);
      else change();
    });
    $('clear').addEventListener('click',() => confirmAction('¿Borrar solo tu charla personal? El perfil y el estudio se conservan.',() => clear(data().keep,false,'Charla borrada.')));
    $('forget').addEventListener('click',() => confirmAction('¿Borrar tu perfil, preferencias y toda la charla personal de este navegador? No afecta a tus libros.',() => clear(false,true,'Perfil y charla eliminados.')));
    $('confirm-yes').addEventListener('click',() => { const act = confirmation; dismissConfirm(); act?.(); });
    $('confirm-no').addEventListener('click',() => { dismissConfirm(); $('input').focus(); });
    $('tutor').addEventListener('click',() => { close(); document.getElementById('open-dialogue').click(); });
    $('model').addEventListener('click',() => { close(); document.getElementById('btn-model').click(); });
    $('review').addEventListener('click',() => { close(); S.emit('study:openReview',{ docId:S.state.activeDocId || '', authored:false }); });
    S.on('qwen:status',() => { if (isOpen()) syncEngine(); });
    // Importar estudio conserva el registro privado; el reset global lo borra,
    // incluso si conserva ajustes. No aceptar una escritura tardía de Qwen.
    for (const ev of ['brain:importing','system:resetting']) S.on(ev,() => { replacing = true; close(); });
    S.on('brain:importFailed',() => { replacing = false; });
    S.on('brain:imported',() => { replacing = false; if (data().keep) turns = data().turns.slice(); });
    S.on('system:reset',() => { replacing = false; storageFailed = false; turns = []; });
  }
  root.NCCompanionUI = { init };
})(typeof window !== 'undefined' ? window : globalThis);
