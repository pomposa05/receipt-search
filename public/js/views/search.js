// ① ホーム・検索画面
import { h, debounce, loading, errorBox } from '../ui.js';
import { get } from '../api.js';
import { navigate } from '../router.js';
import { chooseImageFile, captureFromCamera } from '../imageInput.js';
import { setPendingImage } from '../state.js';

const LAST_QUERY_KEY = 'last-search';

export function renderSearch({ outlet, query }) {
  let q = query.get('q') ?? sessionStorage.getItem(LAST_QUERY_KEY) ?? '';
  const input = h('input', {
    type: 'search', class: 'search-input', id: 'search-input', value: q, autocomplete: 'off', enterkeyhint: 'search',
    placeholder: '名前・企業名・読み・キーワード・メモで検索', 'aria-label': '検索語',
  });
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  let seq = 0;

  async function startImage(kind) {
    const file = kind === 'camera' ? await captureFromCamera() : await chooseImageFile();
    if (!file) return;
    setPendingImage(file);
    navigate('#/new');
  }

  const actions = h('div', { class: 'quick-actions' }, [
    h('a', { class: 'btn btn-primary btn-lg', href: '#/new' }, [h('span', { 'aria-hidden': 'true' }, '＋ '), '新規登録']),
    h('button', { type: 'button', class: 'btn btn-secondary btn-lg', onclick: () => startImage('camera') }, [h('span', { 'aria-hidden': 'true' }, '📷 '), 'カメラで撮影']),
    h('button', { type: 'button', class: 'btn btn-secondary btn-lg', onclick: () => startImage('file') }, [h('span', { 'aria-hidden': 'true' }, '🖼 '), '画像を取り込む']),
  ]);

  async function run() {
    q = input.value;
    sessionStorage.setItem(LAST_QUERY_KEY, q);
    history.replaceState(null, '', q.trim() ? `#/?q=${encodeURIComponent(q)}` : '#/');
    const my = ++seq;
    if (!q.trim()) { return showRecent(my); }
    results.replaceChildren(loading('検索中…'));
    try {
      const r = await get(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      showResults(r);
    } catch (e) {
      if (my !== seq) return;
      results.replaceChildren(errorBox(`検索できませんでした。${e.message}`, run));
    }
  }

  async function showRecent(my) {
    results.replaceChildren(loading());
    try {
      const r = await get('/api/recent');
      if (my !== seq) return;
      if (!r.items.length) {
        results.replaceChildren(h('div', { class: 'empty' }, [
          h('p', { class: 'empty-title' }, 'まだ登録情報がありません'),
          h('p', {}, '「新規登録」から入力するか、「カメラで撮影」「画像を取り込む」で名刺や資料から登録できます。'),
        ]));
        return;
      }
      results.replaceChildren(h('h2', { class: 'section-title' }, '最近更新した登録情報'), h('ul', { class: 'result-list' }, r.items.map((p) => personCard(p))));
    } catch (e) {
      if (my !== seq) return;
      results.replaceChildren(errorBox(`読み込めませんでした。${e.message}`, run));
    }
  }

  function showResults(r) {
    if (!r.results.length) {
      results.replaceChildren(h('div', { class: 'empty' }, [
        h('p', { class: 'empty-title' }, `「${r.query}」に該当する登録情報はありません`),
        h('ul', { class: 'tips' }, [
          h('li', {}, '名前や企業名の一部だけで検索してみてください（例: 「山田」「サンプル」）'),
          h('li', {}, '読み（ひらがな）でも検索できます（例: 「やまだ」）'),
          h('li', {}, '「株式会社」などを省いて検索してみてください'),
        ]),
        h('a', { class: 'btn btn-primary', href: `#/new?name=${encodeURIComponent(r.query)}` }, `「${r.query}」を新規登録する`),
      ]));
      return;
    }
    const hasCandidate = r.results.some((x) => x.isCandidate);
    results.replaceChildren(
      h('div', { class: 'result-summary' }, [
        h('span', {}, `「${r.query}」の検索結果 `),
        h('strong', {}, `${r.total}件`),
        h('span', { class: 'muted' }, '（一致度の高い順）'),
      ]),
      hasCandidate ? h('p', { class: 'notice notice-warn small' }, '「候補」と表示されたものは、表記の似た登録情報です（曖昧検索）。目的の登録情報か内容を確認して選んでください。') : '',
      h('ul', { class: 'result-list' }, r.results.map((x) => (x.type === 'company' ? companyCard(x) : personCard(x)))),
    );
  }

  const go = debounce(run, 200);
  input.addEventListener('input', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go.cancel(); run(); input.blur?.(); }
    if (e.key === 'Escape') { input.value = ''; run(); }
  });

  outlet.append(
    h('section', { class: 'hero' }, [
      h('h1', { class: 'hero-title' }, '領収証の宛名を探す'),
      h('div', { class: 'search-box' }, [h('span', { class: 'search-icon', 'aria-hidden': 'true' }, '🔍'), input]),
      actions,
    ]),
    results,
  );
  if (window.matchMedia('(pointer: fine)').matches) input.focus();
  run();
  return { cleanup: () => go.cancel() };
}

function badges(x) {
  const out = [];
  if (x.isCandidate) out.push(h('span', { class: 'badge badge-warn' }, '候補・要確認'));
  for (const m of x.matches || []) out.push(h('span', { class: `badge ${m.candidate ? 'badge-warn-soft' : 'badge-soft'}` }, `${m.field}：${m.level}`));
  return out.length ? h('div', { class: 'badges' }, out) : null;
}

export function personCard(p) {
  const kana = p.nameKana || '';
  return h('li', {}, h('a', { class: `result-card ${p.isCandidate ? 'is-candidate' : ''}`, href: `#/person/${p.id}` }, [
    h('div', { class: 'rc-main' }, [
      h('div', { class: 'rc-name' }, [h('span', { class: 'type-icon', 'aria-label': '人物' }, '👤'), p.name, kana ? h('span', { class: 'rc-kana' }, kana) : null]),
      h('div', { class: 'rc-company' }, p.companyName ? ['🏢 ', p.companyName] : h('span', { class: 'muted' }, '企業の登録なし')),
      (p.department || p.title) ? h('div', { class: 'rc-sub' }, [p.department, p.title].filter(Boolean).join(' ')) : null,
      p.receiptName ? h('div', { class: 'rc-receipt' }, [h('span', { class: 'rc-label' }, '宛名'), p.receiptName]) : null,
      badges(p),
    ]),
    h('div', { class: 'rc-id' }, `ID ${p.id}`),
  ]));
}

export function companyCard(c) {
  return h('li', {}, h('div', { class: `result-card company ${c.isCandidate ? 'is-candidate' : ''}` }, [
    h('div', { class: 'rc-main' }, [
      h('a', { class: 'rc-name rc-link', href: `#/company/${c.id}` }, [h('span', { class: 'type-icon', 'aria-label': '企業' }, '🏢'), c.name, c.nameKana ? h('span', { class: 'rc-kana' }, c.nameKana) : null]),
      c.receiptName ? h('div', { class: 'rc-receipt' }, [h('span', { class: 'rc-label' }, '宛名'), c.receiptName]) : null,
      h('div', { class: 'rc-persons' }, [
        h('span', { class: 'rc-label' }, `関連人物 ${c.personCount}名`),
        c.persons?.length ? h('span', { class: 'chips' }, c.persons.map((p) => h('a', { class: 'chip chip-person', href: `#/person/${p.id}` }, `👤 ${p.name}`))) : h('span', { class: 'muted small' }, 'なし'),
        c.personCount > (c.persons?.length || 0) ? h('a', { class: 'small', href: `#/company/${c.id}` }, 'すべて表示') : null,
      ]),
      badges(c),
    ]),
    h('div', { class: 'rc-id' }, `ID ${c.id}`),
  ]));
}
