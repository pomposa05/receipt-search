// 実際のOCRエンジン（tesseract.js）で名刺画像を読み取るテスト
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTesseractProvider } from '../../server/ocr/tesseractProvider.js';
import { extractFields } from '../../server/ocr/extract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const provider = createTesseractProvider({ cacheDir: path.join(root, '.cache') });
after(() => provider.close());
const read = async (f) => extractFields((await provider.recognize(fs.readFileSync(path.join(root, 'test/fixtures', f)))).lines);

test('名刺1: 企業名・名前・部署・役職・電話・メール', { timeout: 120000 }, async () => {
  const { fields } = await read('card1.png');
  assert.equal(fields.companyName.value, '株式会社サンプル商事');
  assert.equal(fields.name.value.replace(/\s/g, ''), '山田太郎');
  assert.equal(fields.department.value, '営業部');
  assert.equal(fields.title.value, '部長');
  assert.equal(fields.phone.value, '03-1234-5678');
  assert.equal(fields.email.value, 'taro.yamada@example.co.jp');
});

test('名刺2: 合同会社', { timeout: 120000 }, async () => {
  const { fields } = await read('card2.png');
  assert.equal(fields.companyName.value, '合同会社テスト技研');
  assert.equal(fields.name.value.replace(/\s/g, ''), '佐藤花子');
});

test('文字のない画像: 何も推測で埋めない', { timeout: 120000 }, async () => {
  const { fields, lines } = await read('blank.png');
  assert.equal(lines.length, 0);
  assert.equal(fields.name.value, '');
  assert.equal(fields.companyName.value, '');
});
