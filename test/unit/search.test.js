import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search } from '../../server/search/engine.js';

const T = '2026-01-01T00:00:00.000Z';
const co = (id, name, extra = {}) => ({ id, name, name_kana: '', keywords: '', receipt_name: '', memo: '', updated_at: T, ...extra });
const pe = (id, company_id, name, extra = {}) => ({
  id, company_id, name, name_kana: '', keywords: '', receipt_name: '', department: '', title: '', memo: '', updated_at: T, ...extra,
});
const readings = { '山田太郎': 'やまだたろう', '山田花子': 'やまだはなこ', '佐藤一郎': 'さとういちろう' };
const reading = (s) => readings[s.replace(/\s/g, '')] || '';

const data = {
  companies: [co(1, '株式会社サンプル', { keywords: '取引先' }), co(2, 'サンプル商事有限会社'), co(3, '株式会社テスト', { memo: '経理は月末締め' })],
  persons: [
    pe(1, 1, '山田 太郎', { keywords: 'ゴルフ', memo: '毎月の会食あり' }),
    pe(2, 2, '山田太郎'), // 同姓同名（別企業）
    pe(3, 1, '佐藤一郎', { name_kana: 'サトウ イチロウ' }),
    pe(4, null, '山田花子'),
  ],
  companyNameHistory: [{ company_id: 3, old_name: '旧テスト工業株式会社' }],
};
const idx = buildIndex(data, reading);
const ids = (r) => r.results.map((x) => `${x.type[0]}${x.id}`);

test('名前検索: 同姓同名を両方表示し、完全一致を上位にする', () => {
  const r = search(idx, '山田太郎');
  assert.deepEqual(ids(r).slice(0, 2), ['p2', 'p1']);
  assert.equal(r.results[0].matchLevel, '完全一致');
  assert.equal(r.results[1].companyName, '株式会社サンプル');
  assert.equal(r.results[0].companyName, 'サンプル商事有限会社');
});

test('企業名検索: 企業と関連人物を表示（企業名のみで一致した人物は企業カードにまとめる）', () => {
  const r = search(idx, '株式会社サンプル');
  assert.equal(ids(r)[0], 'c1');
  assert.equal(r.results[0].personCount, 2);
  assert.deepEqual(r.results[0].persons.map((p) => p.id), [1, 3]);
  assert.ok(!ids(r).includes('p1'), '企業カード内にまとめられる');
});

test('部分一致・表記揺れ・略記', () => {
  assert.deepEqual(ids(search(idx, 'サンプル')).slice(0, 2), ['c1', 'c2']);
  assert.equal(ids(search(idx, 'ｻﾝﾌﾟﾙ'))[0], 'c1');
  assert.equal(ids(search(idx, '株サンプル'))[0], 'c1');
  assert.equal(ids(search(idx, '(株)サンプル'))[0], 'c1');
  assert.equal(ids(search(idx, 'さんぷる'))[0], 'c1');
});

test('読み検索（登録した読み・自動推定の読み）', () => {
  const r = search(idx, 'やまだ');
  assert.deepEqual(new Set(ids(r)), new Set(['p1', 'p2', 'p4']));
  assert.ok(r.results.every((x) => x.matches[0].field === '読み'));
  assert.equal(ids(search(idx, 'サトウ'))[0], 'p3');
  assert.equal(ids(search(idx, 'さとう いちろう'))[0], 'p3');
});

test('キーワード・メモ・旧企業名で検索できる', () => {
  assert.deepEqual(ids(search(idx, 'ゴルフ')), ['p1']);
  assert.deepEqual(ids(search(idx, '会食')), ['p1']);
  assert.deepEqual(ids(search(idx, '月末締め')), ['c3']);
  assert.equal(ids(search(idx, '取引先'))[0], 'c1');
  assert.equal(ids(search(idx, 'テスト工業'))[0], 'c3');
});

test('誤字・脱字の曖昧検索は「候補」として返す', () => {
  const r = search(idx, '山田太朗');
  assert.ok(ids(r).includes('p1') && ids(r).includes('p2'));
  assert.ok(r.results.every((x) => x.isCandidate));
  const r2 = search(idx, 'サンプ商事');
  assert.equal(ids(r2)[0], 'c2');
  assert.ok(r2.results[0].isCandidate);
});

test('複数語（空白区切り）は全語一致', () => {
  const r = search(idx, 'サンプル 佐藤');
  assert.deepEqual(ids(r), ['p3']);
});

test('該当なし・空入力', () => {
  assert.equal(search(idx, '存在しない名前').total, 0);
  assert.equal(search(idx, '   ').total, 0);
  assert.equal(search(idx, '!!!').total, 0);
});

test('同じ条件なら常に同じ順序（決定的）', () => {
  const a = JSON.stringify(search(idx, '山田'));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(search(buildIndex(data, reading), '山田')), a);
  // 同点時: 読みの五十音順 → ID順
  assert.deepEqual(ids(search(idx, '山田')), ['p1', 'p2', 'p4']);
});
