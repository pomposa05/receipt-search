// ログイン画面（APP_PASSWORD を設定した場合のみ表示）
import { h } from '../ui.js';
import { post } from '../api.js';

export function renderLogin(outlet, onDone) {
  const pw = h('input', { type: 'password', id: 'pw', class: 'input', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'field-error', role: 'alert', hidden: true });
  const form = h('form', { class: 'card form login' }, [
    h('h1', {}, 'ログイン'),
    h('p', { class: 'small muted' }, 'このアプリにはパスワードが設定されています。'),
    h('label', { for: 'pw', class: 'field-label' }, 'パスワード'),
    pw, err,
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, 'ログイン')),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      await post('/api/auth/login', { password: pw.value });
      onDone();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      pw.select();
    }
  });
  outlet.replaceChildren(form);
  pw.focus();
}
