const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createApp } = require('./support/dom.cjs');
const T = require('../js/smalltalk');
const C = require('../js/companion');

test('fórmulas completas, vocativos, cortesía compuesta y respuestas breves en contexto', () => {
  for (const [text,kind,reply] of [
    ['¡HoLa, Spyder! 👋🏽','hello',/¡Hola!/], ['buenos DI\u0301AS','hello',/¡Buenos días!/],
    ['Hola, buenas tardes','hello',/¡Buenas tardes!/], ['Buenas noches.','hello',/¡Buenas noches!/],
    ['Buen día, Spyder, ¿cómo estás?','checkin',/¡Buen día!.*Gracias por preguntar/], ['¿qué tal?','checkin',/¿Cómo vas tú/],
    ['¿Sigues ahí?','available',/te leo/], ['Muy bien, gracias. ¿Y tú?','good',/Qué bueno/],
    ['Gracias por tu ayuda','thanks',/De nada/], ['Hasta mañana','bye',/Hasta luego/],
    ['Muchas gracias y hasta pronto','thanksBye',/De nada.*Hasta/], ['Mucho gusto','meet',/Mucho gusto/]
  ]) {
    const m = T.parse(text).social; assert.equal(m?.kind, kind, text); assert.match(T.reply(m),reply);
  }
  assert.equal(T.parse('bien').social,null); assert.equal(T.parse('bien',{afterCheckin:true}).social.kind,'good');
  assert.equal(T.parse('regular',{afterCheckin:true}).social.kind,'rough');
  assert.equal(T.parse('No estoy bien',{afterCheckin:true}).social.kind,'rough');
  assert.match(T.reply(T.parse('bien, ¿y tú?').social),/listo para charlar/);
});

test('no secuestra un tema, una búsqueda literal, negaciones, filtros ni instrucciones con saludo', () => {
  for (const q of ['buenas prácticas','Gracias a la luz crecen las plantas','¿Qué tal funciona la búsqueda?', 'hola mundo', 'Hola.pdf',
    '"hola"','«buenos días»','-hola','hola =doc:saludos', '2 + 3', 'No estoy bien', '<b>hola</b>']) {
    assert.deepEqual(T.parse(q),{social:null,request:q},q);
  }
  for (const [raw,request] of [
    ['¡Buenos días! ¿Cuánto es 2,5 * 4?', '¿Cuánto es 2,5 * 4?'], ['Hola Spyder ¿qué es la mediana?', '¿qué es la mediana?'],
    ['Hola resume =doc:Cálculo -anexo', 'resume =doc:Cálculo -anexo'], ['¡Hola! Buenos días, busca "frase exacta" =pag:2', 'busca "frase exacta" =pag:2'],
    ['Gracias, ¿por qué?', '¿por qué?'], ['Hola, estoy triste', 'estoy triste']
  ]) assert.deepEqual(T.parse(raw),{social:null,request},raw);
  assert.equal(T.parse('Hola, '+ 'x'.repeat(200)).social,null);
});

test('Spyder personal mantiene su nombre y tono, su propia continuidad y la prioridad de ayuda', () => {
  const p={alias:'Luz',tone:'practical'}, h=[];
  const ask=q=>{const r=C.respond(q,p,h);h.push(r);return r;};
  assert.match(ask('¡Buenos días!').text,/Buenos días, Luz/);assert.equal(ask('👋').intent,'hello');
  assert.equal(ask('¿Cómo estás hoy?').intent,'checkin');assert.equal(ask('Más o menos').intent,'offer');
  assert.equal(ask('Solo quiero que me escuches').intent,'listen');assert.equal(ask('Muchas gracias').intent,'listen');
  assert.equal(ask('Buenas tardes, no estoy a salvo').intent,'urgent');assert.equal(ask('Hola').intent,'urgent');
  assert.equal(C.noteDraft('Hola, recuerda que quiero caminar'),'quiero caminar');
  assert.ok(h.every(r=>!C.canGenerate(r))); assert.equal(C.record({version:1,keep:true,turns:h}).turns.some(t=>t.intent==='checkin'),true);
});

async function app(t) {
  const {w,errors}=await createApp(new IDBFactory()); t.after(()=>{w.close();assert.deepEqual(errors,[]);});
  w.document.querySelector('[data-workspace="chat"]').click();return {w,S:w.NeuralStore,send:q=>w.BrainRAG.send(q)};
}

test('chatear en Automático sin libros: no hay búsqueda, modelo, votos, uso del perfil ni requisito de demo',async t=>{
  const {w,S,send}=await app(t), box=w.document.getElementById('chat-messages');
  await S.savePersonal({...S.state.personal,profile:{alias:'NombrePrivado',note:'NotaPrivada'}});
  let work=0; S.search=()=>{ work++; throw Error('búsqueda inesperada'); };
  w.NCQwenModel.info=()=>({enabled:true});w.NCQwenModel.generate=()=>{work++;};
  w.NCLocalModel.info=()=>({enabled:true});w.NCLocalModel.scores=()=>{work++;};
  for(const [q,kind] of [['Hola','hello'],['¿Cómo estás?','checkin'],['bien','good'],['¡Mil gracias!','thanks'],['Chao','bye']]) {
    const r=await send(q);assert.equal(r.smalltalk.kind,kind);assert.equal(r.sources.length,0);assert.equal(r.citations,null);
    assert.equal(box.lastChild.querySelector('button'),null);assert.match(box.lastChild.textContent,/charla local/);
    assert.doesNotMatch(r.text,/KIMI|NombrePrivado|NotaPrivada|documento\(s\)|pasajes/);
  }
  assert.equal(work,0);assert.equal(S.state.docs.length,0);assert.equal(S.state.feedback.length,0);assert.equal(S.state.personal.turns.length,0);
  const backup=await S.exportBrain();assert.equal(backup.data.chat.at(-1).question,'Chao');assert.doesNotMatch(JSON.stringify(backup),/NombrePrivado|NotaPrivada/);
});

test('la petición con saludo sigue llegando a calculadora, memoria y pasajes filtrados; se conserva la pregunta original',async t=>{
  const {w,S,send}=await app(t);w.document.getElementById('btn-load-demo').click();
  const math=await send('¡Buenos días! ¿Cuánto vale 2,5 * 4?');assert.equal(math.mode,'math');assert.match(math.text,/= 10/);
  const learn=await send('Hola, aprende que mi examen es el jueves');assert.equal(learn.intent,'learn');assert.equal(S.state.consolidatedMemory.at(-1).fact,'mi examen es el jueves');
  const q='Hola, resume el documento =doc:Informe =pag:2';const r=await send(q);assert.equal(r.mode,'resumen');assert.equal(r.question,q);
  assert.ok(r.sources.length);assert.ok(r.sources.every(s=>s.docName==='Informe_Contraste_2025.md' && s.pageNum===2));assert.match(r.text,/\[1\]/);
  assert.equal(S.state.chat.at(-1).question,q);assert.equal(w.NCRag.detectIntent('¿Cómo estás?'),'smalltalk');assert.equal(w.NCRag.detectIntent(q),'resumen');
});

test('gracias no corta el hilo del tutor ni solicita Qwen; no se retoman fuentes a través de otro ámbito',async t=>{
  const {w,S,send}=await app(t);w.document.getElementById('open-dialogue').click();w.document.getElementById('dialogue-demo').click();
  const a=await send('Buenos días, ¿qué dicen los informes sobre la latencia?');assert.equal(a.dialogue.kind,'numbers');
  let calls=0;w.NCQwenModel.info=()=>({enabled:true});w.NCQwenModel.generate=async()=>{calls++;return 'explicación';};S.setSetting('dialogueQwen',true);
  const g=await send('Muchas gracias');assert.equal(g.smalltalk.kind,'thanks');assert.equal(g.mode,'tutor');assert.equal(g.dialogue,undefined);assert.equal(calls,0);
  assert.equal(w.document.querySelector('#dialogue-quick-actions button').disabled,false);
  const why=await send('Hola, ¿por qué?');assert.equal(why.dialogue.action,'why');assert.equal(why.dialogue.topic,a.dialogue.topic);assert.deepEqual(why.sources,a.sources);assert.equal(calls,1);
  S.setSetting('dialogueDocId',S.state.docs[0].id);await send('Hola');S.setSetting('dialogueDocId','');assert.equal((await send('¿Por qué?')).sources.length,0);
  await assert.rejects(w.NCRag.ask('Hola, '+'x'.repeat(998)),/1000/);
});
