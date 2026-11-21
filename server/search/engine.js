// 検索エンジン（DBから独立。データを受け取り索引を作り、検索する）
//
// 検索順位（同じ入力 → 常に同じ結果）
//   1. 一致レベル（基本点）
//        完全一致 1000 / 正規化後の一致 900 / 前方一致 800 / 部分一致 700
//        類似：脱字 500〜550 / 類似：誤字 220〜400（候補扱い）
//   2. 一致した項目（加点）
//        名前 60 / 企業名 55 / 企業名+名前 50 / 読み 45 / 領収証宛名 40 / キーワード 35
//        部署・役職 20 / 旧企業名 15 / メモ 10
//   3. 同点時: 一致レベルの高い順 → 読み（なければ名前）の五十音順 → 種別（企業→人物）→ ID昇順
import {
  normalize, companyCore, displayKey, splitTerms, splitKeywords, toHiragana,
} from './normalize.js';
import {
  editDistance, substringDistance, subsequenceSpan, allowedErrors,
} from './similarity.js';

export const LEVELS = {
  EXACT: { rank: 1, base: 1000, label: '完全一致' },
  NORMALIZED: { rank: 2, base: 900, label: '一致（表記揺れ吸収）' },
  PREFIX: { rank: 3, base: 800, label: '前方一致' },
  CONTAINS: { rank: 4, base: 700, label: '部分一致' },
  SUBSEQ: { rank: 5, base: 500, label: '類似（文字の抜け）', candidate: true },
  FUZZY: { rank: 6, base: 400, label: '類似（誤字の可能性）', candidate: true },
};

const FIELD = {
  name: { label: '名前', bonus: 60, fuzzy: true },
  company: { label: '企業名', bonus: 55, fuzzy: true, company: true },
  combined: { label: '企業名+名前', bonus: 50, fuzzy: true },
  kana: { label: '読み', bonus: 45, fuzzy: true },
  companyKana: { label: '企業名の読み', bonus: 44, fuzzy: true, company: true },
  receipt: { label: '領収証宛名', bonus: 40, fuzzy: false },
  keyword: { label: 'キーワード', bonus: 35, fuzzy: true },
  companyKeyword: { label: '企業キーワード', bonus: 30, fuzzy: false, company: true },
  dept: { label: '部署・役職', bonus: 20, fuzzy: false },
  oldCompany: { label: '旧企業名', bonus: 15, fuzzy: false, company: true },
  memo: { label: 'メモ', bonus: 10, fuzzy: false },
};

const FUZZY_MAX_FIELD_LEN = 80;
/** ID比較（数値IDでも文字列IDでも同じ規則で並べる） */
const cmpId = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

function makeField(key, raw, { isCompany = false, kana = false } = {}) {
  const value = String(raw ?? '');
  if (!value.trim()) return null;
  const norm = kana ? normalize(toHiragana(value)) : normalize(value);
  if (!norm) return null;
  const forms = [norm];
  if (isCompany) {
    const core = companyCore(value);
    if (core && core !== norm) forms.push(core);
  }
  return { key, def: FIELD[key], raw: value, display: displayKey(value), forms };
}

function pushField(list, f) {
  if (f) list.push(f);
}

/**
 * 索引の作成
 * @param {object} data {companies, persons, companyNameHistory}
 * @param {(text:string)=>string} reading 自動読み（ひらがな/カタカナ）を返す関数。不明なら ''
 */
export function buildIndex(data, reading = () => '') {
  const companiesById = new Map(data.companies.map((c) => [c.id, c]));
  const oldNames = new Map();
  for (const h of data.companyNameHistory || []) {
    if (!oldNames.has(h.company_id)) oldNames.set(h.company_id, []);
    oldNames.get(h.company_id).push(h.old_name);
  }
  const personsByCompany = new Map();
  for (const p of data.persons) {
    if (p.company_id == null) continue;
    if (!personsByCompany.has(p.company_id)) personsByCompany.set(p.company_id, []);
    personsByCompany.get(p.company_id).push(p);
  }

  const companyFields = (c, prefix = true) => {
    const fs = [];
    pushField(fs, makeField('company', c.name, { isCompany: true }));
    const ck = c.name_kana || reading(c.name);
    pushField(fs, makeField('companyKana', ck, { isCompany: true, kana: true }));
    for (const k of splitKeywords(c.keywords)) pushField(fs, makeField(prefix ? 'companyKeyword' : 'keyword', k));
    for (const o of oldNames.get(c.id) || []) pushField(fs, makeField('oldCompany', o, { isCompany: true }));
    return fs;
  };

  const docs = [];
  for (const c of data.companies) {
    const fields = companyFields(c, false);
    pushField(fields, makeField('receipt', c.receipt_name));
    pushField(fields, makeField('memo', c.memo));
    const members = (personsByCompany.get(c.id) || []).slice().sort((a, b) => cmpId(a.id, b.id));
    docs.push({
      type: 'company',
      id: c.id,
      fields,
      sortKey: normalize(c.name_kana || reading(c.name) || c.name),
      summary: {
        type: 'company',
        id: c.id,
        name: c.name,
        nameKana: c.name_kana,
        receiptName: c.receipt_name,
        keywords: c.keywords,
        personCount: members.length,
        persons: members.slice(0, 8).map((p) => ({ id: p.id, name: p.name, nameKana: p.name_kana })),
        updatedAt: c.updated_at,
      },
    });
  }

  for (const p of data.persons) {
    const c = p.company_id != null ? companiesById.get(p.company_id) : null;
    const fields = [];
    pushField(fields, makeField('name', p.name));
    const kana = p.name_kana || reading(p.name);
    pushField(fields, makeField('kana', kana, { kana: true }));
    if (c) {
      for (const f of companyFields(c, true)) fields.push(f);
      pushField(fields, makeField('combined', `${c.name}${p.name}`, { isCompany: true }));
      pushField(fields, makeField('combined', `${p.name}${c.name}`, { isCompany: true }));
    }
    for (const k of splitKeywords(p.keywords)) pushField(fields, makeField('keyword', k));
    pushField(fields, makeField('receipt', p.receipt_name));
    pushField(fields, makeField('dept', p.department));
    pushField(fields, makeField('dept', p.title));
    pushField(fields, makeField('memo', p.memo));
    docs.push({
      type: 'person',
      id: p.id,
      companyId: c ? c.id : null,
      fields,
      sortKey: normalize(kana || p.name),
      summary: {
        type: 'person',
        id: p.id,
        name: p.name,
        nameKana: p.name_kana,
        nameKanaAuto: p.name_kana ? '' : toHiragana(reading(p.name) || ''),
        companyId: c ? c.id : null,
        companyName: c ? c.name : '',
        department: p.department,
        title: p.title,
        receiptName: p.receipt_name,
        keywords: p.keywords,
        updatedAt: p.updated_at,
      },
    });
  }
  return { docs, builtAt: Date.now() };
}

/** 検索語の準備（正規化形と、法人格略記を外した派生形） */
function prepareTerm(raw) {
  const norm = normalize(raw);
  const variants = [{ norm, penalty: 0 }];
  const core = companyCore(raw);
  if (core && core !== norm) variants.push({ norm: core, penalty: 5 });
  // 「株サンプル」「サンプル株」のような略記
  const m = norm.match(/^(株|有|合)(.{2,})$/) || norm.match(/^(.{2,})(株|有)$/);
  if (m) {
    const stripped = norm.startsWith(m[1]) && m[1].length === 1 ? m[2] : m[1];
    if (stripped && !variants.some((v) => v.norm === stripped)) variants.push({ norm: stripped, penalty: 10 });
  }
  return { raw, display: displayKey(raw), norm, variants };
}

/** 1つの検索語 × 1つの項目の一致判定 */
function matchField(term, field) {
  if (!term.norm) return null;
  if (term.display && term.display === field.display) {
    return { level: LEVELS.EXACT, score: LEVELS.EXACT.base + field.def.bonus };
  }
  let best = null;
  const consider = (level, extra = 0) => {
    const score = level.base + field.def.bonus + extra;
    if (!best || score > best.score) best = { level, score };
  };
  for (const v of term.variants) {
    if (!v.norm) continue;
    for (const form of field.forms) {
      if (form === v.norm) consider(LEVELS.NORMALIZED, -v.penalty);
      else if (form.startsWith(v.norm)) consider(LEVELS.PREFIX, -v.penalty + coverageBonus(v.norm, form));
      else if (form.includes(v.norm)) consider(LEVELS.CONTAINS, -v.penalty + coverageBonus(v.norm, form));
    }
  }
  if (best || !field.def.fuzzy) return best;

  // 類似一致（候補扱い）
  for (const v of term.variants) {
    const q = v.norm;
    const qLen = [...q].length;
    for (const form of field.forms) {
      const fLen = [...form].length;
      if (fLen > FUZZY_MAX_FIELD_LEN) continue;
      // 脱字: 検索語の文字が順番通りに含まれる（例: 株サンプル → 株式会社サンプル）
      if (qLen >= 3) {
        const span = subsequenceSpan(q, form);
        if (span !== null && span <= qLen * 2 + 2) {
          consider(LEVELS.SUBSEQ, Math.round(50 * (qLen / span)) - v.penalty);
        }
      }
      // 誤字: 編集距離
      const maxErr = allowedErrors(qLen);
      if (maxErr > 0) {
        const d = substringDistance(q, form);
        if (d > 0 && d <= maxErr) consider(LEVELS.FUZZY, -60 * d - v.penalty);
      }
      // 短い語（3文字）は項目全体と1文字違いのときのみ
      if (qLen === 3 && fLen <= 4) {
        const d = editDistance(q, form);
        if (d === 1) consider(LEVELS.FUZZY, -90 - v.penalty);
      }
    }
  }
  return best;
}

/** 部分一致の際、項目に占める割合が大きいほど少し加点（0〜9） */
function coverageBonus(q, form) {
  return Math.min(9, Math.floor((9 * [...q].length) / Math.max(1, [...form].length)));
}

function matchDoc(term, doc) {
  let best = null;
  for (const field of doc.fields) {
    const m = matchField(term, field);
    if (m && (!best || m.score > best.score)) best = { ...m, field };
  }
  return best;
}

/**
 * 検索
 * @returns {{results: object[], total: number, query: string}}
 */
export function search(index, query, { limit = 50 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { query: q, results: [], total: 0 };
  const terms = splitTerms(q).map(prepareTerm).filter((t) => t.norm);
  const whole = prepareTerm(q);
  if (!whole.norm) return { query: q, results: [], total: 0 };

  const hits = [];
  for (const doc of index.docs) {
    const candidates = [];
    // A) 入力全体を1語として照合
    const w = matchDoc(whole, doc);
    if (w) candidates.push({ score: w.score, level: w.level, matches: [w] });
    // B) 複数語（空白区切り）は全語一致（AND）
    if (terms.length > 1) {
      const ms = terms.map((t) => matchDoc(t, doc));
      if (ms.every(Boolean)) {
        const avg = Math.round(ms.reduce((s, m) => s + m.score, 0) / ms.length);
        const worst = ms.reduce((a, m) => (m.level.rank > a.rank ? m.level : a), LEVELS.EXACT);
        candidates.push({ score: avg, level: worst, matches: ms });
      }
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.score - a.score || a.level.rank - b.level.rank);
    const c = candidates[0];
    hits.push({
      doc,
      score: c.score,
      level: c.level,
      viaCompanyOnly: c.matches.every((m) => m.field.def.company),
      matches: c.matches.map((m) => ({
        field: m.field.def.label,
        level: m.level.label,
        candidate: !!m.level.candidate,
      })),
    });
  }

  // 企業そのものが結果に含まれる場合、「企業名でのみ一致した人物」は企業カードの中にまとめる
  const companyHitIds = new Set(hits.filter((h) => h.doc.type === 'company').map((h) => h.doc.id));
  const filtered = hits.filter(
    (h) => !(h.doc.type === 'person' && h.viaCompanyOnly && h.doc.companyId != null && companyHitIds.has(h.doc.companyId)),
  );

  filtered.sort((a, b) =>
    b.score - a.score
    || a.level.rank - b.level.rank
    || (a.doc.sortKey < b.doc.sortKey ? -1 : a.doc.sortKey > b.doc.sortKey ? 1 : 0)
    || (a.doc.type === b.doc.type ? 0 : a.doc.type === 'company' ? -1 : 1)
    || cmpId(a.doc.id, b.doc.id));

  const results = filtered.slice(0, limit).map((h) => ({
    ...h.doc.summary,
    score: h.score,
    matchLevel: h.level.label,
    isCandidate: !!h.level.candidate,
    matches: h.matches,
  }));
  return { query: q, results, total: filtered.length };
}
