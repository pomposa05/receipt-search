// 顔写真機能のテスト（HTTPで配信し、保存した画像 /_blob/ も返せるようにする）
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium, devices } = require('playwright');
const out = path.join(__dirname, 'out');
const dist = fs.readFileSync(path.join(__dirname, '../dist/receipt-search.html'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
const hook = `(() => { const orig = window.claude.use; window.claude.use = async (n) => { const cap = await orig(n); if (n !== 'assets' || !cap) return cap; return { ...cap, async upload(blob, o) { const r = await cap.upload(blob, o); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); if (window.__storeBlob) await window.__storeBlob(r.id, btoa(s)); window.__lastUpload = { id: r.id, size: blob.size, type: blob.type }; return r; } }; }; })();`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style><script>${mock}</script><script>${hook}</script></head><body>${dist}</body></html>`;
const card = fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/card1.png'));
const results = []; const errors = []; let page;
const step = async (name, fn) => { try { await fn(); results.push(1); console.log('✔', name); } catch (e) { results.push(0); console.log('✖', name, '\n  ', e.message.split('\n')[0]); await page.screenshot({ path: path.join(out, `PHOTO-FAIL-${results.length}.png`), fullPage: true }); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const blobs = new Map();
const srv = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  const m = req.url.match(/^\/_blob\/(\w+)/);
  if (m) { const b = blobs.get(m[1]) || card; res.writeHead(200, { 'content-type': blobs.has(m[1]) ? 'image/jpeg' : 'image/png' }); return res.end(b); }
  res.writeHead(404); res.end();
}).listen(0, async () => {
  const base = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch();
  page = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(e.message));
  // 模擬の assets.upload が保存した画像をサーバーにも渡す
  await page.exposeFunction('__storeBlob', (id, b64) => { blobs.set(id, Buffer.from(b64, 'base64')); });
  await page.goto(base); await page.waitForSelector('.empty');
  await page.evaluate(() => { window.__ocrResult = { readable: true, lines: ['株式会社サンプル商事', '山田 太郎'], fields: { companyName: { value: '株式会社サンプル商事', confidence: 'high' }, name: { value: '山田 太郎', confidence: 'high' } } }; });

  await step('準備: 名刺画像つきで人物を登録', async () => {
    await page.click('.nav >> text=新規登録');
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ocr-card >> text=画像を取り込む')]);
    await ch.setFiles(path.resolve(__dirname, '../../test/fixtures/card1.png'));
    await page.waitForSelector('text=読み取り結果を入力欄に反映しました');
    await page.check('#ocr-confirm'); await page.click('text=この内容で登録');
    await page.waitForSelector('.receipt-text');
    assert(await page.isVisible('.person-head .avatar-empty'), 'initial avatar');
  });
  await step('名刺画像から切り抜いて写真を保存 → 400×400', async () => {
    await page.click('text=＋ 写真を追加');
    await page.waitForSelector('dialog >> text=名刺画像から切り抜く');
    await page.click('dialog .thumb-btn');
    await page.waitForSelector('dialog .crop-canvas');
    await page.waitForTimeout(300);
    // 枠をドラッグして移動・大きさを変更
    const box = await page.locator('dialog .crop-canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 20); await page.mouse.up();
    await page.locator('#crop-size').fill('30');
    await page.screenshot({ path: path.join(out, 'photo-1-crop.png'), fullPage: true });
    await page.click('dialog >> text=この範囲で保存');
    await page.waitForSelector('text=写真を保存しました');
    const up = await page.evaluate(() => window.__lastUpload);
    assert(up && up.type === 'image/jpeg', JSON.stringify(up));
    const dim = await page.evaluate(async (id) => { const r = await fetch('/_blob/' + id); const bm = await createImageBitmap(await r.blob()); return [bm.width, bm.height]; }, up.id);
    assert(dim[0] === 400 && dim[1] === 400, dim.join('x'));
    const doc = await page.evaluate(() => [...window.__docs].find(([p]) => p.startsWith('persons/'))[1]);
    assert(doc.photo?.assetId === up.id, 'photo saved in db');
    await page.waitForSelector('.person-head img.avatar');
    await page.screenshot({ path: path.join(out, 'photo-2-detail.png'), fullPage: true });
  });
  await step('検索結果にも写真を表示', async () => {
    await page.click('.nav >> text=検索');
    await page.fill('#search-input', '山田'); await page.waitForTimeout(300);
    await page.waitForSelector('.result-card img.avatar');
    await page.screenshot({ path: path.join(out, 'photo-3-search.png'), fullPage: true });
  });
  await step('保存済みの画像から写真を変更（回転も）', async () => {
    await page.click('.result-card >> nth=0');
    await page.click('text=写真を変更 >> nth=0');
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('dialog >> text=保存済みの画像を選ぶ')]);
    await ch.setFiles(path.resolve(__dirname, '../../test/fixtures/card2.png'));
    await page.waitForSelector('dialog .crop-canvas');
    await page.click('dialog >> text=⟳ 回転');
    const before = await page.evaluate(() => window.__lastUpload.id);
    await page.click('dialog >> text=この範囲で保存');
    await page.waitForFunction((b) => window.__lastUpload.id !== b, before);
    await page.waitForFunction((b) => [...window.__docs].find(([p]) => p.startsWith('persons/'))[1].photo?.assetId === window.__lastUpload.id, before);
  });
  await step('切り抜きをキャンセルすると変更されない', async () => {
    const cur = await page.evaluate(() => [...window.__docs].find(([p]) => p.startsWith('persons/'))[1].photo.assetId);
    await page.click('text=写真を変更 >> nth=0');
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('dialog >> text=保存済みの画像を選ぶ')]);
    await ch.setFiles(path.resolve(__dirname, '../../test/fixtures/card1.png'));
    await page.waitForSelector('dialog .crop-canvas');
    await page.click('dialog >> text=キャンセル');
    const now = await page.evaluate(() => [...window.__docs].find(([p]) => p.startsWith('persons/'))[1].photo.assetId);
    assert(cur === now, 'unchanged');
  });
  await step('写真を削除', async () => {
    await page.click('text=写真を削除');
    await page.click('dialog button:has-text("削除する")');
    await page.waitForSelector('text=写真を削除しました');
    await page.waitForSelector('.person-head .avatar-empty');
    const doc = await page.evaluate(() => [...window.__docs].find(([p]) => p.startsWith('persons/'))[1]);
    assert(!doc.photo, 'removed');
  });
  await step('非対応ファイルは案内', async () => {
    await page.click('text=＋ 写真を追加');
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('dialog >> text=保存済みの画像を選ぶ')]);
    await ch.setFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await page.waitForSelector('.toast-error >> text=対応していないファイル形式');
  });
  await step('スマホ: 切り抜き画面が画面内に収まる', async () => {
    const m = await b.newContext({ ...devices['iPhone 13'] }); const mp = await m.newPage();
    await mp.addInitScript(() => {});
    await mp.goto(base); await mp.waitForSelector('.empty');
    await mp.tap('.nav >> text=新規登録');
    await mp.fill('input[data-key=name]', '写真 テスト'); await mp.tap('text=この内容で登録');
    await mp.waitForSelector('.receipt-text');
    await mp.tap('text=＋ 写真を追加');
    const [ch] = await Promise.all([mp.waitForEvent('filechooser'), mp.tap('dialog >> text=保存済みの画像を選ぶ')]);
    await ch.setFiles(path.resolve(__dirname, '../../test/fixtures/card1.png'));
    await mp.waitForSelector('dialog .crop-canvas'); await mp.waitForTimeout(300);
    const w = await mp.evaluate(() => [document.querySelector('dialog .crop-canvas').getBoundingClientRect().right, innerWidth]);
    assert(w[0] <= w[1], `canvas overflows ${w}`);
    await mp.screenshot({ path: path.join(out, 'photo-4-mobile.png') });
    await m.close();
  });
  await step('JSエラーなし', async () => assert(!errors.length, errors.join('\n')));
  await b.close(); srv.close();
  console.log(`${results.filter(Boolean).length} / ${results.length} 合格`);
});
