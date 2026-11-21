import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, companyCore, splitKeywords, tidyKeywords } from '../../server/search/normalize.js';
import { editDistance, substringDistance, subsequenceSpan } from '../../server/search/similarity.js';

test('全角半角・カタカナひらがな・空白・異体字を吸収する', () => {
  assert.equal(normalize('ｻﾝﾌﾟﾙ'), normalize('サンプル'));
  assert.equal(normalize('サンプル'), 'さんぷる');
  assert.equal(normalize('山田　太郎'), normalize('山田太郎'));
  assert.equal(normalize('ＡＢＣ　Ｃｏ．'), 'abcco');
  assert.equal(normalize('髙橋'), '高橋');
  assert.equal(normalize('渡邊'), normalize('渡辺'));
  assert.equal(normalize('サンプル－'), 'さんぷるー');
});

test('企業名の法人格を除いた中核名', () => {
  for (const s of ['株式会社サンプル', 'サンプル株式会社', '(株)サンプル', '㈱サンプル', '（株）サンプル', 'サンプル Co., Ltd.', 'カブシキガイシャサンプル']) {
    assert.equal(companyCore(s), 'さんぷる', s);
  }
  assert.equal(companyCore('有限会社テスト'), 'てすと');
  assert.equal(companyCore('一般社団法人テスト協会'), 'てすと協会');
  assert.equal(companyCore('株式会社'), normalize('株式会社'));
});

test('キーワードの分割と整理', () => {
  assert.deepEqual(splitKeywords('ゴルフ、会食,年末 贈答'), ['ゴルフ', '会食', '年末', '贈答']);
  assert.equal(tidyKeywords('ゴルフ、ごるふ,会食'), 'ゴルフ, 会食');
});

test('類似度判定', () => {
  assert.equal(editDistance('やまだ', 'やまだ'), 0);
  assert.equal(editDistance('たなか', 'なたか'), 1); // 隣接入替
  assert.equal(substringDistance('さんぷる', 'かぶしきがいしゃさんぷる'), 0);
  assert.equal(substringDistance('山田太朗', '山田太郎'), 1);
  assert.equal(subsequenceSpan('株さんぷる', '株式会社さんぷる'), 8);
  assert.equal(subsequenceSpan('xyz', 'abc'), null);
});
