// ④ 管理画面（登録情報一覧・編集・削除・重複候補・データ管理）
import {
  h, loading, errorBox, formatDateTime, confirmDialog, toast, debounce,
} from '../ui.js';
import { get, del, post } from '../api.js';

const TABS = [['persons', '人物一覧'], ['companies', '企業一覧'], ['duplicates', '重複候補'], ['data', 'データ管理']];

// 一覧の絞り込み用の簡易正規化（全角半角・カタカナ/ひらがな・空白の違いを吸収）
function norm(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');
}

export function renderAdmin({ outlet, query }) {
  const tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'persons';
  const body = h('div');
  outlet.append(
    h('div', { class: 'page-head' }, [h('h1', {}, '管理')]),
    h('nav', { class: 'segmented', 'aria-label': '管理メニュー' }, TABS.map(([k, label]) => h('a', {
      href: `#/admin?tab=${k}`, class: k === tab ? 'active' : '', 'aria-current': k === tab ? 'page' : undefined,
    }, label))),
    body,
  );
  ({ persons: personsTab, companies: companiesTab, duplicates: duplicatesTab, data: dataTab })[tab](body);
  return null;
}

function listTab(body, { url, columns, rowFilterText, renderRow, sorters, emptyText }) {
  const filter = h('input', { type: 'search', class: 'input', placeholder: '一覧を絞り込む', 'aria-label': '一覧を絞り込む' });
  const sort = h('select', { class: 'input', 'aria-label': '並び順' }, sorters.map(([k, label]) => h('option', { value: k }, label)));
  const count = h('span', { class: 'muted small' });
  const tbody = h('tbody');
  let items = [];
  const render = () => {
    const f = norm(filter.value);
    const sorter = sorters.find(([k]) => k === sort.value)[2];
    const shown = items.filter((it) => !f || norm(rowFilterText(it)).includes(f)).sort(sorter);
    count.textContent = `${shown.length} / ${items.length}件`;
    tbody.replaceChildren(...(shown.length ? shown.map((it) => renderRow(it, reload)) : [h('tr', {}, h('td', { colspan: columns.length }, emptyText))]));
  };
  filter.addEventListener('input', debounce(render, 120));
  sort.addEventListener('change', render);
  async function reload() {
    body.replaceChildren(loading());
    try {
      items = (await get(url)).items;
    } catch (e) {
      body.replaceChildren(errorBox(`読み込めませんでした。${e.message}`, reload));
      return;
    }
    body.replaceChildren(
      h('div', { class: 'toolbar' }, [filter, sort, count]),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c)))), tbody])),
    );
    render();
  }
  reload();
}

const byStr = (f) => (a, b) => String(f(a)).localeCompare(String(f(b)), 'ja');
const byDesc = (f) => (a, b) => String(f(b)).localeCompare(String(f(a))) || b.id - a.id;

function personsTab(body) {
  listTab(body, {
    url: '/api/persons',
    columns: ['ID', '名前', '企業名', '領収証宛名', '最終更新', '操作'],
    emptyText: '該当する人物はありません。',
    rowFilterText: (p) => `${p.name} ${p.nameKana} ${p.companyName} ${p.receiptName} ${p.keywords}`,
    sorters: [
      ['updated', '更新日時が新しい順', byDesc((p) => p.updatedAt)],
      ['created', '登録日時が新しい順', byDesc((p) => p.createdAt)],
      ['name', '名前順', byStr((p) => p.nameKana || p.name)],
      ['company', '企業名順', byStr((p) => p.companyName)],
    ],
    renderRow: (p, reload) => h('tr', {}, [
      h('td', { 'data-label': 'ID' }, String(p.id)),
      h('td', { 'data-label': '名前' }, h('a', { href: `#/person/${p.id}` }, p.name)),
      h('td', { 'data-label': '企業名' }, p.companyId ? h('a', { href: `#/company/${p.companyId}` }, p.companyName) : h('span', { class: 'muted' }, '—')),
      h('td', { 'data-label': '領収証宛名' }, p.receiptName),
      h('td', { 'data-label': '最終更新' }, formatDateTime(p.updatedAt)),
      h('td', { class: 'actions' }, [
        h('a', { class: 'btn btn-xs', href: `#/person/${p.id}/edit` }, '編集'),
        h('button', {
          type: 'button', class: 'btn btn-xs btn-danger-ghost',
          onclick: async () => {
            if (!(await confirmDialog('登録情報を削除します', [`「${p.name}」${p.companyName ? `（${p.companyName}）` : ''} ID ${p.id}`, 'メモも含めて削除され、元に戻せません。'], { okLabel: '削除する', danger: true }))) return;
            try { await del(`/api/persons/${p.id}`); toast('削除しました', 'success'); reload(); } catch (e) { toast(`削除できませんでした: ${e.message}`, 'error', 6000); }
          },
        }, '削除'),
      ]),
    ]),
  });
}

function companiesTab(body) {
  listTab(body, {
    url: '/api/companies',
    columns: ['ID', '企業名', '人物数', '領収証宛名', '最終更新', '操作'],
    emptyText: '該当する企業はありません。',
    rowFilterText: (c) => `${c.name} ${c.nameKana} ${c.receiptName} ${c.keywords}`,
    sorters: [
      ['updated', '更新日時が新しい順', byDesc((c) => c.updatedAt)],
      ['created', '登録日時が新しい順', byDesc((c) => c.createdAt)],
      ['name', '企業名順', byStr((c) => c.nameKana || c.name)],
      ['count', '人物数が多い順', (a, b) => b.personCount - a.personCount || a.id - b.id],
    ],
    renderRow: (c, reload) => h('tr', {}, [
      h('td', { 'data-label': 'ID' }, String(c.id)),
      h('td', { 'data-label': '企業名' }, h('a', { href: `#/company/${c.id}` }, c.name)),
      h('td', { 'data-label': '人物数' }, `${c.personCount}名`),
      h('td', { 'data-label': '領収証宛名' }, c.receiptName),
      h('td', { 'data-label': '最終更新' }, formatDateTime(c.updatedAt)),
      h('td', { class: 'actions' }, [
        h('a', { class: 'btn btn-xs', href: `#/company/${c.id}/edit` }, '編集'),
        h('button', {
          type: 'button', class: 'btn btn-xs btn-danger-ghost',
          onclick: async () => {
            if (c.personCount > 0) { toast(`「${c.name}」には${c.personCount}人の人物が紐付いているため削除できません。先に人物を削除するか所属を変更してください。`, 'error', 7000); return; }
            if (!(await confirmDialog('企業を削除します', [`「${c.name}」ID ${c.id}`, '企業メモも含めて削除され、元に戻せません。'], { okLabel: '削除する', danger: true }))) return;
            try { await del(`/api/companies/${c.id}`); toast('削除しました', 'success'); reload(); } catch (e) { toast(`削除できませんでした: ${e.message}`, 'error', 7000); }
          },
        }, '削除'),
      ]),
    ]),
  });
}

async function duplicatesTab(body) {
  body.replaceChildren(loading());
  let d;
  try { d = await get('/api/duplicates'); } catch (e) { body.replaceChildren(errorBox(`読み込めませんでした。${e.message}`, () => duplicatesTab(body))); return; }
  const intro = h('p', { class: 'notice notice-info small' }, '名前（または法人格を除いた企業名）が同じ登録情報を一覧にしています。同姓同名の別人の可能性があるため、自動では統合しません。同一の場合は不要な方を削除してください。');
  const pSection = h('section', { class: 'card' }, [
    h('h2', { class: 'card-title' }, `同じ名前の人物（${d.persons.length}組）`),
    d.persons.length ? h('div', {}, d.persons.map((g) => h('div', { class: 'dup-group' }, [
      h('div', { class: 'dup-key' }, [g.key, g.sameCompany ? h('span', { class: 'badge badge-warn' }, '同じ企業に同名あり') : null]),
      h('ul', {}, g.items.map((p) => h('li', {}, [
        h('a', { href: `#/person/${p.id}` }, `👤 ${p.name}`), ` — ${p.companyName || '企業なし'}`,
        h('span', { class: 'muted small' }, `（ID ${p.id}・登録 ${formatDateTime(p.createdAt)}）`),
      ]))),
    ]))) : h('p', { class: 'muted' }, '重複候補はありません。'),
  ]);
  const cSection = h('section', { class: 'card' }, [
    h('h2', { class: 'card-title' }, `同じ名前の企業（${d.companies.length}組）`),
    d.companies.length ? h('div', {}, d.companies.map((g) => h('div', { class: 'dup-group' }, [
      h('div', { class: 'dup-key' }, g.key),
      h('ul', {}, g.items.map((c) => h('li', {}, [
        h('a', { href: `#/company/${c.id}` }, `🏢 ${c.name}`), h('span', { class: 'muted small' }, `（ID ${c.id}・人物${c.personCount}名・登録 ${formatDateTime(c.createdAt)}）`),
      ]))),
    ]))) : h('p', { class: 'muted' }, '重複候補はありません。'),
  ]);
  body.replaceChildren(intro, pSection, cSection);
}

async function dataTab(body) {
  body.replaceChildren(loading());
  let s;
  try { s = await get('/api/stats'); } catch (e) { body.replaceChildren(errorBox(`読み込めませんでした。${e.message}`, () => dataTab(body))); return; }
  const backupBtn = h('button', {
    type: 'button', class: 'btn btn-secondary',
    onclick: async () => {
      backupBtn.disabled = true;
      try { const r = await post('/api/backup'); toast(`バックアップを作成しました（${r.file}）`, 'success', 5000); } catch (e) { toast(`バックアップに失敗しました: ${e.message}`, 'error', 6000); } finally { backupBtn.disabled = false; }
    },
  }, '今すぐバックアップ');
  body.replaceChildren(
    h('section', { class: 'card' }, [
      h('h2', { class: 'card-title' }, '登録件数'),
      h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(s.persons)), h('div', { class: 'stat-label' }, '人物')]),
        h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(s.companies)), h('div', { class: 'stat-label' }, '企業')]),
        h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(s.images)), h('div', { class: 'stat-label' }, '画像')]),
      ]),
    ]),
    h('section', { class: 'card' }, [
      h('h2', { class: 'card-title' }, '書き出し・バックアップ'),
      h('p', { class: 'small' }, 'データはサーバー（このアプリを起動しているPC）の data フォルダに保存されています。起動時と24時間ごとに自動でバックアップされます（data/backups、最新14件）。'),
      h('div', { class: 'row' }, [
        h('a', { class: 'btn btn-secondary', href: '/api/export.json', download: '' }, 'JSONで書き出し（移行用・全データ）'),
        h('a', { class: 'btn btn-secondary', href: '/api/export.csv', download: '' }, 'CSVで書き出し（Excel用）'),
        backupBtn,
      ]),
      h('p', { class: 'small muted' }, '書き出したファイルには個人情報が含まれます。取り扱いにご注意ください。'),
    ]),
  );
}

