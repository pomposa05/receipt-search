// 読み仮名の自動推定（kuromoji 形態素解析・辞書はローカル）
// 用途: (1) 登録画面での「読み」入力候補  (2) 読み未入力の登録情報を読みで検索できるようにする
// 推定結果は確定情報としては保存しない（画面では候補として提示し、利用者が確認して保存する）
import path from 'node:path';
import { createRequire } from 'node:module';
import { toHiragana, nfkc, replaceItaiji } from './normalize.js';

const require = createRequire(import.meta.url);
let tokenizer = null;
let initPromise = null;
const cache = new Map();
const listeners = [];

export function initReading() {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve) => {
    let kuromoji;
    try {
      kuromoji = require('kuromoji');
    } catch {
      resolve(false);
      return;
    }
    const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
    kuromoji.builder({ dicPath }).build((err, t) => {
      if (err) {
        console.warn('[reading] 読み辞書の読み込みに失敗しました:', err.message);
        resolve(false);
        return;
      }
      tokenizer = t;
      cache.clear();
      for (const fn of listeners) fn();
      resolve(true);
    });
  });
  return initPromise;
}

export function onReadingReady(fn) {
  listeners.push(fn);
}

export function isReadingReady() {
  return !!tokenizer;
}

/**
 * 文字列の読み（ひらがな）を返す。漢字の読みが辞書にない語を含む場合は '' を返す（推測で埋めない）。
 */
export function getReading(text) {
  const s = nfkc(text).trim();
  if (!s || !tokenizer) return '';
  if (cache.has(s)) return cache.get(s);
  let out = '';
  try {
    for (const tk of tokenizer.tokenize(replaceItaiji(s.replace(/\s+/g, '')))) {
      const surface = tk.surface_form;
      if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(surface)) {
        out += toHiragana(surface);
      } else if (/^[A-Za-z0-9&.,'()-]+$/.test(surface)) {
        out += surface; // 英数字はそのまま
      } else if (tk.reading && tk.reading !== '*') {
        out += toHiragana(tk.reading);
      } else if (/^[\p{P}\p{S}]+$/u.test(surface)) {
        // 記号は読まない
      } else {
        out = '';
        break;
      }
    }
  } catch {
    out = '';
  }
  if (cache.size > 20000) cache.clear();
  cache.set(s, out);
  return out;
}
