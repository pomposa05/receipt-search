// 環境設定（環境変数で上書き可能）
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  // 既定は自分のPCからのみ接続可。スマートフォンから使う場合は HOST=0.0.0.0 と APP_PASSWORD を設定
  host: process.env.HOST || '127.0.0.1',
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data'),
  password: process.env.APP_PASSWORD || '',
  maxBodyBytes: 30 * 1024 * 1024,
  backupKeep: Number(process.env.BACKUP_KEEP || 14),
  backupIntervalHours: 24,
  unlinkedImageDays: 7,
  publicDir: path.join(root, 'public'),
};
