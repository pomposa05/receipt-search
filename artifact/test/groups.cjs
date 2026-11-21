// グループ分け機能のテスト（模擬ランタイムで実行）
const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');
const out = path.join(__dirname, 'out');
const dist = fs.readFileSync(path.join(__dirname, '../dist/receipt-search.html'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
fs.writeFileSync(path.join(out, 'page.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style><script>${mock}</script></head><body>${dist}</body></html>`);
const pagePath = 'file://' + path.join(out, 'page.html');
const results = []; const errors = []; let page;
const step = async (name, fn) => { try { await fn(); results.push(1); console.log('✔', name); } catch (e) { results.push(0); console.log('✖', name, '\n  ', e.message.split('\n')[0]); await page.screenshot({ path: path.join(out, `GROUP-FAIL-${results.length}.png`), fullPage: true }); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const docs = (coll) => page.evaluate((c) => [...window.__docs].filter(([p]) => p.startsWith(c + '/')).map(([p, d]) => ({ id: p.split('/')[1], ...d })), coll);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  page = await ctx.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pagePath); await page.waitForSelector('.empty');

  await step('準備: キーワード「青年部」付きで一括登録（3件）', async () => {
    await page.click('.nav >> text=新規登録'); await page.click('.segmented >> text=一覧から一括登録');
    await page.fill('#bulk-text', '株式会社あおば設備\t青木さん\n（有）さくら園芸\tけんくん\n寺島工業（株）\t寺島さん');
    await page.fill('#bulk-keywords', '青年部');
    await page.click('text=表に分ける'); await page.click('text=③ 確認へ進む');
    await page.check('#bulk-confirm'); await page.click('button:has-text("件を登録する")');
    await page.waitForSelector('text=3件を登録しました');
  });
  await step('管理 → グループ作成「青年部」', async () => {
    await page.click('.nav >> text=管理'); await page.click('.segmented >> text=グループ');
    await page.fill('#new-group-name', '青年部'); await page.click('.card >> button:has-text("作成")');
    await page.waitForSelector('h1 >> text=青年部');
  });
  await step('同名キーワードの登録情報をまとめて追加', async () => {
    await page.waitForSelector('text=3件をまとめて追加');
    await page.click('text=3件をまとめて追加');
    await page.waitForSelector('text=メンバー（3件）');
    const ps = await docs('persons');
    const g = (await docs('groups'))[0];
    assert(ps.every((p) => (p.groupIds || []).includes(g.id)), 'all in group');
    await page.screenshot({ path: path.join(out, 'group-1-page.png'), fullPage: true });
  });
  await step('同名グループは作れない', async () => {
    await page.click('.nav >> text=管理'); await page.click('.segmented >> text=グループ');
    await page.fill('#new-group-name', '青年部'); await page.click('.card >> button:has-text("作成")');
    await page.waitForSelector('.field-error >> text=既にあります');
  });
  await step('登録画面でグループを新規作成して選択 → 詳細に表示', async () => {
    await page.click('.nav >> text=新規登録');
    await page.click('.segmented >> text=人物を登録');
    await page.click('dialog button:has-text("切り替える")', { timeout: 1000 }).catch(() => {});
    await page.fill('input[data-key=name]', '森野さん');
    await page.fill('input[data-key=companyName]', '（株）斎木電機');
    await page.click('input[data-key=name]');
    await page.fill('.gnew input', '2026年度協賛'); await page.click('text=＋ 作成して追加');
    await page.waitForSelector('.gtoggle.on >> text=2026年度協賛');
    await page.click('.gtoggle >> text=青年部');
    await page.click('text=この内容で登録');
    await page.waitForSelector('.receipt-text');
    const t = await page.textContent('.info');
    assert(t.includes('青年部') && t.includes('2026年度協賛'), t);
  });
  await step('検索画面: グループで絞り込み → メンバー一覧・宛名コピー', async () => {
    await page.click('.nav >> text=検索');
    await page.waitForSelector('.gfilter');
    await page.click('.gfilter button:has-text("青年部")');
    await page.waitForSelector('.result-summary >> text=4件');
    await page.screenshot({ path: path.join(out, 'group-2-filter.png'), fullPage: true });
    await page.click('text=宛名を一覧でコピー');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip.split('\n').length === 4 && clip.includes('寺島工業（株） 様\t寺島さん'), clip);
    await page.fill('#search-input', '寺島'); await page.waitForTimeout(300);
    assert((await page.$$('.result-card')).length === 1, 'filtered search');
    await page.click('.gfilter button:has-text("2026年度協賛")');
    await page.waitForSelector('text=に該当する登録情報はありません');
    assert(await page.isVisible('text=すべてのグループから探す'), 'escape');
  });
  await step('グループ名で検索できる', async () => {
    await page.click('.gfilter button:has-text("すべて")');
    await page.fill('#search-input', '2026年度協賛'); await page.waitForTimeout(300);
    const t = await page.$$eval('.result-card', (e) => e.map((x) => x.innerText));
    assert(t.length === 1 && t[0].includes('森野さん'), t.join('|'));
  });
  await step('メンバーを追加ダイアログ・外す', async () => {
    await page.fill('#search-input', '');
    await page.click('.gfilter button:has-text("2026年度協賛")');
    await page.click('text=グループの管理');
    await page.click('text=＋ メンバーを追加');
    await page.fill('dialog input[type=search]', '青木');
    await page.waitForTimeout(200);
    await page.check('dialog .pick-row input');
    await page.click('dialog >> text=選んだ登録情報を追加');
    await page.waitForSelector('text=メンバー（2件）');
    await page.click('.gm-row:has-text("青木さん") >> text=外す');
    await page.click('dialog button:has-text("外す")');
    await page.waitForSelector('text=メンバー（1件）');
  });
  await step('グループ名・色の変更 → 所属は維持', async () => {
    await page.click('text=名前・色を変更');
    await page.fill('#group-name', '2026協賛企業');
    await page.click('dialog .swatch[aria-label=赤]');
    await page.click('dialog >> text=保存');
    await page.waitForSelector('h1 >> text=2026協賛企業');
    await page.waitForSelector('text=メンバー（1件）');
  });
  await step('編集画面でグループを外す', async () => {
    await page.click('.gm-row .gm-main');
    await page.click('text=情報を編集');
    await page.click('.gtoggle.on >> text=2026協賛企業');
    await page.click('text=変更を保存');
    await page.waitForSelector('.receipt-text');
    assert(!(await page.textContent('.info')).includes('2026協賛企業'), 'removed');
  });
  await step('一括登録でグループを指定', async () => {
    await page.click('.nav >> text=新規登録'); await page.click('.segmented >> text=一覧から一括登録');
    await page.click('dialog button:has-text("切り替える")', { timeout: 1000 }).catch(() => {});
    await page.fill('#bulk-text', '（有）倉田建設\t倉田さん');
    await page.click('.gtoggle >> text=青年部');
    await page.click('text=表に分ける'); await page.click('text=③ 確認へ進む');
    assert((await page.textContent('.confirm-card')).includes('青年部'), 'confirm shows group');
    await page.check('#bulk-confirm'); await page.click('button:has-text("件を登録する")');
    await page.waitForSelector('text=1件を登録しました');
    const g = (await docs('groups')).find((x) => x.name === '青年部');
    const kura = (await docs('persons')).find((p) => p.name === '倉田さん');
    assert(kura.groupIds.includes(g.id), 'bulk group');
  });
  await step('グループ削除 → 登録情報は残り所属だけ外れる', async () => {
    await page.click('.nav >> text=管理'); await page.click('.segmented >> text=グループ');
    await page.click('.gm-row:has-text("青年部") >> text=開く');
    await page.click('text=このグループを削除');
    await page.click('dialog button:has-text("削除する")');
    await page.waitForSelector('text=グループを削除しました');
    const ps = await docs('persons');
    assert(ps.length === 5, `persons ${ps.length}`);
    const gs = await docs('groups');
    assert(gs.length === 1 && ps.every((p) => !(p.groupIds || []).some((x) => !gs.find((g) => g.id === x))), 'cleaned');
  });
  await step('JSON書き出しにグループを含む', async () => {
    await page.click('.segmented >> text=データ管理');
    await page.click('text=JSONで書き出し');
    await page.waitForFunction(() => window.__saved?.filename.endsWith('.json'));
    const j = JSON.parse(await page.evaluate(() => window.__saved.data));
    assert(Array.isArray(j.groups) && j.groups[0].name === '2026協賛企業', JSON.stringify(j.groups));
  });
  await step('スマホ表示で横スクロールなし（グループ画面）', async () => {
    const m = await b.newContext({ ...devices['iPhone 13'] }); const mp = await m.newPage();
    await mp.goto(pagePath); await mp.waitForSelector('.empty');
    await mp.tap('.nav >> text=管理'); await mp.tap('.segmented >> text=グループ');
    await mp.fill('#new-group-name', 'テスト会'); await mp.tap('.card >> button:has-text("作成")');
    await mp.waitForSelector('h1 >> text=テスト会');
    assert(!(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'overflow');
    await mp.screenshot({ path: path.join(out, 'group-3-mobile.png'), fullPage: true });
    await m.close();
  });
  await step('外部検索（Google）リンク: 検索画面・該当なし・企業詳細・人物詳細', async () => {
    await page.click('.nav >> text=検索');
    await page.click('.gfilter button:has-text("すべて")').catch(() => {});
    await page.fill('#search-input', '寺島'); await page.waitForTimeout(300);
    let href = await page.getAttribute('.ext-foot a.ext-link', 'href');
    assert(href === 'https://www.google.com/search?q=' + encodeURIComponent('寺島'), href);
    assert(await page.getAttribute('.ext-foot a.ext-link', 'target') === '_blank', 'new tab');
    assert((await page.getAttribute('.ext-foot a.ext-link', 'rel')).includes('noopener'), 'rel');
    await page.fill('#search-input', 'まだ登録されていない会社'); await page.waitForTimeout(300);
    href = await page.getAttribute('.empty a.ext-link', 'href');
    assert(href.endsWith(encodeURIComponent('まだ登録されていない会社')), href);
    await page.fill('#search-input', '寺島工業'); await page.waitForTimeout(300);
    await page.click('.result-card .rc-link');
    await page.waitForSelector('.card-ext');
    const links = await page.$$eval('.card-ext a.ext-link', (a) => a.map((x) => x.href));
    assert(links.length === 2 && links[0].includes(encodeURIComponent('寺島工業（株）')) && links[1].startsWith('https://www.google.com/maps/search/?api=1&query='), links.join(' '));
    await page.screenshot({ path: path.join(out, 'ext-company.png'), fullPage: true });
    await page.click('.person-row');
    await page.waitForSelector('.memo-text');
    assert((await page.$$('.card-ext a.ext-link')).length === 2, 'person detail links');
  });
  await step('JSエラーなし', async () => assert(!errors.length, errors.join('\n')));
  await b.close();
  console.log(`${results.filter(Boolean).length} / ${results.length} 合格`);
})();
