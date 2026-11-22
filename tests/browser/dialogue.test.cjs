const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openBrowser, boot, serve, root } = require('../support/browser.cjs');

const latest = p => p.locator('#chat-messages .dialogue-result').last();
const info = p => p.evaluate(() => NeuralStore.state.chat.at(-1)?.dialogue);
const file = (name, text) => ({ name, mimeType:'text/plain', buffer:Buffer.from(text) });
const workspace = (p,key) => p.click(`.workspace-step[data-workspace="${key}"]`);
async function send(p, text) {
  const count = await p.locator('.dialogue-result').count();
  await p.fill('#chat-input',text); await p.press('#chat-input','Enter');
  await p.waitForFunction(n => document.querySelectorAll('.dialogue-result').length > n,count);
}
async function chip(p, label) {
  const count = await p.locator('.dialogue-result').count();
  await p.locator('#dialogue-quick-actions').getByRole('button',{ name:label, exact:true }).click();
  await p.waitForFunction(n => document.querySelectorAll('.dialogue-result').length > n,count);
}

test('PWA con servidor apagado: fuentes → por qué → anexo → revisión comprobable → práctica y pregunta propia → recarga', async t => {
  const { url, closeServer } = await serve(t), ctx = await (await openBrowser(t)).newContext({ viewport:{width:1366,height:850},reducedMotion:'reduce' });
  const p=await ctx.newPage(), errors=[], external=[];
  p.on('pageerror',e=>errors.push(e.message)); ctx.on('request',r=>{ if (/^https?:/.test(r.url())&&!r.url().startsWith(url)) external.push(r.url()); });
  await boot(p,url); await p.waitForFunction(()=>!!navigator.serviceWorker.controller); await closeServer(); await ctx.setOffline(true);
  await boot(p,url); await p.click('#btn-toggle-spiders'); await workspace(p,'chat'); await p.click('#open-dialogue');
  assert.equal(await p.inputValue('#mode-select'),'tutor'); await p.click('#dialogue-demo'); await p.press('#chat-input','Enter');
  await p.waitForSelector('.dialogue-reading'); assert.match(await latest(p).textContent(),/12 ms y 40 ms.*no basta/);
  await chip(p,'Contrastar fuentes'); assert.match(await latest(p).textContent(),/latencia de inferencia.*latencia de consulta/);
  const annex = 'Las mediciones de 12 ms y 40 ms se obtuvieron con cargas diferentes.';
  const picker = p.waitForEvent('filechooser'); await p.click('#dialogue-upload'); await (await picker).setFiles(file('Anexo.txt',`# Nota de trabajo\nLa bitácora tiene dos secciones.\n# Procedimiento\n${annex}`));
  await p.waitForSelector('#doc-tabs .active .doc-tab-name:text-is("Anexo.txt")'); assert.match(await p.textContent('#dialogue-status'),/biblioteca cambió/);
  await chip(p,'¿Por qué?'); assert.equal((await info(p)).kind,'numbers'); assert.doesNotMatch(await latest(p).textContent(),/Anexo.txt/);
  await chip(p,'Revisar conclusión'); const d=await info(p); assert.equal(d.kind,'conditions'); assert.ok(d.before.includes('no basta'));
  const findAnnex = () => latest(p).locator('.dialogue-source').filter({hasText:'Anexo.txt'});
  assert.match(await findAnnex().textContent(),/pág. 2 · incorporado/); assert.equal(await findAnnex().locator('blockquote').textContent(),annex);
  await chip(p,'Ponme a prueba'); const exercise=latest(p); assert.equal(await exercise.locator('blockquote').first().isVisible(),false);
  await exercise.getByLabel(/Tu explicación/).fill('BORRADOR NO PERSISTENTE'); await exercise.locator('.dialogue-solution summary').click();
  await findAnnex().getByRole('button',{name:/Ver en la fuente/}).click();
  await p.waitForFunction(expected => [...document.querySelectorAll('#doc-content mark.quote-focus')].map(m=>m.textContent).join('')===expected && document.activeElement.matches('mark.quote-focus'), annex);
  assert.equal(await p.textContent('#page-indicator'),'Pág 2 / 2');
  await findAnnex().getByRole('button',{name:/Crear mi pregunta/}).click(); await p.waitForSelector('#question-dialog[open]');
  assert.equal(await p.textContent('#question-quote'),annex); await p.fill('#question-front','¿Qué diferencia de método indica el anexo?'); await p.click('#question-save');
  await p.locator('#bot-stage').getByRole('button',{name:'Empezar repaso'}).click(); assert.equal(await p.locator('.study-card-front').textContent(),'¿Qué diferencia de método indica el anexo?');
  await p.locator('#bot-stage').getByRole('button',{name:'Mostrar respuesta'}).click(); assert.equal(await p.textContent('#review-answer'),annex);
  const backup=await p.evaluate(async()=>{await NeuralStore.flush(); return NeuralStore.exportBrain();}); assert.equal(backup.data.cards[0].selector.quote,annex);
  assert.doesNotMatch(JSON.stringify(backup),/BORRADOR NO PERSISTENTE/);
  await boot(p,url); await workspace(p,'chat'); assert.equal(await p.inputValue('#mode-select'),'tutor');
  await send(p,'¿Por qué dices eso?'); assert.equal((await info(p)).kind,'conditions');
  await p.getByRole('button',{name:'Quitar documento Anexo.txt'}).click(); await p.waitForFunction(()=>!NeuralStore.state.docs.some(d=>d.name==='Anexo.txt'));
  assert.equal(await findAnnex().locator('.source-link').isDisabled(),true);
  await chip(p,'Revisar conclusión'); assert.equal((await info(p)).kind,'numbers'); assert.match(await latest(p).textContent(),/retiré/i);
  assert.equal(await findAnnex().count(),0); assert.deepEqual(external,[]); assert.deepEqual(errors,[]);
});

test('disco sin red, pantalla móvil: dos cuadernos homónimos, cambio explícito de alcance y una pregunta sin evidencia', async t => {
  const ctx=await(await openBrowser(t)).newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'}); await ctx.setOffline(true);
  const p=await ctx.newPage(), net=[], errors=[]; p.on('pageerror',e=>errors.push(e.message)); ctx.on('request',r=>{if(/^https?:/.test(r.url())) net.push(r.url());});
  await boot(p,pathToFileURL(path.join(root,'index.html')).href); await p.click('#btn-toggle-spiders');
  await workspace(p,'study'); await p.click('#study-open-dialogue');
  await p.locator('#file-input').setInputFiles(file('Clase.txt','La mediana es el valor que ocupa la posición central de los datos ordenados.'));
  await p.waitForFunction(()=>document.querySelector('#dialogue-doc').options.length===2);
  await p.selectOption('#dialogue-doc',{index:1}); await send(p,'¿Qué es la mediana?'); assert.equal((await info(p)).kind,'description');
  await p.locator('#file-input').setInputFiles(file('Clase.txt','En esta práctica se usa la mediana solo cuando los datos están ordenados.'));
  await p.waitForFunction(()=>document.querySelector('#dialogue-doc').options.length===3); await chip(p,'Revisar conclusión');
  assert.equal(await latest(p).locator('blockquote').count(),1); assert.match(await latest(p).textContent(),/No encontré evidencia distinta/);
  await p.selectOption('#dialogue-doc',''); await send(p,'¿Por qué?'); assert.equal((await info(p)).topic,'');
  await send(p,'Explica la mediana'); await chip(p,'Contrastar fuentes'); assert.equal((await info(p)).kind,'qualification'); assert.equal(await latest(p).locator('blockquote').count(),2);
  await send(p,'¿Qué es el vulcanismo?'); assert.equal(await latest(p).locator('blockquote').count(),0); assert.match(await latest(p).textContent(),/No encontré un pasaje pertinente/);
  assert.ok(await p.locator('#chat-messages').evaluate(n => n.scrollHeight > n.clientHeight && n.clientHeight < innerHeight), 'el historial móvil no empuja la entrada fuera de un panel acotado');
  assert.deepEqual(net,[]); assert.deepEqual(errors,[]);
});

test('vista sin permisos de formularios ni modales: preguntar, abrir cita y olvidar el hilo sin borrar libros', async t => {
  const { url }=await serve(t), p=await(await openBrowser(t)).newPage(), fn=p.waitForEvent('framenavigated',f=>f.url()===url);
  await p.setContent(`<iframe sandbox="allow-scripts" width="1250" height="850" src="${url}"></iframe>`); const f=await fn;
  await f.waitForSelector('html[data-app-ready=true]'); await workspace(f,'chat'); await f.selectOption('#mode-select','tutor'); await f.click('#dialogue-demo');
  await send(f,'latencia de consulta'); await chip(f,'¿Por qué?'); assert.ok(await latest(f).locator('blockquote').count()>1);
  await latest(f).locator('.source-link').first().click(); await f.waitForSelector('#doc-content mark.quote-focus');
  await f.click('#btn-clear-chat'); await f.click('#dialogue-clear-no'); assert.equal(await f.locator('.dialogue-result').count(),2);
  await f.click('#btn-clear-chat'); await f.click('#dialogue-clear-yes'); assert.equal(await f.locator('.dialogue-result').count(),0);
  await send(f,'¿Por qué?'); assert.equal((await info(f)).topic,''); assert.equal(await f.locator('#dialogue-doc option').count(),3);
});
