// 日本語文字列の正規化（検索用）
// - 全角/半角の統一（NFKC）
// - 英字の小文字化
// - カタカナ→ひらがな
// - 異体字（髙→高 など）の統一
// - 空白・記号の除去
// すべて決定的（同じ入力 → 同じ出力）で、検索・重複判定で共通利用する。

/** 名前でよく使われる異体字 → 標準字体 */
const ITAIJI = {
  '髙': '高', '﨑': '崎', '嵜': '崎', '邊': '辺', '邉': '辺', '澤': '沢', '濱': '浜',
  '齋': '斎', '齊': '斉', '廣': '広', '國': '国', '嶋': '島', '嶌': '島', '櫻': '桜',
  '藏': '蔵', '德': '徳', '惠': '恵', '眞': '真', '實': '実', '冨': '富', '條': '条',
  '圓': '円', '關': '関', '瀧': '滝', '淺': '浅', '團': '団', '與': '与', '龍': '竜',
  '萬': '万', '彌': '弥', '榮': '栄', '壽': '寿', '傳': '伝', '學': '学', '會': '会',
  '﨔': '欅', '舘': '館', '桒': '桑', '曽': '曾', '籠': '篭', '凜': '凛',
};

/** 法人格（正規化前のNFKC小文字文字列に対して除去する） */
const LEGAL_FORMS_JA = new RegExp(
  [
    '株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
    '(?:一般|公益)(?:社団|財団)法人', '特定非営利活動法人', 'npo法人',
    '医療法人(?:社団|財団)?', '社会福祉法人', '学校法人', '宗教法人', '独立行政法人',
    '(?:弁護士|税理士|司法書士|行政書士|社会保険労務士|弁理士|監査|特許業務|土地家屋調査士)法人',
    '\\((?:株|有|合|同|資|名|社|財|医|学|福|一社|一財|公社|公財|特非|独)\\)',
  ].join('|'),
  'g',
);
const LEGAL_FORMS_EN = /\b(?:co\.?\s*,?\s*ltd\.?|company\s+limited|inc\.?|incorporated|corp\.?|corporation|limited|ltd\.?|llc|l\.l\.c\.|k\.k\.|g\.k\.|y\.k\.)(?=\s|$|[^a-z])/g;
/** 読み（ひらがな化済み）に含まれる法人格 */
const LEGAL_FORMS_KANA = /(かぶしきがいしゃ|かぶしきかいしゃ|ゆうげんがいしゃ|ゆうげんかいしゃ|ごうどうがいしゃ|ごうどうかいしゃ|ごうしがいしゃ|ごうめいがいしゃ)/g;

export function nfkc(s) {
  return String(s ?? '').normalize('NFKC');
}

/** 表示用比較（完全一致判定）: NFKC + 前後空白除去 + 連続空白を1つに */
export function displayKey(s) {
  return nfkc(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

export function toHiragana(s) {
  return String(s ?? '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function toKatakana(s) {
  return String(s ?? '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

export function replaceItaiji(s) {
  let out = '';
  for (const ch of s) out += ITAIJI[ch] || ch;
  return out;
}

/** 検索用正規化 */
export function normalize(s) {
  let t = nfkc(s).toLowerCase();
  // かなの直後のダッシュ類は長音とみなす（例: サンプル－ → サンプルー）
  t = t.replace(/([ぁ-ゖァ-ヺ])[‐‑‒–—―−-]/g, '$1ー');
  t = toHiragana(t);
  t = replaceItaiji(t);
  // 文字・数字・長音・繰り返し記号以外（空白・記号・括弧など）を除去
  t = t.replace(/[^\p{L}\p{N}ー々〆ゝゞ]/gu, '');
  return t;
}

/** 企業名から法人格を除いた「中核名」を正規化して返す */
export function companyCore(s) {
  let t = nfkc(s).toLowerCase();
  t = t.replace(LEGAL_FORMS_JA, ' ').replace(LEGAL_FORMS_EN, ' ');
  let n = normalize(t).replace(LEGAL_FORMS_KANA, '');
  if (!n) n = normalize(s); // 法人格だけの文字列の場合は元を使う
  return n;
}

/** 法人格を含むか */
export function hasLegalForm(s) {
  const t = nfkc(s).toLowerCase();
  LEGAL_FORMS_JA.lastIndex = 0;
  LEGAL_FORMS_EN.lastIndex = 0;
  const r = LEGAL_FORMS_JA.test(t) || LEGAL_FORMS_EN.test(t);
  LEGAL_FORMS_JA.lastIndex = 0;
  LEGAL_FORMS_EN.lastIndex = 0;
  return r;
}

/** キーワード文字列を個々のキーワードに分割（カンマ・読点・改行・空白区切り） */
export function splitKeywords(s) {
  return nfkc(s)
    .split(/[,、，;；\n\r\t ]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/** キーワードの表記を整える（重複除去・区切りを「, 」に統一） */
export function tidyKeywords(s) {
  const seen = new Set();
  const out = [];
  for (const k of splitKeywords(s)) {
    const key = normalize(k);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out.join(', ');
}

/** 検索語を空白で分割（全角空白も対象） */
export function splitTerms(q) {
  return nfkc(q).trim().split(/\s+/).filter(Boolean);
}
