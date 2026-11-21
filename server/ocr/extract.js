// OCRで得た行テキストから、名刺・書類の項目（名前・企業名など）を抽出する
// 方針: 判別できない項目は推測で埋めない。
//   confidence: 'high'   … 規則に明確に合致（入力欄に反映）
//               'medium' … 候補が1つに絞れた（入力欄に反映、要確認表示）
//               'low'    … 複数候補・不確実（入力欄には反映せず、候補として提示のみ）
//               'none'   … 見つからない
import { nfkc, hasLegalForm } from '../search/normalize.js';

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々〆';
const RE_SINGLE_CJK = new RegExp(`^[${CJK}]$`, 'u');

const COMPANY_WORDS = /(株式会社|有限会社|合同会社|合資会社|合名会社|社団法人|財団法人|法人|\((株|有|合|同)\)|co\.?,?\s*ltd|inc\.?\b|corp\.?\b|corporation|company|k\.k\.|事務所|研究所|協会|組合|商店|商会|工業|製作所|銀行|病院|クリニック|医院|大学|学校|ホールディングス|グループ本社)/i;
const DEPT_WORDS = /(本部|事業部|営業部|[^\s]{1,10}部$|[^\s]{1,10}部\s|[^\s]{1,10}課|[^\s]{1,10}室|センター|グループ|チーム|支店|支社|営業所|工場|事業所|部門|局)/;
const TITLE_WORDS = /(代表取締役社長|代表取締役|取締役社長|取締役|代表社員|代表理事|代表|社長|副社長|会長|専務|常務|執行役員|監査役|理事長|理事|部長|次長|課長|係長|主任|主査|主事|室長|所長|店長|支店長|工場長|センター長|マネージャー|マネジャー|ディレクター|リーダー|チーフ|スタッフ|担当|顧問|参与|院長|教授|准教授|講師|税理士|弁護士|公認会計士|司法書士|行政書士|社会保険労務士|一級建築士|CEO|COO|CFO|CTO)/i;
const ADDRESS_WORDS = /(〒|\d{3}-\d{4}|北海道|東京都|京都府|大阪府|.{2,3}県|市|区|町|村|丁目|番地|ビル|階|号)/;
const CONTACT = /(tel|fax|phone|mobile|携帯|電話|e-?mail|mail|url|http|www\.|@|〒|℡)/i;
const LABEL_ONLY = /^(名刺|住所|所在地|電話|携帯|メール|ホームページ|領収書|領収証|御中|様|殿|但し|但|上記正に領収いたしました)$/;

export function cleanText(s) {
  const t = nfkc(s).replace(/[|｜]/g, ' ').replace(/\s+/g, ' ').trim();
  // OCRは日本語1文字ごとに空白を入れることがあるため、1文字ずつ並んだ部分だけ詰める
  // （例: 山 田 太 郎 → 山田太郎。「営業部 部長」「山田 太郎」の区切りは残す）
  const out = [];
  for (const tok of t.split(' ')) {
    const prev = out[out.length - 1];
    if (prev !== undefined && RE_SINGLE_CJK.test(tok) && prev.single) {
      prev.text += tok;
    } else {
      out.push({ text: tok, single: RE_SINGLE_CJK.test(tok) });
    }
    if (out.length && !RE_SINGLE_CJK.test(tok)) out[out.length - 1].single = false;
  }
  return out.map((o) => o.text).join(' ');
}

function splitNameTitle(text) {
  // 「営業部 部長 山田 太郎」→ 役職・部署を除いた残りを名前候補にする
  let rest = text;
  const titles = [];
  const depts = [];
  const parts = text.split(/\s+/);
  const keep = [];
  for (const part of parts) {
    if (TITLE_WORDS.test(part) && part.replace(TITLE_WORDS, '').length <= 1) titles.push(part);
    else if (DEPT_WORDS.test(`${part} `) && /(部|課|室|センター|グループ|チーム|支店|支社|営業所|本部)$/.test(part)) depts.push(part);
    else keep.push(part);
  }
  rest = keep.join(' ');
  return { rest, titles, depts };
}

function isNameLike(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const compact = t.replace(/\s/g, '');
  const len = [...compact].length;
  if (len < 2 || len > 8) return false;
  if (!new RegExp(`^[${CJK}]+( [${CJK}]+)?$`, 'u').test(t)) return false;
  if (/^[\p{Script=Katakana}ー]+$/u.test(compact)) return false; // カタカナのみは読みの可能性が高い
  if (/^[\p{Script=Hiragana}]+$/u.test(compact)) return false;
  if (COMPANY_WORDS.test(t) || TITLE_WORDS.test(t) || ADDRESS_WORDS.test(t) || LABEL_ONLY.test(compact)) return false;
  if (/(部|課|室|株|社)$/.test(compact)) return false;
  return true;
}

function isKanaReading(s) {
  const compact = s.replace(/\s/g, '');
  const len = [...compact].length;
  return len >= 3 && len <= 16 && /^[\p{Script=Katakana}\p{Script=Hiragana}ー・]+$/u.test(compact);
}

/**
 * @param {{text:string, confidence?:number, height?:number}[]} rawLines
 */
export function extractFields(rawLines) {
  const lines = rawLines
    .map((l, i) => ({ index: i, text: cleanText(l.text), confidence: l.confidence ?? 100, height: l.height ?? 0 }))
    .filter((l) => l.text && l.text.replace(/[\s\p{P}\p{S}]/gu, '').length > 0);

  const fields = {
    name: none('名前を判別できませんでした。画像を見て入力してください。'),
    nameKana: none(''),
    companyName: none('企業名を判別できませんでした。画像を見て入力してください。'),
    department: none(''),
    title: none(''),
    email: none(''),
    phone: none(''),
    address: none(''),
    url: none(''),
  };

  // --- 連絡先系（規則が明確なもの） ---
  const emails = [];
  const phones = [];
  const urls = [];
  const addresses = [];
  for (const l of lines) {
    for (const m of l.text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) emails.push(m[0]);
    for (const m of l.text.matchAll(/(?:https?:\/\/|www\.)[^\s]+/gi)) urls.push(m[0]);
    // 郵便番号（〒123-4567）を電話番号と誤認しないよう除外してから探す
    const noPostal = l.text.replace(/〒\s?\d{3}-?\d{4}/g, ' ');
    for (const m of noPostal.matchAll(/(?:\+81[\s-]?|(?<!\d))0\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}(?!\d)/g)) {
      const digits = m[0].replace(/\D/g, '');
      const before = noPostal.slice(Math.max(0, m.index - 6), m.index);
      if (digits.length >= 10 && digits.length <= 12 && !/fax/i.test(before)) phones.push(m[0].trim());
    }
    if (/〒\s?\d{3}-?\d{4}/.test(l.text) || /(都|道|府|県).{1,6}(市|区|郡|町|村)/.test(l.text)) addresses.push(l.text);
  }
  if (emails.length) fields.email = found(emails[0], 'high', 'メールアドレスの形式に一致', emails);
  if (phones.length) fields.phone = found(phones[0], 'medium', '電話番号の形式に一致', phones);
  if (urls.length) fields.url = found(urls[0], 'high', 'URLの形式に一致', urls);
  if (addresses.length) fields.address = found(addresses.join(' '), 'medium', '住所の形式に一致', addresses);

  // --- 企業名 ---
  const companyCands = lines
    .filter((l) => COMPANY_WORDS.test(l.text) && !CONTACT.test(l.text) && !/(〒|丁目|番地)/.test(l.text))
    .map((l) => ({ ...l, legal: hasLegalForm(l.text) }));
  // 法人格を含む行を優先。日本語を含む行を英語表記より優先。
  companyCands.sort((a, b) => Number(b.legal) - Number(a.legal)
    || Number(/\p{Script=Han}|\p{Script=Katakana}/u.test(b.text)) - Number(/\p{Script=Han}|\p{Script=Katakana}/u.test(a.text))
    || b.height - a.height || a.index - b.index);
  const legalJa = companyCands.filter((c) => c.legal && /\p{Script=Han}|\p{Script=Katakana}/u.test(c.text));
  if (legalJa.length === 1) {
    fields.companyName = found(trimCompany(legalJa[0].text), lowConf(legalJa[0]) ? 'medium' : 'high', '法人格（株式会社など）を含む行', companyCands.map((c) => trimCompany(c.text)));
  } else if (legalJa.length > 1) {
    fields.companyName = found('', 'low', '企業名らしい行が複数あります。候補から選ぶか入力してください。', uniq(legalJa.map((c) => trimCompany(c.text))));
  } else if (companyCands.length) {
    fields.companyName = found('', 'low', '企業名の可能性がある行があります。候補から選ぶか入力してください。', uniq(companyCands.map((c) => trimCompany(c.text))));
  }

  // --- 部署・役職・名前 ---
  const usedIdx = new Set(companyCands.map((c) => c.index));
  const nameCands = [];
  const titles = [];
  const depts = [];
  for (const l of lines) {
    if (usedIdx.has(l.index) || CONTACT.test(l.text) || /\d{2,}/.test(l.text)) continue;
    const { rest, titles: ts, depts: ds } = splitNameTitle(l.text);
    titles.push(...ts);
    depts.push(...ds);
    if (!ts.length && !ds.length && DEPT_WORDS.test(`${l.text} `) && !isNameLike(l.text)) depts.push(l.text);
    if (isNameLike(rest)) nameCands.push({ ...l, text: rest.replace(/\s+/g, ' ').trim() });
  }
  if (titles.length) fields.title = found(uniq(titles).join(' '), 'medium', '役職名に一致', uniq(titles));
  if (depts.length) fields.department = found(uniq(depts).join(' '), 'medium', '部署名に一致', uniq(depts));

  if (nameCands.length) {
    const sorted = nameCands.slice().sort((a, b) => b.height - a.height || a.index - b.index);
    const top = sorted[0];
    const second = sorted[1];
    const options = uniq(sorted.map((c) => c.text));
    if (sorted.length === 1) {
      fields.name = found(top.text, lowConf(top) ? 'low' : 'medium', lowConf(top) ? '文字の認識精度が低いため確認が必要です。' : '名前らしい行が1つ見つかりました。', options);
    } else if (top.height > 0 && second.height > 0 && top.height >= second.height * 1.3 && !lowConf(top)) {
      fields.name = found(top.text, 'medium', '最も大きな文字で書かれた名前らしい行です。', options);
    } else {
      fields.name = found('', 'low', '名前らしい行が複数あります。候補から選ぶか入力してください。', options);
    }
    if (fields.name.confidence === 'low') fields.name.value = '';
  }

  // --- 読み（カタカナ・ひらがなのみの行） ---
  const kanaCands = lines.filter((l) => isKanaReading(l.text) && !COMPANY_WORDS.test(l.text));
  if (kanaCands.length === 1 && fields.name.value) {
    fields.nameKana = found(kanaCands[0].text, 'low', '名前の読みの可能性があります。', [kanaCands[0].text]);
    fields.nameKana.value = ''; // 読みは候補提示のみ
  } else if (kanaCands.length) {
    fields.nameKana = found('', 'low', '読みの可能性がある行です。', uniq(kanaCands.map((l) => l.text)));
  }

  return { lines: lines.map(({ index, text, confidence }) => ({ index, text, confidence: Math.round(confidence) })), fields };
}

function lowConf(l) {
  return (l.confidence ?? 100) < 60;
}
function trimCompany(t) {
  // 「株式会社サンプル 営業部」のように同じ行に部署がある場合は企業名部分だけにする
  const m = t.match(/^(.*?(?:株式会社|有限会社|合同会社|合資会社|合名会社|法人|\((?:株|有|合|同)\))\s?[^\s]*)(?:\s+.+(?:部|課|室|センター|支店|営業所))?$/);
  return (m ? m[1] : t).trim();
}
function uniq(a) {
  return [...new Set(a.filter(Boolean))];
}
function none(reason) {
  return { value: '', confidence: 'none', reason, options: [] };
}
function found(value, confidence, reason, options = []) {
  return { value, confidence, reason, options: uniq(options) };
}
