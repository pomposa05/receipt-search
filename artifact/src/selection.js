// ===== まとめて選択 → 宛名を一括表示（複数人から同時に領収証を頼まれたとき用） =====
// 選択はこの端末の画面内だけ（タブを閉じるまで保持）。登録情報には何も書き込まない。

const SEL = new Map(); // key "person:ID" / "company:ID" → { type, id, done }
const selListeners = new Set();
const SEL_KEY = 'receipt-selection';
try { for (const x of JSON.parse(sessionStorage.getItem(SEL_KEY) || '[]')) SEL.set(`${x.type}:${x.id}`, x); } catch { /* 保存できない環境では保持しない */ }
function selSave() { try { sessionStorage.setItem(SEL_KEY, JSON.stringify([...SEL.values()])); } catch { /* noop */ } }
function selNotify() { selSave(); for (const fn of [...selListeners]) { try { fn(); } catch (e) { console.error(e); } } }
const onSelChange = (fn) => { selListeners.add(fn); return () => selListeners.delete(fn); };
const isSel = (type, id) => SEL.has(`${type}:${id}`);
function setSel(type, id, on) {
  const k = `${type}:${id}`;
  if (on && !SEL.has(k)) SEL.set(k, { type, id, done: false });
  if (!on) SEL.delete(k);
}
function toggleSel(type, id, on) { setSel(type, id, on); selNotify(); }
function selectMany(items, on = true) { for (const x of items) setSel(x.type, x.id, on); selNotify(); }
function clearSel() { SEL.clear(); selNotify(); }
/** 選択中で、今も存在する登録情報（選んだ順） */
function selItems() {
  const out = [];
  for (const s of SEL.values()) {
    if (s.type === 'person') {
      const p = S.persons.get(s.id); if (!p) continue;
      const c = p.companyId ? S.companies.get(p.companyId) : null;
      out.push({ ...s, receipt: p.receiptName || defaultReceiptName(p.name, c?.name), person: p.name, company: c?.name || '', ref: p });
    } else {
      const c = S.companies.get(s.id); if (!c) continue;
      out.push({ ...s, receipt: companyReceiptName(c), person: '', company: c.name, ref: c });
    }
  }
  return out;
}

/** 行に付けるチェック欄 */
function selCheckbox(type, id, label) {
  const cb = h('input', { type: 'checkbox', class: 'sel-cb', checked: isSel(type, id), 'aria-label': `${label}を選択`, 'data-key': `${type}:${id}` });
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => toggleSel(type, id, cb.checked));
  return h('label', { class: 'sel-box', title: '選択（まとめて宛名を表示）', onclick: (e) => e.stopPropagation() }, cb);
}
/** 一覧の「すべて選択／解除」ボタン */
function selectAllButton(getItems, label = 'すべて選択') {
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' });
  let off = null;
  const render = () => {
    if (off && !btn.isConnected) { off(); return; } // 画面から消えたら購読をやめる
    const items = getItems();
    const all = items.length && items.every((x) => isSel(x.type, x.id));
    btn.textContent = all ? '選択を外す' : label;
    btn.disabled = !items.length;
  };
  btn.addEventListener('click', () => { const items = getItems(); const all = items.every((x) => isSel(x.type, x.id)); selectMany(items, !all); });
  render();
  off = onSelChange(render);
  return btn;
}

// ---------- 画面下の選択バー ----------
function mountSelectionBar() {
  const count = h('strong', {});
  const bar = h('div', { class: 'sel-bar', role: 'region', 'aria-label': '選択中の登録情報', hidden: true }, [
    h('span', { class: 'sel-count' }, [count, '件を選択中']),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => showSelected() }, '対象を表示'),
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => clearSel() }, '選択を解除'),
  ]);
  document.body.append(bar);
  const render = () => {
    // 画面上のチェック欄を選択状態に合わせる（別の画面で選んだ・解除した場合も）
    document.querySelectorAll('.sel-cb[data-key]').forEach((cb) => { cb.checked = SEL.has(cb.dataset.key); });
    const n = selItems().length;
    count.textContent = String(n);
    bar.hidden = n === 0;
    document.body.classList.toggle('has-sel-bar', n > 0);
  };
  onSelChange(render);
  onData(render);
  render();
}

// ---------- 一括表示（ポップアップ） ----------
async function showSelected() {
  const list = h('ol', { class: 'sel-list' });
  const summary = h('span', { class: 'small muted' });
  function render() {
    const items = selItems();
    const done = items.filter((x) => x.done).length;
    summary.textContent = `${items.length}件（発行済み ${done}件）`;
    fill(list, items.map((x, i) => {
      const receiptEl = h('div', { class: 'sel-receipt' }, x.receipt);
      const doneCb = h('input', { type: 'checkbox', checked: x.done, 'aria-label': `${x.receipt}を発行済みにする` });
      doneCb.addEventListener('change', () => { const s = SEL.get(`${x.type}:${x.id}`); if (s) s.done = doneCb.checked; selSave(); render(); });
      return h('li', { class: `sel-item ${x.done ? 'is-done' : ''}` }, [
        h('div', { class: 'sel-num' }, String(i + 1)),
        h('div', { class: 'sel-body' }, [
          h('div', { class: 'rc-row' }, [h('span', { class: 'rc-label' }, '宛名'), receiptEl]),
          x.person ? h('div', { class: 'rc-row' }, [h('span', { class: 'rc-label' }, '人物'), h('span', {}, x.person)]) : null,
          h('div', { class: 'rc-row' }, [h('span', { class: 'rc-label' }, '企業名'), h('span', {}, x.company || h('span', { class: 'muted' }, '企業の登録なし'))]),
        ]),
        h('div', { class: 'sel-actions' }, [
          h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => copyText(x.receipt, receiptEl) }, 'コピー'),
          h('label', { class: 'sel-done' }, [doneCb, ' 発行済み']),
          h('button', { type: 'button', class: 'btn btn-xs btn-danger-ghost', onclick: () => { toggleSel(x.type, x.id, false); render(); } }, '外す'),
        ]),
      ]);
    }));
    if (!items.length) list.append(h('li', { class: 'muted' }, '選択中の登録情報はありません。'));
  }
  render();
  const allBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: (e) => copyText(selItems().map((x) => x.receipt).join('\n'), list) }, 'すべての宛名をコピー');
  const allWithName = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => copyText(selItems().map((x) => [x.receipt, x.person, x.company].join('\t')).join('\n'), list) }, '人物・企業名つきでコピー');
  const v = await dialog({
    title: 'まとめて表示（領収証の宛名）',
    body: [
      h('div', { class: 'row sel-head' }, [summary, allBtn, allWithName]),
      h('p', { class: 'small muted' }, '書き終えたものに「発行済み」の印を付けられます（この端末の画面内だけの印で、登録情報は変わりません）。'),
      list,
    ],
    buttons: [{ label: '選択を解除して閉じる', value: 'clear' }, { label: '閉じる', value: true, kind: 'primary' }],
  });
  if (v === 'clear') clearSel();
}
