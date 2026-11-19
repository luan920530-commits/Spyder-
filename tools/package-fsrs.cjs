// node tools/package-fsrs.cjs /ruta/a/ts-fsrs-5.4.2/package
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const dir = process.argv[2];
if (!dir) throw Error('Indica la carpeta de ts-fsrs@5.4.2.');
const src = fs.readFileSync(path.join(dir, 'dist/index.umd.js'));
if (crypto.createHash('sha256').update(src).digest('hex') !== '59b7444121d0aae5bb969097ed95df38eff4a4f878e459703c63720f6b6a176b') throw Error('Bundle FSRS inesperado');
// El planificador usa funciones puras. No instalar sus cuatro atajos globales en Date.
const out = src.toString().replace(/  \/\* istanbul ignore next -- @preserve \*\/\n  Date\.prototype\.\w+ = function\([^)]*\) \{\n[^\n]*\n  \};\n/g, '').replace(/^\/\/# sourceMappingURL=.*\n?/m, '');
if (out.includes('Date.prototype.')) throw Error('No se aislaron los atajos de Date.');
const dest = path.join(__dirname, '../vendor/fsrs'); fs.mkdirSync(dest, { recursive: true });
fs.writeFileSync(path.join(dest, 'ts-fsrs.umd.js'), out); fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(dest, 'LICENSE'));
