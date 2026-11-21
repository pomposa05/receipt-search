// GitHub Pages版（スマホ保存）のテスト: docs/ をそのままHTTPで配信し、本物の IndexedDB で動かす
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium, devices } = require('playwright');
const out = path.join(__dirname, 'out');
const docs = path.resolve(__dirname, '../../docs');
const card = path.resolve(__dirname, '../../test/fixtures/card1.png');
const results = []; const errors = []; const external = []; let page;
const step = async (name, fn) => { try { await fn(); results.push(1); console.log('✔', name); } catch (e) { results.push(0); console.log('✖', name, '\n  ', e.message.split('\n')[0]); await page.screenshot({ path: path.join(out, `PAGES-FAIL-${results.length}.png`), fullPage: true }); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.txt': 'text/plain', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]).replace(/^\/receipt-search/, '');
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(docs, u);
  if (!f.startsWith(docs) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const base = `http://localhost:${srv.address().port}/receipt-search/`;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  ctx.on('request', (r) => { if (!r.url().startsWith(base) && !/^(blob|data):/.test(r.url())) external.push(r.url()); });
  page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Parameter not found|Estimating resolution|Warning/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(base); await page.waitForSelector('.empty');

  await step('起動: 空の状態で開ける', async () => {
    assert(await page.evaluate(() => typeof window.LOCAL_STORE === 'object'), 'local runtime');
  });
  await step('名刺を端末内で読み取って登録（Claudeは使わない）', async () => {
    await page.click('.nav >> text=新規登録');
    assert((await page.textContent('.ocr-card')).includes('この端末内で文字を読み取って'), 'local text');
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ocr-card >> text=画像を取り込む')]);
    await ch.setFiles(card);
    await page.waitForSelector('text=読み取り結果を入力欄に反映しました', { timeout: 120000 });
    const name = await page.inputValue('input[data-key=name]');
    const company = await page.inputValue('input[data-key=companyName]');
    console.log('   読み取り:', JSON.stringify({ name, company }));
    if (!name) await page.fill('input[data-key=name]', '山田 太郎');
    if (!company) await page.fill('input[data-key=companyName]', '株式会社サンプル商事');
    await page.check('#ocr-confirm'); await page.click('text=この内容で登録');
    await page.waitForSelector('.receipt-text');
    assert(await page.locator('.card img').first().evaluate((i) => i.src.startsWith('blob:') && i.naturalWidth > 0), 'card image shown from device');
  });
  await step('顔写真を名刺から切り抜いて保存 → 端末内の画像で表示', async () => {
    await page.click('text=＋ 写真を追加');
    await page.click('dialog .thumb-btn');
    await page.waitForSelector('dialog .crop-canvas');
    await page.click('dialog >> text=この範囲で保存');
    await page.waitForSelector('text=写真を保存しました');
    await page.waitForFunction(() => { const i = document.querySelector('.person-head img.avatar'); return i && i.src.startsWith('blob:') && i.naturalWidth > 0; });
  });
  await step('メモを保存', async () => {
    await page.fill('.memo-text', '毎月末に領収証を依頼される');
    await page.click('button:text-is("メモを保存")');
    await page.waitForFunction(() => /保存済み/.test(document.querySelector('.memo-status')?.textContent || ''));
  });
  await step('再読み込みしても登録・画像・メモが残る（端末内に保存）', async () => {
    await page.reload(); await page.waitForSelector('#search-input');
    await page.fill('#search-input', '山田'); await page.waitForTimeout(300);
    await page.waitForSelector('.result-card img.avatar');
    assert(await page.locator('.result-card img.avatar').evaluate((i) => i.naturalWidth > 0), 'avatar after reload');
    await page.click('.result-card >> nth=0');
    assert((await page.inputValue('.memo-text')) === '毎月末に領収証を依頼される', 'memo kept');
  });
  await step('管理 → データ管理: スマホ保存の注意と保存状況を表示', async () => {
    await page.click('.nav >> text=管理'); await page.click('.segmented >> text=データ管理');
    await page.waitForSelector('text=このスマホ（このブラウザ）の中だけに保存されています');
    await page.waitForSelector('text=使用量:');
    assert(!(await page.innerText('body')).includes('claude.ai）の保存領域'), 'no artifact text');
    await page.screenshot({ path: path.join(out, 'pages-1-admin.png'), fullPage: true });
  });
  let exported;
  await step('JSONで書き出し → ファイルがダウンロードされる', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("JSONで書き出し")')]);
    exported = path.join(out, 'pages-export.json'); await dl.saveAs(exported);
    const j = JSON.parse(fs.readFileSync(exported, 'utf8'));
    assert(JSON.stringify(j).includes('サンプル商事'), 'export contents');
  });
  await step('別の端末（空の状態）に取り込める', async () => {
    const c2 = await b.newContext({ viewport: { width: 1200, height: 900 } }); const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push('p2 ' + e.message));
    await p2.goto(base); await p2.waitForSelector('.empty');
    await p2.click('.nav >> text=管理'); await p2.click('.segmented >> text=データ管理');
    const [ch] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('text=JSONファイルを選んで取り込む')]);
    await ch.setFiles(exported);
    await p2.click('dialog button:has-text("取り込む")');
    await p2.waitForSelector('text=取り込みました');
    await p2.click('.nav >> text=検索'); await p2.fill('#search-input', '山田'); await p2.waitForTimeout(300);
    assert((await p2.textContent('.result-list')).includes('サンプル商事'), 'imported');
    await c2.close();
  });
  await step('外部への通信がない（Googleフォント等も読み込まない）', async () => {
    assert(!external.length, external.join('\n'));
  });
  await step('スマホ表示: 横にはみ出さない・ホーム画面用の設定がある', async () => {
    const m = await b.newContext({ ...devices['iPhone 13'] }); const mp = await m.newPage();
    mp.on('pageerror', (e) => errors.push('mobile ' + e.message));
    await mp.goto(base); await mp.waitForSelector('.empty');
    assert(!(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'overflow');
    const man = await (await mp.request.get(base + 'manifest.webmanifest')).json();
    assert(man.display === 'standalone' && man.icons.length === 2, 'manifest');
    assert((await mp.request.get(base + 'apple-touch-icon.png')).ok(), 'icon');
    await mp.screenshot({ path: path.join(out, 'pages-2-mobile.png') });
    await m.close();
  });
  await step('JSエラーなし', async () => assert(!errors.length, errors.join('\n')));
  await b.close(); srv.close();
  console.log(`${results.filter(Boolean).length} / ${results.length} 合格`);
});
