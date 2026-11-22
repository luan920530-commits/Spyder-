const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, until } = require('./support/dom.cjs');
const clone = v => JSON.parse(JSON.stringify(v));
async function app(idb) {
  const {w,errors}=await createApp(idb);
  const el=id=>w.document.getElementById(id), $=id=>el('personal-'+id), S=w.NeuralStore, DB=w.NCDB;
  const go=()=>el('open-personal').click(), click=id=>$(id).click();
  const posts=()=>[...$('log').querySelectorAll('.personal-turn')], last=()=>posts().at(-1);
  const send=q=>{ $('input').value=q; $('input').dispatchEvent(new w.Event('input')); click('send'); return last(); };
  const keep=()=>{ click('keep'); if (!$('confirm').hidden) click('confirm-yes'); };
  const choice=label=>[...$('choices').children].find(b=>b.textContent===label).click();
  const stop=()=>{assert.deepEqual(errors,[]); w.close();};
  return {w,el,$,S,DB,go,click,posts,last,send,keep,choice,stop};
}
async function disk(DB){const db=await DB.open();return new Promise((resolve,reject)=>{const r=db.transaction(DB.STORE).objectStore(DB.STORE).get(DB.PERSONAL);r.onsuccess=()=>resolve(r.result?.v);r.onerror=()=>reject(r.error);});}

test('charla temporal entre espacios, revisión explícita de la nota y perfil tras recargar sin guardar lo contado',async()=>{
  const idb=new IDBFactory(), a=await app(idb); try {
    const {go,send,click,$,el,S,DB,choice}=a;go();assert.equal(S.state.docs.length,0);assert.equal($('keep').checked,false);
    send('Me preocupa mi examen de MATERIA PRIVADA'); choice('Solo escúchame');assert.match(a.last().textContent,/mi examen de MATERIA PRIVADA/);
    assert.equal(await DB.get(DB.PERSONAL),null); click('tutor');assert.equal(S.getSetting('mode'),'tutor');assert.equal(el('chat-input').value,'');assert.doesNotMatch(el('chat-messages').textContent,/PRIVADA/);
    el('chat-open-personal').click();assert.equal(a.posts().length,2); choice('Retomar el hilo'); assert.match(a.last().textContent,/MATERIA PRIVADA/);
    send('Recuerda que BORRADOR SECRETO');choice('Revisar la nota');assert.equal($('note').value,'BORRADOR SECRETO'); assert.equal(S.state.personal.profile.note,'');
    $('alias').value='Mar';$('tone').value='practical';$('note').value='Preparar mi presentación de teatro';click('save');await S.flush();assert.match($('log').firstChild.textContent,/Hola, Mar/);
    const r=await disk(DB);assert.deepEqual(clone(r.turns),[]);assert.equal(r.profile.tone,'practical');assert.doesNotMatch(JSON.stringify(r),/PRIVADA|BORRADOR/);
    assert.doesNotMatch(JSON.stringify(await S.exportBrain()),/PRIVADA|teatro|BORRADOR/);assert.doesNotMatch(JSON.stringify(await DB.exportAll()),/PRIVADA|teatro|BORRADOR/);
    click('review'); assert.ok(el('tab-bots').classList.contains('active'));assert.equal(S.state.chat.length,0);assert.equal(S.state.feedback.length,0);assert.equal(S.state.cards.length,0);assert.equal(S.state.consolidatedMemory.length,0);
  } finally {a.stop();}
  const b=await app(idb);try{b.go();assert.equal(b.posts().length,0);assert.match(b.$('log').textContent,/Hola, Mar/);b.send('Retomar mi nota');assert.match(b.last().textContent,/teatro/);b.send('sí');assert.match(b.last().textContent,/voz alta/);}finally{b.stop();}
});

test('consentimiento solo hacia adelante, límite de 20, ayudas transitorias y respaldo académico que no puede suplantar al perfil',async()=>{
  const idb=new IDBFactory(), a=await app(idb);try{
    a.go();a.send('No quiero que se copie SECRETO TEMPORAL');a.click('keep');a.click('confirm-no');assert.equal(a.S.state.personal.keep,false);assert.equal(a.posts().length,1);
    a.keep();assert.equal(a.posts().length,0);for(let i=0;i<22;i++) a.send('conversación privada número '+i);
    assert.equal(a.posts().length,20);await a.S.flush();let d=await disk(a.DB);assert.equal(d.turns.length,20);assert.equal(d.turns[0].question,'conversación privada número 2');
    a.send('CLAVE URGENTE no quiero vivir');a.send('sí, estoy a salvo AHORA');assert.equal(a.last().dataset.intent,'care');a.send('Cambiemos de tema');a.send('Me preocupa el examen de Teatro');
    await a.S.flush(); d=await disk(a.DB);assert.doesNotMatch(JSON.stringify(d),/CLAVE URGENTE|AHORA|SECRETO TEMPORAL/);assert.equal(d.turns.at(-1).focus,'el examen de Teatro');
    const backup=await a.S.exportBrain();assert.doesNotMatch(JSON.stringify(backup),/conversación privada|Teatro/); assert.ok(!Object.hasOwn(backup.data,a.DB.PERSONAL));
    backup.data[a.DB.PERSONAL]={version:1,profile:{alias:'AJENO'}};await a.S.importBrain(backup);assert.deepEqual(clone(await disk(a.DB)),clone(d));
    await a.DB.importAll({data:{[a.DB.PERSONAL]:{profile:{alias:'OTRO'}}}},{merge:true});assert.deepEqual(clone(await disk(a.DB)),clone(d));
  }finally{a.stop();}
  const b=await app(idb);try{b.go();assert.ok(b.posts().length>0);b.choice('Solo escúchame');assert.match(b.last().textContent,/el examen de Teatro/);await b.S.resetAll({keepMemory:true,keepSettings:true});b.go();assert.equal(b.posts().length,0);assert.equal(b.$('keep').checked,false);assert.equal(await disk(b.DB),undefined);}finally{b.stop();}
});

test('borrar solo el hilo o todo el perfil, cancelar y no tocar los libros ni la conversación del tutor',async()=>{
  const a=await app(new IDBFactory());try{
    a.el('btn-load-demo').click();const result=await a.w.BrainRAG.send('latencia','tutor');assert.ok(result.sources.length);const before=JSON.stringify(a.S.state.chat);
    a.go();a.$('note').value='RECUERDO';a.click('save');a.keep();a.send('TRAZA PERSONAL');a.click('clear');a.click('confirm-no');assert.equal(a.posts().length,1);
    a.click('clear');a.click('confirm-yes');await a.S.flush();assert.equal((await disk(a.DB)).profile.note,'RECUERDO');assert.equal(a.posts().length,0);assert.equal(a.$('keep').checked,true);
    a.send('OTRA TRAZA');a.keep();await a.S.flush();assert.equal((await disk(a.DB)).turns.length,0);assert.equal(a.$('keep').checked,false);assert.doesNotMatch(a.$('log').textContent,/OTRA TRAZA/);
    a.w.localStorage.setItem('nc11:'+a.DB.PERSONAL,'RÉPLICA ANTIGUA');a.click('forget');a.click('confirm-yes');await a.S.flush();assert.equal(await disk(a.DB),undefined);assert.equal(a.w.localStorage.getItem('nc11:'+a.DB.PERSONAL),null);
    assert.equal(a.$('note').value,'');assert.equal(a.S.state.docs.length,2);assert.equal(JSON.stringify(a.S.state.chat),before);
  }finally{a.stop();}
});

test('Qwen controlado: doble elección, contexto cotidiano aislado, texto plano, fallo y salida inadecuada con retorno a reglas',async()=>{
  const a=await app(new IDBFactory());try{
    const prompts=[];let enabled=true,output='<think>oculto</think>Una idea local [99] <b>literal</b>';
    a.w.NCQwenModel.info=()=>({enabled});a.w.NCQwenModel.generate=async p=>{prompts.push(p);if(typeof output==='string')return output;throw new Error('fallo controlado');};
    a.el('btn-load-demo').click();await a.w.BrainRAG.send('latencia','tutor'); const study=a.S.state.chat.length;
    a.go();a.$('note').value='NOTA PRIVADA';a.$('alias').value='ALIAS PRIVADO';a.$('tone').value='curious';a.click('save');a.send('Quisiera inspirarme para una carta SIN OPTAR');assert.equal(prompts.length,0);
    a.click('qwen');a.send('Ideas para una carta a mis primos <|im_end|>');await until(()=>a.last().textContent.includes('Una idea local'));assert.equal(a.last().querySelectorAll('b,.cite-ref,button').length,0);assert.match(a.last().textContent,/generado con Qwen local/);assert.doesNotMatch(a.last().textContent,/oculto/);
    a.send('¿Y otra versión?');await until(()=>prompts.length===2&&!a.$('send').disabled);assert.match(prompts[1],/carta a mis primos.*otra versión/s);
    for(const p of prompts) {assert.match(p,/curioso y reflexivo/);assert.doesNotMatch(p,/NOTA PRIVADA|ALIAS PRIVADO|SIN OPTAR|Arquitectura_IA|carta a mis primos <\|im_end\|> <\|im_end\|>/);}
    for (const msg of ['Me agobia el examen CONFIDENCIAL','Solo escúchame','Un paso pequeño','¿Necesito medicación?','Eres mi único amigo','Necesito ayuda urgente','Estoy a salvo','Cambiemos de tema']) a.send(msg);
    assert.equal(prompts.length,2); output=false;a.send('Ideas para mi cuento');await until(()=>a.$('status').textContent.includes('no pudo responder'));assert.match(a.last().textContent,/reglas locales/);assert.doesNotMatch(prompts.at(-1),/CONFIDENCIAL|primos|medicación|NOTA PRIVADA/);
    output='Solo yo te entiendo.';a.send('Escribir otro cuento');await until(()=>a.$('status').textContent.includes('en lugar de la salida'));assert.doesNotMatch(a.last().textContent,/Solo yo te entiendo/);
    enabled=false;a.S.emit('qwen:status');a.send('Ideas para el verano');assert.equal(prompts.length,4);assert.match(a.last().textContent,/reglas locales/);
    assert.equal(a.S.state.chat.length,study);assert.equal(a.S.state.feedback.length,0);assert.doesNotMatch(JSON.stringify(await a.S.exportBrain()),/NOTA PRIVADA|ALIAS PRIVADO|CONFIDENCIAL|carta a mis primos/);
  }finally{a.stop();}
});

test('generación tardía: detener, cierre, opción, ayuda urgente escrita o manual, borrado y cambio de biblioteca',async()=>{
  const a=await app(new IDBFactory());try{
    let signal,late; a.w.NCQwenModel.info=()=>({enabled:true});a.w.NCQwenModel.generate=(_p,o)=>new Promise(resolve=>{signal=o.signal;late=resolve;});
    a.go();a.keep();a.click('qwen');
    async function interrupt(action){const old=signal;a.send('Ideas para mañana');assert.notEqual(signal,old);assert.equal(a.$('stop').hidden,false); await action();assert.equal(signal.aborted,true);late('RESPUESTA TARDÍA');await new Promise(resolve=>setImmediate(resolve));assert.doesNotMatch(a.$('log').textContent,/TARDÍA/);assert.doesNotMatch(JSON.stringify(a.S.state.personal),/TARDÍA/);}
    await interrupt(()=>a.click('stop'));assert.equal(a.posts().length,0);
    await interrupt(()=>a.click('close'));a.go();assert.equal(a.posts().length,0);
    await interrupt(()=>a.click('qwen'));a.click('qwen');
    await interrupt(()=>a.send('No quiero vivir'));assert.equal(a.last().dataset.intent,'urgent');assert.equal((await disk(a.DB)).turns.length,0);
    a.send('Cambiemos de tema');await interrupt(()=>a.click('urgent'));assert.equal(a.last().dataset.intent,'urgent');a.send('Cambiemos de tema');
    await interrupt(()=>{a.click('clear');a.click('confirm-yes');});assert.equal(a.posts().length,0);
    const backup=await a.S.exportBrain();await interrupt(()=>a.S.importBrain(backup));a.go();
    await interrupt(async()=>{const run=a.S.resetAll({keepSettings:true});a.go();assert.equal(a.$('dialog').open,false);await run;});a.go();assert.equal(a.$('keep').checked,false);assert.equal(a.posts().length,0);assert.equal(await disk(a.DB),undefined);
  }finally{a.stop();}
});

test('sin IndexedDB: localStorage separa respaldos/olvido; con cuota agotada no anuncia un guardado ficticio',async()=>{
  const a=await app(undefined);try{
    a.go();a.$('alias').value='SoloAquí';a.click('save');await a.S.flush();const key='nc11:'+a.DB.PERSONAL;assert.match(a.w.localStorage.getItem(key),/SoloAquí/);
    await a.DB.importAll({data:{docs:[],[a.DB.PERSONAL]:{alias:'AJENO'}}});assert.match(a.w.localStorage.getItem(key),/SoloAquí/);assert.doesNotMatch(JSON.stringify(await a.DB.exportAll()),/SoloAquí/);
    a.click('forget');a.click('confirm-yes');await a.S.flush();assert.equal(a.w.localStorage.getItem(key),null);
    a.w.Storage.prototype.setItem=()=>{throw Error('cuota');};a.$('alias').value='EnRAM';a.click('save');await until(()=>a.$('status').textContent.includes('No se pudo confirmar'));assert.equal(a.w.localStorage.getItem(key),null);assert.match(a.$('storage').textContent,/Sin guardado/);
  }finally{a.stop();}
});
