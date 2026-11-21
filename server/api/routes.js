// REST API の定義（画面からはすべてこのAPI経由でデータを操作する）
import { readJson, sendJson } from '../http.js';
import { AppError } from '../errors.js';
import { getReading, isReadingReady } from '../search/reading.js';
import { toKatakana } from '../search/normalize.js';

export function registerRoutes(router, ctx) {
  const { registry, searchService, ocrService, imageService, exporter, backup, config } = ctx;
  const body = (req) => readJson(req, config.maxBodyBytes);

  router.get('/api/health', (req, res) => sendJson(res, 200, {
    ok: true, ocr: ocrService.providerName, readingReady: isReadingReady(), time: new Date().toISOString(),
  }));

  // 検索
  router.get('/api/search', (req, res, { url }) => {
    const q = (url.searchParams.get('q') || '').slice(0, 200);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    sendJson(res, 200, searchService.search(q, { limit }));
  });
  router.get('/api/recent', (req, res) => sendJson(res, 200, { items: registry.recent(10) }));

  // 人物
  router.get('/api/persons', (req, res) => sendJson(res, 200, { items: registry.listPersons() }));
  router.post('/api/persons', async (req, res) => sendJson(res, 201, registry.createPerson(await body(req))));
  router.get('/api/persons/:id', (req, res, { params }) => sendJson(res, 200, registry.getPerson(params.id)));
  router.put('/api/persons/:id', async (req, res, { params }) => sendJson(res, 200, registry.updatePerson(params.id, await body(req))));
  router.delete('/api/persons/:id', (req, res, { params, url }) => sendJson(res, 200, registry.deletePerson(params.id, url.searchParams.get('version'))));
  router.put('/api/persons/:id/memo', async (req, res, { params }) => sendJson(res, 200, registry.updatePersonMemo(params.id, await body(req))));

  // 企業
  router.get('/api/companies', (req, res, { url }) => {
    const q = url.searchParams.get('q');
    if (q != null) sendJson(res, 200, { items: registry.suggestCompanies(q.slice(0, 200)) });
    else sendJson(res, 200, { items: registry.listCompanies() });
  });
  router.post('/api/companies', async (req, res) => sendJson(res, 201, registry.createCompany(await body(req))));
  router.get('/api/companies/:id', (req, res, { params }) => sendJson(res, 200, registry.getCompany(params.id)));
  router.put('/api/companies/:id', async (req, res, { params }) => sendJson(res, 200, registry.updateCompany(params.id, await body(req))));
  router.delete('/api/companies/:id', (req, res, { params, url }) => sendJson(res, 200, registry.deleteCompany(params.id, url.searchParams.get('version'))));
  router.put('/api/companies/:id/memo', async (req, res, { params }) => sendJson(res, 200, registry.updateCompanyMemo(params.id, await body(req))));

  // 重複
  router.post('/api/duplicates/check', async (req, res) => sendJson(res, 200, registry.checkDuplicates(await body(req))));
  router.get('/api/duplicates', (req, res) => sendJson(res, 200, registry.duplicateGroups()));

  // 読み仮名の候補（推定。確定は利用者が行う）
  router.post('/api/reading', async (req, res) => {
    const b = await body(req);
    const r = getReading(String(b.text || '').slice(0, 200));
    sendJson(res, 200, { reading: r ? toKatakana(r) : '', available: isReadingReady() });
  });

  // OCR
  router.post('/api/ocr', async (req, res) => sendJson(res, 200, await ocrService.processImage(await body(req))));
  router.get('/api/images/:id', (req, res, { params, serveFile }) => {
    const f = imageService.getFile(Number(params.id));
    if (!f) throw new AppError(404, 'NOT_FOUND', '画像が見つかりません。');
    serveFile(f.file, f.mime, 'private, max-age=3600');
  });

  // データ管理
  router.get('/api/stats', (req, res) => sendJson(res, 200, exporter.stats()));
  router.get('/api/export.json', (req, res) => {
    const data = exporter.json();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="receipt-search-${stamp()}.json"`,
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data, null, 2));
  });
  router.get('/api/export.csv', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="receipt-search-${stamp()}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.end(`﻿${exporter.csv()}`); // BOM付き（Excelで文字化けしない）
  });
  router.post('/api/backup', (req, res) => sendJson(res, 200, backup()));
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
}
