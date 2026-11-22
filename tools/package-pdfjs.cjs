// node tools/package-pdfjs.cjs /ruta/al/paquete/pdfjs-dist-4.2.67-descomprimido
// Solo para regenerar vendor; ni la aplicación ni las pruebas necesitan npm para esto.
const fs = require('node:fs');
const path = require('node:path');
const dist = path.resolve(process.argv[2] || 'node_modules/pdfjs-dist');
const dest = path.resolve(__dirname, '../vendor/pdfjs');
if (JSON.parse(fs.readFileSync(path.join(dist, 'package.json'))).version !== '4.2.67') {
  throw new Error('Se esperaba pdfjs-dist 4.2.67');
}

// Los dos bundles legacy son autocontenidos. Conservar su código y licencia;
// cambiar solo el envoltorio ESM por un script clásico con los mismos exports.
// Así se pueden cargar desde file: sin importar un módulo de un origen opaco.
for (const worker of [false, true]) {
  const name = worker ? 'pdf.worker.min' : 'pdf.min';
  const source = fs.readFileSync(path.join(dist, 'legacy/build', name + '.mjs'), 'utf8');
  const end = source.match(/export\{([^{}]+)\};\s*$/);
  if (!end) throw new Error('Estructura ESM inesperada: ' + name);
  const body = source.slice(0, end.index);
  let result;
  if (worker) {
    const binding = end[1].match(/^(\w+) as WorkerMessageHandler$/);
    if (!binding) throw new Error('Falta el export WorkerMessageHandler');
    result = `(() => { 'use strict';\n${body}\nglobalThis.pdfjsWorker = { WorkerMessageHandler: ${binding[1]} };\n})();\n`;
  } else {
    // El propio bundle publica pdfjsLib después de su inicialización asíncrona.
    result = `globalThis.pdfjsLibPromise = (async () => { 'use strict';\n${body}\nreturn globalThis.pdfjsLib;\n})();\n`;
  }
  fs.writeFileSync(path.join(dest, name + '.js'), '// PDF.js 4.2.67 (legacy); envoltorio de módulo adaptado por tools/package-pdfjs.cjs.\n' + result);
}

// En file: o en una vista con origen opaco no se permite fetch/XHR de los .bcmap
// y las fuentes. Empaquetar los mismos bytes como datos de un script local.
const assets = {};
for (const dir of ['cmaps', 'standard_fonts']) {
  for (const name of fs.readdirSync(path.join(dest, dir)).sort()) {
    if (/\.(bcmap|pfb|ttf)$/.test(name)) assets[dir + '/' + name] = fs.readFileSync(path.join(dest, dir, name)).toString('base64');
  }
}
fs.writeFileSync(path.join(dest, 'packed-assets.js'), '// CMaps y fuentes de PDF.js 4.2.67; licencias en cmaps/ y standard_fonts/.\n' +
  'globalThis.NCPdfPackedAssets = ' + JSON.stringify(assets, null, 1) + ';\n');
