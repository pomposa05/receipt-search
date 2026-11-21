// SQLite データベース（Node.js 内蔵 node:sqlite を使用。追加のネイティブモジュール不要）
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.js';

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    transaction(db, () => {
      if (typeof m.up === 'function') m.up(db);
      else db.exec(m.up);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
    });
    console.log(`[db] マイグレーション適用: v${m.version} ${m.name}`);
  }
}

let depth = 0;
/** トランザクション（入れ子呼び出しは外側にまとめる）。例外時はロールバックしデータを壊さない */
export function transaction(db, fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally {
    depth--;
  }
}

/** オンラインバックアップ（VACUUM INTO で整合性のとれた複製を作成） */
export function backupDatabase(db, backupDir, keep = 14) {
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  let file = path.join(backupDir, `app-${ts}.db`);
  let n = 1;
  while (fs.existsSync(file)) file = path.join(backupDir, `app-${ts}-${n++}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(backupDir).filter((f) => /^app-.*\.db$/.test(f)).sort();
  while (files.length > keep) fs.rmSync(path.join(backupDir, files.shift()), { force: true });
  return file;
}
