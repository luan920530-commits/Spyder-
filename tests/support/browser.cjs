const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '../..');
const fixture = name => path.join(root, 'tests/fixtures', name);

async function openBrowser(t) {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' });
  t.after(() => browser.close());
  return browser;
}

async function boot(page, url) {
  await page.goto(url);
  await page.waitForSelector('html[data-app-ready="true"]');
  await page.locator('#chk-auto-page').uncheck();
}

// Host estático sin CORS, sin configuración para .mjs y con una subruta como
// la de Pages. No se cambia la política de seguridad de index.html.
async function serve(t) {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const filename = path.resolve(root, '.' + url.pathname.slice('/app'.length), url.pathname.endsWith('/') ? 'index.html' : '');
    if (!url.pathname.startsWith('/app/') || !filename.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    try {
      const body = await fs.readFile(filename);
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const closeServer = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  t.after(() => server.listening && closeServer());
  return { url: `http://127.0.0.1:${server.address().port}/app/`, closeServer };
}

module.exports = { openBrowser, boot, serve, root, fixture };
