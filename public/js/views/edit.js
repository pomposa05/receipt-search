// 編集画面（人物／企業）
import { h, loading, errorBox, confirmDialog } from '../ui.js';
import { get } from '../api.js';
import { navigate } from '../router.js';
import { createPersonForm, createCompanyForm } from '../forms.js';

async function load(outlet, url, notFoundMsg) {
  outlet.append(loading());
  try {
    return await get(url);
  } catch (e) {
    outlet.replaceChildren(errorBox(e.status === 404 ? notFoundMsg : `読み込めませんでした。${e.message}`), h('a', { class: 'btn btn-ghost', href: '#/' }, '検索へ戻る'));
    return null;
  }
}

function guard(form) {
  return {
    isDirty: () => form.isDirty(),
    async canLeave() {
      if (!form.isDirty()) return true;
      return confirmDialog('変更が保存されていません', 'このまま移動すると、変更内容は破棄されます。移動しますか？', { okLabel: '破棄して移動', danger: true });
    },
  };
}

export async function renderEditPerson({ outlet, params }) {
  const p = await load(outlet, `/api/persons/${encodeURIComponent(params.id)}`, 'この登録情報は見つかりません。');
  if (!p) return null;
  const form = createPersonForm({ person: p, onSaved: (r) => navigate(`#/person/${r.id}`) });
  outlet.replaceChildren(
    h('div', { class: 'page-head' }, [h('a', { class: 'back', href: `#/person/${p.id}` }, '← 詳細へ戻る'), h('h1', {}, `${p.name} を編集`), h('span', { class: 'id-badge' }, `人物ID ${p.id}`)]),
    h('p', { class: 'small muted' }, 'メモは詳細画面で編集できます。'),
    form.el,
  );
  return guard(form);
}

export async function renderEditCompany({ outlet, params }) {
  const c = await load(outlet, `/api/companies/${encodeURIComponent(params.id)}`, 'この企業は見つかりません。');
  if (!c) return null;
  const form = createCompanyForm({ company: c, onSaved: (r) => navigate(`#/company/${r.id}`) });
  outlet.replaceChildren(
    h('div', { class: 'page-head' }, [h('a', { class: 'back', href: `#/company/${c.id}` }, '← 詳細へ戻る'), h('h1', {}, `${c.name} を編集`), h('span', { class: 'id-badge' }, `企業ID ${c.id}`)]),
    h('p', { class: 'small muted' }, '企業メモは詳細画面で編集できます。'),
    form.el,
  );
  return guard(form);
}
