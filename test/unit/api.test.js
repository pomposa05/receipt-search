import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, fakeOcr, PNG_1x1, tempDir } from './helpers.js';

let s;
before(async () => {
  s = await startApp({
    ocrProvider: fakeOcr([
      { text: '株式会社サンプル', height: 30, confidence: 92 },
      { text: '山田 太郎', height: 60, confidence: 95 },
    ]),
  });
});
after(() => s.close());

test('人物を新規企業と一緒に登録し、名前・企業名の双方向で検索できる', async () => {
  const r = await s.call('POST', '/api/persons', { name: ' 山田　太郎 ', keywords: 'ゴルフ、会食', company: { mode: 'new', name: '株式会社サンプル' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.name, '山田 太郎');
  assert.equal(r.body.company.name, '株式会社サンプル');
  assert.equal(r.body.receiptName, '株式会社サンプル 山田 太郎 様');
  assert.equal(r.body.keywords, 'ゴルフ, 会食');
  const byName = await s.call('GET', `/api/search?q=${encodeURIComponent('山田太郎')}`);
  assert.equal(byName.body.results[0].companyName, '株式会社サンプル');
  const byCompany = await s.call('GET', `/api/search?q=${encodeURIComponent('サンプル')}`);
  assert.equal(byCompany.body.results[0].type, 'company');
  assert.equal(byCompany.body.results[0].persons[0].name, '山田 太郎');
});

test('既存企業と同名の新規企業は確認なしに作らない（既存IDで紐付け or 明示的に別企業）', async () => {
  const r = await s.call('POST', '/api/persons', { name: '佐藤花子', company: { mode: 'new', name: '(株)サンプル' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'COMPANY_EXISTS');
  const cid = r.body.error.details.candidates[0].id;
  const ok = await s.call('POST', '/api/persons', { name: '佐藤花子', company: { mode: 'existing', id: cid } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.company.id, cid);
  assert.equal(ok.body.company.personCount, 2);
  // 確認したうえで別企業として登録
  const sep = await s.call('POST', '/api/persons', { name: '高橋一郎', company: { mode: 'new', name: '株式会社サンプル' }, confirmNewCompany: true });
  assert.equal(sep.status, 201);
  assert.notEqual(sep.body.company.id, cid);
});

test('同姓同名は自動で同一と判断せず、確認後に別人として登録できる', async () => {
  const r = await s.call('POST', '/api/persons', { name: '山田太郎', company: { mode: 'none' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'POSSIBLE_DUPLICATE');
  const ok = await s.call('POST', '/api/persons', { name: '山田太郎', company: { mode: 'none' }, confirmDuplicate: true });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.company, null);
  assert.equal(ok.body.receiptName, '山田太郎 様');
  const res = await s.call('GET', `/api/search?q=${encodeURIComponent('山田太郎')}`);
  const persons = res.body.results.filter((x) => x.type === 'person');
  assert.equal(persons.length, 2);
  assert.notEqual(persons[0].id, persons[1].id);
});

test('入力チェック: 名前なし・長すぎ・存在しない企業ID', async () => {
  assert.equal((await s.call('POST', '/api/persons', { name: '  ' })).status, 400);
  assert.equal((await s.call('POST', '/api/persons', { name: 'あ'.repeat(101) })).status, 400);
  const r = await s.call('POST', '/api/persons', { name: '存在企業テスト', company: { mode: 'existing', id: 99999 } });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'COMPANY_NOT_FOUND');
  assert.equal((await s.call('POST', '/api/persons', { name: 'x' }, { 'Content-Type': 'text/plain' })).status, 415);
});

test('メモ: 保存・再表示・追記・衝突検知（他の人物には表示されない）', async () => {
  const a = (await s.call('POST', '/api/persons', { name: 'メモ太郎', company: { mode: 'none' } })).body;
  const b = (await s.call('POST', '/api/persons', { name: 'メモ次郎', company: { mode: 'none' } })).body;
  const long = '長文メモ\n'.repeat(5000);
  let r = await s.call('PUT', `/api/persons/${a.id}/memo`, { memo: long, memoVersion: a.memoVersion });
  assert.equal(r.status, 200);
  assert.equal(r.body.memoVersion, 1);
  assert.equal((await s.call('GET', `/api/persons/${a.id}`)).body.memo, long.trim());
  assert.equal((await s.call('GET', `/api/persons/${b.id}`)).body.memo, '');
  r = await s.call('PUT', `/api/persons/${a.id}/memo`, { memo: `${long}追記`, memoVersion: 1 });
  assert.equal(r.body.memoVersion, 2);
  const stale = await s.call('PUT', `/api/persons/${a.id}/memo`, { memo: '古い画面から', memoVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'MEMO_CONFLICT');
  assert.match(stale.body.error.details.currentMemo, /追記$/);
  // メモの内容で検索できる
  r = await s.call('PUT', `/api/persons/${b.id}/memo`, { memo: '但し書きはお品代で発行', memoVersion: 0 });
  const found = await s.call('GET', `/api/search?q=${encodeURIComponent('お品代')}`);
  assert.deepEqual(found.body.results.map((x) => x.id), [b.id]);
});

test('編集の楽観ロック・所属変更の履歴', async () => {
  const c2 = (await s.call('POST', '/api/companies', { name: '合同会社テスト技研' })).body;
  const p = (await s.call('POST', '/api/persons', { name: '異動花子', company: { mode: 'none' } })).body;
  const r = await s.call('PUT', `/api/persons/${p.id}`, { name: '異動花子', version: p.version, company: { mode: 'existing', id: c2.id } });
  assert.equal(r.status, 200);
  assert.equal(r.body.company.id, c2.id);
  assert.equal(r.body.affiliationHistory.length, 1);
  assert.equal(r.body.affiliationHistory[0].new_company_name, '合同会社テスト技研');
  const stale = await s.call('PUT', `/api/persons/${p.id}`, { name: '古い編集', version: p.version, company: { mode: 'none' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  assert.equal((await s.call('GET', `/api/persons/${p.id}`)).body.name, '異動花子');
});

test('企業名の変更: 紐付けは維持、宛名の置換は指定時のみ、旧企業名でも検索可', async () => {
  const c = (await s.call('POST', '/api/companies', { name: '株式会社旧名' })).body;
  const p1 = (await s.call('POST', '/api/persons', { name: '社員一号', company: { mode: 'existing', id: c.id } })).body;
  const p2 = (await s.call('POST', '/api/persons', { name: '社員二号', receiptName: '社員二号 様', company: { mode: 'existing', id: c.id }, confirmDuplicate: true })).body;
  const r = await s.call('PUT', `/api/companies/${c.id}`, { name: '株式会社新名', version: c.version, replaceReceiptNames: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.receiptName, '株式会社新名 御中');
  assert.deepEqual(r.body.affectedPersons.map((x) => [x.id, x.replaced]), [[p1.id, true], [p2.id, false]]);
  assert.equal((await s.call('GET', `/api/persons/${p1.id}`)).body.receiptName, '株式会社新名 社員一号 様');
  assert.equal((await s.call('GET', `/api/persons/${p1.id}`)).body.company.id, c.id);
  const old = await s.call('GET', `/api/search?q=${encodeURIComponent('旧名')}`);
  assert.equal(old.body.results[0].id, c.id);
  assert.equal(old.body.results[0].matches[0].field, '旧企業名');
});

test('削除: 人物は削除可、人物が紐付く企業は削除不可', async () => {
  const c = (await s.call('POST', '/api/companies', { name: '削除テスト株式会社' })).body;
  const p = (await s.call('POST', '/api/persons', { name: '削除対象', company: { mode: 'existing', id: c.id } })).body;
  const blocked = await s.call('DELETE', `/api/companies/${c.id}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'COMPANY_HAS_PERSONS');
  assert.equal((await s.call('DELETE', `/api/persons/${p.id}?version=${p.version}`)).status, 200);
  assert.equal((await s.call('GET', `/api/persons/${p.id}`)).status, 404);
  assert.equal((await s.call('DELETE', `/api/companies/${c.id}`)).status, 200);
  assert.equal((await s.call('GET', `/api/search?q=${encodeURIComponent('削除対象')}`)).body.total, 0);
});

test('OCR: 画像の保存・抽出・登録情報との紐付け・重複画像の検知', async () => {
  const r = await s.call('POST', '/api/ocr', { dataBase64: PNG_1x1, originalHash: 'a'.repeat(64), originalName: 'card.png' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ocr.fields.companyName.value, '株式会社サンプル');
  assert.equal(r.body.ocr.fields.name.value, '山田 太郎');
  assert.deepEqual(r.body.duplicates, []);
  const p = await s.call('POST', '/api/persons', { name: 'OCR登録', company: { mode: 'none' }, imageId: r.body.imageId });
  assert.equal(p.body.images.length, 1);
  const img = await s.call('GET', `/api/images/${r.body.imageId}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const again = await s.call('POST', '/api/ocr', { dataBase64: PNG_1x1, originalHash: 'a'.repeat(64) });
  assert.equal(again.body.duplicates[0].name, 'OCR登録');
});

test('OCR: 非対応形式・空データ・OCR失敗を案内する', async () => {
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'binary').toString('base64');
  const bad = await s.call('POST', '/api/ocr', { dataBase64: gif });
  assert.equal(bad.status, 415);
  assert.match(bad.body.error.message, /JPG・JPEG・PNG・WebP/);
  assert.equal((await s.call('POST', '/api/ocr', { dataBase64: '' })).status, 400);
  const failing = await startApp({ ocrProvider: { name: 'x', recognize: async () => { throw new Error('boom'); }, close: async () => {} } });
  const f = await failing.call('POST', '/api/ocr', { dataBase64: PNG_1x1 });
  assert.equal(f.status, 422);
  assert.equal(f.body.error.code, 'OCR_FAILED');
  assert.ok(f.body.error.details.imageId);
  await failing.close();
});

test('重複候補の一覧・企業候補の提示', async () => {
  const d = await s.call('GET', '/api/duplicates');
  assert.ok(d.body.persons.some((g) => g.items.length >= 2 && g.key.replace(/\s/g, '') === '山田太郎'));
  assert.ok(d.body.companies.some((g) => g.items.length >= 2));
  const sug = await s.call('GET', `/api/companies?q=${encodeURIComponent('さんぷる')}`);
  assert.equal(sug.status, 200);
});

test('セキュリティ: 別サイトからの書き込み拒否・パストラバーサル拒否・CSV数式無害化', async () => {
  const r = await s.call('POST', '/api/persons', { name: 'x' }, { Origin: 'http://evil.example' });
  assert.equal(r.status, 403);
  const t = await fetch(`${s.base}/..%2f..%2fpackage.json`);
  assert.equal(t.status, 404);
  await s.call('POST', '/api/persons', { name: '=HYPERLINK("x")', company: { mode: 'none' } });
  const csv = await s.call('GET', '/api/export.csv');
  assert.match(csv.text, /'=HYPERLINK/);
  const html = await fetch(`${s.base}/`);
  assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
});

test('アプリを再起動してもデータ（登録情報・メモ）が残る', async () => {
  const dir = tempDir();
  let a = await startApp({ dataDir: dir, ocrProvider: fakeOcr([]) });
  const p = (await a.call('POST', '/api/persons', { name: '永続花子', company: { mode: 'new', name: '株式会社永続' } })).body;
  await a.call('PUT', `/api/persons/${p.id}/memo`, { memo: '再起動後も残るメモ', memoVersion: 0 });
  await a.close();
  a = await startApp({ dataDir: dir, ocrProvider: fakeOcr([]) });
  const again = (await a.call('GET', `/api/persons/${p.id}`)).body;
  assert.equal(again.memo, '再起動後も残るメモ');
  assert.equal(again.company.name, '株式会社永続');
  assert.equal((await a.call('GET', `/api/search?q=${encodeURIComponent('永続')}`)).body.total >= 1, true);
  // バックアップ
  const b = await a.call('POST', '/api/backup');
  assert.equal(b.status, 200);
  assert.ok(fs.existsSync(path.join(dir, 'backups', b.body.file)));
  await a.close();
});

test('アクセス制御（APP_PASSWORD 設定時）', async () => {
  const a = await startApp({ password: 'secret-pass', ocrProvider: fakeOcr([]) });
  assert.equal((await a.call('GET', '/api/search?q=a')).status, 401);
  assert.equal((await a.call('POST', '/api/auth/login', { password: 'wrong' })).status, 401);
  const ok = await a.call('POST', '/api/auth/login', { password: 'secret-pass' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await a.call('GET', '/api/search?q=a', undefined, { Cookie: cookie })).status, 200);
  await a.close();
});
