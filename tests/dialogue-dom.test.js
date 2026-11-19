const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createApp, until } = require('./support/dom.cjs');

function book(S, id, text, sourcePage = 1) {
  return S.addDocument({ id, name:'Cuaderno.txt', pages:[{ pageNum:1, sourcePage, sentences:[{ id:'pasaje-'+id, text }] }] });
}
const lastBody = w => [...w.document.querySelectorAll('.dialogue-result')].at(-1);

test('demo desde Asistente, hilo y práctica: el anexo cambia la interpretación, no el texto de los informes ni la programación FSRS', async () => {
  const { w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore, $ = id => w.document.getElementById(id), ask = q => w.BrainRAG.send(q);
    $('open-dialogue').click(); assert.equal($('mode-select').value,'tutor'); assert.equal($('dialogue-setup').hidden,false);
    $('dialogue-demo').click(); const a = await ask($('chat-input').value); assert.equal(a.dialogue.kind,'numbers');
    assert.match(a.dialogue.reading,/12 ms y 40 ms/); assert.equal(a.provider,'internal');
    const c = await ask('¿En qué difieren las fuentes?'); assert.match(c.dialogue.reason,/latencia de inferencia.*latencia de consulta/);
    book(S,'anexo','Las mediciones de 12 ms y 40 ms se obtuvieron con cargas diferentes.',91);
    assert.match($('dialogue-status').textContent,/biblioteca cambió/);
    const why = await ask('¿Y por qué no se contradicen?'); assert.equal(why.dialogue.action,'why'); assert.deepEqual(why.sources,c.sources);
    const r = await ask('Con el anexo, ¿cambia tu conclusión?'); assert.equal(r.dialogue.kind,'conditions');
    const n = r.dialogue.changeRefs[0]-1; assert.equal(r.sources[n].sourcePage,91); assert.equal(r.sources[n].docId,'anexo');
    const b = lastBody(w), row = b.querySelectorAll('.dialogue-source')[n]; assert.match(row.textContent,/pág. 91 · incorporado/);
    assert.equal(row.querySelector('blockquote').textContent,r.sources[n].text);
    assert.match(w.NCRag.toMarkdown(r),/Lectura anterior:.*no basta/s);
    const p = await ask('Hazme una pregunta'); assert.equal(p.dialogue.action,'practice'); assert.equal(p.dialogue.kind,'conditions');
    const challenge = lastBody(w); assert.equal(challenge.querySelector('.dialogue-solution').open,false);
    challenge.querySelector('textarea').value='SOLO MI BORRADOR'; challenge.querySelector('summary').click();
    assert.equal(challenge.querySelector('.dialogue-solution').open,true);
    assert.deepEqual([S.state.cards.length,S.state.feedback.length,S.state.relationVotes.length],[0,0,0]);
    const backup = await S.exportBrain(); assert.doesNotMatch(JSON.stringify(backup),/SOLO MI BORRADOR/);
    assert.equal(backup.data.chat.at(-1).sources[n].offset,0); assert.deepEqual(errors,[]);
  } finally { w.close(); }
});

test('opt-in separado de Qwen: solo recibe citas vivas del alcance, salida no enlazable, caída por reglas y cancelación sin respuesta tardía', async () => {
  const { w, errors } = await createApp(new IDBFactory());
  try {
    const S = w.NeuralStore, $ = id => w.document.getElementById(id), prompts = [];
    w.NCQwenModel.info = () => ({ enabled:true, status:'ready' });
    w.NCQwenModel.generate = async prompt => { prompts.push(prompt); return '<think>OMITIR</think> TEXTO GENERADO [99] <b>prueba</b>'; };
    book(S,'A','La mediana es el valor central. Referencia [99] <b>nota literal</b>.',12);
    book(S,'B','La mediana aparece en CUADERNO AJENO.',29);
    S.setSetting('mode','tutor'); S.setSetting('dialogueDocId','A');
    let a = await w.BrainRAG.send('¿Qué es la mediana?'); assert.equal(a.provider,'internal'); assert.equal(prompts.length,0);
    assert.equal($('dialogue-qwen').disabled,false); $('dialogue-qwen').click();
    a = await w.BrainRAG.send('¿Por qué?'); assert.equal(a.provider,'qwen-local');
    assert.match(prompts[0],/Eres un tutor/); assert.match(prompts[0],/valor central/); assert.doesNotMatch(prompts[0],/AJENO|personaje/);
    const b = lastBody(w); assert.match(b.textContent,/puede equivocarse, no es una fuente/);
    assert.equal(b.querySelector('blockquote b, .dialogue-generated b, .cite-ref'),null);
    assert.match(b.querySelector('blockquote').textContent,/\[99\] <b>nota literal<\/b>/); assert.match(b.querySelector('.dialogue-generated').textContent,/TEXTO GENERADO \[99\] <b>/);
    assert.doesNotMatch(b.textContent,/OMITIR/);
    await w.BrainRAG.send('¿Qué falta?'); assert.doesNotMatch(prompts.at(-1),/TEXTO GENERADO/);
    a = await w.BrainRAG.send('arqueología'); assert.equal(a.sources.length,0); assert.equal(prompts.length,2);
    w.NCQwenModel.generate = async () => { throw new Error('no cabe en contexto'); };
    a = await w.BrainRAG.send('mediana'); assert.equal(a.fallback,true); assert.equal(a.provider,'internal'); assert.match(a.dialogue.notice,/conserva/);
    let release, signal; w.NCQwenModel.generate = (_,o) => new Promise(ok => { release=ok; signal=o.signal; });
    for (const abort of [()=>$('btn-stop-generation').click(), ()=>S.setSetting('dialogueDocId','B'), ()=>book(S,'C','No contiene el tema.')]) {
      const count=S.state.chat.length; signal=null; const waiting=w.BrainRAG.send('mediana'); await until(()=>!!signal);
      assert.equal($('btn-stop-generation').classList.contains('hidden'),false); abort(); assert.equal(signal.aborted,true);
      release('RESIDUO TARDÍO'); assert.equal(await waiting,null); assert.equal(S.state.chat.length,count);
    }
    signal=null; const waiting=w.BrainRAG.send('mediana'); await until(()=>!!signal);
    $('btn-clear-chat').click(); assert.equal($('dialogue-clear').hidden,false); $('dialogue-clear-yes').click();
    release('RESIDUO TARDÍO'); assert.equal(await waiting,null); assert.equal(S.state.chat.length,0); assert.equal(S.state.docs.length,3);
    assert.doesNotMatch($('chat-messages').textContent,/RESIDUO|TEXTO GENERADO/);
    S.setSetting('mode','auto'); a = await w.BrainRAG.send('Calcula 4 + 7'); assert.match(a.text,/11/); assert.deepEqual(errors,[]);
  } finally { w.close(); }
});

test('IndexedDB e importación: el tema sigue después de recargar; un ID reutilizado con otro literal ya no sirve de prueba ni de tarjeta', async () => {
  const db = new IDBFactory(), first = await createApp(db);
  let backup;
  try {
    const S=first.w.NeuralStore; book(S,'libro','La mediana es el valor central de los datos.',8);
    S.setSetting('mode','tutor'); S.setSetting('dialogueDocId','libro'); await first.w.BrainRAG.send('¿Qué es la mediana?');
    backup=JSON.parse(JSON.stringify(await S.exportBrain())); await S.flush();
  } finally { first.w.close(); }
  const { w, errors } = await createApp(db);
  try {
    const S=w.NeuralStore, $=id=>w.document.getElementById(id);
    assert.equal($('dialogue-doc').value,'libro'); assert.match($('dialogue-status').textContent,/mediana/);
    const a=await w.BrainRAG.send('¿En qué te basas?'); assert.equal(a.sources[0].sourcePage,8); assert.match(a.dialogue.reason,/define/);
    backup.data.docs[0].pages[0].sentences[0].text='La moda es el dato más frecuente.';
    await S.importBrain(backup); assert.equal(S.state.chat.length,1);
    const b=lastBody(w); assert.equal(b.querySelector('.source-link').disabled,true); assert.match(b.querySelector('.dialogue-note').textContent,/ya no coincide/);
    assert.equal(w.NCQuestionUI.fromCitation(backup.data.chat[0].sources[0],'Borrador'),false);
    const why=await w.BrainRAG.send('¿Por qué?'); assert.equal(why.sources.length,0); assert.match(why.dialogue.change,/ya no/); assert.doesNotMatch(why.text,/valor central/);
    S.removeDocument('libro'); assert.equal($('dialogue-doc').value,''); assert.equal((await w.BrainRAG.send('¿Por qué?')).dialogue.topic,'');
    await S.resetAll({keepSettings:false}); assert.equal($('dialogue-setup').hidden,true); assert.equal(S.state.chat.length,0); assert.deepEqual(errors,[]);
  } finally { w.close(); }
});

test('reset mientras se lee un anexo desde el selector compartido no añade el anexo al nuevo chat', async () => {
  const { w, errors } = await createApp(new IDBFactory());
  try {
    const S=w.NeuralStore, input=w.document.getElementById('file-input'); S.setSetting('mode','tutor');
    let finish; const file={name:'Anexo pendiente.txt',type:'text/plain',text:()=>new Promise(resolve=>{finish=resolve;})};
    Object.defineProperty(input,'files',{value:[file],configurable:true}); input.dispatchEvent(new w.Event('change'));
    await until(()=>!!finish); const reset=S.resetAll({keepSettings:true});
    assert.equal(await w.BrainRAG.send('tema transitorio'),null); await reset;
    finish('La latencia no debe aparecer en la nueva biblioteca.'); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(S.state.docs.length,0); assert.equal(S.state.chat.length,0); const r=await w.BrainRAG.send('latencia'); assert.equal(r.sources.length,0); assert.deepEqual(errors,[]);
  } finally { w.close(); }
});
