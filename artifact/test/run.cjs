const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');
const dist = fs.readFileSync(path.join(__dirname, '../dist/receipt-search.html'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style><script>${mock}</script></head><body>${dist}</body></html>`;
const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'page.html'), html);
const card = path.resolve(__dirname, '../../test/fixtures/card1.png');
const results = []; const errors = [];
const step = async (name, fn) => { try { await fn(); results.push(true); console.log('✔', name); } catch (e) { results.push(false); console.log('✖', name, '\n  ', e.message.split('\n')[0]); await page.screenshot({ path: path.join(out, `FAIL-${results.length}.png`), fullPage: true }); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
let page;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  page = await ctx.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(m.text()); });
  await page.goto('file://' + path.join(out, 'page.html'));
  await page.evaluate(() => { window.__ocrResult = { readable: true, lines: ['株式会社サンプル商事', '営業部 部長', '山田 太郎', 'ヤマダ タロウ', 'TEL 03-1234-5678'],
    fields: { companyName: { value: '株式会社サンプル商事', confidence: 'high' }, name: { value: '山田 太郎', confidence: 'medium' }, nameKana: { value: 'ヤマダ タロウ', confidence: 'low', options: ['ヤマダ タロウ'] }, department: { value: '営業部', confidence: 'high' }, title: { value: '部長', confidence: 'high' }, phone: { value: '03-1234-5678', confidence: 'high' } } }; });
  await step('空の状態の案内', async () => { await page.waitForSelector('.empty'); await page.screenshot({ path: path.join(out, '01-empty.png') }); });
  await step('画像取り込み → Claude読み取り → 反映 → 確認必須 → 登録', async () => {
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=画像を取り込む')]);
    await ch.setFiles(card);
    await page.waitForSelector('text=読み取り結果を入力欄に反映しました');
    assert(await page.inputValue('input[data-key=name]') === '山田 太郎', 'name');
    assert(await page.inputValue('input[data-key=companyName]') === '株式会社サンプル商事', 'company');
    assert(await page.inputValue('input[data-key=nameKana]') === '', 'low の読みは入力しない');
    await page.click('.cand-box >> text=ヤマダ タロウ');
    await page.screenshot({ path: path.join(out, '02-ocr.png'), fullPage: true });
    await page.click('text=この内容で登録');
    await page.waitForSelector('.notice-error >> text=チェックを入れてください');
    await page.check('#ocr-confirm');
    await page.click('text=この内容で登録');
    await page.waitForSelector('.receipt-text');
    assert((await page.textContent('.receipt-text')) === '株式会社サンプル商事 山田 太郎 様', 'receipt');
    assert(await page.isVisible('.thumb'), 'image linked');
    await page.screenshot({ path: path.join(out, '03-detail.png'), fullPage: true });
  });
  await step('メモ自動保存', async () => {
    await page.fill('.memo-text', '但し書きは「お品代」');
    await page.waitForSelector('.memo-status.memo-saved', { timeout: 6000 });
    const saved = await page.evaluate(() => [...window.__docs].find(([p]) => p.startsWith('persons/'))[1].memo);
    assert(saved === '但し書きは「お品代」', 'memo in db');
  });
  await step('メモ保存失敗 → 未保存表示 → 再試行', async () => {
    await page.evaluate(() => { window.__dbFail = true; });
    await page.fill('.memo-text', '但し書きは「お品代」 追記: 通信切断中');
    await page.click('text=メモを保存');
    await page.waitForSelector('.memo-status.memo-error');
    await page.evaluate(() => { window.__dbFail = false; });
    await page.click('.memo-card button:has-text("再試行")');
    await page.waitForSelector('.memo-status.memo-saved');
  });
  await step('検索（名前・企業・読み・メモ・略記・誤字）', async () => {
    for (const [q, exp] of [['山田太郎', '山田'], ['サンプル', 'サンプル商事'], ['やまだ', '山田'], ['お品代', '山田'], ['株サンプル商事', 'サンプル商事'], ['山田太朗', '山田']]) {
      await page.click('.nav >> text=検索');
      await page.fill('#search-input', q); await page.waitForTimeout(300);
      const t = await page.$$eval('.result-card', (els) => els.map((e) => e.innerText));
      assert(t[0]?.includes(exp), `${q} → ${t[0]}`);
    }
    await page.screenshot({ path: path.join(out, '04-search.png'), fullPage: true });
  });
  await step('同じ企業に人物追加（候補選択）＋手入力宛名', async () => {
    await page.click('.nav >> text=新規登録');
    await page.fill('input[data-key=name]', '佐藤 花子');
    await page.fill('input[data-key=companyName]', 'サンプル');
    await page.click('.suggest-item >> nth=0');
    await page.waitForSelector('.company-status.ok');
    await page.fill('input[data-key=receiptName]', 'サンプル商事 経理部 佐藤様');
    await page.click('text=この内容で登録');
    await page.waitForSelector('.receipt-text');
    assert(await page.textContent('.receipt-text') === 'サンプル商事 経理部 佐藤様', 'manual receipt');
    assert((await page.textContent('.info')).includes('人物2名'), 'same company');
  });
  await step('同姓同名 → 別人として登録', async () => {
    await page.click('.nav >> text=新規登録');
    await page.fill('input[data-key=name]', '山田太郎');
    await page.click('text=この内容で登録');
    await page.waitForSelector('dialog >> text=同じ名前の登録情報があります');
    await page.click('dialog >> text=別人として登録する');
    await page.waitForSelector('text=同じ名前の登録情報が他に1件あります');
  });
  await step('同名企業の新規作成 → 既存に紐付け', async () => {
    await page.click('.nav >> text=新規登録');
    await page.fill('input[data-key=name]', '鈴木 一郎');
    await page.fill('input[data-key=companyName]', '(株)サンプル商事');
    await page.click('input[data-key=name]');
    await page.click('text=この内容で登録');
    await page.waitForSelector('dialog >> text=同じ（または似た）企業が登録済みです');
    await page.click('dialog >> text=この企業に紐付ける');
    await page.waitForSelector('.receipt-text');
    assert((await page.textContent('.info')).includes('人物3名'), 'linked');
  });
  await step('企業名変更 → 影響確認 → 宛名置換・旧名検索', async () => {
    await page.click('.info .linkish');
    await page.click('text=企業情報を編集');
    await page.fill('input[data-key=companyName]', '株式会社サンプルHD');
    await page.click('text=変更を保存');
    await page.waitForSelector('dialog >> text=企業名の変更による影響の確認');
    await page.click('dialog >> text=変更する');
    await page.waitForSelector('text=企業名の変更履歴');
    await page.click('.nav >> text=検索');
    await page.fill('#search-input', 'サンプル商事'); await page.waitForTimeout(300);
    const t = await page.$$eval('.result-card', (els) => els.map((e) => e.innerText));
    assert(t[0]?.includes('サンプルHD'), t[0]);
    await page.fill('#search-input', 'お品代'); await page.waitForTimeout(300);
    await page.click('.result-card >> nth=0');
    assert((await page.textContent('.receipt-text')).includes('サンプルHD'), 'receipt replaced');
  });
  await step('管理: 重複候補・企業削除防止・書き出し・読み推定', async () => {
    await page.click('.nav >> text=管理');
    await page.click('.segmented >> text=重複候補');
    await page.waitForSelector('.dup-group');
    await page.click('.segmented >> text=企業一覧');
    await page.click('.table >> text=削除');
    await page.waitForSelector('.toast-error >> text=削除できません');
    await page.click('.segmented >> text=データ管理');
    await page.click('text=CSVで書き出し');
    await page.waitForFunction(() => window.__saved?.filename.endsWith('.csv'));
    await page.click('text=JSONで書き出し');
    await page.waitForFunction(() => window.__saved?.filename.endsWith('.json'));
    await page.click('text=読みを推定する');
    await page.waitForSelector('text=件の読みを推定しました');
    await page.screenshot({ path: path.join(out, '05-admin.png'), fullPage: true });
  });
  await step('取り込み（PC版形式）', async () => {
    const json = { format: 'receipt-search-export', companies: [{ id: 1, name: '有限会社みどり商店', name_kana: '', keywords: '', receipt_name: '', memo: '' }], persons: [{ id: 1, company_id: 1, name: '緑川 葉子', name_kana: 'ミドリカワ ヨウコ', keywords: '', receipt_name: '', memo: 'PC版のメモ' }] };
    const f = path.join(out, 'import.json'); fs.writeFileSync(f, JSON.stringify(json));
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=JSONファイルを選んで取り込む')]);
    await ch.setFiles(f);
    await page.click('dialog button:has-text("取り込む")');
    await page.waitForSelector('text=人物1件を取り込みました');
    await page.click('.nav >> text=検索');
    await page.fill('#search-input', 'みどりかわ'); await page.waitForTimeout(300);
    assert((await page.$$eval('.result-card', (els) => els.map((e) => e.innerText)))[0]?.includes('みどり商店'), 'imported search');
  });
  await step('人物の削除', async () => {
    await page.click('.result-card >> nth=0');
    await page.click('.form-actions >> text=削除');
    await page.click('dialog >> text=削除する');
    await page.waitForSelector('#search-input');
  });
  await step('画像の保存に失敗しても登録は保存される', async () => {
    await page.evaluate(() => { window.__assetFail = true; });
    await page.click('.nav >> text=新規登録');
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ocr-card >> text=画像を取り込む')]);
    await ch.setFiles(path.resolve(__dirname, '../../test/fixtures/card2.png'));
    await page.waitForSelector('text=読み取り結果を入力欄に反映しました');
    await page.fill('input[data-key=name]', '画像失敗 テスト');
    await page.check('#ocr-confirm');
    await page.click('text=この内容で登録');
    await page.waitForSelector('text=画像なしで保存します', { timeout: 5000 });
    await page.waitForSelector('.receipt-text');
    assert(await page.textContent('.receipt-text') !== '', 'saved');
    await page.evaluate(() => { window.__assetFail = false; });
  });
  await step('保存権限のないアカウントには案内を表示', async () => {
    await page.evaluate(() => localStorage.setItem('canWrite', 'no'));
    await page.reload();
    await page.waitForSelector('#perm-banner:not([hidden])');
    await page.screenshot({ path: path.join(out, '07-perm.png') });
    await page.evaluate(() => localStorage.removeItem('canWrite'));
  });
  await step('スマホ表示・横スクロールなし', async () => {
    const m = await b.newContext({ ...devices['iPhone 13'] }); const mp = await m.newPage();
    mp.on('pageerror', (e) => errors.push('mobile ' + e.message));
    await mp.goto('file://' + path.join(out, 'page.html'));
    await mp.waitForSelector('.empty');
    assert(!(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'overflow');
    await mp.screenshot({ path: path.join(out, '06-mobile.png'), fullPage: true });
    await m.close();
  });
  await step('JSエラーなし', async () => assert(!errors.length, errors.join('\n')));
  await b.close();
  console.log(`${results.filter(Boolean).length} / ${results.length} 合格`);
})();
