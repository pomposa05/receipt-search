// ブラウザ操作による総合テスト（実サーバー・実OCRを使用）
// 実行: npm run test:e2e   スクリーンショット: test/e2e/out/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { config as baseConfig } from '../../server/config.js';
import { createApp } from '../../server/app.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../fixtures');
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    await (globalThis.activePage || page).screenshot({ path: path.join(out, `FAIL-${results.length}.png`), fullPage: true }).catch(() => {});
    console.log(`✖ ${name}\n   ${e.message.split('\n')[0]}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-e2e-'));
const app = createApp({ ...baseConfig, dataDir });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${app.server.address().port}`;
await app.ocrProvider.warmUp();

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write', 'camera'], { origin: BASE });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const shot = (name, p = page) => p.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
let nav = 0;
// 画面を読み込み直して移動（前の手順が失敗して未保存確認が出たままでも次の手順に影響させない）
const go = (hash) => page.goto(`${BASE}/?n=${++nav}${hash}`);
const search = async (q) => {
  await go('#/');
  await page.fill('#search-input', q);
  await page.waitForTimeout(450);
};
const resultTexts = () => page.$$eval('.result-card', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));

await step('ホーム画面: 未登録時の案内と主要ボタン', async () => {
  await go(`#/`);
  await page.waitForSelector('.empty');
  for (const t of ['新規登録', 'カメラで撮影', '画像を取り込む']) assert(await page.isVisible(`text=${t}`), `${t} ボタンがない`);
  await shot('01-home-empty');
});

let personId;
await step('画像取り込み → OCR → 入力欄へ反映 → 確認チェック必須 → 保存', async () => {
  await go(`#/`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=画像を取り込む')]);
  await chooser.setFiles(path.join(fixtures, 'card1.png'));
  await page.waitForURL(/#\/new/);
  await page.waitForSelector('text=読み取り結果を入力欄に反映しました', { timeout: 60000 });
  assert((await page.inputValue('#f-name')).replace(/\s/g, '') === '山田太郎', `名前: ${await page.inputValue('#f-name')}`);
  assert(await page.inputValue('#f-companyName') === '株式会社サンプル商事', '企業名');
  assert(await page.inputValue('#f-department') === '営業部', '部署');
  assert(await page.inputValue('#f-title') === '部長', '役職');
  assert(await page.$eval('#f-name', (e) => e.classList.contains('ocr-filled')), 'OCR反映の強調表示');
  assert((await page.inputValue('#f-receiptName')).includes('株式会社サンプル商事 山田'), '宛名の自動作成');
  // 読みの候補をタップして入力
  await page.click('.cand-box >> text=ヤマダ タロウ');
  assert(await page.inputValue('#f-nameKana') === 'ヤマダ タロウ', '読み候補の反映');
  await shot('02-ocr-result');
  // 確認チェックなしでは保存できない
  await page.click('text=この内容で登録');
  await page.waitForSelector('.notice-error >> text=読み取り結果を画像と見比べて確認しました');
  await page.check('#ocr-confirm');
  await page.click('text=この内容で登録');
  await page.waitForURL(/#\/person\/\d+$/);
  personId = Number(page.url().match(/person\/(\d+)/)[1]);
  await page.waitForSelector('.receipt-text');
  assert((await page.textContent('.receipt-text')).includes('株式会社サンプル商事 山田'), '詳細に宛名');
  assert(await page.isVisible('.thumb'), '取り込み元画像が紐付く');
  await shot('03-detail');
});

await step('名前・企業名・読み・部分一致・表記揺れ・誤字で検索できる', async () => {
  const cases = [
    ['山田太郎', '山田'], ['株式会社サンプル商事', 'サンプル商事'], ['サンプル', 'サンプル商事'], ['やまだ', '山田'],
    ['山田', '山田'], ['株サンプル商事', 'サンプル商事'], ['ｻﾝﾌﾟﾙ', 'サンプル商事'], ['ヤマダ　タロウ', '山田'], ['山田太朗', '山田'],
  ];
  for (const [q, expect] of cases) {
    await search(q);
    const texts = await resultTexts();
    assert(texts.length && texts[0].includes(expect), `「${q}」→ ${texts[0] || '結果なし'}`);
  }
  await search('山田太朗');
  assert(await page.isVisible('text=候補・要確認'), '曖昧一致は候補表示');
  await shot('04-search-fuzzy');
  await search('株式会社サンプル商事');
  assert(await page.isVisible('.result-card.company >> text=山田'), '企業カードに関連人物');
  await shot('05-search-company');
});

await step('検索結果がない場合の案内', async () => {
  await search('該当しない名前ですよ');
  await page.waitForSelector('text=に該当する登録情報はありません');
  assert(await page.isVisible('text=を新規登録する'), '新規登録への案内');
});

await step('検索結果 → 詳細 → メモ自動保存・保存状態表示・再読み込み後も保持・追記', async () => {
  await search('やまだ');
  await page.click('.result-card >> nth=0');
  await page.waitForSelector('.memo-text');
  await page.fill('.memo-text', '領収証の但し書きは「お品代」。');
  await page.waitForSelector('.memo-status.memo-dirty');
  await page.waitForSelector('.memo-status.memo-saved', { timeout: 8000 });
  await page.reload();
  await page.waitForSelector('.memo-text');
  assert(await page.inputValue('.memo-text') === '領収証の但し書きは「お品代」。', 'メモが保持されない');
  await page.click('.memo-text');
  await page.keyboard.press('End');
  await page.keyboard.type('\n2026/11 追記: 宛名変更なし');
  await page.click('text=メモを保存');
  await page.waitForSelector('.memo-status.memo-saved');
  await page.reload();
  await page.waitForSelector('.memo-text');
  assert((await page.inputValue('.memo-text')).endsWith('追記: 宛名変更なし'), '追記が保持されない');
  await shot('06-memo-saved');
  await search('お品代');
  assert((await resultTexts())[0]?.includes('山田'), 'メモ内容で検索できない');
});

await step('メモ保存失敗（通信切断）→ 未保存表示・下書き保持 → 再試行で保存', async () => {
  await go(`#/person/${personId}`);
  await page.waitForSelector('.memo-text');
  await page.route('**/api/persons/*/memo', (r) => r.abort());
  await page.fill('.memo-text', '通信切断中に書いたメモ');
  await page.click('text=メモを保存');
  await page.waitForSelector('.memo-status.memo-error');
  assert((await page.textContent('.memo-status')).includes('未保存'), '未保存の表示');
  assert(await page.isVisible('#conn-banner'), '接続エラーの表示');
  await shot('07-memo-error');
  // 画面移動しようとすると確認が出る
  await page.click('.back');
  await page.waitForSelector('dialog >> text=メモが保存されていません');
  await page.click('dialog >> text=この画面に残る');
  await page.unroute('**/api/persons/*/memo');
  await page.click('.memo-card button:has-text("再試行")');
  await page.waitForSelector('.memo-status.memo-saved');
  assert(await page.isHidden('#conn-banner'), '接続回復で表示が消える');
});

await step('同じ企業へ人物を追加（企業候補から選択・IDで紐付け）', async () => {
  await go(`#/new`);
  await page.fill('#f-name', '佐藤 花子');
  await page.fill('#f-companyName', 'サンプル商事');
  await page.waitForSelector('.suggest-item');
  await page.click('.suggest-item >> nth=0');
  await page.waitForSelector('.company-status.ok');
  // 回帰テスト: 手入力した領収証宛名がそのまま保存されること
  await page.fill('#f-receiptName', '株式会社サンプル商事 経理部 佐藤様');
  await page.click('text=この内容で登録');
  await page.waitForURL(/#\/person\/\d+$/);
  await page.waitForSelector('.receipt-text');
  assert(await page.textContent('.receipt-text') === '株式会社サンプル商事 経理部 佐藤様', `手入力の宛名: ${await page.textContent('.receipt-text')}`);
  await page.click('.info a[href^="#/company/"]');
  await page.waitForSelector('text=この企業の人物（2名）');
  await shot('08-company-detail');
});

await step('同姓同名の確認ダイアログ → 別人として登録 → 区別して表示', async () => {
  await go(`#/new`);
  await page.fill('#f-name', '山田太郎');
  await page.fill('#f-companyName', '合同会社テスト技研');
  await page.click('text=この内容で登録');
  await page.waitForSelector('dialog >> text=同じ名前の登録情報があります');
  await shot('09-duplicate-dialog');
  await page.click('dialog >> text=別人として登録する');
  await page.waitForURL(/#\/person\/\d+$/);
  await page.waitForSelector('text=同じ名前の登録情報が他に1件あります');
  await search('山田太郎');
  const texts = await resultTexts();
  assert(texts.length === 2 && texts.some((t) => t.includes('サンプル商事')) && texts.some((t) => t.includes('テスト技研')), texts.join(' / '));
});

await step('同名企業を新規作成しようとすると既存企業の選択を促す', async () => {
  await go(`#/new`);
  await page.fill('#f-name', '鈴木 一郎');
  await page.fill('#f-companyName', '(株)サンプル商事');
  await page.click('#f-name'); // 候補を閉じて選択しないまま保存
  await page.click('text=この内容で登録');
  await page.waitForSelector('dialog >> text=同じ（または似た）企業が登録済みです');
  await page.click('dialog >> text=この企業に紐付ける');
  await page.waitForURL(/#\/person\/\d+$/);
  assert((await page.textContent('.info')).includes('人物3名'), '既存企業に紐付かない');
});

await step('企業名の変更 → 影響確認ダイアログ → 宛名を置換', async () => {
  await search('サンプル商事');
  await page.click('.result-card.company .rc-link');
  await page.click('text=企業情報を編集');
  await page.fill('#f-companyName', '株式会社サンプルホールディングス');
  await page.click('text=変更を保存');
  await page.waitForSelector('dialog >> text=企業名の変更による影響の確認');
  await shot('10-company-rename');
  await page.click('dialog >> text=変更する');
  await page.waitForSelector('text=企業名の変更履歴');
  await go(`#/person/${personId}`);
  await page.waitForSelector('.receipt-text');
  assert((await page.textContent('.receipt-text')).includes('株式会社サンプルホールディングス'), '宛名が置換されていない');
  await search('サンプル商事');
  assert((await resultTexts())[0]?.includes('ホールディングス'), '旧企業名で検索できない');
});

await step('企業のみ登録（御中）', async () => {
  await go(`#/new?type=company`);
  await page.fill('#f-companyName', '有限会社みどり商店');
  assert(await page.inputValue('#f-receiptName') === '有限会社みどり商店 御中', '宛名の自動作成');
  await page.click('text=この内容で登録');
  await page.waitForURL(/#\/company\/\d+$/);
});

await step('非対応ファイル・文字のない画像のエラー案内', async () => {
  await go(`#/new`);
  let [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ocr-card >> text=画像を取り込む')]);
  await chooser.setFiles({ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForSelector('.ocr-card .notice-error >> text=対応していないファイル形式');
  [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ocr-card >> text=画像を取り込む')]);
  await chooser.setFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a jpeg') });
  await page.waitForSelector('.ocr-card .notice-error >> text=画像を読み込めませんでした');
  [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ocr-card >> text=画像を取り込む')]);
  await chooser.setFiles(path.join(fixtures, 'blank.png'));
  await page.waitForSelector('text=画像から文字を読み取れませんでした', { timeout: 60000 });
  assert(await page.inputValue('#f-name') === '', '推測で入力しない');
  await shot('11-ocr-unreadable');
});

await step('同じ画像の重複取り込みを警告', async () => {
  await go(`#/new`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ocr-card >> text=画像を取り込む')]);
  await chooser.setFiles(path.join(fixtures, 'card1.png'));
  await page.waitForSelector('text=この画像は既に取り込まれています', { timeout: 60000 });
});

await step('カメラ撮影（PCのブラウザ内カメラ）→ 撮影画像でOCR', async () => {
  await go(`#/new`);
  await page.click('.ocr-card >> text=カメラで撮影');
  await page.waitForSelector('.dlg-camera video');
  await page.waitForFunction(() => document.querySelector('.dlg-camera video')?.videoWidth > 0, null, { timeout: 10000 });
  await shot('12-camera');
  await page.click('.dlg-camera >> text=撮影する');
  await page.waitForSelector('.ocr-preview:not([hidden])');
  await page.waitForSelector('.ocr-status .notice', { timeout: 60000 });
});

await step('カメラが使えない環境では画像取り込みを案内', async () => {
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); });
  await p2.goto(`${BASE}/#/new`);
  await p2.click('.ocr-card >> text=カメラで撮影');
  await p2.waitForSelector('dialog >> text=カメラを使用できません');
  assert(await p2.isVisible('dialog >> text=画像を選ぶ'), '画像選択への案内');
  await ctx2.close();
});

await step('未保存の入力がある登録画面から離れると確認', async () => {
  await go(`#/new`);
  await page.fill('#f-name', '入力途中');
  await page.click('.nav >> text=検索');
  await page.waitForSelector('dialog >> text=入力内容が保存されていません');
  await page.click('dialog >> text=キャンセル');
  assert(page.url().includes('#/new'), '画面に残る');
  assert(await page.inputValue('#f-name') === '入力途中', '入力が保持される');
  await page.click('.nav >> text=検索');
  await page.click('dialog >> text=破棄して移動');
  await page.waitForSelector('#search-input');
});

await step('保存失敗（通信切断）時に入力内容を保持してエラー表示', async () => {
  await go(`#/new`);
  await page.fill('#f-name', '通信テスト');
  await page.route('**/api/persons', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
  await page.click('text=この内容で登録');
  await page.waitForSelector('.notice-error >> text=保存できませんでした');
  assert(await page.inputValue('#f-name') === '通信テスト', '入力が消えた');
  await page.unroute('**/api/persons');
  await page.click('text=この内容で登録');
  await page.waitForURL(/#\/person\/\d+$/);
});

await step('管理画面: 一覧・重複候補・削除・人物が紐付く企業の削除防止', async () => {
  await go(`#/admin`);
  await page.waitForSelector('.table tbody tr');
  await shot('13-admin');
  await go(`#/admin?tab=duplicates`);
  await page.waitForSelector('.dup-group >> text=同じ企業に同名あり', { state: 'attached', timeout: 3000 }).catch(() => {});
  assert(await page.isVisible('.dup-group'), '重複候補が表示されない');
  await shot('14-duplicates');
  await go(`#/admin?tab=persons`);
  await page.fill('.toolbar input', '通信テスト');
  await page.waitForFunction(() => document.querySelectorAll('.table tbody tr').length === 1 && document.querySelector('.table tbody').innerText.includes('通信テスト'));
  await page.click('.table >> text=削除');
  await page.click('dialog >> text=削除する');
  await page.waitForSelector('text=削除しました');
  await go(`#/admin?tab=companies`);
  await page.fill('.toolbar input', 'ホールディングス');
  await page.waitForFunction(() => document.querySelectorAll('.table tbody tr').length === 1 && document.querySelector('.table tbody').innerText.includes('ホールディングス'));
  await page.click('.table >> text=削除');
  await page.waitForSelector('.toast-error >> text=削除できません');
  await go(`#/admin?tab=data`);
  await page.waitForSelector('.stat-num');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=CSVで書き出し')]);
  assert((await dl.suggestedFilename()).endsWith('.csv'), 'CSV');
});

await step('宛名のコピー', async () => {
  await go(`#/person/${personId}`);
  await page.click('.receipt-card >> text=コピー');
  await page.waitForSelector('text=コピーしました');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip.includes('山田'), `クリップボード: ${clip}`);
});

await step('スマートフォン表示（iPhone）: 検索・詳細・登録', async () => {
  const m = await browser.newContext({ ...devices['iPhone 13'], locale: 'ja-JP' });
  const mp = await m.newPage();
  globalThis.activePage = mp;
  mp.on('pageerror', (e) => pageErrors.push(`mobile: ${e.message}`));
  await mp.goto(`${BASE}/#/?q=${encodeURIComponent('やまだ')}`);
  await mp.waitForSelector('.result-card');
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, '横スクロールが発生');
  await mp.screenshot({ path: path.join(out, '15-mobile-search.png'), fullPage: true });
  await mp.tap('.result-card >> nth=0');
  await mp.waitForSelector('.memo-text');
  await mp.screenshot({ path: path.join(out, '16-mobile-detail.png'), fullPage: true });
  await mp.goto(`${BASE}/#/new`);
  await mp.waitForSelector('#f-name');
  // スマホではカメラボタンが端末カメラ（capture属性付きの入力）を起動する
  const [chooser] = await Promise.all([mp.waitForEvent('filechooser'), mp.tap('.ocr-card >> text=カメラで撮影')]);
  assert(await chooser.element().getAttribute('capture') === 'environment', 'capture属性');
  await mp.screenshot({ path: path.join(out, '17-mobile-register.png'), fullPage: true });
  await m.close();
  globalThis.activePage = null;
});

await step('ブラウザのJavaScriptエラーがない', async () => {
  assert(pageErrors.length === 0, pageErrors.join('\n'));
});

await browser.close();
await app.close();
fs.rmSync(dataDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 合格`);
process.exit(failed.length ? 1 : 0);
