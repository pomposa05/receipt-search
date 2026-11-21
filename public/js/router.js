// ハッシュ方式の画面切り替え（#/person/12 など）。画面追加は routes に1行足すだけ。
const routes = [];
let current = null; // { view, cleanup, canLeave }
let lastHash = location.hash;
let skipNext = false;

export function route(pattern, loader) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/?]+)'; })}$`);
  routes.push({ re, keys, loader });
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', hash);
    render();
  } else if (location.hash === hash) {
    render();
  } else {
    location.hash = hash;
  }
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, query: new URLSearchParams(qs) };
}

async function render() {
  const { path, query } = parseHash();
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const outlet = document.getElementById('app');
    if (current?.cleanup) current.cleanup();
    current = null;
    outlet.replaceChildren();
    window.scrollTo(0, 0);
    const view = await r.loader({ params, query, outlet });
    current = view || null;
    lastHash = location.hash;
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.section === path.split('/')[1]));
    return;
  }
  location.hash = '#/';
}

/** 未保存の内容がある画面から離れる前に確認する */
async function onHashChange() {
  if (skipNext) { skipNext = false; return; }
  if (current?.canLeave) {
    const ok = await current.canLeave();
    if (!ok) {
      skipNext = true;
      history.pushState(null, '', lastHash || '#/');
      skipNext = false;
      return;
    }
  }
  render();
}

export function startRouter() {
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('beforeunload', (e) => {
    if (current?.isDirty?.()) { e.preventDefault(); e.returnValue = ''; }
  });
  render();
}

export function currentView() { return current; }
