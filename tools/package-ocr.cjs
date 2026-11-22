// node tools/package-ocr.cjs /ruta/a/tesseract.js-core-6.1.2/package /ruta/a/spa.traineddata
// Un script de datos cargado a petición también funciona desde file: y en un
// iframe opaco. Ninguna ruta ni byte de un documento se usa como código.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [dir, language] = process.argv.slice(2);
if (!dir || !language) throw Error('Se necesitan la carpeta de tesseract.js-core y spa.traineddata');
function read(file, hash, encoding) {
  const bytes = fs.readFileSync(file);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash) throw Error('Hash inesperado: ' + file);
  return bytes.toString(encoding);
}
const data = {
  glue: read(path.join(dir, 'tesseract-core-lstm.js'), '48a3ee8e00924cb8c7f0cc0d099b1318fea120af56b3ee8fb3a70dd2311806c2', 'utf8'),
  wasm: read(path.join(dir, 'tesseract-core-lstm.wasm'), '220e2e87551edccb85519796a170469f8ab2a8055216789e3b8b1ada18b7bc2b', 'base64'),
  spa: read(language, '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464', 'base64')
};
const dest = path.join(__dirname, '../vendor/ocr'); fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(dest, 'LICENSE'));
fs.writeFileSync(path.join(dest, 'es-lstm-6.1.2.js'), '// Tesseract.js-core 6.1.2 / tessdata_fast spa. Consulte vendor/NOTICE.md.\nglobalThis.NCOcrAssets = ' + JSON.stringify(data) + ';\n');
