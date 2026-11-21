// メモ編集部品（人物メモ・企業メモ共通）
// - 入力停止から2秒後に自動保存＋「保存」ボタン（Ctrl+S / ⌘+S でも保存）
// - 保存状態を常に表示（保存済み / 未保存 / 保存中 / 保存失敗）。サーバーの保存完了を確認してから「保存済み」にする
// - 保存できなかった内容は端末内に下書きとして退避し、次回表示時に復元を案内
// - 他の端末で同時に更新された場合は上書きせず、どちらを残すか選ばせる
import { h, toast, dialog, formatDateTime, formatTime, debounce } from './ui.js';
import { put } from './api.js';

export function createMemoEditor({ type, id, memo, memoVersion, memoUpdatedAt, label = 'メモ' }) {
  const endpoint = `/api/${type === 'company' ? 'companies' : 'persons'}/${id}/memo`;
  const draftKey = `memo-draft:${type}:${id}`;
  let saved = memo || '';
  let version = memoVersion;
  let state = 'saved'; // saved | dirty | saving | error
  let inflight = null;

  const ta = h('textarea', {
    class: 'memo-text', id: `memo-${type}-${id}`, rows: 6, maxlength: 100000,
    placeholder: '自由に入力できます（例: 領収証は但し書き「お品代」で発行、など）。入力すると自動で保存されます。',
    'aria-describedby': `memo-status-${type}-${id}`,
  });
  ta.value = saved;
  const status = h('span', { class: 'memo-status', id: `memo-status-${type}-${id}`, role: 'status', 'aria-live': 'polite' });
  const count = h('span', { class: 'muted small' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => save() }, 'メモを保存');
  const retryBtn = h('button', { type: 'button', class: 'btn btn-danger btn-sm', hidden: true, onclick: () => save() }, '再試行');
  const draftBox = h('div', { class: 'notice notice-warn', hidden: true });
  const updatedLine = h('div', { class: 'muted small' });

  function setState(s, detail = '') {
    state = s;
    const text = {
      saved: `✓ 保存済み${detail ? `（${detail}）` : ''}`,
      dirty: '● 未保存の変更があります',
      saving: '保存中…',
      error: `✕ 保存に失敗しました。このメモは未保存です。${detail}`,
    }[s];
    status.textContent = text;
    status.className = `memo-status memo-${s}`;
    retryBtn.hidden = s !== 'error';
    saveBtn.disabled = s === 'saving';
  }
  function updateCount() {
    count.textContent = `${ta.value.length.toLocaleString()}文字`;
  }
  function autoGrow() {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(600, Math.max(140, ta.scrollHeight + 4))}px`;
  }
  function setUpdated(iso) {
    updatedLine.textContent = iso ? `メモの最終保存: ${formatDateTime(iso)}` : 'メモはまだ保存されていません';
  }

  function writeDraft() {
    try {
      if (ta.value !== saved) localStorage.setItem(draftKey, JSON.stringify({ text: ta.value, baseVersion: version, at: new Date().toISOString() }));
      else localStorage.removeItem(draftKey);
    } catch { /* 端末の保存領域が使えない場合は無視 */ }
  }
  function clearDraft() {
    try { localStorage.removeItem(draftKey); } catch { /* noop */ }
  }

  const autoSave = debounce(() => { if (state === 'dirty') save(); }, 2000);

  ta.addEventListener('input', () => {
    updateCount();
    autoGrow();
    if (ta.value === saved) { setState('saved'); clearDraft(); autoSave.cancel(); return; }
    setState('dirty');
    writeDraft();
    autoSave();
  });
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  });

  async function save({ force = false } = {}) {
    autoSave.cancel();
    if (inflight) { await inflight.catch(() => {}); }
    const text = ta.value;
    if (text === saved && !force) { setState('saved'); clearDraft(); return true; }
    setState('saving');
    inflight = put(endpoint, { memo: text, memoVersion: version });
    try {
      const r = await inflight;
      saved = r.memo;
      version = r.memoVersion;
      setUpdated(r.memoUpdatedAt);
      if (ta.value === text) {
        setState('saved', formatTime(r.memoUpdatedAt));
        clearDraft();
      } else {
        setState('dirty'); // 保存中にさらに入力された
        autoSave();
      }
      return true;
    } catch (e) {
      if (e.code === 'MEMO_CONFLICT') return resolveConflict(e.details, text);
      writeDraft();
      setState('error', e.code === 'NETWORK' || e.code === 'TIMEOUT' ? '通信を確認して「再試行」を押してください。' : e.message);
      toast(`メモを保存できませんでした: ${e.message}`, 'error', 6000);
      return false;
    } finally {
      inflight = null;
    }
  }

  async function resolveConflict(details, mine) {
    setState('error', '他の端末で更新されています。');
    const choice = await dialog({
      title: 'メモが他の画面・端末で更新されています',
      body: [
        h('p', {}, 'どちらの内容を残すか選んでください。選ばなかった内容は失われます（必要ならコピーしてください）。'),
        h('div', { class: 'conflict-grid' }, [
          h('div', {}, [h('h3', {}, `保存されている内容（${formatDateTime(details.memoUpdatedAt)}）`), h('pre', { class: 'conflict-text' }, details.currentMemo || '（空）')]),
          h('div', {}, [h('h3', {}, 'この画面で入力した内容'), h('pre', { class: 'conflict-text' }, mine || '（空）')]),
        ]),
      ],
      buttons: [
        { label: '保存されている内容を表示', value: 'theirs' },
        { label: '入力した内容で上書き保存', value: 'mine', kind: 'primary' },
      ],
      dismissible: false,
    });
    version = details.memoVersion;
    if (choice === 'mine') {
      saved = details.currentMemo;
      return save({ force: true });
    }
    saved = details.currentMemo || '';
    ta.value = saved;
    clearDraft();
    updateCount();
    autoGrow();
    setUpdated(details.memoUpdatedAt);
    setState('saved');
    return true;
  }

  // 前回保存できなかった下書きの復元案内
  try {
    const raw = localStorage.getItem(draftKey);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.text !== saved) {
        draftBox.hidden = false;
        draftBox.append(
          h('p', {}, `保存されていないメモの下書きがあります（${formatDateTime(d.at)}）。`),
          h('div', { class: 'row' }, [
            h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => { ta.value = d.text; ta.dispatchEvent(new Event('input')); draftBox.hidden = true; } }, '下書きを復元する'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { clearDraft(); draftBox.hidden = true; } }, '破棄する'),
          ]),
        );
      } else clearDraft();
    }
  } catch { /* noop */ }

  setState('saved');
  setUpdated(memoUpdatedAt);
  updateCount();

  const el = h('section', { class: 'card memo-card', 'aria-label': label }, [
    h('div', { class: 'card-head' }, [h('h2', { class: 'card-title' }, label), status]),
    draftBox,
    ta,
    h('div', { class: 'memo-foot' }, [h('div', {}, [updatedLine, count]), h('div', { class: 'row' }, [retryBtn, saveBtn])]),
  ]);
  requestAnimationFrame(autoGrow);

  return {
    el,
    isDirty: () => state !== 'saved',
    async canLeave() {
      if (state === 'saved') return true;
      if (state === 'dirty' || state === 'saving') {
        if (await save()) return true;
      }
      const ok = await dialog({
        title: 'メモが保存されていません',
        body: h('p', {}, 'このまま移動すると、メモの変更は保存されません（下書きは端末内に残ります）。移動しますか？'),
        buttons: [{ label: 'この画面に残る', value: false, kind: 'primary' }, { label: '保存せずに移動', value: true, kind: 'danger' }],
      });
      return ok === true;
    },
    cleanup() { autoSave.cancel(); },
  };
}
