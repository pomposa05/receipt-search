// 画像の保存・検証・重複検知・不要画像の掃除
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError, badRequest } from '../errors.js';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export function createImageService({ images, persons, companies, dataDir, unlinkedDays = 7 }) {
  const dir = path.join(dataDir, 'images');
  fs.mkdirSync(dir, { recursive: true });

  function describeLinks(imageId) {
    return images.linksForImage(imageId).map((l) => {
      if (l.entity_type === 'person') {
        const p = persons.get(l.entity_id);
        return p ? { type: 'person', id: p.id, name: p.name, companyName: p.company_name || '' } : null;
      }
      const c = companies.get(l.entity_id);
      return c ? { type: 'company', id: c.id, name: c.name } : null;
    }).filter(Boolean);
  }

  return {
    dir,
    save({ dataBase64, originalHash = '', originalName = '', width, height }) {
      if (typeof dataBase64 !== 'string' || !dataBase64) throw badRequest('画像データがありません。');
      const b64 = dataBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(b64, 'base64');
      if (!buffer.length) throw badRequest('画像データを読み込めませんでした。');
      if (buffer.length > MAX_IMAGE_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', '画像が大きすぎます（15MBまで）。');
      const type = detectImageType(buffer);
      if (!type) throw new AppError(415, 'UNSUPPORTED_IMAGE', '対応していない画像形式です。JPG・JPEG・PNG・WebP の画像を選んでください。');
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const safeOriginalHash = /^[0-9a-f]{64}$/.test(originalHash) ? originalHash : '';
      // 重複（同じ画像・同じ元ファイル）の検知
      const dupImages = images.byHashes(sha256, safeOriginalHash);
      const duplicates = [];
      for (const d of dupImages) for (const link of describeLinks(d.id)) duplicates.push({ imageId: d.id, ...link });
      let image = images.bySha(sha256);
      if (!image) {
        const fileName = `${sha256}.${type.ext}`;
        const file = path.join(dir, fileName);
        fs.writeFileSync(`${file}.tmp`, buffer);
        fs.renameSync(`${file}.tmp`, file);
        const id = images.insert({
          sha256, original_hash: safeOriginalHash, mime: type.mime, file_name: fileName,
          original_name: String(originalName).slice(0, 200),
          width: Number.isFinite(Number(width)) ? Math.round(Number(width)) : null,
          height: Number.isFinite(Number(height)) ? Math.round(Number(height)) : null,
        }, new Date().toISOString());
        image = images.get(id);
      }
      return { image, buffer, duplicates };
    },
    setOcrText(id, text) {
      images.setOcr(id, String(text || '').slice(0, 20000));
    },
    getFile(id) {
      const img = images.get(id);
      if (!img) return null;
      const file = path.join(dir, path.basename(img.file_name));
      if (!fs.existsSync(file)) return null;
      return { file, mime: img.mime };
    },
    /** 登録情報に紐付かないまま一定日数が過ぎた画像を削除（個人情報を不要に残さない） */
    cleanupOrphans() {
      const before = new Date(Date.now() - unlinkedDays * 86400000).toISOString();
      let n = 0;
      for (const img of images.orphans(before)) {
        fs.rmSync(path.join(dir, path.basename(img.file_name)), { force: true });
        images.delete(img.id);
        n++;
      }
      return n;
    },
  };
}
