import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFields, cleanText } from '../../server/ocr/extract.js';

const L = (text, height = 20, confidence = 90) => ({ text, height, confidence });

test('OCRの空白: 1文字ずつの区切りだけ詰める', () => {
  assert.equal(cleanText('山 田 太 郎'), '山田太郎');
  assert.equal(cleanText('営業部 部長'), '営業部 部長');
  assert.equal(cleanText('ＴＥＬ　０３'), 'TEL 03');
});

test('名刺: 企業名・名前・部署・役職・連絡先を抽出', () => {
  const { fields } = extractFields([
    L('株式会社サンプル商事', 34), L('営業部 部長', 26), L('山田 太郎', 66), L('ヤマダ タロウ', 21),
    L('〒100-0001 東京都千代田区千代田1-1-1', 21), L('TEL 03-1234-5678 taro@example.co.jp', 21),
  ]);
  assert.equal(fields.companyName.value, '株式会社サンプル商事');
  assert.equal(fields.companyName.confidence, 'high');
  assert.equal(fields.name.value, '山田 太郎');
  assert.equal(fields.department.value, '営業部');
  assert.equal(fields.title.value, '部長');
  assert.equal(fields.email.value, 'taro@example.co.jp');
  assert.equal(fields.phone.value, '03-1234-5678');
  assert.equal(fields.nameKana.value, '', '読みは候補提示のみ');
  assert.deepEqual(fields.nameKana.options, ['ヤマダ タロウ']);
});

test('名前候補が複数で区別できない場合は推測で埋めない', () => {
  const { fields } = extractFields([L('株式会社テスト', 30), L('山田 太郎', 30), L('佐藤 花子', 30)]);
  assert.equal(fields.name.value, '');
  assert.equal(fields.name.confidence, 'low');
  assert.deepEqual(fields.name.options.sort(), ['佐藤 花子', '山田 太郎'].sort());
});

test('企業名候補が複数の場合は候補提示のみ', () => {
  const { fields } = extractFields([L('株式会社アルファ', 30), L('株式会社ベータ', 30), L('鈴木 一郎', 60)]);
  assert.equal(fields.companyName.value, '');
  assert.equal(fields.companyName.confidence, 'low');
  assert.equal(fields.name.value, '鈴木 一郎');
});

test('認識精度が低い名前は確定しない', () => {
  const { fields } = extractFields([L('株式会社テスト', 30), L('山田 太郎', 60, 40)]);
  assert.equal(fields.name.value, '');
  assert.equal(fields.name.confidence, 'low');
});

test('文字がない場合は何も埋めず理由を返す', () => {
  const { fields, lines } = extractFields([]);
  assert.equal(lines.length, 0);
  assert.equal(fields.name.value, '');
  assert.equal(fields.name.confidence, 'none');
  assert.match(fields.name.reason, /判別できません/);
});

test('郵便番号を電話番号と誤認しない', () => {
  const { fields } = extractFields([L('〒100-0001 東京都千代田区1-1')]);
  assert.equal(fields.phone.value, '');
});
