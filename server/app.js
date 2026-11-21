// アプリの組み立て（各機能を部品として接続する。機能追加はここに部品を足す）
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { openDatabase, backupDatabase } from './db/database.js';
import { createCompaniesRepo } from './repositories/companies.js';
import { createPersonsRepo } from './repositories/persons.js';
import { createImagesRepo } from './repositories/images.js';
import { createRegistry } from './services/registry.js';
import { createSearchService } from './services/searchService.js';
import { createImageService } from './services/images.js';
import { createExporter } from './services/exporter.js';
import { createOcrService } from './ocr/index.js';
import { createTesseractProvider } from './ocr/tesseractProvider.js';
import { initReading } from './search/reading.js';
import { createAuth } from './auth.js';
import { registerRoutes } from './api/routes.js';
import {
  createRouter, sendJson, sendError, securityHeaders, readJson,
} from './http.js';
import { AppError } from './errors.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function createApp(config, { ocrProvider } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(path.join(config.dataDir, 'app.db'));
  const companies = createCompaniesRepo(db);
  const persons = createPersonsRepo(db);
  const images = createImagesRepo(db);
  const searchService = createSearchService({ companies, persons });
  const registry = createRegistry({ db, companies, persons, images, onChange: searchService.invalidate });
  const imageService = createImageService({ images, persons, companies, dataDir: config.dataDir, unlinkedDays: config.unlinkedImageDays });
  const provider = ocrProvider || createTesseractProvider({ cacheDir: path.join(config.root, '.cache') });
  const ocrService = createOcrService({ provider, imageService });
  const exporter = createExporter({ db, companies, persons, images });
  const backupDir = path.join(config.dataDir, 'backups');
  const backup = () => ({ file: path.basename(backupDatabase(db, backupDir, config.backupKeep)), dir: backupDir });
  const auth = createAuth(config.password);
  initReading();

  const router = createRouter();
  registerRoutes(router, {
    registry, searchService, ocrService, imageService, exporter, backup, config,
  });

  const serveFile = (res, file, mime, cache = 'no-cache') => {
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  };

  async function handle(req, res) {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (pathname.startsWith('/api/')) {
      // 別サイトからの書き込み要求を拒否（CSRF対策）
      if (req.method !== 'GET' && req.headers.origin) {
        const host = req.headers.host;
        let originHost = '';
        try { originHost = new URL(req.headers.origin).host; } catch { /* noop */ }
        if (originHost !== host) throw new AppError(403, 'FORBIDDEN_ORIGIN', '許可されていない接続元です。');
      }
      if (pathname === '/api/auth/status') return sendJson(res, 200, { enabled: auth.enabled, authenticated: auth.isAuthenticated(req) });
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const b = await readJson(req, 10000);
        const r = auth.login(req, b.password);
        if (!r.ok) throw new AppError(401, r.locked ? 'LOCKED' : 'BAD_PASSWORD', r.locked ? 'ログインの失敗が続いたため、5分間ログインできません。' : 'パスワードが違います。');
        res.setHeader('Set-Cookie', r.cookie);
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', auth.logout(req));
        return sendJson(res, 200, { ok: true });
      }
      if (!auth.isAuthenticated(req)) throw new AppError(401, 'AUTH_REQUIRED', 'ログインが必要です。');
      const m = router.match(req.method, pathname);
      if (!m) throw new AppError(404, 'NOT_FOUND', 'APIが見つかりません。');
      if (m.methodNotAllowed) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'この操作は許可されていません。');
      return m.handler(req, res, { params: m.params, url, serveFile: (f, mime, cache) => serveFile(res, f, mime, cache) });
    }

    // 静的ファイル（画面）
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError(405, 'METHOD_NOT_ALLOWED', '許可されていない操作です。');
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(config.publicDir, rel));
    if (!file.startsWith(config.publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('ページが見つかりません');
    }
    return serveFile(res, file, MIME[path.extname(file)] || 'application/octet-stream');
  }

  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((e) => {
      if (res.headersSent) { res.end(); return; }
      sendError(res, e);
    });
  });

  // 起動時の保守: バックアップ・不要画像の削除
  const maintenance = () => {
    try {
      const hasData = companies.all().length + persons.all().length > 0;
      if (hasData) backup();
      const removed = imageService.cleanupOrphans();
      if (removed) console.log(`[maintenance] 未使用の画像を ${removed} 件削除しました`);
    } catch (e) {
      console.error('[maintenance] 失敗:', e.message);
    }
  };
  const timer = setInterval(maintenance, config.backupIntervalHours * 3600000);
  timer.unref();

  return {
    server,
    db,
    maintenance,
    ocrProvider: provider,
    async close() {
      clearInterval(timer);
      await new Promise((r) => server.close(r));
      await provider.close?.();
      db.close();
    },
  };
}
