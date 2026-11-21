// 任意のアクセス制御: 環境変数 APP_PASSWORD を設定すると、パスワード入力が必要になる
import crypto from 'node:crypto';

const SESSION_DAYS = 30;

export function createAuth(password) {
  const sessions = new Map(); // token -> expiresAt
  const attempts = new Map(); // ip -> {count, until}
  const enabled = !!password;

  function tokenFrom(req) {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)rs_session=([a-f0-9]{64})/);
    return m ? m[1] : null;
  }

  return {
    enabled,
    isAuthenticated(req) {
      if (!enabled) return true;
      const t = tokenFrom(req);
      if (!t) return false;
      const exp = sessions.get(t);
      if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
      return true;
    },
    login(req, given) {
      const ip = req.socket.remoteAddress || '';
      const a = attempts.get(ip);
      if (a && a.until > Date.now()) return { ok: false, locked: true };
      const g = Buffer.from(String(given ?? ''));
      const p = Buffer.from(password);
      const ok = g.length === p.length && crypto.timingSafeEqual(g, p);
      if (!ok) {
        const count = (a?.count || 0) + 1;
        attempts.set(ip, { count, until: count >= 5 ? Date.now() + 5 * 60000 : 0 });
        return { ok: false, locked: count >= 5 };
      }
      attempts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_DAYS * 86400000);
      return { ok: true, cookie: `rs_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}` };
    },
    logout(req) {
      const t = tokenFrom(req);
      if (t) sessions.delete(t);
      return 'rs_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
    },
  };
}
