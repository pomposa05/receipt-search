const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');
const out = path.join(__dirname, 'out');
const pagePath = 'file://' + path.join(out, 'page.html');
// run.cjs と同じ組み立てでページを作る
const dist = fs.readFileSync(path.join(__dirname, '../dist/receipt-search.html'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
fs.writeFileSync(path.join(out, 'page.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style><script>${mock}</script></head><body>${dist}</body></html>`);
const results = []; const errors = [];
let page;
const step = async (name, fn) => { try { await fn(); results.push(1); console.log('✔', name); } catch (e) { results.push(0); console.log('✖', name, '\n  ', e.message.split('\n')[0]); await page.screenshot({ path: path.join(out, `BULK-FAIL-${results.length}.png`), fullPage: true }); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const docs = () => page.evaluate(() => [...window.__docs].map(([p, d]) => ({ p, ...d })));
(async () => {
  const b = await chromium.launch();
  page = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pagePath);
  await page.waitForSelector('.empty');
  await step('準備: 既存の企業と人物を1件登録', async () => {
    await page.click('.nav >> text=新規登録');
    await page.fill('input[data-key=name]', '青木さん');
    await page.fill('input[data-key=companyName]', '株式会社あおば設備');
    await page.click('text=この内容で登録');
    await page.waitForSelector('.receipt-text');
  });
  await step('① 貼り付け → 表に分ける', async () => {
    await page.click('.nav >> text=新規登録');
    await page.click('.segmented >> text=一覧から一括登録');
    const text = ['株式会社あおば設備\t青木さん', '（有）さくら園芸\tけんくん', '（有）インテリアみなと\t北野さん　ジョー', '東西テレビ（株）南支局', 'みなみビジョン\t森下', 'コンビニ南町店　大川さん', '（株）丸山,田中さん', '（有）さくら園芸\tゆうくん'].join('\n');
    await page.fill('#bulk-text', text);
    await page.fill('#bulk-keywords', '青年部');
    await page.click('text=表に分ける');
    await page.waitForSelector('.bulk-table tbody tr');
    const n = await page.$$eval('.bulk-table tbody tr', (t) => t.length);
    assert(n === 8, `rows ${n}`);
    await page.screenshot({ path: path.join(out, 'bulk-1-table.png'), fullPage: true });
  });
  await step('② 既存企業の紐付け表示・同名人物は初期で除外・区切りなし行は要確認', async () => {
    const rows = await page.$$eval('.bulk-table tbody tr', (t) => t.map((r) => ({ text: r.innerText, checked: r.querySelector('input[type=checkbox]').checked, sel: r.querySelector('select')?.value || '' })));
    assert(rows[0].sel.startsWith('C') && !rows[0].checked, `row1 ${JSON.stringify(rows[0])}`);
    assert(rows[3].text.includes('要確認'), 'row4 uncertain');
    assert(rows[2].checked, 'row3');
  });
  await step('② 2行に分かれたセルを「上と結合」', async () => {
    await page.click('.bulk-table tbody tr:nth-child(5) >> text=上と結合');
    const v = await page.$$eval('.bulk-table tbody tr:nth-child(4) input.input', (i) => i.map((x) => x.value));
    assert(v[0] === '東西テレビ（株）南支局 みなみビジョン' && v[1] === '森下', JSON.stringify(v));
  });
  await step('③ 確認画面: チェックするまで登録できない', async () => {
    await page.click('text=③ 確認へ進む');
    await page.waitForSelector('.confirm-card');
    const btn = page.locator('button:has-text("件を登録する")');
    assert(await btn.isDisabled(), 'should be disabled');
    const txt = await page.textContent('.confirm-card');
    assert(txt.includes('登録済み'), 'link label');
    assert(txt.includes('（有）インテリアみなと 様'), 'receipt');
    const nums = await page.$$eval('.confirm-card .stat-num', (e) => e.map((x) => x.textContent));
    assert(JSON.stringify(nums) === JSON.stringify(['6', '5', '0', '1']), `stats ${nums}`);
    await page.screenshot({ path: path.join(out, 'bulk-2-confirm.png'), fullPage: true });
  });
  await step('③ 戻って修正 → 内容が残っている', async () => {
    await page.click('text=← 戻って修正する');
    await page.waitForSelector('.bulk-table');
    assert((await page.$$eval('.bulk-table tbody tr', (t) => t.length)) === 7, 'rows kept');
    await page.click('text=③ 確認へ進む');
  });
  await step('④ 登録 → 保存内容（同じ一覧の同名企業は1社にまとめる・敬称そのまま）', async () => {
    await page.check('#bulk-confirm');
    await page.click('button:has-text("件を登録する")');
    await page.waitForSelector('text=6件を登録しました');
    const d = await docs();
    const comps = d.filter((x) => x.p.startsWith('companies/'));
    const pers = d.filter((x) => x.p.startsWith('persons/'));
    assert(comps.length === 1 + 5, `companies ${comps.length}`);
    assert(pers.length === 1 + 6, `persons ${pers.length}`);
    const kanryu = comps.filter((c) => c.name === '（有）さくら園芸');
    assert(kanryu.length === 1, 'kanryu once');
    assert(pers.filter((p) => p.companyId === kanryu[0].p.split('/')[1]).length === 2, 'two persons in さくら園芸');
    const karino = pers.find((p) => p.name === '北野さん ジョー');
    assert(karino && karino.keywords === '青年部' && karino.receiptName === '（有）インテリアみなと 様', JSON.stringify(karino));
    await page.screenshot({ path: path.join(out, 'bulk-3-done.png'), fullPage: true });
  });
  await step('検索で確認（キーワード「青年部」）', async () => {
    await page.click('text=検索画面で確認する');
    await page.waitForSelector('.result-card');
    const n = await page.$$eval('.result-list > li', (e) => e.length);
    assert(n >= 6, `results ${n}`);
  });
  await step('一覧の画像 → Claude読み取り → 表（判読に迷う行は要確認）', async () => {
    await page.evaluate(() => { window.__listResult = { rows: [{ company: '安田産業（株）', name: '小林さん', uncertain: true }, { company: '?電気（株）', name: '石井さん', uncertain: true }, { company: '寺島工業（株）', name: '寺島さん', uncertain: false }] }; });
    await page.click('.nav >> text=新規登録');
    await page.click('.segmented >> text=一覧から一括登録');
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=一覧の画像（スクリーンショット）を読み取る')]);
    await ch.setFiles(path.resolve(__dirname, '../../test/fixtures/card1.png'));
    await page.waitForSelector('.bulk-table tbody tr');
    const t = await page.$$eval('.bulk-table tbody tr', (r) => r.map((x) => x.innerText));
    assert(t.length === 3 && t[0].includes('要確認') && t[1].includes('要確認') && !t[2].includes('要確認'), t.join('|'));
  });
  await step('「?」を含む行: 要確認・色付き・強調 → 直すと消える', async () => {
    // 直前の手順で読み取った表（2行目が「?電気（株）」）
    const row2 = page.locator('.bulk-table tbody tr:nth-child(2)');
    assert((await row2.innerText()).includes('読めなかった文字があります'), 'unknown note');
    assert(await row2.locator('mark.unknown-char').count() === 1, 'mark');
    assert(await row2.locator('input.has-unknown').count() === 1, 'has-unknown class');
    await page.screenshot({ path: path.join(out, 'bulk-5-unknown.png'), fullPage: true });
    // 確認画面: 「?」が残っている件数を表示
    await page.click('text=③ 確認へ進む');
    await page.waitForSelector('.confirm-card');
    const t = await page.textContent('.confirm-card');
    assert(t.includes('読めなかった文字「?」が残っています') && t.includes('「?」が残っている1件も'), 'confirm unknown');
    assert(await page.locator('.confirm-card mark.unknown-char').count() >= 2, 'confirm marks');
    await page.screenshot({ path: path.join(out, 'bulk-6-confirm-unknown.png'), fullPage: true });
    await page.click('text=← 戻って修正する');
    // 直す
    const ci = page.locator('.bulk-table tbody tr:nth-child(2) input.input').first();
    await ci.fill('森田電気（株）'); await ci.press('Tab');
    const after = await page.locator('.bulk-table tbody tr:nth-child(2)').innerText();
    assert(!after.includes('要確認') && !after.includes('読めなかった'), after);
  });
  await step('1件ずつの登録: 「?」を含む読み取り結果は入力せず候補 → 選ぶと警告 → 保存前に確認', async () => {
    await page.evaluate(() => { window.__ocrResult = { readable: true, lines: ['株式会社テスト', '山?太郎'], fields: { companyName: { value: '株式会社テスト', confidence: 'high' }, name: { value: '山?太郎', confidence: 'high' } } }; });
    await page.click('.segmented >> text=人物を登録');
    await page.click('dialog button:has-text("切り替える")').catch(() => {});
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ocr-card >> text=画像を取り込む')]);
    await ch.setFiles(path.resolve(__dirname, '../../test/fixtures/card1.png'));
    await page.waitForSelector('text=読み取り結果を入力欄に反映しました');
    assert(await page.inputValue('input[data-key=name]') === '', 'not filled');
    assert((await page.textContent('.form')).includes('読めない文字（?）を含むため入力していません'), 'reason');
    assert(await page.locator('.ocr-line-text mark.unknown-char').count() === 1, 'line mark');
    await page.click('.cand-box button.chip:has-text("太郎")');
    assert(await page.isVisible('.field-unknown'), 'field warning');
    await page.screenshot({ path: path.join(out, 'single-unknown.png'), fullPage: true });
    await page.check('#ocr-confirm');
    await page.click('text=この内容で登録');
    await page.waitForSelector('dialog >> text=読めなかった文字「?」が残っています');
    await page.click('dialog >> text=戻って直す');
    await page.fill('input[data-key=name]', '山田太郎');
    assert(await page.isHidden('.field-unknown'), 'warning cleared');
  });
  await step('スマホ表示で横スクロールなし', async () => {
    const m = await b.newContext({ ...devices['iPhone 13'] }); const mp = await m.newPage();
    await mp.goto(pagePath); await mp.waitForSelector('.empty');
    await mp.tap('.nav >> text=新規登録'); await mp.tap('.segmented >> text=一覧から一括登録');
    await mp.fill('#bulk-text', '（有）さくら園芸\tけんくん\n寺島工業（株）\t寺島さん');
    await mp.tap('text=表に分ける'); await mp.waitForSelector('.bulk-table');
    assert(!(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'overflow');
    await mp.screenshot({ path: path.join(out, 'bulk-4-mobile.png'), fullPage: true });
    await m.close();
  });
  await step('JSエラーなし', async () => assert(!errors.length, errors.join('\n')));
  await b.close();
  console.log(`${results.filter(Boolean).length} / ${results.length} 合格`);
})();
