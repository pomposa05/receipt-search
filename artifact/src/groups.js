// ===== グループ分け: 画面部品 =====

const GROUP_COLOR_NAMES = ['青', '緑', '橙', '赤', '紫', '水色', '茶', '灰'];

function groupChip(g, { onClick, count, small = false } = {}) {
  const label = count != null ? [h('span', { class: 'gdot', 'aria-hidden': 'true' }), g.name, h('span', { class: 'gcount' }, String(count))] : [h('span', { class: 'gdot', 'aria-hidden': 'true' }), g.name];
  return onClick
    ? h('button', { type: 'button', class: `gchip g${g.color || 0} ${small ? 'gchip-sm' : ''}`, onclick: onClick }, label)
    : h('span', { class: `gchip g${g.color || 0} ${small ? 'gchip-sm' : ''}` }, label);
}
/** 所属グループのチップ一覧（クリックでグループ画面へ） */
function groupChips(ids, { small = false, empty = null } = {}) {
  const gs = validGroupIds(ids).map((g) => S.groups.get(g)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));
  if (!gs.length) return empty;
  return h('span', { class: 'chips' }, gs.map((g) => groupChip(g, { small, onClick: (e) => { e.stopPropagation(); go('group', { id: g.id }); } })));
}

/** 登録・編集画面のグループ選択（タップで切り替え。新しいグループもその場で作れる） */
function groupPicker(initialIds = []) {
  let selected = new Set(validGroupIds(initialIds));
  const box = h('div', { class: 'chips gpicker' });
  const newName = h('input', { type: 'text', class: 'input input-inline', placeholder: '新しいグループ名', maxlength: 50, 'aria-label': '新しいグループ名' });
  const addBtn = h('button', { type: 'button', class: 'btn btn-xs' }, '＋ 作成して追加');
  const msg = h('div', { class: 'small warn-text', role: 'status' });
  function render() {
    const gs = groupList();
    fill(box, gs.length ? gs.map((g) => {
      const on = selected.has(g.id);
      return h('button', { type: 'button', class: `gchip g${g.color || 0} gtoggle ${on ? 'on' : ''}`, 'aria-pressed': String(on), onclick: () => { if (on) selected.delete(g.id); else selected.add(g.id); render(); } },
        [h('span', { class: 'gcheck', 'aria-hidden': 'true' }, on ? '✓' : '＋'), g.name]);
    }) : h('span', { class: 'small muted' }, 'まだグループがありません。下で作成できます。'));
  }
  addBtn.addEventListener('click', async () => {
    msg.textContent = '';
    const name = newName.value.trim();
    if (!name) { msg.textContent = 'グループ名を入力してください。'; return; }
    const exist = groupNameTaken(name);
    if (exist) { selected.add(exist.id); newName.value = ''; render(); msg.textContent = `「${exist.name}」は既にあるため、それを選びました。`; return; }
    addBtn.disabled = true;
    try {
      const r = await createGroup({ name, color: S.groups.size % GROUP_COLORS });
      selected.add(r.id); newName.value = ''; render();
      toast(`グループ「${name}」を作成しました`, 'success');
    } catch (e) { msg.textContent = dbErrorMessage(e); } finally { addBtn.disabled = false; }
  });
  newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });
  render();
  const off = onData(render);
  const wrap = h('div', { class: 'field' }, [
    h('div', { class: 'field-label' }, 'グループ（任意・複数選べます）'),
    box,
    h('div', { class: 'row gnew' }, [newName, addBtn]),
    msg,
  ]);
  return { wrap, value: () => validGroupIds([...selected]), key: () => JSON.stringify(validGroupIds([...selected]).sort()), cleanup: off };
}

// ---------- 検索画面のグループ絞り込み ----------
let activeGroupFilter = '';
function groupFilterBar(onChange) {
  const bar = h('div', { class: 'gfilter', role: 'group', 'aria-label': 'グループで絞り込む' });
  function render() {
    const gs = groupList();
    if (activeGroupFilter && !S.groups.has(activeGroupFilter)) activeGroupFilter = '';
    bar.hidden = !gs.length;
    fill(bar, [
      h('span', { class: 'small muted' }, 'グループ:'),
      h('button', { type: 'button', class: `gchip gall ${!activeGroupFilter ? 'on' : ''}`, 'aria-pressed': String(!activeGroupFilter), onclick: () => { activeGroupFilter = ''; render(); onChange(); } }, 'すべて'),
      ...gs.map((g) => {
        const on = activeGroupFilter === g.id;
        const b = groupChip(g, { count: groupMembers(g.id).count, onClick: () => { activeGroupFilter = on ? '' : g.id; render(); onChange(); } });
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
        return b;
      }),
    ]);
  }
  render();
  return { el: bar, render };
}
const inActiveGroup = (type, id) => {
  if (!activeGroupFilter) return true;
  const x = type === 'company' ? S.companies.get(id) : S.persons.get(id);
  return (x?.groupIds || []).includes(activeGroupFilter);
};

/** グループのメンバー一覧（人物は所属企業も表示）を名前順で返す */
function groupMemberCards(groupId) {
  const m = groupMembers(groupId);
  const key = (x) => normalize(x.nameKana || x.nameKanaAuto || x.name);
  const ps = m.persons.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : cmpId(a.id, b.id))).map(personSummary);
  const cs = m.companies.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : cmpId(a.id, b.id))).map((c) => ({ ...companySummary(c), persons: [...S.persons.values()].filter((p) => p.companyId === c.id).slice(0, 8).map((p) => ({ id: p.id, name: p.name })) }));
  return { ps, cs, count: m.count };
}
/** 宛名の一覧（コピー用）。人物は宛名、企業のみの登録は企業の宛名 */
function groupReceiptText(groupId) {
  const { ps, cs } = groupMemberCards(groupId);
  return [...ps.map((p) => `${p.receiptName || defaultReceiptName(p.name, p.companyName)}\t${p.name}`), ...cs.map((c) => c.receiptName || `${c.name} 御中`)].join('\n');
}

// ---------- グループ画面 ----------
function viewGroup({ outlet, params }) {
  const status = h('div', { class: 'small', 'aria-live': 'polite' });
  function render() {
    const g = S.groups.get(params.id);
    if (!g) {
      if (!allConfirmed()) { fill(outlet, loading()); return; }
      notFoundView(outlet, 'このグループは見つかりません（削除された可能性があります）。');
      return;
    }
    const { ps, cs, count } = groupMemberCards(g.id);
    // 同じ名前のキーワードが付いた人物と、人物が登録されていない企業（企業のみの登録）を候補にする
    const kwMatch = (x) => !(x.groupIds || []).includes(g.id) && splitKeywords(x.keywords).some((k) => normalize(k) === normalize(g.name));
    const kwCands = [...[...S.persons.values()].filter(kwMatch), ...[...S.companies.values()].filter((c) => kwMatch(c) && !personCount(c.id))];
    const memberRow = (x, type) => h('li', { class: 'gm-row' }, [
      selCheckbox(type, x.id, x.name),
      h('button', { type: 'button', class: 'gm-main', onclick: () => go(type, { id: x.id }) }, [
        type === 'person' ? avatar(S.persons.get(x.id) || x, 'xs') : h('span', { class: 'type-tag type-co' }, '企業'),
        h('span', { class: 'gm-receipt' }, x.receiptName || '（宛名未設定）'),
        type === 'person' ? h('span', { class: 'gm-name' }, x.name) : null,
        h('span', { class: 'small muted' }, type === 'person' ? (x.companyName || '企業なし') : x.name),
      ]),
      h('button', { type: 'button', class: 'btn btn-xs btn-danger-ghost', onclick: async () => {
        if (!(await confirmDialog('グループから外します', [`「${x.name}」をグループ「${g.name}」から外します。`, '登録情報そのものは削除されません。'], { okLabel: '外す' }))) return;
        try { await setMembership(type, x.id, g.id, false); toast('グループから外しました', 'success'); } catch (e) { toast(dbErrorMessage(e), 'error', 6000); }
      } }, '外す'),
    ]);
    fill(outlet,
      h('div', { class: 'page-head' }, [
        backLink('← 戻る'),
        h('div', { class: 'title-row' }, [h('h1', {}, [h('span', { class: `gdot-lg g${g.color || 0}`, 'aria-hidden': 'true' }), g.name]), h('span', { class: 'id-badge' }, `グループ ${count}件`)]),
        g.memo ? h('p', { class: 'muted' }, g.memo) : null,
      ]),
      h('div', { class: 'row' }, [
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openAddMembers(g) }, '＋ メンバーを追加'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => go('register', { groupId: g.id }) }, 'このグループで新規登録'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => go('register', { type: 'bulk', groupId: g.id }) }, '一覧から一括登録'),
        count ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: (e) => copyText(groupReceiptText(g.id), e.currentTarget) }, '宛名を一覧でコピー') : null,
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => editGroupDialog(g) }, '名前・色を変更'),
      ]),
      kwCands.length ? h('div', { class: 'notice notice-info' }, [
        h('p', {}, `キーワードに「${g.name}」が付いている登録情報が${kwCands.length}件あります。まとめてこのグループに追加できます。`),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const n = await setMembershipMany(kwCands.map((x) => ({ type: S.companies.has(x.id) ? 'company' : 'person', id: x.id })), g.id, true, (d, t) => { status.textContent = `追加中… ${d} / ${t}`; });
            status.textContent = ''; toast(`${n}件をグループに追加しました`, 'success');
          } catch (err) { status.textContent = ''; toast(`途中で止まりました: ${dbErrorMessage(err)}`, 'error', 7000); }
        } }, `${kwCands.length}件をまとめて追加`),
      ]) : null,
      status,
      h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, [
          h('h2', { class: 'card-title' }, `メンバー（${count}件）`),
          count ? selectAllButton(() => [...ps.map((x) => ({ type: 'person', id: x.id })), ...cs.map((x) => ({ type: 'company', id: x.id }))]) : null,
        ]),
        count ? h('p', { class: 'small muted' }, '複数人から同時に領収証を頼まれたときは、チェックを入れて画面下の「対象を表示」を押すと、宛名をまとめて表示できます。') : null,
        count ? h('ul', { class: 'gm-list' }, [...ps.map((p) => memberRow(p, 'person')), ...cs.map((c) => memberRow(c, 'company'))])
          : h('p', { class: 'muted' }, 'まだメンバーがいません。「＋ メンバーを追加」から選ぶか、登録画面でこのグループを選んでください。'),
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'card-title' }, 'グループの削除'),
        h('p', { class: 'small muted' }, 'グループを削除しても、メンバーの登録情報は削除されません（所属が外れるだけです）。'),
        h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: async () => {
          if (!(await confirmDialog('グループを削除します', [`グループ「${g.name}」を削除します。`, `メンバー${count}件の所属を外します。登録情報そのものは削除されません。`], { okLabel: '削除する', danger: true }))) return;
          try { await deleteGroup(g.id, (d, t) => { status.textContent = `所属を外しています… ${d} / ${t}`; }); toast('グループを削除しました', 'success'); go('admin', { tab: 'groups' }, { push: false }); } catch (e) { status.textContent = ''; toast(`削除が途中で止まりました: ${dbErrorMessage(e)}`, 'error', 7000); }
        } }, 'このグループを削除'),
      ]),
    );
  }
  render();
  return { onData: render };
}

async function openAddMembers(g) {
  const filter = h('input', { type: 'search', class: 'input', placeholder: '名前・企業名で絞り込む', 'aria-label': '絞り込み' });
  const list = h('ul', { class: 'pick-list' });
  const chosen = new Set();
  const counter = h('span', { class: 'small muted' });
  const all = [
    ...[...S.persons.values()].map((p) => ({ type: 'person', id: p.id, label: p.name, sub: S.companies.get(p.companyId)?.name || '企業なし', groupIds: p.groupIds || [], key: normalize(`${p.name}${p.nameKana || ''}${S.companies.get(p.companyId)?.name || ''}${p.keywords || ''}`) })),
    ...[...S.companies.values()].map((c) => ({ type: 'company', id: c.id, label: c.name, sub: '企業', groupIds: c.groupIds || [], key: normalize(`${c.name}${c.nameKana || ''}${c.keywords || ''}`) })),
  ].filter((x) => !x.groupIds.includes(g.id)).sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  const render = () => {
    const f = normalize(filter.value);
    const shown = all.filter((x) => !f || x.key.includes(f));
    fill(list, shown.length ? shown.slice(0, 300).map((x) => {
      const cb = h('input', { type: 'checkbox', checked: chosen.has(`${x.type}:${x.id}`) });
      cb.addEventListener('change', () => { const k = `${x.type}:${x.id}`; if (cb.checked) chosen.add(k); else chosen.delete(k); counter.textContent = `${chosen.size}件を選択中`; });
      return h('li', {}, h('label', { class: 'pick-row' }, [cb, h('span', { class: 'type-tag' + (x.type === 'company' ? ' type-co' : '') }, x.type === 'company' ? '企業' : '人物'), h('span', {}, x.label), h('span', { class: 'small muted' }, x.sub)]));
    }) : h('li', { class: 'muted' }, all.length ? '該当する登録情報はありません。' : '追加できる登録情報はありません（全員がこのグループに入っています）。'));
    counter.textContent = `${chosen.size}件を選択中`;
  };
  filter.addEventListener('input', debounce(render, 100));
  render();
  const ok = await dialog({
    title: `「${g.name}」にメンバーを追加`,
    body: [filter, counter, list],
    buttons: [{ label: 'キャンセル', value: false }, { label: '選んだ登録情報を追加', value: true, kind: 'primary' }],
  });
  if (!ok || !chosen.size) return;
  const items = [...chosen].map((k) => { const [type, id] = k.split(':'); return { type, id }; });
  try { const n = await setMembershipMany(items, g.id, true); toast(`${n}件をグループに追加しました`, 'success'); } catch (e) { toast(`追加が途中で止まりました: ${dbErrorMessage(e)}`, 'error', 7000); }
}

function colorPicker(initial = 0) {
  let value = initial;
  const box = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': '色' });
  const render = () => fill(box, GROUP_COLOR_NAMES.map((n, i) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(value === i), class: `swatch g${i} ${value === i ? 'on' : ''}`, title: n, 'aria-label': n, onclick: () => { value = i; render(); } })));
  render();
  return { el: box, value: () => value };
}

async function editGroupDialog(g) {
  const name = h('input', { type: 'text', class: 'input', value: g.name, maxlength: 50, id: 'group-name' });
  const memo = h('input', { type: 'text', class: 'input', value: g.memo || '', maxlength: 200, id: 'group-memo', placeholder: '例: 2026年度 協賛企業' });
  const color = colorPicker(g.color || 0);
  const v = await dialog({
    title: 'グループの名前・色を変更',
    body: [h('label', { class: 'field-label', for: 'group-name' }, 'グループ名'), name, h('label', { class: 'field-label', for: 'group-memo' }, '説明（任意）'), memo, h('div', { class: 'field-label' }, '色'), color.el, h('p', { class: 'small muted' }, '名前を変えても、メンバーの所属はそのまま維持されます。')],
    buttons: [{ label: 'キャンセル', value: false }, { label: '保存', value: () => ({ name: name.value, memo: memo.value, color: color.value() }), kind: 'primary' }],
  });
  if (!v) return;
  try { await updateGroup(g.id, { ...v, version: g.version }); toast('保存しました', 'success'); } catch (e) { toast(dbErrorMessage(e), 'error', 6000); }
}

// ---------- 管理 → グループ ----------
function adminGroups(body) {
  const name = h('input', { type: 'text', class: 'input', id: 'new-group-name', placeholder: '例: 青年部', maxlength: 50 });
  const color = colorPicker(S.groups.size % GROUP_COLORS);
  const err = h('div', { class: 'field-error', role: 'alert', hidden: true });
  const listBox = h('div');
  const create = async () => {
    err.hidden = true;
    try { const r = await createGroup({ name: name.value, color: color.value() }); toast('グループを作成しました', 'success'); name.value = ''; go('group', { id: r.id }); } catch (e) { err.textContent = dbErrorMessage(e); err.hidden = false; }
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
  const render = () => {
    const gs = groupList();
    fill(listBox, gs.length ? h('ul', { class: 'gm-list' }, gs.map((g) => h('li', { class: 'gm-row' }, [
      h('button', { type: 'button', class: 'gm-main', onclick: () => go('group', { id: g.id }) }, [groupChip(g), h('span', { class: 'small muted' }, `${groupMembers(g.id).count}件`), g.memo ? h('span', { class: 'small muted' }, g.memo) : null]),
      h('button', { type: 'button', class: 'btn btn-xs', onclick: () => go('group', { id: g.id }) }, '開く'),
    ]))) : h('p', { class: 'muted' }, 'まだグループがありません。'));
  };
  fill(body,
    h('section', { class: 'card' }, [
      h('h2', { class: 'card-title' }, '新しいグループを作る'),
      h('p', { class: 'small muted' }, '例: 青年部、〇〇会、2026年度協賛など。1人が複数のグループに入れます。'),
      h('div', { class: 'row' }, [name, h('button', { type: 'button', class: 'btn btn-primary', onclick: create }, '作成')]),
      h('div', { class: 'field-label' }, '色'), color.el, err,
    ]),
    h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, 'グループ一覧'), listBox]),
  );
  render();
  return render;
}
