import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config as baseConfig } from '../../server/config.js';
import { createApp } from '../../server/app.js';

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-'));
}

/** テスト用サーバー（OCRは差し替え可能） */
export async function startApp({ dataDir = tempDir(), password = '', ocrProvider } = {}) {
  const config = { ...baseConfig, dataDir, password, port: 0 };
  const app = createApp(config, { ocrProvider });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* noop */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return { app, base, dataDir, call, close: () => app.close() };
}

export const fakeOcr = (lines) => ({
  name: 'fake',
  async recognize() { return { text: lines.map((l) => l.text).join('\n'), confidence: 90, lines }; },
  async close() {},
});

// 1x1 PNG / JPEG
export const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
