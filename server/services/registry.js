// 登録情報の業務ルール
// - 人物と企業は内部ID（company_id）でのみ関連付ける。文字列一致で自動的に紐付けない。
// - 同名の人物・企業は自動で同一と判断しない（重複候補を返し、利用者の確認を必須にする）。
// - 更新は version による楽観ロックで、他の端末での更新を上書きしない。
// - メモは「人物ID」または「企業ID」に紐付く（人物メモ／企業メモ）。memo_version で衝突を検知する。
import { transaction } from '../db/database.js';
import { AppError, badRequest, notFound, conflict } from '../errors.js';
import {
  normalize, companyCore, nfkc, tidyKeywords, displayKey,
} from '../search/normalize.js';
import { editDistance } from '../search/similarity.js';

const LIMITS = {
  name: 100, name_kana: 200, department: 100, title: 100, keywords: 1000, receipt_name: 200, memo: 100000,
};
const LABELS = {
  name: '名前', name_kana: '読み', department: '部署', title: '役職', keywords: 'キーワード', receipt_name: '領収証宛名', memo: 'メモ',
};

const now = () => new Date().toISOString();

function clean(v) {
  // 前後の空白を除去し、制御文字（改行・タブ以外）を取り除く
  return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}
function cleanLine(v) {
  return clean(v).replace(/\s+/g, ' ');
}
function checkLen(obj, keys, labelPrefix = '') {
  for (const k of keys) {
    if ((obj[k] || '').length > LIMITS[k]) {
      throw badRequest(`${labelPrefix}${LABELS[k]}が長すぎます（${LIMITS[k]}文字まで）。`, { field: k });
    }
  }
}

/** 領収証宛名の既定値 */
export function defaultReceiptName(personName, companyName) {
  const p = cleanLine(personName);
  const c = cleanLine(companyName);
  if (c && p) return `${c} ${p} 様`;
  if (c) return `${c} 御中`;
  if (p) return `${p} 様`;
  return '';
}

function parseId(v, label = 'ID') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${label}が正しくありません。`);
  return n;
}

export function createRegistry({ db, companies, persons, images, onChange = () => {} }) {
  const changed = () => onChange();

  // ---------- 入力の整形 ----------
  function personInput(body) {
    const p = {
      name: cleanLine(body.name),
      name_kana: cleanLine(body.nameKana),
      department: cleanLine(body.department),
      title: cleanLine(body.title),
      keywords: tidyKeywords(clean(body.keywords)),
      receipt_name: cleanLine(body.receiptName),
      memo: clean(body.memo),
    };
    if (!p.name) throw badRequest('名前を入力してください。', { field: 'name' });
    checkLen(p, Object.keys(LIMITS));
    return p;
  }
  function companyInput(body) {
    const c = {
      name: cleanLine(body.name),
      name_kana: cleanLine(body.nameKana),
      keywords: tidyKeywords(clean(body.keywords)),
      receipt_name: cleanLine(body.receiptName),
      memo: clean(body.memo),
    };
    if (!c.name) throw badRequest('企業名を入力してください。', { field: 'companyName' });
    checkLen(c, ['name', 'name_kana', 'keywords', 'receipt_name', 'memo'], '企業の');
    return c;
  }

  // ---------- 重複候補 ----------
  function companyCandidates(name, excludeId = null) {
    const core = companyCore(name);
    const norm = normalize(name);
    if (!core) return [];
    const out = [];
    for (const c of companies.listWithCounts()) {
      if (c.id === excludeId) continue;
      const cc = companyCore(c.name);
      let reason = null;
      if (displayKey(c.name) === displayKey(name)) reason = '同じ企業名';
      else if (normalize(c.name) === norm || cc === core) reason = '表記違いの同名';
      else if ([...core].length >= 4 && editDistance(cc, core) === 1) reason = '1文字違いの企業名';
      if (reason) out.push({ ...companySummary(c), reason });
    }
    return out;
  }

  function personCandidates(name, companyId, excludeId = null) {
    const norm = normalize(name);
    if (!norm) return [];
    const out = [];
    for (const p of persons.listWithCompany()) {
      if (p.id === excludeId) continue;
      const pn = normalize(p.name);
      const sameCompany = companyId != null && p.company_id === companyId;
      let reason = null;
      if (pn === norm) reason = sameCompany ? '同じ企業に同じ名前' : '同じ名前（別企業または企業なし）';
      else if (sameCompany && [...norm].length >= 3 && editDistance(pn, norm) === 1) reason = '同じ企業に1文字違いの名前';
      if (reason) out.push({ ...personSummary(p), reason, sameCompany });
    }
    out.sort((a, b) => Number(b.sameCompany) - Number(a.sameCompany) || a.id - b.id);
    return out;
  }

  // ---------- 企業の指定（既存ID / 新規 / なし）を解決 ----------
  function resolveCompany(spec, { confirmNewCompany }) {
    const mode = spec?.mode || 'none';
    if (mode === 'none') return { companyId: null, company: null, created: false };
    if (mode === 'existing') {
      const id = parseId(spec.id, '企業ID');
      const c = companies.get(id);
      if (!c) throw new AppError(404, 'COMPANY_NOT_FOUND', '選択した企業が見つかりません。削除された可能性があります。企業を選び直してください。');
      return { companyId: id, company: c, created: false };
    }
    if (mode === 'new') {
      const c = companyInput({ name: spec.name, nameKana: spec.nameKana, keywords: spec.keywords });
      const cands = companyCandidates(c.name);
      if (cands.length && !confirmNewCompany) {
        throw conflict('COMPANY_EXISTS', '同じ（または似た）企業名が既に登録されています。既存の企業に紐付けるか、別の企業として新規登録するか選んでください。', { candidates: cands });
      }
      c.receipt_name = defaultReceiptName('', c.name);
      const id = companies.insert(c, now());
      return { companyId: id, company: companies.get(id), created: true };
    }
    throw badRequest('企業の指定方法が正しくありません。');
  }

  function linkImage(type, entityId, imageId, ts) {
    if (imageId == null || imageId === '') return;
    const id = parseId(imageId, '画像ID');
    if (!images.get(id)) throw new AppError(404, 'IMAGE_NOT_FOUND', '取り込んだ画像が見つかりません。もう一度画像を取り込んでください。');
    images.link(type, entityId, id, ts);
  }

  // ---------- 人物 ----------
  function createPerson(body) {
    const p = personInput(body);
    return transaction(db, () => {
      // 企業の解決より先に人物の重複を確認（新規企業を作ってから中断しないため）
      const plannedCompanyId = body.company?.mode === 'existing' ? Number(body.company.id) : null;
      if (!body.confirmDuplicate) {
        const cands = personCandidates(p.name, plannedCompanyId);
        if (cands.length) {
          throw conflict('POSSIBLE_DUPLICATE', '同じ（または似た）名前の登録情報があります。同一人物の場合は既存の登録情報を開いてください。別人の場合は「別人として登録」を選んでください。', { candidates: cands });
        }
      }
      const { companyId, company } = resolveCompany(body.company, body);
      p.company_id = companyId;
      if (!p.receipt_name) p.receipt_name = defaultReceiptName(p.name, company?.name);
      const ts = now();
      const id = persons.insert(p, ts);
      linkImage('person', id, body.imageId, ts);
      if (company) linkImageToCompanyIfNew(body, company, ts);
      changed();
      return getPerson(id);
    });
  }

  function linkImageToCompanyIfNew(body, company, ts) {
    if (body.company?.mode === 'new' && body.imageId) linkImage('company', company.id, body.imageId, ts);
  }

  function updatePerson(idRaw, body) {
    const id = parseId(idRaw);
    const p = personInput(body);
    const version = Number(body.version);
    return transaction(db, () => {
      const cur = persons.get(id);
      if (!cur) throw notFound();
      if (cur.version !== version) {
        throw conflict('VERSION_CONFLICT', '他の画面または端末でこの登録情報が更新されています。最新の内容を読み込んでから編集してください。', { current: personDetail(cur) });
      }
      const { companyId, company } = resolveCompany(body.company, body);
      p.company_id = companyId;
      if (!p.receipt_name) p.receipt_name = defaultReceiptName(p.name, company?.name);
      const ts = now();
      if (persons.update(id, version, p, ts) !== 1) throw conflict('VERSION_CONFLICT', '更新が競合しました。最新の内容を読み込んでください。');
      if ((cur.company_id ?? null) !== (companyId ?? null)) {
        persons.insertHistory(id, cur.company_id, cur.company_name || '', companyId, company?.name || '', ts);
      }
      linkImage('person', id, body.imageId, ts);
      if (company) linkImageToCompanyIfNew(body, company, ts);
      changed();
      return getPerson(id);
    });
  }

  function deletePerson(idRaw, versionRaw) {
    const id = parseId(idRaw);
    return transaction(db, () => {
      const cur = persons.get(id);
      if (!cur) throw notFound();
      if (versionRaw != null && versionRaw !== '' && Number(versionRaw) !== cur.version) {
        throw conflict('VERSION_CONFLICT', '他の画面または端末でこの登録情報が更新されています。内容を確認してから削除してください。');
      }
      images.unlinkEntity('person', id);
      persons.delete(id);
      changed();
      return { deleted: true, id };
    });
  }

  function updatePersonMemo(idRaw, body) {
    const id = parseId(idRaw);
    const memo = clean(body.memo);
    if (memo.length > LIMITS.memo) throw badRequest(`メモが長すぎます（${LIMITS.memo}文字まで）。`);
    return transaction(db, () => {
      const cur = persons.get(id);
      if (!cur) throw notFound();
      if (cur.memo_version !== Number(body.memoVersion)) {
        throw conflict('MEMO_CONFLICT', '他の画面または端末でこのメモが更新されています。', {
          currentMemo: cur.memo, memoVersion: cur.memo_version, memoUpdatedAt: cur.memo_updated_at,
        });
      }
      if (cur.memo === memo) return memoResult(cur);
      persons.updateMemo(id, cur.memo_version, memo, now());
      changed();
      return memoResult(persons.get(id));
    });
  }

  function getPerson(idRaw) {
    const id = parseId(idRaw);
    const p = persons.get(id);
    if (!p) throw notFound();
    return personDetail(p);
  }

  function personDetail(p) {
    const c = p.company_id != null ? companies.get(p.company_id) : null;
    return {
      type: 'person',
      id: p.id,
      name: p.name,
      nameKana: p.name_kana,
      department: p.department,
      title: p.title,
      keywords: p.keywords,
      receiptName: p.receipt_name,
      memo: p.memo,
      memoVersion: p.memo_version,
      memoUpdatedAt: p.memo_updated_at,
      version: p.version,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      company: c ? {
        id: c.id, name: c.name, nameKana: c.name_kana, receiptName: c.receipt_name,
        personCount: persons.countByCompany(c.id),
      } : null,
      sameNameCount: personCandidates(p.name, null, p.id).filter((x) => normalize(x.name) === normalize(p.name)).length,
      images: images.forEntity('person', p.id),
      affiliationHistory: persons.history(p.id),
    };
  }

  // ---------- 企業 ----------
  function createCompany(body) {
    const c = companyInput(body);
    return transaction(db, () => {
      if (!body.confirmDuplicate) {
        const cands = companyCandidates(c.name);
        if (cands.length) {
          throw conflict('COMPANY_EXISTS', '同じ（または似た）企業名が既に登録されています。同じ企業の場合は既存の企業を開いてください。別の企業の場合は「別の企業として登録」を選んでください。', { candidates: cands });
        }
      }
      if (!c.receipt_name) c.receipt_name = defaultReceiptName('', c.name);
      const ts = now();
      const id = companies.insert(c, ts);
      linkImage('company', id, body.imageId, ts);
      changed();
      return getCompany(id);
    });
  }

  function updateCompany(idRaw, body) {
    const id = parseId(idRaw);
    const c = companyInput(body);
    const version = Number(body.version);
    return transaction(db, () => {
      const cur = companies.get(id);
      if (!cur) throw notFound();
      if (cur.version !== version) {
        throw conflict('VERSION_CONFLICT', '他の画面または端末でこの企業情報が更新されています。最新の内容を読み込んでから編集してください。', { current: companyDetail(cur) });
      }
      if (c.name !== cur.name && !body.confirmDuplicate) {
        const cands = companyCandidates(c.name, id);
        if (cands.length) {
          throw conflict('COMPANY_EXISTS', '変更後の企業名と同じ（または似た）企業が既に登録されています。本当にこの名前に変更しますか？', { candidates: cands });
        }
      }
      if (!c.receipt_name) c.receipt_name = defaultReceiptName('', c.name);
      const ts = now();
      if (companies.update(id, version, c, ts) !== 1) throw conflict('VERSION_CONFLICT', '更新が競合しました。最新の内容を読み込んでください。');
      const affected = [];
      if (c.name !== cur.name) {
        companies.insertHistory(id, cur.name, c.name, ts);
        // 関連人物の領収証宛名に旧企業名が含まれていれば、利用者の指定に応じて置き換える
        for (const p of persons.byCompany(id)) {
          const contains = p.receipt_name.includes(cur.name);
          let replaced = false;
          if (contains && body.replaceReceiptNames) {
            persons.updateReceipt(p.id, p.receipt_name.split(cur.name).join(c.name), ts);
            replaced = true;
          }
          affected.push({ id: p.id, name: p.name, receiptContainsOldName: contains, replaced });
        }
      }
      linkImage('company', id, body.imageId, ts);
      changed();
      return { ...getCompany(id), affectedPersons: affected };
    });
  }

  function deleteCompany(idRaw, versionRaw) {
    const id = parseId(idRaw);
    return transaction(db, () => {
      const cur = companies.get(id);
      if (!cur) throw notFound();
      if (versionRaw != null && versionRaw !== '' && Number(versionRaw) !== cur.version) {
        throw conflict('VERSION_CONFLICT', '他の画面または端末でこの企業情報が更新されています。内容を確認してから削除してください。');
      }
      const members = persons.byCompany(id);
      if (members.length) {
        throw conflict('COMPANY_HAS_PERSONS', `この企業には ${members.length} 人の人物が紐付いているため削除できません。先に人物を削除するか、別の企業へ所属を変更してください。`, {
          persons: members.map((p) => ({ id: p.id, name: p.name })),
        });
      }
      images.unlinkEntity('company', id);
      companies.delete(id);
      changed();
      return { deleted: true, id };
    });
  }

  function updateCompanyMemo(idRaw, body) {
    const id = parseId(idRaw);
    const memo = clean(body.memo);
    if (memo.length > LIMITS.memo) throw badRequest(`メモが長すぎます（${LIMITS.memo}文字まで）。`);
    return transaction(db, () => {
      const cur = companies.get(id);
      if (!cur) throw notFound();
      if (cur.memo_version !== Number(body.memoVersion)) {
        throw conflict('MEMO_CONFLICT', '他の画面または端末でこのメモが更新されています。', {
          currentMemo: cur.memo, memoVersion: cur.memo_version, memoUpdatedAt: cur.memo_updated_at,
        });
      }
      if (cur.memo === memo) return memoResult(cur);
      companies.updateMemo(id, cur.memo_version, memo, now());
      changed();
      return memoResult(companies.get(id));
    });
  }

  function getCompany(idRaw) {
    const id = parseId(idRaw);
    const c = companies.get(id);
    if (!c) throw notFound();
    return companyDetail(c);
  }

  function companyDetail(c) {
    return {
      type: 'company',
      id: c.id,
      name: c.name,
      nameKana: c.name_kana,
      keywords: c.keywords,
      receiptName: c.receipt_name,
      memo: c.memo,
      memoVersion: c.memo_version,
      memoUpdatedAt: c.memo_updated_at,
      version: c.version,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      persons: persons.byCompany(c.id).map((p) => ({
        id: p.id, name: p.name, nameKana: p.name_kana, department: p.department, title: p.title, receiptName: p.receipt_name,
      })),
      sameNameCount: companyCandidates(c.name, c.id).length,
      images: images.forEntity('company', c.id),
      nameHistory: companies.history(c.id),
    };
  }

  // ---------- 一覧・重複・統計 ----------
  function listPersons() {
    return persons.listWithCompany().map(personSummary);
  }
  function listCompanies() {
    return companies.listWithCounts().map(companySummary);
  }
  function recent(limit = 10) {
    return persons.recent(limit).map(personSummary);
  }
  function suggestCompanies(q, limit = 10) {
    const nq = normalize(q);
    const core = companyCore(q);
    if (!nq) return [];
    const scored = [];
    for (const c of companies.listWithCounts()) {
      const n = normalize(c.name);
      const cc = companyCore(c.name);
      const k = normalize(c.name_kana);
      let s = 0;
      if (displayKey(c.name) === displayKey(q)) s = 100;
      else if (n === nq || cc === core) s = 90;
      else if (cc.startsWith(core) || n.startsWith(nq) || (k && k.startsWith(nq))) s = 80;
      else if (n.includes(nq) || (core && cc.includes(core)) || (k && k.includes(nq))) s = 70;
      else if ([...core].length >= 4 && editDistance(cc, core) <= 1) s = 50;
      if (s) scored.push({ s, c });
    }
    scored.sort((a, b) => b.s - a.s || a.c.id - b.c.id);
    return scored.slice(0, limit).map((x) => companySummary(x.c));
  }

  function duplicateGroups() {
    const pg = new Map();
    for (const p of persons.listWithCompany()) {
      const k = normalize(p.name);
      if (!pg.has(k)) pg.set(k, []);
      pg.get(k).push(personSummary(p));
    }
    const cg = new Map();
    for (const c of companies.listWithCounts()) {
      const k = companyCore(c.name);
      if (!cg.has(k)) cg.set(k, []);
      cg.get(k).push(companySummary(c));
    }
    return {
      persons: [...pg.values()].filter((g) => g.length > 1).map((items) => ({
        key: items[0].name,
        sameCompany: new Set(items.map((i) => i.companyId)).size < items.length,
        items,
      })),
      companies: [...cg.values()].filter((g) => g.length > 1).map((items) => ({ key: items[0].name, items })),
    };
  }

  function checkDuplicates(body) {
    if (body.kind === 'company') return { candidates: companyCandidates(cleanLine(body.name), body.excludeId ? Number(body.excludeId) : null) };
    const companyId = body.companyId ? Number(body.companyId) : null;
    return { candidates: personCandidates(cleanLine(body.name), companyId, body.excludeId ? Number(body.excludeId) : null) };
  }

  return {
    createPerson, updatePerson, deletePerson, updatePersonMemo, getPerson,
    createCompany, updateCompany, deleteCompany, updateCompanyMemo, getCompany,
    listPersons, listCompanies, recent, suggestCompanies, duplicateGroups, checkDuplicates,
  };
}

function memoResult(r) {
  return { memo: r.memo, memoVersion: r.memo_version, memoUpdatedAt: r.memo_updated_at, updatedAt: r.updated_at };
}

export function personSummary(p) {
  return {
    type: 'person',
    id: p.id,
    name: p.name,
    nameKana: p.name_kana,
    companyId: p.company_id ?? null,
    companyName: p.company_name || '',
    department: p.department,
    title: p.title,
    receiptName: p.receipt_name,
    keywords: p.keywords,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export function companySummary(c) {
  return {
    type: 'company',
    id: c.id,
    name: c.name,
    nameKana: c.name_kana,
    receiptName: c.receipt_name,
    keywords: c.keywords,
    personCount: c.person_count ?? 0,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

export { nfkc };
