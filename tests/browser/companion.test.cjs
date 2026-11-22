const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, boot, serve, root } = require('../support/browser.cjs');
const last=p=>p.locator('#personal-log .personal-turn').last();
async function ask(p,q){ await p.fill('#personal-input',q);await p.press('#personal-input','Enter');await last(p).locator('.personal-user p').getByText(q,{exact:true}).waitFor(); }
const choice=(p,label)=>p.locator('#personal-choices').getByRole('button',{name:label,exact:true}).click();
const prefs=p=>p.click('#personal-prefs summary');

test('PWA móvil sin servidor ni libros: escucha, memoria explícita, charla opcional al recargar y paso al estudio sin copiar lo personal',async t=>{
  const {url,closeServer}=await serve(t),ctx=await(await openBrowser(t)).newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'}),p=await ctx.newPage();
  const external=[],errors=[];ctx.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(url))external.push(r.url());});p.on('pageerror',e=>errors.push(e.message));
  await boot(p,url);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);await closeServer();await ctx.setOffline(true);await boot(p,url);
  await p.click('#open-personal');assert.equal(await p.evaluate(()=>document.activeElement.id),'personal-input');assert.match(await p.textContent('#personal-storage'),/temporal/);
  await ask(p,'Me preocupa mi examen de química');await choice(p,'Solo escúchame');assert.match(await last(p).textContent(),/mi examen de química/);
  await ask(p,'Temo quedarme en blanco');assert.match(await last(p).textContent(),/lo que temes que pueda pasar/);await choice(p,'Un paso pequeño');assert.match(await last(p).textContent(),/voz alta/);
  await ask(p,'Recuerda que BORRADOR DEL PERFIL');await choice(p,'Revisar la nota');assert.equal(await p.inputValue('#personal-note'),'BORRADOR DEL PERFIL');
  await p.fill('#personal-alias','Mar');await p.selectOption('#personal-tone','practical');await p.fill('#personal-note','Ensayar mi presentación de arte');await p.click('#personal-save');await p.locator('#personal-status').getByText('Perfil guardado en este navegador.').waitFor();
  await p.press('#personal-save','Escape');assert.equal(await p.evaluate(()=>document.activeElement.id),'open-personal');
  await boot(p,url);await p.click('#open-personal');assert.match(await p.textContent('#personal-log'),/Hola, Mar/);assert.equal(await p.locator('.personal-turn').count(),0);
  await choice(p,'Retomar mi nota');assert.match(await last(p).textContent(),/presentación de arte/);
  await prefs(p);await p.click('#personal-keep');await p.click('#personal-confirm-yes');assert.equal(await p.locator('.personal-turn').count(),0);
  await ask(p,'Tengo que preparar mi proyecto de acuarela');await choice(p,'Solo tengo 15 minutos');assert.match(await last(p).textContent(),/mi proyecto de acuarela.*3 min:.*9 min:.*3 min:/s);
  // Leer IDB, no el espejo de NCDB: la recarga comprueba el guardado que
  // provocó el envío, sin pedir un flush extra a la aplicación.
  await p.waitForFunction(async()=>{const d=await NCDB.open();return new Promise(resolve=>{const r=d.transaction(NCDB.STORE).objectStore(NCDB.STORE).get(NCDB.PERSONAL);r.onsuccess=()=>resolve(r.result?.v.turns.length===2);});});
  const inside=await p.locator('#personal-log').evaluate(n=>{const box=n.getBoundingClientRect(),input=document.getElementById('personal-input').getBoundingClientRect();return n.scrollHeight>n.clientHeight&&input.bottom<innerHeight&&box.width<=innerWidth;});assert.ok(inside);
  await boot(p,url);await p.click('#open-personal');assert.equal(await p.locator('.personal-turn').count(),2);await choice(p,'Retomar el hilo');assert.match(await last(p).textContent(),/mi proyecto de acuarela/);
  await p.click('#personal-tutor');assert.equal(await p.inputValue('#mode-select'),'tutor');assert.doesNotMatch(await p.textContent('#chat-messages'),/acuarela|química/);
  await p.click('#dialogue-demo');await p.press('#chat-input','Enter');await p.waitForSelector('.dialogue-reading');assert.match(await p.textContent('.dialogue-reading'),/12 ms y 40 ms/);
  await p.click('#chat-open-personal');await p.click('#personal-review');assert.equal(await p.isVisible('#review-doc'),true);
  const backup=await p.evaluate(()=>NeuralStore.exportBrain());assert.equal(backup.data.docs.length,2);assert.doesNotMatch(JSON.stringify(backup),/acuarela|presentación de arte|BORRADOR DEL PERFIL|química/);
  await p.click('#open-personal');await prefs(p);await p.click('#personal-forget');await p.click('#personal-confirm-yes');await p.locator('#personal-status').getByText('Perfil y charla eliminados.').waitFor();
  await boot(p,url);await p.click('#open-personal');assert.equal(await p.locator('.personal-turn').count(),0);assert.doesNotMatch(await p.textContent('#personal-log'),/Hola, Mar/);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});

test('desde disco sin red: cambio de tono, pausa y ayuda manual accesible sin llamar a servicios externos',async t=>{
  const ctx=await(await openBrowser(t)).newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});await ctx.setOffline(true);
  const p=await ctx.newPage(),errors=[],net=[];p.on('pageerror',e=>errors.push(e.message));ctx.on('request',r=>{if(/^https?:/.test(r.url()))net.push(r.url());});
  await boot(p,pathToFileURL(path.join(root,'index.html')).href);await p.click('#open-personal');await prefs(p);await p.selectOption('#personal-tone','curious');await p.click('#personal-save');await prefs(p);
  await ask(p,'Hola');assert.match(await last(p).textContent(),/qué te gustaría explorar/);await ask(p,'Estoy frustrada');await choice(p,'Una pausa');assert.match(await last(p).textContent(),/Si te resulta cómodo/);
  await p.click('#personal-urgent');assert.match(await last(p).textContent(),/emergencias.*no puedo llamar/s);await choice(p,'Estoy a salvo');assert.equal(await last(p).getAttribute('data-intent'),'care');await choice(p,'Cambiar de tema');
  await ask(p,'¿Qué es una estrella?');assert.equal(await last(p).getAttribute('data-intent'),'ordinary');assert.equal(await p.evaluate(()=>NeuralStore.state.personal.turns.length),0);
  await p.press('#personal-input','Escape');assert.equal(await p.locator('#personal-dialog[open]').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(net,[]);
});

test('vista aislada sin almacenamiento, formas ni confirm: hablar y borrar sin prometer persistencia',async t=>{
  const {url}=await serve(t),p=await(await openBrowser(t)).newPage(),frame=p.waitForEvent('framenavigated',f=>f.url()===url);
  await p.setContent(`<iframe sandbox="allow-scripts" width="950" height="720" src="${url}"></iframe>`);const f=await frame;await f.waitForSelector('html[data-app-ready=true]');await f.click('#open-personal');await ask(f,'Hoy me siento triste');await choice(f,'Solo escúchame');assert.equal(await last(f).getAttribute('data-intent'),'listen');
  await prefs(f);await f.fill('#personal-alias','Temporal');await f.click('#personal-save');await f.locator('#personal-status').getByText(/No se pudo confirmar/).waitFor();await f.click('#personal-clear');await f.click('#personal-confirm-yes');assert.equal(await f.locator('.personal-turn').count(),0);assert.equal(await f.evaluate(()=>NeuralStore.state.chat.length),0);
});
