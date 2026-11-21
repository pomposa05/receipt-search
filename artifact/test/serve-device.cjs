// 端末内OCRの確認: 公開時と同じ配置（ページ＋vendor/）で配信し、Claude読み取りなしの状態で名刺を読み取る
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const dist = fs.readFileSync(path.join(root, 'dist/receipt-search.html'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8').replace("const caps = { db, sample,", "const caps = { db, sample: null,");
const page = `<!doctype html><html><head><meta charset="utf-8"><script>${mock}</script></head><body>${dist}</body></html>`;
const wasm = process.argv[2] === 'wasm';
const csp = `default-src 'self'; script-src 'self' 'unsafe-inline' ${wasm ? "'wasm-unsafe-eval'" : ''} https://cdnjs.cloudflare.com; worker-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' blob: data:`;
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': csp }); return res.end(page); }
  const f = path.join(root, u);
  if (!f.startsWith(path.join(root, 'vendor')) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/plain' });
  fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.log('  console:', m.text().slice(0, 160)); });
  await p.goto(`http://localhost:${srv.address().port}/`);
  await p.click('.nav >> text=新規登録');
  const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('.ocr-card >> text=画像を取り込む')]);
  await ch.setFiles(path.resolve(root, '../test/fixtures/card1.png'));
  const t0 = Date.now();
  await p.waitForSelector('.ocr-status .notice-error, .ocr-status .notice-info >> text=反映しました', { timeout: 120000 }).catch(() => {});
  await p.waitForFunction(() => !document.querySelector('.ocr-status .loading'), null, { timeout: 120000 }).catch(() => {});
  console.log(`CSP ${wasm ? '+wasm-unsafe-eval' : '(wasm不許可)'}: ${Date.now() - t0}ms`);
  console.log('  status:', (await p.textContent('.ocr-status')).replace(/\s+/g, ' ').slice(0, 220));
  for (const k of ['name', 'companyName', 'department', 'title']) console.log('  ', k, JSON.stringify(await p.inputValue(`input[data-key=${k}]`)));
  await p.screenshot({ path: path.join(__dirname, 'out', `device-${wasm ? 'wasm' : 'nowasm'}.png`), fullPage: true });
  await b.close(); srv.close();
});
