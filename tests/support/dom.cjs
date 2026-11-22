const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '../..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (fn()) return; await wait(20); }
  throw new Error('Tiempo agotado esperando condición');
}
function canvasContext() {
  const gradient = () => ({ addColorStop() {} });
  const ctx = { createRadialGradient: gradient, createLinearGradient: gradient, measureText: text => ({ width: String(text).length * 6 }) };
  ['arc', 'beginPath', 'bezierCurveTo', 'quadraticCurveTo', 'clearRect', 'clip', 'closePath', 'ellipse', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo', 'rect', 'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform', 'stroke', 'strokeRect', 'translate'].forEach(name => { ctx[name] = () => {}; });
  return ctx;
}
async function createApp(indexedDB, withD3 = false, reducedMotion = true, clock = null) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'https://local.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  const w = dom.window;
  Object.defineProperty(w, 'indexedDB', { value: indexedDB, configurable: true });
  w.matchMedia = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} });
  w.confirm = () => true;
  w.URL.createObjectURL = () => 'blob:https://local.test/fake';
  w.URL.revokeObjectURL = () => {};
  w.HTMLCanvasElement.prototype.getContext = function () {
    const context = canvasContext();
    if (clock && this.id === 'core-3d-canvas') context.clearRect = () => { clock.sphereDraws++; };
    return context;
  };
  if (clock) {
    let time = 0, next = 1;
    const queue = new Map(); clock.sphereDraws = 0;
    w.requestAnimationFrame = callback => { const id = next++; queue.set(id, callback); return id; };
    w.cancelAnimationFrame = id => queue.delete(id);
    clock.tick = delta => { time += delta; const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(time)); };
  }
  w.HTMLElement.prototype.scrollIntoView = function () {};
  if (withD3) w.eval(fs.readFileSync(path.join(root, 'vendor', 'd3', 'd3.min.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'vendor/fsrs/ts-fsrs.umd.js'), 'utf8'));
  for (const script of w.document.querySelectorAll('script[src^="js/"]')) {
    w.eval(fs.readFileSync(path.join(root, script.getAttribute('src')), 'utf8'));
  }
  await until(() => w.document.documentElement.dataset.appReady === 'true');
  return { dom, w, errors };
}
function byText(w, selector, text) {
  return [...w.document.querySelectorAll(selector)].find(x => x.textContent.includes(text));
}

module.exports = { createApp, wait, until, byText };
