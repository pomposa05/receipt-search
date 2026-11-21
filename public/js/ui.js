// 画面部品（要素作成・通知・確認ダイアログ・日時表示など）
// 利用者の入力値は必ず textContent で表示し、HTMLとして解釈させない（XSS対策）

/** 要素を作る: h('div', {class:'x', onclick}, [子要素や文字列]) */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------- 通知（トースト） ----------
export function toast(message, type = 'info', ms = 3500) {
  const root = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  root.append(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------- ダイアログ ----------
/**
 * 汎用ダイアログ。buttons: [{label, value, kind:'primary'|'danger'|'ghost'}]
 * 戻り値: 押されたボタンの value（閉じた場合は null）
 */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }], dismissible = true }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-title' });
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.append(
      h('h2', { id: 'dlg-title', class: 'dlg-title' }, title),
      h('div', { class: 'dlg-body' }, typeof body === 'function' ? body(done) : body),
      h('div', { class: 'dlg-actions' }, buttons.map((b) => h('button', {
        type: 'button', class: `btn btn-${b.kind || 'ghost'}`, onclick: () => done(typeof b.value === 'function' ? b.value() : b.value),
      }, b.label))),
    );
    d.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) done(null); });
    document.body.append(d);
    d.showModal();
    const primary = d.querySelector('.btn-primary') || d.querySelector('.dlg-actions .btn');
    primary?.focus();
  });
}

export async function confirmDialog(title, message, { okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  const v = await dialog({
    title,
    body: [].concat(message).map((m) => (m instanceof Node ? m : h('p', {}, m))),
    buttons: [
      { label: cancelLabel, value: false, kind: 'ghost' },
      { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

// ---------- 表示用 ----------
export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function formatTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = h('textarea', { class: 'sr-only', readonly: true }, text);
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('copy failed');
    }
    toast('コピーしました', 'success', 1800);
  } catch {
    toast('コピーできませんでした。文字を長押し（または選択）してコピーしてください。', 'error');
  }
}

export function keywordChips(keywords) {
  const list = String(keywords || '').split(/[,、，]\s*/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return h('span', { class: 'muted' }, '（なし）');
  return h('span', { class: 'chips' }, list.map((k) => h('a', { class: 'chip', href: `#/?q=${encodeURIComponent(k)}` }, k)));
}

export function field(label, control, { hint, required, id } = {}) {
  return h('div', { class: 'field' }, [
    h('label', { class: 'field-label', for: id }, [label, required ? h('span', { class: 'req' }, '必須') : null]),
    control,
    hint ? h('div', { class: 'field-hint' }, hint) : null,
  ]);
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function errorBox(message, retry) {
  return h('div', { class: 'notice notice-error', role: 'alert' }, [
    h('p', {}, message),
    retry ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: retry }, '再試行') : null,
  ]);
}

export function loading(text = '読み込み中…') {
  return h('div', { class: 'loading', role: 'status' }, [h('span', { class: 'spinner', 'aria-hidden': 'true' }), text]);
}

/** 領収証宛名の既定値（サーバーと同じ規則） */
export function defaultReceiptName(personName, companyName) {
  const p = String(personName || '').trim().replace(/\s+/g, ' ');
  const c = String(companyName || '').trim().replace(/\s+/g, ' ');
  if (c && p) return `${c} ${p} 様`;
  if (c) return `${c} 御中`;
  if (p) return `${p} 様`;
  return '';
}
