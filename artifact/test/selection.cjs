// まとめて選択 → 宛名の一括表示のテスト
const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');
const out = path.join(__dirname, 'out');
const dist = fs.readFileSync(path.join(__dirname, '../dist/receipt-search.html'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
fs.writeFileSync(path.join(out, 'page-sel.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style><script>${mock}</script></head><body>${dist}</body></html>`);
const pagePath = 'file://' + path.join(out, 'page-sel.html');
const results = []; const errors = []; let page;
const step = async (name, fn) => { try { await fn(); results.push(1); console.log('✔', name); } catch (e) { results.push(0); console.log('✖', name, '\n  ', e.message.split('\n')[0]); await page.screenshot({ path: path.join(out, `SEL-FAIL-${results.length}.png`), fullPage: true }); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  page = await ctx.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pagePath); await page.waitForSelector('.empty');

  await step('準備: グループ「青年部」に4人を一括登録', async () => {
    await page.click('.nav >> text=新規登録'); await page.click('.segmented >> text=一覧から一括登録');
    await page.fill('#bulk-text', '株式会社サンプル商事\t山田さん\n株式会社サンプル商事\t佐藤くん\n有限会社テスト工房\t鈴木さん\n合同会社みなと\t高橋さん');
    await page.fill('.gnew input', '青年部'); await page.click('text=＋ 作成して追加');
    await page.waitForSelector('.gtoggle.on >> text=青年部');
    await page.click('text=表に分ける'); await page.click('text=③ 確認へ進む');
    await page.check('#bulk-confirm'); await page.click('button:has-text("件を登録する")');
    await page.waitForSelector('text=4件を登録しました');
  });
  await step('選択していない間は選択バーを出さない', async () => {
    await page.click('.nav >> text=検索');
    assert(await page.isHidden('.sel-bar'), 'bar hidden');
  });
  await step('グループで絞り込み → 2人を選択 → バーに2件', async () => {
    await page.click('.gfilter button:has-text("青年部")');
    await page.waitForSelector('.result-summary >> text=4件');
    const cards = page.locator('.result-list > li');
    await cards.nth(0).locator('.sel-cb').check();
    await cards.nth(2).locator('.sel-cb').check();
    await page.waitForSelector('.sel-bar:not([hidden])');
    assert((await page.textContent('.sel-count')).includes('2件'), await page.textContent('.sel-count'));
    await page.screenshot({ path: path.join(out, 'sel-1-bar.png'), fullPage: true });
  });
  await step('別の検索でも選択は残り、追加で選べる', async () => {
    await page.click('.gfilter button:has-text("すべて")');
    await page.fill('#search-input', '高橋'); await page.waitForTimeout(300);
    await page.locator('.result-list > li').first().locator('.sel-cb').check();
    assert((await page.textContent('.sel-count')).includes('3件'), 'count 3');
  });
  await step('対象を表示 → ポップアップに宛名・人物・企業名を一括表示', async () => {
    await page.click('.sel-bar >> text=対象を表示');
    await page.waitForSelector('dialog .sel-list');
    const items = await page.$$eval('dialog .sel-item', (e) => e.map((x) => x.innerText));
    assert(items.length === 3, `items ${items.length}`);
    assert(items.every((t) => t.indexOf('宛名') < t.indexOf('人物') && t.indexOf('人物') < t.indexOf('企業名')), 'order');
    assert(items[2].includes('合同会社みなと 様') && items[2].includes('高橋さん'), items[2]);
    await page.screenshot({ path: path.join(out, 'sel-2-popup.png'), fullPage: true });
  });
  await step('すべての宛名をコピー・1件ずつコピー', async () => {
    await page.click('dialog >> text=すべての宛名をコピー');
    let clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip.split('\n').length === 3 && clip.split('\n')[2] === '合同会社みなと 様', clip);
    await page.click('dialog .sel-item >> nth=0 >> text=コピー');
    clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(!clip.includes('\n') && clip.endsWith('様'), clip);
    await page.click('dialog >> text=人物・企業名つきでコピー');
    clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip.split('\n')[2] === '合同会社みなと 様\t高橋さん\t合同会社みなと', clip);
  });
  await step('発行済みの印 → 閉じて開き直しても残る', async () => {
    await page.check('dialog .sel-item >> nth=0 >> .sel-done input');
    await page.waitForSelector('dialog .sel-item.is-done');
    assert((await page.textContent('dialog')).includes('発行済み 1件'), 'summary');
    await page.click('dialog button:text-is("閉じる")');
    await page.click('.sel-bar >> text=対象を表示');
    assert(await page.locator('dialog .sel-item.is-done').count() === 1, 'kept');
  });
  await step('ポップアップで「外す」→ 件数が減る', async () => {
    await page.click('dialog .sel-item >> nth=1 >> text=外す');
    assert(await page.locator('dialog .sel-item').count() === 2, 'removed');
    await page.click('dialog button:text-is("閉じる")');
    assert((await page.textContent('.sel-count')).includes('2件'), 'bar 2');
  });
  await step('グループ画面: すべて選択 → 4件', async () => {
    await page.click('.nav >> text=管理'); await page.click('.segmented >> text=グループ');
    await page.click('.gm-row:has-text("青年部") >> text=開く');
    await page.click('.card-head >> text=すべて選択');
    assert((await page.textContent('.sel-count')).includes('4件'), await page.textContent('.sel-count'));
    assert(await page.locator('.gm-row .sel-cb:checked').count() === 4, 'all checked');
  });
  await step('選択を解除 → バーが消え、チェックも外れる', async () => {
    await page.click('.sel-bar >> text=選択を解除');
    await page.waitForSelector('.sel-bar[hidden]', { state: 'attached' });
    assert(await page.locator('.gm-row .sel-cb:checked').count() === 0, 'unchecked');
  });
  await step('選択はタブ内に保存される（再読み込みしても残る）', async () => {
    await page.locator('.gm-row').first().locator('.sel-cb').check();
    // 模擬データベースは再読み込みで消えるため、タブ内の保存内容を確認する
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('receipt-selection') || '[]'));
    assert(saved.length === 1 && saved[0].type === 'person', JSON.stringify(saved));
  });
  await step('スマホ: 選択バーとポップアップが画面内に収まる', async () => {
    const m = await b.newContext({ ...devices['iPhone 13'] }); const mp = await m.newPage();
    mp.on('pageerror', (e) => errors.push('mobile ' + e.message));
    await mp.goto(pagePath); await mp.waitForSelector('.empty');
    await mp.tap('.nav >> text=新規登録');
    await mp.fill('input[data-key=name]', '伊藤さん'); await mp.fill('input[data-key=companyName]', '株式会社長い名前のテスト企業ホールディングス');
    await mp.tap('input[data-key=name]');
    await mp.tap('text=この内容で登録'); await mp.waitForSelector('.receipt-text');
    await mp.tap('.nav >> text=検索'); await mp.fill('#search-input', '伊藤'); await mp.waitForTimeout(300);
    await mp.locator('.result-list > li').first().locator('.sel-cb').tap();
    await mp.tap('.sel-bar >> text=対象を表示');
    await mp.waitForSelector('dialog .sel-item');
    assert(!(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'overflow');
    await mp.screenshot({ path: path.join(out, 'sel-3-mobile.png') });
    await m.close();
  });
  await step('JSエラーなし', async () => assert(!errors.length, errors.join('\n')));
  await b.close();
  console.log(`${results.filter(Boolean).length} / ${results.length} 合格`);
})();
