// OCRプロバイダ: tesseract.js（端末内で処理。画像を外部サービスへ送信しない）
// 日本語・英語の学習データは npm パッケージ（@tesseract.js-data/*）から読み込み、オフラインで動作する。
// 別のOCR（クラウドOCR等）へ差し替える場合は、同じ recognize() インターフェースのプロバイダを作成する。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function prepareLangDir(cacheDir) {
  const dir = path.join(cacheDir, 'tessdata');
  fs.mkdirSync(dir, { recursive: true });
  for (const lang of ['jpn', 'eng']) {
    const dest = path.join(dir, `${lang}.traineddata.gz`);
    if (fs.existsSync(dest)) continue;
    const pkgDir = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    const src = path.join(pkgDir, '4.0.0_best_int', `${lang}.traineddata.gz`);
    fs.copyFileSync(src, dest);
  }
  return dir;
}

export function createTesseractProvider({ cacheDir, timeoutMs = 120000 }) {
  let workerPromise = null;
  let queue = Promise.resolve();

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        const { createWorker } = await import('tesseract.js');
        const langPath = prepareLangDir(cacheDir);
        const worker = await createWorker(['jpn', 'eng'], 1, {
          langPath,
          cachePath: langPath,
          gzip: true,
          logger: () => {},
          errorHandler: (e) => console.warn('[ocr]', e),
        });
        // PSM 3: 自動レイアウト解析（名刺のように大きさの違う文字が散在する資料向け。既定の6だと大きな氏名を取りこぼす）
        await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
        return worker;
      })().catch((e) => {
        workerPromise = null;
        throw e;
      });
    }
    return workerPromise;
  }

  async function run(buffer) {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer, {}, { text: true, blocks: true });
    const lines = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const b = line.bbox || {};
          lines.push({
            text: line.text || '',
            confidence: line.confidence ?? 0,
            height: (b.y1 ?? 0) - (b.y0 ?? 0),
            bbox: b,
          });
        }
      }
    }
    return { text: data.text || '', confidence: data.confidence ?? 0, lines };
  }

  return {
    name: 'tesseract.js (jpn+eng, ローカル処理)',
    /** 画像バッファから文字認識。同時実行は1件ずつ順番に処理する。 */
    recognize(buffer) {
      const job = queue.then(() => withTimeout(run(buffer), timeoutMs));
      queue = job.catch(() => {});
      return job;
    },
    warmUp() {
      return getWorker().then(() => true);
    },
    async close() {
      if (workerPromise) {
        const w = await workerPromise.catch(() => null);
        if (w) await w.terminate();
        workerPromise = null;
      }
    },
  };
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('OCR timeout'), { code: 'OCR_TIMEOUT' })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
