// ② 登録画面（人物／企業のみ）＋ 画像からの読み取り
import { h, loading, errorBox } from '../ui.js';
import { get } from '../api.js';
import { navigate } from '../router.js';
import { createPersonForm, createCompanyForm } from '../forms.js';
import { createOcrPanel } from '../ocrPanel.js';
import { takePendingImage } from '../state.js';
import { confirmDialog } from '../ui.js';

export async function renderRegister({ outlet, query }) {
  let kind = query.get('type') === 'company' ? 'company' : 'person';
  let presetCompany = null;
  const companyId = query.get('companyId');
  if (companyId) {
    outlet.append(loading());
    try {
      const c = await get(`/api/companies/${encodeURIComponent(companyId)}`);
      presetCompany = { id: c.id, name: c.name, personCount: c.persons.length };
    } catch (e) {
      outlet.replaceChildren(errorBox(`企業情報を読み込めませんでした。${e.message}`));
      return null;
    }
    outlet.replaceChildren();
  }

  let form = null;
  const formHost = h('div');
  const ocr = createOcrPanel({
    onFields: (fields) => form.applyOcr(fields),
    onLine: (target, text) => form.applyLine(target, text),
    targets: () => form.lineTargets,
  });

  function buildForm() {
    const common = {
      getImageId: ocr.imageId,
      ocrUsed: ocr.used,
      onSaved: (r) => { navigate(`#/${r.type}/${r.id}`); },
    };
    form = kind === 'person'
      ? createPersonForm({ ...common, presetCompany, presetName: query.get('name') || '' })
      : createCompanyForm(common);
    formHost.replaceChildren(form.el);
  }

  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': '登録の種類' });
  function renderTabs() {
    tabs.replaceChildren(
      ...[['person', '👤 人物を登録'], ['company', '🏢 企業のみ登録']].map(([k, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(kind === k), class: kind === k ? 'active' : '',
        onclick: async () => {
          if (kind === k) return;
          if (form.isDirty() && !(await confirmDialog('登録の種類を切り替えます', '入力中の内容は破棄されます。よろしいですか？', { okLabel: '切り替える' }))) return;
          kind = k;
          renderTabs();
          buildForm();
        },
      }, label)),
    );
  }
  renderTabs();
  buildForm();

  outlet.append(
    h('div', { class: 'page-head' }, [h('a', { class: 'back', href: '#/' }, '← 検索へ戻る'), h('h1', {}, '新規登録')]),
    tabs,
    h('div', { class: 'register-layout' }, [ocr.el, formHost]),
  );

  const pending = takePendingImage();
  if (pending) ocr.loadFile(pending);

  return {
    isDirty: () => form.isDirty() || ocr.isBusy(),
    async canLeave() {
      if (!form.isDirty()) return true;
      return confirmDialog('入力内容が保存されていません', 'このまま移動すると、入力した内容は破棄されます。移動しますか？', { okLabel: '破棄して移動', danger: true });
    },
  };
}
