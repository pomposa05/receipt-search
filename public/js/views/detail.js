// ③ 詳細画面（人物／企業）
import {
  h, loading, errorBox, keywordChips, formatDateTime, copyText, confirmDialog, toast, dialog,
} from '../ui.js';
import { get, del } from '../api.js';
import { navigate } from '../router.js';
import { createMemoEditor } from '../memoEditor.js';

function receiptCard(main, alternatives) {
  const alts = [...new Set(alternatives.filter((a) => a && a !== main))];
  return h('section', { class: 'card receipt-card', 'aria-label': '領収証宛名' }, [
    h('div', { class: 'receipt-label' }, '領収証宛名'),
    h('div', { class: 'receipt-row' }, [
      h('div', { class: 'receipt-text', id: 'receipt-text' }, main || '（未設定）'),
      main ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => copyText(main) }, 'コピー') : null,
    ]),
    alts.length ? h('div', { class: 'receipt-alts' }, [
      h('span', { class: 'small muted' }, '他の書き方:'),
      ...alts.map((a) => h('button', { type: 'button', class: 'chip chip-btn', title: 'コピー', onclick: () => copyText(a) }, `${a} ⧉`)),
    ]) : null,
  ]);
}

function infoRow(label, value) {
  return h('div', { class: 'info-row' }, [h('dt', {}, label), h('dd', {}, value)]);
}

function imagesBlock(images) {
  if (!images?.length) return h('span', { class: 'muted' }, '（なし）');
  return h('div', { class: 'thumbs' }, images.map((img) => h('a', {
    href: `/api/images/${img.id}`, target: '_blank', rel: 'noopener', title: `${img.original_name || '画像'}（${formatDateTime(img.created_at)}）`,
  }, h('img', { class: 'thumb', src: `/api/images/${img.id}`, alt: `取り込み元画像 ${img.original_name || ''}`, loading: 'lazy' }))));
}

export async function renderPerson({ outlet, params }) {
  outlet.append(loading());
  let p;
  try {
    p = await get(`/api/persons/${encodeURIComponent(params.id)}`);
  } catch (e) {
    outlet.replaceChildren(errorBox(e.status === 404 ? 'この登録情報は見つかりません（削除された可能性があります）。' : `読み込めませんでした。${e.message}`, () => navigate(location.hash)),
      h('a', { class: 'btn btn-ghost', href: '#/' }, '検索へ戻る'));
    return null;
  }
  const memo = createMemoEditor({ type: 'person', id: p.id, memo: p.memo, memoVersion: p.memoVersion, memoUpdatedAt: p.memoUpdatedAt, label: 'メモ（この人物の登録情報に保存）' });
  const companyName = p.company?.name || '';

  async function remove() {
    const ok = await confirmDialog('登録情報を削除します', [
      `「${p.name}」${companyName ? `（${companyName}）` : ''} ID ${p.id}`,
      'メモも含めて削除され、元に戻せません。企業情報は削除されません。',
    ], { okLabel: '削除する', danger: true });
    if (!ok) return;
    try {
      await del(`/api/persons/${p.id}?version=${p.version}`);
      toast('削除しました', 'success');
      memo.cleanup();
      navigate('#/', { replace: true });
    } catch (e) {
      toast(`削除できませんでした: ${e.message}`, 'error', 6000);
    }
  }

  outlet.replaceChildren(
    h('div', { class: 'page-head' }, [
      h('a', { class: 'back', href: '#/' }, '← 検索へ戻る'),
      h('div', { class: 'title-row' }, [
        h('h1', {}, [h('span', { class: 'type-icon' }, '👤'), p.name]),
        h('span', { class: 'id-badge' }, `人物ID ${p.id}`),
      ]),
      p.nameKana ? h('div', { class: 'kana' }, p.nameKana) : null,
      p.sameNameCount ? h('div', { class: 'notice notice-warn small' }, `同じ名前の登録情報が他に${p.sameNameCount}件あります。企業名・人物IDで区別してください。`) : null,
    ]),
    receiptCard(p.receiptName, [
      companyName ? `${companyName} ${p.name} 様` : '', companyName ? `${companyName} 御中` : '', `${p.name} 様`,
    ]),
    h('section', { class: 'card' }, [
      h('dl', { class: 'info' }, [
        infoRow('名前', [p.name, p.nameKana ? h('span', { class: 'muted' }, `（${p.nameKana}）`) : null]),
        infoRow('企業名', p.company
          ? [h('a', { href: `#/company/${p.company.id}` }, `🏢 ${p.company.name}`), h('span', { class: 'muted small' }, ` 企業ID ${p.company.id}・人物${p.company.personCount}名`)]
          : h('span', { class: 'muted' }, '（企業の登録なし）')),
        infoRow('部署・役職', [p.department, p.title].filter(Boolean).join(' ') || h('span', { class: 'muted' }, '（なし）')),
        infoRow('キーワード', keywordChips(p.keywords)),
        infoRow('登録日時', formatDateTime(p.createdAt)),
        infoRow('最終更新日時', formatDateTime(p.updatedAt)),
      ]),
      h('div', { class: 'form-actions' }, [
        h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: remove }, '削除'),
        h('a', { class: 'btn btn-primary', href: `#/person/${p.id}/edit` }, '情報を編集'),
      ]),
    ]),
    memo.el,
    h('section', { class: 'card' }, [
      h('h2', { class: 'card-title' }, '取り込み元画像'),
      imagesBlock(p.images),
    ]),
    p.affiliationHistory.length ? h('section', { class: 'card' }, [
      h('h2', { class: 'card-title' }, '所属の変更履歴'),
      h('ul', { class: 'history' }, p.affiliationHistory.map((x) => h('li', {}, `${formatDateTime(x.changed_at)}　${x.old_company_name || '企業なし'} → ${x.new_company_name || '企業なし'}`))),
    ]) : '',
  );

  return { isDirty: memo.isDirty, canLeave: memo.canLeave, cleanup: memo.cleanup };
}

export async function renderCompany({ outlet, params }) {
  outlet.append(loading());
  let c;
  try {
    c = await get(`/api/companies/${encodeURIComponent(params.id)}`);
  } catch (e) {
    outlet.replaceChildren(errorBox(e.status === 404 ? 'この企業は見つかりません（削除された可能性があります）。' : `読み込めませんでした。${e.message}`, () => navigate(location.hash)),
      h('a', { class: 'btn btn-ghost', href: '#/' }, '検索へ戻る'));
    return null;
  }
  const memo = createMemoEditor({ type: 'company', id: c.id, memo: c.memo, memoVersion: c.memoVersion, memoUpdatedAt: c.memoUpdatedAt, label: '企業メモ（この企業に保存）' });

  async function remove() {
    if (c.persons.length) {
      await dialog({
        title: 'この企業は削除できません',
        body: [
          h('p', {}, `この企業には ${c.persons.length} 人の人物が紐付いています。名前と企業の紐付けを守るため、先に人物を削除するか、人物の所属企業を変更してください。`),
          h('ul', {}, c.persons.map((p) => h('li', {}, h('a', { href: `#/person/${p.id}` }, `👤 ${p.name}`)))),
        ],
        buttons: [{ label: '閉じる', value: true, kind: 'primary' }],
      });
      return;
    }
    const ok = await confirmDialog('企業を削除します', [`「${c.name}」企業ID ${c.id}`, '企業メモも含めて削除され、元に戻せません。'], { okLabel: '削除する', danger: true });
    if (!ok) return;
    try {
      await del(`/api/companies/${c.id}?version=${c.version}`);
      toast('削除しました', 'success');
      memo.cleanup();
      navigate('#/', { replace: true });
    } catch (e) {
      toast(`削除できませんでした: ${e.message}`, 'error', 6000);
    }
  }

  outlet.replaceChildren(
    h('div', { class: 'page-head' }, [
      h('a', { class: 'back', href: '#/' }, '← 検索へ戻る'),
      h('div', { class: 'title-row' }, [h('h1', {}, [h('span', { class: 'type-icon' }, '🏢'), c.name]), h('span', { class: 'id-badge' }, `企業ID ${c.id}`)]),
      c.nameKana ? h('div', { class: 'kana' }, c.nameKana) : null,
      c.sameNameCount ? h('div', { class: 'notice notice-warn small' }, `同じ（または似た）名前の企業が他に${c.sameNameCount}件あります。企業IDで区別してください。`) : null,
    ]),
    receiptCard(c.receiptName, [`${c.name} 御中`, `${c.name} 様`]),
    h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('h2', { class: 'card-title' }, `この企業の人物（${c.persons.length}名）`),
        h('a', { class: 'btn btn-secondary btn-sm', href: `#/new?companyId=${c.id}` }, '＋ この企業に人物を追加'),
      ]),
      c.persons.length
        ? h('ul', { class: 'person-list' }, c.persons.map((p) => h('li', {}, h('a', { class: 'person-row', href: `#/person/${p.id}` }, [
          h('span', { class: 'pr-name' }, ['👤 ', p.name, p.nameKana ? h('span', { class: 'muted small' }, ` ${p.nameKana}`) : null]),
          h('span', { class: 'small muted' }, [p.department, p.title].filter(Boolean).join(' ')),
          h('span', { class: 'small' }, p.receiptName ? `宛名: ${p.receiptName}` : ''),
          h('span', { class: 'small muted' }, `ID ${p.id}`),
        ]))))
        : h('p', { class: 'muted' }, 'まだ人物が登録されていません。'),
    ]),
    h('section', { class: 'card' }, [
      h('dl', { class: 'info' }, [
        infoRow('企業名', [c.name, c.nameKana ? h('span', { class: 'muted' }, `（${c.nameKana}）`) : null]),
        infoRow('キーワード', keywordChips(c.keywords)),
        infoRow('登録日時', formatDateTime(c.createdAt)),
        infoRow('最終更新日時', formatDateTime(c.updatedAt)),
        c.nameHistory.length ? infoRow('企業名の変更履歴', h('ul', { class: 'history' }, c.nameHistory.map((x) => h('li', {}, `${formatDateTime(x.changed_at)}　${x.old_name} → ${x.new_name}`)))) : null,
      ]),
      h('div', { class: 'form-actions' }, [
        h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: remove }, '削除'),
        h('a', { class: 'btn btn-primary', href: `#/company/${c.id}/edit` }, '企業情報を編集'),
      ]),
    ]),
    memo.el,
    h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '取り込み元画像'), imagesBlock(c.images)]),
  );
  return { isDirty: memo.isDirty, canLeave: memo.canLeave, cleanup: memo.cleanup };
}
