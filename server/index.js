// 起動スクリプト: npm start
import os from 'node:os';
import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp(config);
app.maintenance();

app.server.listen(config.port, config.host, () => {
  console.log('');
  console.log('==============================================');
  console.log(' 領収証宛名検索アプリ を起動しました');
  console.log(`  このPCで開く:  http://localhost:${config.port}`);
  if (config.host === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  スマホで開く:  http://${n.address}:${config.port}`);
      }
    }
    if (!config.password) console.log('  ⚠ 注意: APP_PASSWORD が未設定です。同じネットワークの誰でも閲覧できます。');
  }
  console.log(`  データ保存先:  ${config.dataDir}`);
  console.log('  終了するには Ctrl + C を押してください');
  console.log('==============================================');
  // OCRの準備を先に行い、初回の取り込みを速くする
  app.ocrProvider.warmUp?.().then(() => console.log('[ocr] 文字認識の準備ができました')).catch((e) => console.warn('[ocr] 準備に失敗:', e.message));
});

app.server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`ポート ${config.port} は使用中です。PORT=3001 npm start のように別の番号で起動してください。`);
  else console.error(e);
  process.exit(1);
});

const shutdown = () => {
  console.log('\n終了しています…');
  app.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
