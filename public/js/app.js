// アプリの起動・画面の登録（画面を追加する場合は route() を1行追加）
import { route, startRouter } from './router.js';
import { get, onConnectionChange } from './api.js';
import { renderSearch } from './views/search.js';
import { renderRegister } from './views/register.js';
import { renderPerson, renderCompany } from './views/detail.js';
import { renderEditPerson, renderEditCompany } from './views/edit.js';
import { renderAdmin } from './views/admin.js';
import { renderLogin } from './views/login.js';

route('/', renderSearch);
route('/new', renderRegister);
route('/person/:id', renderPerson);
route('/person/:id/edit', renderEditPerson);
route('/company/:id', renderCompany);
route('/company/:id/edit', renderEditCompany);
route('/admin', renderAdmin);

// 通信状態の表示
const banner = document.getElementById('conn-banner');
let pingTimer = null;
function showBanner(offline) {
  banner.hidden = !offline;
  clearInterval(pingTimer);
  if (offline) pingTimer = setInterval(() => get('/api/health').catch(() => {}), 10000);
}
onConnectionChange((ok) => showBanner(!ok));
window.addEventListener('offline', () => showBanner(true));
window.addEventListener('online', () => get('/api/health').catch(() => {}));
document.getElementById('conn-retry').addEventListener('click', () => get('/api/health').catch(() => {}));

async function boot() {
  const outlet = document.getElementById('app');
  let status;
  try {
    status = await get('/api/auth/status');
  } catch {
    status = { enabled: false, authenticated: true };
  }
  if (status.enabled && !status.authenticated) {
    renderLogin(outlet, () => location.reload());
    return;
  }
  if (status.enabled) document.getElementById('logout').hidden = false;
  startRouter();
}

window.addEventListener('auth-required', () => location.reload());
document.getElementById('logout').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } finally { location.reload(); }
});
boot();
