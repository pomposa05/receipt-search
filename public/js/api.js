// サーバーAPIの呼び出し（通信エラー・サーバーエラーを ApiError に統一）
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const listeners = new Set();
let online = true;
export function onConnectionChange(fn) { listeners.add(fn); }
function setOnline(v) {
  if (online === v) return;
  online = v;
  for (const fn of listeners) fn(v);
}
export const isOnline = () => online;

export async function api(method, path, body, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
  } catch (e) {
    setOnline(false);
    const timeout = e.name === 'AbortError';
    throw new ApiError(0, timeout ? 'TIMEOUT' : 'NETWORK',
      timeout ? '応答がありませんでした（時間切れ）。通信状態を確認して、もう一度お試しください。'
        : 'サーバーに接続できませんでした。通信状態やアプリが起動しているかを確認してください。');
  } finally {
    clearTimeout(timer);
  }
  setOnline(true);
  let data = null;
  try { data = await res.json(); } catch { /* 空応答 */ }
  if (!res.ok) {
    const err = data?.error || {};
    if (res.status === 401 && err.code === 'AUTH_REQUIRED') window.dispatchEvent(new CustomEvent('auth-required'));
    throw new ApiError(res.status, err.code || 'HTTP_' + res.status, err.message || `エラーが発生しました（${res.status}）`, err.details);
  }
  return data;
}

export const get = (p, o) => api('GET', p, undefined, o);
export const post = (p, b, o) => api('POST', p, b ?? {}, o);
export const put = (p, b, o) => api('PUT', p, b ?? {}, o);
export const del = (p, o) => api('DELETE', p, undefined, o);
