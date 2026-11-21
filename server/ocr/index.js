// OCRサービス: 画像の保存 → 重複確認 → 文字認識 → 項目抽出
import { AppError } from '../errors.js';
import { extractFields } from './extract.js';

export function createOcrService({ provider, imageService }) {
  return {
    providerName: provider.name,
    async processImage(input) {
      const saved = imageService.save(input); // 形式・サイズを検証して保存
      let result;
      try {
        result = await provider.recognize(saved.buffer);
      } catch (e) {
        console.error('[ocr] 認識エラー:', e);
        throw new AppError(422, e.code === 'OCR_TIMEOUT' ? 'OCR_TIMEOUT' : 'OCR_FAILED',
          e.code === 'OCR_TIMEOUT'
            ? '文字認識に時間がかかりすぎたため中止しました。画像を小さくするか、手動で入力してください。'
            : '文字認識に失敗しました。手動で入力するか、別の画像でお試しください。',
          { imageId: saved.image.id, duplicates: saved.duplicates });
      }
      imageService.setOcrText(saved.image.id, result.text);
      const extracted = extractFields(result.lines);
      const readable = extracted.lines.length > 0;
      return {
        imageId: saved.image.id,
        duplicates: saved.duplicates,
        ocr: {
          engine: provider.name,
          confidence: Math.round(result.confidence),
          readable,
          message: readable ? '' : '画像から文字を読み取れませんでした。明るい場所で正面から撮り直すか、手動で入力してください。',
          lines: extracted.lines,
          fields: extracted.fields,
        },
      };
    },
  };
}
