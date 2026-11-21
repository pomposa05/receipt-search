// 登録・編集フォーム（人物／企業）
import {
  h, field, toast, dialog, confirmDialog, debounce, defaultReceiptName,
} from './ui.js';
import { get, post, put } from './api.js';

// ---------- 入力欄（OCR反映・候補表示つき） ----------
function textField(key, label, { required = false, hint = '', placeholder = '', value = '', multiline = false, maxlength = 200, autocomplete = 'off' } = {}) {
  const id = `f-${key}`;
  const input = multiline
    ? h('textarea', { id, name: key, rows: 4, maxlength, placeholder })
    : h('input', { id, name: key, type: 'text', maxlength, placeholder, autocomplete, required: required || undefined });
  input.value = value || '';
  const ocrTag = h('span', { class: 'ocr-tag', hidden: true }, '画像から読み取り・要確認');
  const candBox = h('div', { class: 'cand-box', hidden: true });
  const errBox = h('div', { class: 'field-error', role: 'alert', hidden: true });
  const wrap = field([label, ' ', ocrTag], h('div', {}, [input, candBox, errBox]), { hint, required, id });
  input.addEventListener('input', () => { input.classList.remove('ocr-filled'); ocrTag.hidden = true; setError(''); });

  function setError(msg) {
    errBox.textContent = msg;
    errBox.hidden = !msg;
    input.classList.toggle('invalid', !!msg);
  }
  return {
    key, wrap, input, setError,
    get value() { return input.value; },
    set value(v) { input.value = v ?? ''; },
    /** OCR結果の反映: high/medium は入力、low は候補表示のみ、none は理由を表示 */
    applyOcr(f) {
      candBox.replaceChildren();
      candBox.hidden = true;
      if (!f) return false;
      let filled = false;
      if ((f.confidence === 'high' || f.confidence === 'medium') && f.value) {
        input.value = f.value;
        input.classList.add('ocr-filled');
        ocrTag.hidden = false;
        filled = true;
      }
      const others = (f.options || []).filter((o) => o !== input.value);
      if (f.confidence === 'low' || (others.length && filled) || (f.confidence === 'none' && f.reason)) {
        candBox.hidden = false;
        if (f.reason && !filled) candBox.append(h('div', { class: 'small warn-text' }, f.reason));
        if (others.length) {
          candBox.append(h('div', { class: 'chips' }, [
            h('span', { class: 'small muted' }, filled ? '他の候補:' : '候補（タップで入力）:'),
            ...others.slice(0, 6).map((o) => h('button', {
              type: 'button', class: 'chip chip-btn',
              onclick: () => { input.value = o; input.classList.add('ocr-filled'); ocrTag.hidden = false; input.dispatchEvent(new Event('change')); input.dispatchEvent(new CustomEvent('ocr-set')); },
            }, o)),
          ]));
        }
      }
      return filled;
    },
    markOcr() { input.classList.add('ocr-filled'); ocrTag.hidden = false; },
    clearOcr() { input.classList.remove('ocr-filled'); ocrTag.hidden = true; candBox.hidden = true; },
  };
}

// ---------- 領収証宛名（自動作成 ⇔ 手動） ----------
function receiptField(getParts, initial = '', { auto = true } = {}) {
  const f = textField('receiptName', '領収証宛名', {
    hint: '領収証に記載する宛名です。名前・企業名から自動で作成します（直接書き換えることもできます）。',
    value: initial,
  });
  let isAuto = auto;
  const modeLine = h('div', { class: 'small receipt-mode' });
  const resetBtn = h('button', { type: 'button', class: 'btn btn-xs', onclick: () => { isAuto = true; sync(); } }, '自動作成に戻す');
  const altBox = h('div', { class: 'chips small' });
  f.wrap.append(modeLine, altBox);
  f.input.addEventListener('input', () => { isAuto = false; render(); });
  function render() {
    modeLine.replaceChildren(isAuto ? '自動作成中' : h('span', {}, ['手動で入力中 ', resetBtn]));
    const { person, company } = getParts();
    const alts = [...new Set([defaultReceiptName(person, company), company ? defaultReceiptName('', company) : '', person ? defaultReceiptName(person, '') : ''])]
      .filter((a) => a && a !== f.input.value);
    altBox.replaceChildren(...(alts.length ? [h('span', { class: 'muted' }, '他の書き方:'), ...alts.map((a) => h('button', {
      type: 'button', class: 'chip chip-btn', onclick: () => { f.input.value = a; isAuto = false; render(); },
    }, a))] : []));
  }
  function sync() {
    if (isAuto) {
      const { person, company } = getParts();
      f.input.value = defaultReceiptName(person, company);
    }
    render();
  }
  sync();
  // 注意: {...f} とすると value のgetterが値として固定されるため、Object.assign で拡張する
  return Object.assign(f, { sync, isAuto: () => isAuto });
}

// ---------- 企業の選択（既存の企業から選ぶ／新しい企業として登録） ----------
function companyPicker(initialCompany, { onChange }) {
  const f = textField('companyName', '企業名', {
    placeholder: '例: 株式会社サンプル', maxlength: 100,
    hint: '入力すると登録済みの企業が候補に表示されます。既存の企業に紐付ける場合は候補から選んでください。',
    value: initialCompany?.name || '',
  });
  let selected = initialCompany ? { id: initialCompany.id, name: initialCompany.name, personCount: initialCompany.personCount } : null;
  let suggestions = [];
  let active = -1;
  const list = h('ul', { class: 'suggest-list', role: 'listbox', id: 'company-suggest', hidden: true });
  const status = h('div', { class: 'company-status', 'aria-live': 'polite' });
  const kana = textField('companyKana', '企業名の読み（新しい企業として登録する場合・任意）', { placeholder: '例: サンプル', maxlength: 200 });
  f.input.setAttribute('role', 'combobox');
  f.input.setAttribute('aria-controls', 'company-suggest');
  f.input.setAttribute('aria-autocomplete', 'list');
  f.wrap.querySelector('.field > div, div')?.append(list);
  f.wrap.append(status);

  const fetchSuggest = debounce(async () => {
    const q = f.input.value.trim();
    if (!q) { suggestions = []; renderList(); renderStatus(); return; }
    try {
      const r = await get(`/api/companies?q=${encodeURIComponent(q)}`);
      if (f.input.value.trim() !== q) return;
      suggestions = r.items;
    } catch { suggestions = []; }
    renderList();
    renderStatus();
  }, 150);

  function choose(c) {
    selected = { id: c.id, name: c.name, personCount: c.personCount };
    f.input.value = c.name;
    list.hidden = true;
    renderStatus();
    onChange();
  }
  function renderList() {
    active = -1;
    if (!suggestions.length || document.activeElement !== f.input) { list.hidden = true; return; }
    list.replaceChildren(...suggestions.map((c, i) => h('li', {
      role: 'option', class: 'suggest-item', id: `cs-${i}`,
      onmousedown: (e) => { e.preventDefault(); choose(c); },
    }, [h('span', {}, `🏢 ${c.name}`), h('span', { class: 'muted small' }, ` ID ${c.id}・人物${c.personCount}名`)])));
    list.hidden = false;
  }
  function renderStatus() {
    const text = f.input.value.trim();
    kana.wrap.hidden = !(text && !selected);
    if (!text) {
      status.className = 'company-status';
      status.replaceChildren('企業なし（個人のみ）で登録します。');
      return;
    }
    if (selected) {
      status.className = 'company-status ok';
      status.replaceChildren(`✓ 登録済みの企業「${selected.name}」（ID ${selected.id}・人物${selected.personCount ?? 0}名）に紐付けます。`,
        h('button', { type: 'button', class: 'btn btn-xs', onclick: () => { selected = null; renderStatus(); onChange(); f.input.focus(); } }, '選択を解除'));
      return;
    }
    const same = suggestions.filter((c) => c.name.replace(/\s/g, '') === text.replace(/\s/g, ''));
    if (suggestions.length) {
      status.className = 'company-status warn';
      status.replaceChildren(same.length
        ? `⚠ 同じ名前の企業が登録済みです。同じ企業なら候補から選んでください。選ばずに保存すると確認画面が表示されます。`
        : `「${text}」を新しい企業として登録します。似た名前の企業が${suggestions.length}件あります。同じ企業なら候補から選んでください。`);
    } else {
      status.className = 'company-status';
      status.replaceChildren(`「${text}」を新しい企業として登録します。`);
    }
  }

  f.input.addEventListener('input', () => { selected = null; fetchSuggest(); renderStatus(); onChange(); });
  f.input.addEventListener('ocr-set', () => { selected = null; fetchSuggest(); renderStatus(); onChange(); });
  f.input.addEventListener('focus', () => { if (f.input.value.trim()) fetchSuggest(); });
  f.input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  f.input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    const items = [...list.children];
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(suggestions[active]); return; }
    else if (e.key === 'Escape') { list.hidden = true; return; } else return;
    items.forEach((li, i) => li.classList.toggle('active', i === active));
    f.input.setAttribute('aria-activedescendant', active >= 0 ? `cs-${active}` : '');
  });
  renderStatus();

  return Object.assign(f, {
    kana,
    selected: () => selected,
    select: choose,
    setText(v) { f.value = v; selected = null; renderStatus(); fetchSuggest(); },
    spec() {
      const text = f.input.value.trim();
      if (selected) return { mode: 'existing', id: selected.id };
      if (text) return { mode: 'new', name: text, nameKana: kana.value };
      return { mode: 'none' };
    },
    displayName: () => (selected ? selected.name : f.input.value.trim()),
    refresh: () => { fetchSuggest(); renderStatus(); },
  });
}

// ---------- 読み（自動入力ボタンつき） ----------
function kanaField(key, label, getSource, value = '') {
  const f = textField(key, label, { placeholder: '例: ヤマダ タロウ', value, hint: '読みを登録すると、ひらがな・カタカナでも検索できます（未入力でも、ある程度は自動で読みを推定して検索します）。' });
  const btn = h('button', {
    type: 'button', class: 'btn btn-xs',
    onclick: async () => {
      const src = getSource();
      if (!src.trim()) { toast('先に名前を入力してください', 'info'); return; }
      try {
        const r = await post('/api/reading', { text: src });
        if (r.reading) { f.value = r.reading; f.markOcr(); toast('読みの候補を入力しました。正しいか確認してください。', 'info'); }
        else toast('読みを推定できませんでした。手動で入力してください。', 'info');
      } catch (e) { toast(e.message, 'error'); }
    },
  }, '読みの候補を入力');
  f.wrap.append(btn);
  return f;
}

function errorNotice() {
  const box = h('div', { class: 'notice notice-error', role: 'alert', hidden: true });
  return {
    el: box,
    show(msg) { box.textContent = msg; box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    hide() { box.hidden = true; },
  };
}

function candidateList(cands, renderItem) {
  return h('ul', { class: 'cand-list' }, cands.map((c) => h('li', {}, renderItem(c))));
}

const openLink = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

// =====================================================================
// 人物フォーム（新規・編集）
// =====================================================================
export function createPersonForm({ person = null, presetCompany = null, presetName = '', onSaved, getImageId = () => null, ocrUsed = () => false }) {
  const isEdit = !!person;
  const err = errorNotice();
  const name = textField('name', '名前', { required: true, placeholder: '例: 山田 太郎', value: person?.name || presetName, maxlength: 100 });
  const kana = kanaField('nameKana', '名前の読み（任意）', () => name.value, person?.nameKana || '');
  const company = companyPicker(person?.company || presetCompany, { onChange: () => receipt.sync() });
  const dept = textField('department', '部署（任意）', { value: person?.department || '', maxlength: 100 });
  const title = textField('title', '役職（任意）', { value: person?.title || '', maxlength: 100 });
  const keywords = textField('keywords', 'キーワード（任意）', {
    value: person?.keywords || '', maxlength: 1000, placeholder: '例: ゴルフ仲間, 年末贈答, 経費A',
    hint: '検索に使う補助情報です。複数ある場合は「,」や「、」で区切ってください。',
  });
  const initialReceipt = person?.receiptName || '';
  const receiptWasAuto = !isEdit || initialReceipt === defaultReceiptName(person.name, person.company?.name || '');
  const receipt = receiptField(() => ({ person: name.value, company: company.displayName() }), initialReceipt, { auto: receiptWasAuto });
  const memo = isEdit ? null : textField('memo', 'メモ（任意）', { multiline: true, maxlength: 100000, placeholder: '自由に入力できます。登録後も詳細画面でいつでも編集できます。' });
  const ocrConfirm = h('label', { class: 'check ocr-confirm', hidden: true }, [h('input', { type: 'checkbox', id: 'ocr-confirm' }), ' 読み取り結果を画像と見比べて確認しました']);
  name.input.addEventListener('input', () => receipt.sync());
  name.input.addEventListener('ocr-set', () => receipt.sync());
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, isEdit ? '変更を保存' : 'この内容で登録');

  const fieldsByKey = { name, nameKana: kana, companyName: company, department: dept, title, keywords, memo };

  const snapshot = () => JSON.stringify([name.value, kana.value, company.spec(), dept.value, title.value, keywords.value, receipt.value, memo?.value || '']);
  let initial = snapshot();
  let saving = false;

  const form = h('form', { class: 'card form', novalidate: true }, [
    h('h2', { class: 'card-title' }, isEdit ? '人物の登録情報を編集' : '人物を登録'),
    err.el,
    h('div', { class: 'grid-2' }, [name.wrap, kana.wrap]),
    company.wrap,
    company.kana.wrap,
    h('div', { class: 'grid-2' }, [dept.wrap, title.wrap]),
    receipt.wrap,
    keywords.wrap,
    memo?.wrap,
    ocrConfirm,
    h('div', { class: 'form-actions' }, [
      h('a', { class: 'btn btn-ghost', href: isEdit ? `#/person/${person.id}` : '#/' }, 'キャンセル'),
      saveBtn,
    ]),
  ]);

  form.addEventListener('submit', (e) => { e.preventDefault(); save({}); });

  async function save(flags) {
    if (saving) return;
    err.hide();
    name.setError('');
    if (!name.value.trim()) {
      name.setError('名前を入力してください。');
      name.input.focus();
      err.show('名前を入力してください。企業のみを登録する場合は、上の「企業のみ登録」を選んでください。');
      return;
    }
    if (ocrUsed() && !ocrConfirm.hidden && !ocrConfirm.querySelector('input').checked) {
      err.show('画像から読み取った内容を確認し、「読み取り結果を画像と見比べて確認しました」にチェックを入れてください。');
      ocrConfirm.querySelector('input').focus();
      return;
    }
    if (isEdit && !flags.affiliationConfirmed) {
      const before = person.company?.id ?? null;
      const spec = company.spec();
      const changedCompany = (spec.mode === 'existing' ? spec.id : null) !== before || spec.mode === 'new';
      if (changedCompany) {
        const ok = await confirmDialog('所属企業を変更します', [
          `「${person.company?.name || '企業なし'}」→「${company.displayName() || '企業なし'}」`,
          '変更は所属履歴に記録されます。領収証宛名も確認してください。',
        ], { okLabel: '変更する' });
        if (!ok) return;
      }
    }
    const body = {
      name: name.value, nameKana: kana.value, department: dept.value, title: title.value,
      keywords: keywords.value, receiptName: receipt.value, company: company.spec(),
      imageId: getImageId(), ...flags,
    };
    if (memo) body.memo = memo.value;
    if (isEdit) body.version = person.version;
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    let failure = null;
    try {
      const r = isEdit ? await put(`/api/persons/${person.id}`, body) : await post('/api/persons', body);
      initial = snapshot();
      toast(isEdit ? '変更を保存しました' : '登録しました', 'success');
      onSaved(r);
    } catch (e) {
      failure = e;
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '変更を保存' : 'この内容で登録';
    }
    // 保存中フラグを解除してから確認ダイアログ → 再保存へ進む
    if (failure) await handleError(failure, flags);
  }

  async function handleError(e, flags) {
    if (e.code === 'POSSIBLE_DUPLICATE') {
      const v = await dialog({
        title: '同じ名前の登録情報があります',
        body: [
          h('p', {}, '同姓同名の別人の可能性もあるため、自動では同一と判断しません。内容を確認してください。'),
          candidateList(e.details.candidates, (c) => [
            openLink(`#/person/${c.id}`, `👤 ${c.name}（ID ${c.id}）`),
            h('div', { class: 'small' }, `${c.companyName || '企業なし'}${c.department ? ` / ${c.department}` : ''} — ${c.reason}`),
          ]),
          h('p', { class: 'small muted' }, 'リンクは別のタブで開きます（入力内容はこの画面に残ります）。'),
        ],
        buttons: [{ label: '戻って修正する', value: false }, { label: '別人として登録する', value: true, kind: 'primary' }],
      });
      if (v) return save({ ...flags, confirmDuplicate: true });
      return;
    }
    if (e.code === 'COMPANY_EXISTS') {
      const v = await dialog({
        title: '同じ（または似た）企業が登録済みです',
        body: (done) => [
          h('p', {}, '同じ企業の場合は、その企業を選んで紐付けてください。名前が同じでも別の企業の場合は「別の企業として新規登録」を選んでください。'),
          candidateList(e.details.candidates, (c) => [
            h('div', {}, [h('strong', {}, `🏢 ${c.name}`), h('span', { class: 'small muted' }, `（ID ${c.id}・人物${c.personCount}名）${c.reason}`)]),
            h('div', { class: 'row' }, [
              h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => done({ choose: c }) }, 'この企業に紐付ける'),
              openLink(`#/company/${c.id}`, '内容を見る'),
            ]),
          ]),
        ],
        buttons: [{ label: '戻る', value: null }, { label: '別の企業として新規登録', value: 'new', kind: 'danger' }],
      });
      if (v?.choose) { company.select(v.choose); receipt.sync(); return save(flags); }
      if (v === 'new') return save({ ...flags, confirmNewCompany: true });
      return;
    }
    if (e.code === 'VERSION_CONFLICT') {
      const v = await dialog({
        title: '他の画面・端末で更新されています',
        body: h('p', {}, 'この登録情報は、編集を始めた後に別の画面または端末で更新されました。最新の内容を読み込んでから、もう一度編集してください。'),
        buttons: [{ label: '入力内容を残してこの画面に戻る', value: false }, { label: '最新の内容を読み込む（入力は破棄）', value: true, kind: 'primary' }],
      });
      if (v) { initial = snapshot(); location.reload(); }
      return;
    }
    if (e.code === 'COMPANY_NOT_FOUND') { company.setText(company.value); }
    if (e.details?.field && fieldsByKey[e.details.field]) fieldsByKey[e.details.field].setError(e.message);
    const extra = e.status === 0 ? '入力内容は残っています。通信が回復したら、もう一度「保存」を押してください。' : '入力内容は残っています。';
    err.show(`保存できませんでした。${e.message} ${extra}`);
    toast('保存できませんでした', 'error');
  }

  return {
    el: form,
    isDirty: () => snapshot() !== initial,
    /** OCR結果を反映 */
    applyOcr(fields) {
      name.applyOcr(fields.name);
      kana.applyOcr(fields.nameKana);
      if (company.applyOcr(fields.companyName)) company.setText(company.value);
      dept.applyOcr(fields.department);
      title.applyOcr(fields.title);
      receipt.sync();
      ocrConfirm.hidden = false;
      ocrConfirm.querySelector('input').checked = false;
    },
    applyLine(target, text) {
      if (target === 'companyName') { company.setText(text); company.markOcr(); receipt.sync(); return; }
      const f = fieldsByKey[target];
      if (!f) return;
      if (target === 'keywords') f.value = f.value ? `${f.value}, ${text}` : text;
      else if (target === 'memo') f.value = f.value ? `${f.value}\n${text}` : text;
      else f.value = text;
      f.markOcr();
      if (target === 'name') receipt.sync();
      ocrConfirm.hidden = false;
    },
    lineTargets: [
      { key: 'name', label: '名前' }, { key: 'companyName', label: '企業名' }, { key: 'department', label: '部署' },
      { key: 'title', label: '役職' }, { key: 'keywords', label: 'キーワード' }, ...(memo ? [{ key: 'memo', label: 'メモ' }] : []),
    ],
  };
}

// =====================================================================
// 企業フォーム（新規・編集）
// =====================================================================
export function createCompanyForm({ company = null, onSaved, getImageId = () => null, ocrUsed = () => false }) {
  const isEdit = !!company;
  const err = errorNotice();
  const name = textField('companyName', '企業名', { required: true, value: company?.name || '', placeholder: '例: 株式会社サンプル', maxlength: 100 });
  const kana = kanaField('companyKana', '企業名の読み（任意）', () => name.value, company?.nameKana || '');
  kana.input.placeholder = '例: カブシキガイシャサンプル';
  const keywords = textField('keywords', 'キーワード（任意）', { value: company?.keywords || '', maxlength: 1000, hint: '複数ある場合は「,」や「、」で区切ってください。' });
  const initialReceipt = company?.receiptName || '';
  const receipt = receiptField(() => ({ person: '', company: name.value }), initialReceipt, {
    auto: !isEdit || initialReceipt === defaultReceiptName('', company.name),
  });
  const memo = isEdit ? null : textField('memo', 'メモ（任意）', { multiline: true, maxlength: 100000 });
  const ocrConfirm = h('label', { class: 'check ocr-confirm', hidden: true }, [h('input', { type: 'checkbox' }), ' 読み取り結果を画像と見比べて確認しました']);
  name.input.addEventListener('input', () => receipt.sync());
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, isEdit ? '変更を保存' : 'この内容で登録');
  const fieldsByKey = { companyName: name, companyKana: kana, keywords, memo };
  const snapshot = () => JSON.stringify([name.value, kana.value, keywords.value, receipt.value, memo?.value || '']);
  let initial = snapshot();
  let saving = false;

  const form = h('form', { class: 'card form', novalidate: true }, [
    h('h2', { class: 'card-title' }, isEdit ? '企業情報を編集' : '企業のみを登録'),
    !isEdit ? h('p', { class: 'small muted' }, '人物を登録せず、企業宛ての領収証宛名（例: 株式会社サンプル 御中）だけを登録します。') : null,
    err.el,
    h('div', { class: 'grid-2' }, [name.wrap, kana.wrap]),
    receipt.wrap,
    keywords.wrap,
    memo?.wrap,
    ocrConfirm,
    h('div', { class: 'form-actions' }, [
      h('a', { class: 'btn btn-ghost', href: isEdit ? `#/company/${company.id}` : '#/' }, 'キャンセル'),
      saveBtn,
    ]),
  ]);
  form.addEventListener('submit', (e) => { e.preventDefault(); save({}); });

  async function save(flags) {
    if (saving) return;
    err.hide();
    if (!name.value.trim()) { name.setError('企業名を入力してください。'); name.input.focus(); err.show('企業名を入力してください。'); return; }
    if (ocrUsed() && !ocrConfirm.hidden && !ocrConfirm.querySelector('input').checked) {
      err.show('画像から読み取った内容を確認し、「読み取り結果を画像と見比べて確認しました」にチェックを入れてください。');
      return;
    }
    const body = { name: name.value, nameKana: kana.value, keywords: keywords.value, receiptName: receipt.value, imageId: getImageId(), ...flags };
    if (memo) body.memo = memo.value;
    if (isEdit) {
      body.version = company.version;
      // 企業名の変更は関連人物に影響するため確認する
      if (name.value.trim() !== company.name && company.persons.length && flags.replaceReceiptNames === undefined) {
        const cb = h('input', { type: 'checkbox', checked: true, id: 'replace-receipt' });
        const v = await dialog({
          title: '企業名の変更による影響の確認',
          body: [
            h('p', {}, `「${company.name}」→「${name.value.trim()}」`),
            h('p', {}, `この企業に紐付く ${company.persons.length} 人の登録情報に影響します（名前と企業の紐付けはそのまま維持されます）。`),
            h('ul', { class: 'cand-list' }, company.persons.slice(0, 20).map((p) => h('li', {}, `👤 ${p.name} — 宛名: ${p.receiptName || '（なし）'}`))),
            h('label', { class: 'check' }, [cb, ' 各人物の領収証宛名に含まれる旧企業名を、新しい企業名に置き換える']),
            h('p', { class: 'small muted' }, '旧企業名は履歴に残り、旧企業名でも検索できます。'),
          ],
          buttons: [{ label: 'キャンセル', value: false }, { label: '変更する', value: () => ({ replace: cb.checked }), kind: 'primary' }],
        });
        if (!v) return;
        body.replaceReceiptNames = v.replace;
        flags = { ...flags, replaceReceiptNames: v.replace };
      }
    }
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    let failure = null;
    try {
      const r = isEdit ? await put(`/api/companies/${company.id}`, body) : await post('/api/companies', body);
      initial = snapshot();
      if (r.affectedPersons?.some((p) => p.replaced)) toast(`${r.affectedPersons.filter((p) => p.replaced).length}人の領収証宛名を更新しました`, 'success', 5000);
      toast(isEdit ? '変更を保存しました' : '登録しました', 'success');
      onSaved(r);
    } catch (e) {
      failure = e;
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? '変更を保存' : 'この内容で登録';
    }
    if (failure) await handleCompanyError(failure, flags);
  }

  async function handleCompanyError(e, flags) {
    {
      if (e.code === 'COMPANY_EXISTS') {
        const v = await dialog({
          title: '同じ（または似た）企業名が登録済みです',
          body: [
            h('p', {}, '同じ企業の場合は既存の企業を開いてください。別の企業であれば、そのまま登録できます。'),
            candidateList(e.details.candidates, (c) => [openLink(`#/company/${c.id}`, `🏢 ${c.name}（ID ${c.id}・人物${c.personCount}名）`), h('span', { class: 'small muted' }, ` ${c.reason}`)]),
          ],
          buttons: [{ label: '戻る', value: false }, { label: isEdit ? 'この名前に変更する' : '別の企業として登録', value: true, kind: 'danger' }],
        });
        if (v) await save({ ...flags, confirmDuplicate: true });
      } else if (e.code === 'VERSION_CONFLICT') {
        const v = await confirmDialog('他の画面・端末で更新されています', '最新の内容を読み込んでから、もう一度編集してください。', { okLabel: '最新の内容を読み込む（入力は破棄）', cancelLabel: '入力内容を残して戻る' });
        if (v) { initial = snapshot(); location.reload(); }
      } else {
        if (e.details?.field && fieldsByKey[e.details.field]) fieldsByKey[e.details.field].setError(e.message);
        err.show(`保存できませんでした。${e.message} 入力内容は残っています。`);
        toast('保存できませんでした', 'error');
      }
    }
  }

  return {
    el: form,
    isDirty: () => snapshot() !== initial,
    applyOcr(fields) {
      name.applyOcr(fields.companyName);
      receipt.sync();
      ocrConfirm.hidden = false;
      ocrConfirm.querySelector('input').checked = false;
    },
    applyLine(target, text) {
      const f = fieldsByKey[target];
      if (!f) return;
      if (target === 'keywords') f.value = f.value ? `${f.value}, ${text}` : text;
      else if (target === 'memo') f.value = f.value ? `${f.value}\n${text}` : text;
      else f.value = text;
      f.markOcr();
      receipt.sync();
      ocrConfirm.hidden = false;
    },
    lineTargets: [{ key: 'companyName', label: '企業名' }, { key: 'keywords', label: 'キーワード' }, ...(memo ? [{ key: 'memo', label: 'メモ' }] : [])],
  };
}
