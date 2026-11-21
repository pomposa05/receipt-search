// ===== アーティファクト版: 共通部品・データ保存・登録ルール =====
// データは claude.ai のデータベース（db 機能）に保存。読み書きは「投稿者（Contributor）」以上の権限を持つ人（所有者・編集者を含む）。閲覧者（Viewer）・組織外の閲覧者は読めない。
// collections: companies / persons / images

// ---------- 画面部品 ----------
function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false || c === '') return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  add(children);
  return el;
}
const fill = (el, ...kids) => { el.replaceChildren(); kids.flat().forEach((k) => { if (k !== null && k !== undefined && k !== false && k !== '') el.append(k); }); return el; };

function toast(message, type = 'info', ms = 3500) {
  const t = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

let openDialogs = 0;
function dialog({ title, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }], dismissible = true }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'dlg', 'aria-label': title });
    openDialogs++;
    const done = (v) => { d.close(); d.remove(); openDialogs--; resolve(v); };
    d.append(
      h('h2', { class: 'dlg-title' }, title),
      h('div', { class: 'dlg-body' }, typeof body === 'function' ? body(done) : body),
      h('div', { class: 'dlg-actions' }, buttons.map((b) => h('button', {
        type: 'button', class: `btn btn-${b.kind || 'ghost'}`, onclick: () => done(typeof b.value === 'function' ? b.value() : b.value),
      }, b.label))),
    );
    d.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) done(null); });
    document.body.append(d);
    d.showModal();
    (d.querySelector('.btn-primary') || d.querySelector('.dlg-actions .btn'))?.focus();
  });
}
async function confirmDialog(title, message, { okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  const v = await dialog({
    title,
    body: [].concat(message).map((m) => (m instanceof Node ? m : h('p', {}, m))),
    buttons: [{ label: cancelLabel, value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }],
  });
  return v === true;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const formatTime = (iso) => { const d = iso ? new Date(iso) : new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function copyText(text, anchorEl) {
  // クリック処理の中で同期的に呼ぶ（クリップボードはユーザー操作の直後のみ許可される）
  const fallback = () => {
    if (anchorEl) {
      const r = document.createRange(); r.selectNodeContents(anchorEl);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    toast('自動でコピーできませんでした。選択された文字を長押し（Ctrl+C）でコピーしてください。', 'error', 5000);
  };
  try {
    const p = navigator.clipboard?.writeText(text);
    if (!p) { fallback(); return; }
    p.then(() => toast('コピーしました', 'success', 1800), fallback);
  } catch { fallback(); }
}

function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}
const loading = (text = '読み込み中…') => h('div', { class: 'loading', role: 'status' }, [h('span', { class: 'spinner', 'aria-hidden': 'true' }), text]);
const errorBox = (message, retry) => h('div', { class: 'notice notice-error', role: 'alert' }, [
  h('p', {}, message), retry ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: retry }, '再試行') : null,
]);
function keywordChips(keywords, onPick) {
  const list = String(keywords || '').split(/[,、，]\s*/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return h('span', { class: 'muted' }, '（なし）');
  return h('span', { class: 'chips' }, list.map((k) => h('button', { type: 'button', class: 'chip chip-btn', onclick: () => onPick?.(k) }, k)));
}
function defaultReceiptName(personName, companyName) {
  const p = String(personName || '').trim().replace(/\s+/g, ' ');
  const c = String(companyName || '').trim().replace(/\s+/g, ' ');
  if (c && p) return `${c} ${p} 様`;
  if (c) return `${c} 御中`;
  if (p) return `${p} 様`;
  return '';
}
const shortId = (id) => String(id || '');
// 画像読み取りで読めなかった文字は「?」（全角「？」）で表される
const UNKNOWN_RE = /[?？]/;
const hasUnknown = (s) => UNKNOWN_RE.test(String(s || ''));
const UNKNOWN_MSG = '「?」は画像から読めなかった文字です。画像と見比べて正しい文字に直してください。';
/** 「?」を強調表示した要素にする */
function markUnknown(text) {
  const parts = String(text || '').split(/([?？])/);
  return h('span', {}, parts.filter((x) => x !== '').map((x) => (UNKNOWN_RE.test(x) ? h('mark', { class: 'unknown-char', title: '読めなかった文字' }, x) : x)));
}

// ---------- ランタイム機能 ----------
const RT = { db: null, assets: null, sample: null, downloads: null, user: null, canImages: false, canWrite: null };

// ---------- データ（db を購読してメモリに保持） ----------
const S = {
  companies: new Map(), persons: new Map(), images: new Map(), groups: new Map(),
  confirmed: { companies: false, persons: false, images: false, groups: false },
  index: null, listeners: new Set(), error: null,
};
const onData = (fn) => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
const notify = debounce(() => { for (const fn of [...S.listeners]) { try { fn(); } catch (e) { console.error(e); } } }, 60);

function subscribeAll() {
  for (const coll of ['companies', 'persons', 'images', 'groups']) {
    RT.db.collection(coll).onSnapshot((snap) => {
      const m = S[coll];
      m.clear();
      for (const d of snap.docs) m.set(d.id, { id: d.id, ...d.data() });
      if (!snap.metadata.fromCache) S.confirmed[coll] = true;
      S.index = null;
      notify();
    }, (e) => {
      S.error = e;
      notify();
    });
  }
}
const allConfirmed = () => S.confirmed.companies && S.confirmed.persons && S.confirmed.images && S.confirmed.groups;

class AppError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
function dbErrorMessage(e) {
  if (e instanceof AppError) return e.message;
  if (e?.code === 'invalid_argument') { const b = document.getElementById('perm-banner'); if (b) b.hidden = false; }
  switch (e?.code) {
    case 'quota_exceeded': return 'データベースの保存上限に達しました。不要な登録情報を削除してください。';
    case 'resource_exhausted': return '短時間に操作が集中しました。少し待ってからもう一度お試しください。';
    case 'invalid_argument': return 'このアカウントは「閲覧のみ」のため保存できません。所有者と同じアカウントでログインするか、所有者にこのアカウントを「編集者」として招待してもらってください。ページの所有者に、共有メニューで「投稿者」以上の権限を付けてもらってください（同じアカウントでログインしている端末なら保存できます）。';
    case 'revoked': case 'not_granted': return 'このページのデータを使う権限がありません。';
    default: return '保存できませんでした。通信状態を確認して、もう一度お試しください。';
  }
}

// ID: 先頭に種別（P=人物 C=企業 I=画像）。時刻順に並ぶ
function newId(prefix, map) {
  for (;;) {
    const id = `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    if (!map.has(id)) return id;
  }
}

function engineIndex() {
  if (S.index) return S.index;
  const auto = new Map();
  const companies = [...S.companies.values()].map((c) => {
    if (c.nameKanaAuto) auto.set(c.name, c.nameKanaAuto);
    return { id: c.id, name: c.name, name_kana: c.nameKana || '', keywords: withGroupNames(c), receipt_name: c.receiptName || '', memo: c.memo || '', updated_at: c.updatedAt };
  });
  const persons = [...S.persons.values()].map((p) => {
    if (p.nameKanaAuto) auto.set(p.name, p.nameKanaAuto);
    return {
      id: p.id, company_id: p.companyId || null, name: p.name, name_kana: p.nameKana || '', keywords: withGroupNames(p),
      receipt_name: p.receiptName || '', department: p.department || '', title: p.title || '', memo: p.memo || '', updated_at: p.updatedAt,
    };
  });
  const history = [...S.companies.values()].flatMap((c) => (c.nameHistory || []).map((x) => ({ company_id: c.id, old_name: x.oldName })));
  S.index = buildIndex({ companies, persons, companyNameHistory: history }, (s) => auto.get(s) || '');
  return S.index;
}

// ---------- 登録ルール ----------
const LIMITS = { name: 100, nameKana: 200, department: 100, title: 100, keywords: 1000, receiptName: 200, memo: 100000 };
const LABELS = { name: '名前', nameKana: '読み', department: '部署', title: '役職', keywords: 'キーワード', receiptName: '領収証宛名', memo: 'メモ' };
const nowIso = () => new Date().toISOString();
const clean = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const cleanLine = (v) => clean(v).replace(/\s+/g, ' ');
function checkLen(o, keys, prefix = '') {
  for (const k of keys) if ((o[k] || '').length > LIMITS[k]) throw new AppError('BAD_REQUEST', `${prefix}${LABELS[k]}が長すぎます（${LIMITS[k]}文字まで）。`, { field: k });
}
function personInput(b) {
  const p = {
    name: cleanLine(b.name), nameKana: cleanLine(b.nameKana), department: cleanLine(b.department), title: cleanLine(b.title),
    keywords: tidyKeywords(clean(b.keywords)), receiptName: cleanLine(b.receiptName), memo: clean(b.memo),
  };
  if (!p.name) throw new AppError('BAD_REQUEST', '名前を入力してください。', { field: 'name' });
  checkLen(p, Object.keys(LIMITS));
  return p;
}
function companyInput(b) {
  const c = { name: cleanLine(b.name), nameKana: cleanLine(b.nameKana), keywords: tidyKeywords(clean(b.keywords)), receiptName: cleanLine(b.receiptName), memo: clean(b.memo) };
  if (!c.name) throw new AppError('BAD_REQUEST', '企業名を入力してください。', { field: 'companyName' });
  checkLen({ ...c, name: c.name }, ['name', 'nameKana', 'keywords', 'receiptName', 'memo'], '企業の');
  return c;
}
const personCount = (companyId) => [...S.persons.values()].filter((p) => p.companyId === companyId).length;
function companySummary(c) { return { type: 'company', id: c.id, name: c.name, nameKana: c.nameKana || '', receiptName: c.receiptName || '', keywords: c.keywords || '', personCount: personCount(c.id), createdAt: c.createdAt, updatedAt: c.updatedAt }; }
function personSummary(p) {
  const c = p.companyId ? S.companies.get(p.companyId) : null;
  return { type: 'person', id: p.id, name: p.name, nameKana: p.nameKana || '', companyId: c ? c.id : null, companyName: c ? c.name : '', department: p.department || '', title: p.title || '', receiptName: p.receiptName || '', keywords: p.keywords || '', createdAt: p.createdAt, updatedAt: p.updatedAt };
}

function companyCandidates(name, excludeId = null) {
  const core = companyCore(name);
  const norm = normalize(name);
  if (!core) return [];
  const out = [];
  for (const c of S.companies.values()) {
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
  for (const p of S.persons.values()) {
    if (p.id === excludeId) continue;
    const pn = normalize(p.name);
    const sameCompany = companyId != null && p.companyId === companyId;
    let reason = null;
    if (pn === norm) reason = sameCompany ? '同じ企業に同じ名前' : '同じ名前（別企業または企業なし）';
    else if (sameCompany && [...norm].length >= 3 && editDistance(pn, norm) === 1) reason = '同じ企業に1文字違いの名前';
    if (reason) out.push({ ...personSummary(p), reason, sameCompany });
  }
  return out.sort((a, b) => Number(b.sameCompany) - Number(a.sameCompany) || cmpId(a.id, b.id));
}

async function resolveCompany(spec, { confirmNewCompany }) {
  const mode = spec?.mode || 'none';
  if (mode === 'none') return { companyId: null, company: null };
  if (mode === 'existing') {
    const c = S.companies.get(spec.id);
    if (!c) throw new AppError('COMPANY_NOT_FOUND', '選択した企業が見つかりません。削除された可能性があります。企業を選び直してください。');
    return { companyId: c.id, company: c };
  }
  const c = companyInput({ name: spec.name, nameKana: spec.nameKana });
  const cands = companyCandidates(c.name);
  if (cands.length && !confirmNewCompany) {
    throw new AppError('COMPANY_EXISTS', '同じ（または似た）企業名が既に登録されています。', { candidates: cands });
  }
  const ts = nowIso();
  const id = newId('C', S.companies);
  const doc = { ...c, receiptName: defaultReceiptName('', c.name), memo: '', memoVersion: 0, memoUpdatedAt: null, version: 1, nameHistory: [], imageIds: spec.imageIds || [], createdAt: ts, updatedAt: ts };
  await RT.db.doc(`companies/${id}`).set(doc);
  S.companies.set(id, { id, ...doc });
  return { companyId: id, company: { id, ...doc } };
}

async function createPerson(b) {
  const p = personInput(b);
  const plannedCompanyId = b.company?.mode === 'existing' ? b.company.id : null;
  if (!b.confirmDuplicate) {
    const cands = personCandidates(p.name, plannedCompanyId);
    if (cands.length) throw new AppError('POSSIBLE_DUPLICATE', '同じ（または似た）名前の登録情報があります。', { candidates: cands });
  }
  const imageIds = b.imageId ? [b.imageId] : [];
  const { companyId, company } = await resolveCompany({ ...b.company, imageIds: b.company?.mode === 'new' ? imageIds : [] }, { confirmNewCompany: b.confirmNewCompany });
  const ts = nowIso();
  const id = newId('P', S.persons);
  const doc = {
    ...p, companyId, receiptName: p.receiptName || defaultReceiptName(p.name, company?.name),
    memoVersion: p.memo ? 1 : 0, memoUpdatedAt: p.memo ? ts : null, version: 1, affiliationHistory: [], imageIds, groupIds: validGroupIds(b.groupIds), createdAt: ts, updatedAt: ts,
  };
  await RT.db.doc(`persons/${id}`).set(doc);
  S.persons.set(id, { id, ...doc });
  S.index = null;
  return { type: 'person', id };
}

/** 書き込んだ内容を手元のデータにも反映し、画面をすぐ更新する */
function applyLocal(coll, id, patch) {
  const m = S[coll];
  if (m.has(id)) m.set(id, { ...m.get(id), ...patch });
  S.index = null;
  notify();
}
async function fresh(coll, id) {
  const snap = await RT.db.doc(`${coll}/${id}`).get();
  if (!snap.exists) throw new AppError('NOT_FOUND', 'この登録情報は見つかりません（削除された可能性があります）。');
  return { id, ...snap.data() };
}

async function updatePerson(id, b) {
  const p = personInput(b);
  const cur = await fresh('persons', id);
  if (cur.version !== b.version) throw new AppError('VERSION_CONFLICT', '他の画面または端末でこの登録情報が更新されています。');
  const { companyId, company } = await resolveCompany(b.company, { confirmNewCompany: b.confirmNewCompany });
  const ts = nowIso();
  const patch = {
    name: p.name, nameKana: p.nameKana, department: p.department, title: p.title, keywords: p.keywords,
    receiptName: p.receiptName || defaultReceiptName(p.name, company?.name), companyId, version: cur.version + 1, updatedAt: ts,
  };
  if (Array.isArray(b.groupIds)) patch.groupIds = validGroupIds(b.groupIds);
  if (p.name !== cur.name) patch.nameKanaAuto = '';
  if ((cur.companyId || null) !== (companyId || null)) {
    const oldC = cur.companyId ? S.companies.get(cur.companyId) : null;
    patch.affiliationHistory = [{ oldCompanyId: cur.companyId || null, oldCompanyName: oldC?.name || '', newCompanyId: companyId, newCompanyName: company?.name || '', changedAt: ts }, ...(cur.affiliationHistory || [])].slice(0, 50);
  }
  await RT.db.doc(`persons/${id}`).update(patch);
  applyLocal('persons', id, patch);
  return { type: 'person', id };
}

async function deletePerson(id, version) {
  const cur = await fresh('persons', id);
  if (version != null && cur.version !== version) throw new AppError('VERSION_CONFLICT', '他の画面または端末でこの登録情報が更新されています。内容を確認してから削除してください。');
  await RT.db.doc(`persons/${id}`).delete();
  await cleanupImages(cur.imageIds || [], id);
  if (cur.photo?.assetId) await deletePhotoAsset(cur.photo.assetId, id);
}

async function createCompany(b) {
  const c = companyInput(b);
  if (!b.confirmDuplicate) {
    const cands = companyCandidates(c.name);
    if (cands.length) throw new AppError('COMPANY_EXISTS', '同じ（または似た）企業名が既に登録されています。', { candidates: cands });
  }
  const ts = nowIso();
  const id = newId('C', S.companies);
  const doc = {
    ...c, receiptName: c.receiptName || defaultReceiptName('', c.name), memoVersion: c.memo ? 1 : 0, memoUpdatedAt: c.memo ? ts : null,
    version: 1, nameHistory: [], imageIds: b.imageId ? [b.imageId] : [], groupIds: validGroupIds(b.groupIds), createdAt: ts, updatedAt: ts,
  };
  await RT.db.doc(`companies/${id}`).set(doc);
  S.companies.set(id, { id, ...doc });
  S.index = null;
  return { type: 'company', id };
}

async function updateCompany(id, b) {
  const c = companyInput(b);
  const cur = await fresh('companies', id);
  if (cur.version !== b.version) throw new AppError('VERSION_CONFLICT', '他の画面または端末でこの企業情報が更新されています。');
  if (c.name !== cur.name && !b.confirmDuplicate) {
    const cands = companyCandidates(c.name, id);
    if (cands.length) throw new AppError('COMPANY_EXISTS', '変更後の企業名と同じ（または似た）企業が既に登録されています。', { candidates: cands });
  }
  const ts = nowIso();
  const patch = { name: c.name, nameKana: c.nameKana, keywords: c.keywords, receiptName: c.receiptName || defaultReceiptName('', c.name), version: cur.version + 1, updatedAt: ts };
  if (Array.isArray(b.groupIds)) patch.groupIds = validGroupIds(b.groupIds);
  const affected = [];
  if (c.name !== cur.name) {
    patch.nameHistory = [{ oldName: cur.name, newName: c.name, changedAt: ts }, ...(cur.nameHistory || [])].slice(0, 50);
    patch.nameKanaAuto = '';
  }
  await RT.db.doc(`companies/${id}`).update(patch);
  applyLocal('companies', id, patch);
  if (c.name !== cur.name) {
    // 関連人物の領収証宛名に旧企業名が含まれていれば、指定に応じて置き換える（紐付けはIDなので変わらない）
    for (const p of [...S.persons.values()].filter((x) => x.companyId === id)) {
      const contains = (p.receiptName || '').includes(cur.name);
      let replaced = false;
      if (contains && b.replaceReceiptNames) {
        try {
          const fp = await fresh('persons', p.id);
          await RT.db.doc(`persons/${p.id}`).update({ receiptName: fp.receiptName.split(cur.name).join(c.name), version: fp.version + 1, updatedAt: ts });
          replaced = true;
        } catch (e) { console.warn(e); }
      }
      affected.push({ id: p.id, name: p.name, receiptContainsOldName: contains, replaced });
    }
  }
  return { type: 'company', id, affectedPersons: affected };
}

async function deleteCompany(id, version) {
  const cur = await fresh('companies', id);
  if (version != null && cur.version !== version) throw new AppError('VERSION_CONFLICT', '他の画面または端末でこの企業情報が更新されています。');
  const members = [...S.persons.values()].filter((p) => p.companyId === id);
  if (members.length) throw new AppError('COMPANY_HAS_PERSONS', `この企業には ${members.length} 人の人物が紐付いているため削除できません。先に人物を削除するか、別の企業へ所属を変更してください。`, { persons: members });
  await RT.db.doc(`companies/${id}`).delete();
  await cleanupImages(cur.imageIds || [], id);
}

async function updateMemo(coll, id, memoRaw, memoVersion) {
  const memo = clean(memoRaw);
  if (memo.length > LIMITS.memo) throw new AppError('BAD_REQUEST', `メモが長すぎます（${LIMITS.memo}文字まで）。`);
  const cur = await fresh(coll, id);
  if ((cur.memoVersion || 0) !== memoVersion) {
    throw new AppError('MEMO_CONFLICT', '他の画面または端末でこのメモが更新されています。', { currentMemo: cur.memo || '', memoVersion: cur.memoVersion || 0, memoUpdatedAt: cur.memoUpdatedAt });
  }
  if ((cur.memo || '') === memo) return { memo, memoVersion: cur.memoVersion || 0, memoUpdatedAt: cur.memoUpdatedAt };
  const ts = nowIso();
  const next = { memo, memoVersion: (cur.memoVersion || 0) + 1, memoUpdatedAt: ts, updatedAt: ts };
  await RT.db.doc(`${coll}/${id}`).update(next);
  return next;
}

// 画像: 登録情報から参照されなくなった画像は削除（個人情報を不要に残さない）
async function cleanupImages(imageIds, removedOwnerId) {
  for (const iid of imageIds) {
    const stillUsed = [...S.persons.values(), ...S.companies.values()].some((x) => x.id !== removedOwnerId && (x.imageIds || []).includes(iid));
    if (stillUsed) continue;
    const img = S.images.get(iid);
    try {
      if (img?.assetId && RT.assets) await RT.assets.delete(img.assetId);
      await RT.db.doc(`images/${iid}`).delete();
    } catch (e) { console.warn('画像の削除に失敗', e); }
  }
}

async function saveImage(pending) {
  // pending: { blob, sha256, originalHash, name, ocrText, width, height }
  if (!pending) return null;
  const existing = [...S.images.values()].find((i) => i.sha256 === pending.sha256);
  if (existing) return existing.id;
  if (!RT.assets) return null; // 編集権限がない場合は画像を保存しない
  const up = await RT.assets.upload(pending.blob, { type: 'image/jpeg' });
  const id = newId('I', S.images);
  const doc = {
    assetId: up.id, sha256: pending.sha256, originalHash: pending.originalHash || '', originalName: (pending.name || '').slice(0, 200),
    width: pending.width, height: pending.height, ocrText: (pending.ocrText || '').slice(0, 20000), createdAt: nowIso(),
  };
  await RT.db.doc(`images/${id}`).set(doc);
  S.images.set(id, { id, ...doc });
  return id;
}
function duplicateImageOwners(sha, originalHash) {
  const ids = [...S.images.values()].filter((i) => i.sha256 === sha || (originalHash && (i.originalHash === originalHash || i.sha256 === originalHash))).map((i) => i.id);
  if (!ids.length) return [];
  const out = [];
  for (const p of S.persons.values()) if ((p.imageIds || []).some((x) => ids.includes(x))) out.push({ type: 'person', id: p.id, name: p.name, companyName: S.companies.get(p.companyId)?.name || '' });
  for (const c of S.companies.values()) if ((c.imageIds || []).some((x) => ids.includes(x))) out.push({ type: 'company', id: c.id, name: c.name });
  return out;
}
const imageUrl = (imageId) => { const i = S.images.get(imageId); return i?.assetId ? `/_blob/${i.assetId}` : null; };

function duplicateGroups() {
  const pg = new Map();
  for (const p of S.persons.values()) { const k = normalize(p.name); if (!pg.has(k)) pg.set(k, []); pg.get(k).push(personSummary(p)); }
  const cg = new Map();
  for (const c of S.companies.values()) { const k = companyCore(c.name); if (!cg.has(k)) cg.set(k, []); cg.get(k).push(companySummary(c)); }
  return {
    persons: [...pg.values()].filter((g) => g.length > 1).map((items) => ({ key: items[0].name, sameCompany: new Set(items.map((i) => i.companyId)).size < items.length, items })),
    companies: [...cg.values()].filter((g) => g.length > 1).map((items) => ({ key: items[0].name, items })),
  };
}
function suggestCompanies(q, limit = 10) {
  const nq = normalize(q); const core = companyCore(q);
  if (!nq) return [];
  const scored = [];
  for (const c of S.companies.values()) {
    const n = normalize(c.name); const cc = companyCore(c.name); const k = normalize(c.nameKana || '');
    let s = 0;
    if (displayKey(c.name) === displayKey(q)) s = 100;
    else if (n === nq || cc === core) s = 90;
    else if (cc.startsWith(core) || n.startsWith(nq) || (k && k.startsWith(nq))) s = 80;
    else if (n.includes(nq) || (core && cc.includes(core)) || (k && k.includes(nq))) s = 70;
    else if ([...core].length >= 4 && editDistance(cc, core) <= 1) s = 50;
    if (s) scored.push({ s, c });
  }
  scored.sort((a, b) => b.s - a.s || cmpId(a.c.id, b.c.id));
  return scored.slice(0, limit).map((x) => companySummary(x.c));
}


// ===================== グループ =====================
// groups/{id}: { name, color(0-7), memo, version, createdAt, updatedAt }
// 所属は人物・企業の groupIds（グループIDの配列）で持つ。グループ名を変えても所属はIDなので変わらない。
const GROUP_COLORS = 8;
const groupList = () => [...S.groups.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja') || cmpId(a.id, b.id));
const validGroupIds = (ids) => [...new Set((ids || []).filter((g) => S.groups.has(g)))];
function withGroupNames(x) {
  const names = validGroupIds(x.groupIds).map((g) => S.groups.get(g).name);
  return [x.keywords || '', ...names].filter(Boolean).join(', ');
}
function groupMembers(groupId) {
  const persons = [...S.persons.values()].filter((p) => (p.groupIds || []).includes(groupId));
  const companies = [...S.companies.values()].filter((c) => (c.groupIds || []).includes(groupId));
  return { persons, companies, count: persons.length + companies.length };
}
function groupInput(b) {
  const g = { name: cleanLine(b.name), color: Math.max(0, Math.min(GROUP_COLORS - 1, Number(b.color) || 0)), memo: clean(b.memo).slice(0, 2000) };
  if (!g.name) throw new AppError('BAD_REQUEST', 'グループ名を入力してください。', { field: 'groupName' });
  if (g.name.length > 50) throw new AppError('BAD_REQUEST', 'グループ名が長すぎます（50文字まで）。', { field: 'groupName' });
  return g;
}
function groupNameTaken(name, excludeId = null) {
  const n = normalize(name);
  return groupList().find((g) => g.id !== excludeId && normalize(g.name) === n) || null;
}
async function createGroup(b) {
  const g = groupInput(b);
  const dup = groupNameTaken(g.name);
  if (dup) throw new AppError('GROUP_EXISTS', `「${dup.name}」というグループは既にあります。`, { group: dup });
  const ts = nowIso();
  const id = newId('G', S.groups);
  const doc = { ...g, version: 1, createdAt: ts, updatedAt: ts };
  await RT.db.doc(`groups/${id}`).set(doc);
  S.groups.set(id, { id, ...doc });
  S.index = null;
  return { type: 'group', id };
}
async function updateGroup(id, b) {
  const g = groupInput(b);
  const cur = await fresh('groups', id);
  if (cur.version !== b.version) throw new AppError('VERSION_CONFLICT', '他の画面または端末でこのグループが更新されています。');
  const dup = groupNameTaken(g.name, id);
  if (dup) throw new AppError('GROUP_EXISTS', `「${dup.name}」というグループは既にあります。`, { group: dup });
  const gpatch = { ...g, version: cur.version + 1, updatedAt: nowIso() };
  await RT.db.doc(`groups/${id}`).update(gpatch);
  applyLocal('groups', id, gpatch);
  S.index = null;
  return { type: 'group', id };
}
/** 1件の登録情報の所属グループを追加・削除する（登録情報の他の項目は変えない） */
async function setMembership(type, entityId, groupId, on) {
  const coll = type === 'company' ? 'companies' : 'persons';
  const cur = await fresh(coll, entityId);
  const ids = new Set(validGroupIds(cur.groupIds));
  if (on) ids.add(groupId); else ids.delete(groupId);
  const next = [...ids];
  if (JSON.stringify(next) === JSON.stringify(validGroupIds(cur.groupIds))) return false;
  const gp = { groupIds: next, version: (cur.version || 1) + 1, updatedAt: nowIso() };
  await RT.db.doc(`${coll}/${entityId}`).update(gp);
  applyLocal(coll, entityId, gp);
  return true;
}
/** 複数件をまとめて追加・削除（1件ずつ順番に書き込み、失敗したら止めて件数を返す） */
async function setMembershipMany(items, groupId, on, progress) {
  let done = 0;
  for (const it of items) {
    await setMembership(it.type, it.id, groupId, on);
    done++;
    progress?.(done, items.length);
  }
  S.index = null;
  return done;
}
async function deleteGroup(id, progress) {
  const m = groupMembers(id);
  const items = [...m.persons.map((p) => ({ type: 'person', id: p.id })), ...m.companies.map((c) => ({ type: 'company', id: c.id }))];
  await setMembershipMany(items, id, false, progress); // 先に所属を外す（登録情報そのものは削除しない）
  await RT.db.doc(`groups/${id}`).delete();
  S.groups.delete(id);
  S.index = null;
}
