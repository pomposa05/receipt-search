// 画像の選択・カメラ撮影・前処理（向き補正、縮小、回転）・重複検知用ハッシュ
import { h, dialog } from './ui.js';
import { openCameraModal, cameraAvailable } from './camera.js';

export const SUPPORTED_LABEL = 'JPG・JPEG・PNG・WebP';
const SUPPORTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
// HEIC等はブラウザが表示できれば読み込む（iPhoneの多くは選択時にJPEGへ自動変換される）
const TRY_TYPES = ['image/heic', 'image/heif', 'image/bmp', 'image/gif'];
const MAX_FILE_BYTES = 40 * 1024 * 1024;

export class ImageError extends Error {}

function pickFile({ capture = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

/** 画像ファイルを選ぶ（ボタン押下の処理内で呼ぶこと） */
export function chooseImageFile() {
  return pickFile();
}

// スマートフォン・タブレット判定（判定方法によって揺れがあるため複数の手掛かりを併用）
const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches
  || (navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches)
  || navigator.userAgentData?.mobile === true
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/**
 * カメラで撮影する。
 * スマートフォン: 端末のカメラアプリを起動（高画質）。PC: ブラウザ内カメラ（Webカメラ）。
 * カメラが使えない場合は画像の取り込みを案内する。
 */
export async function captureFromCamera() {
  if (isTouchDevice()) return pickFile({ capture: true });
  if (cameraAvailable()) {
    try {
      const blob = await openCameraModal();
      if (blob) return new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      return null;
    } catch (e) {
      return cameraFallback(e.message);
    }
  }
  return cameraFallback(window.isSecureContext
    ? 'この端末ではカメラを使用できません。'
    : 'この接続方式（http）ではブラウザ内カメラを使用できません。');
}

async function cameraFallback(reason) {
  const v = await dialog({
    title: 'カメラを使用できません',
    body: [
      h('p', {}, reason),
      h('p', {}, '撮影済みの写真や保存済みの画像を「画像を取り込む」から選んで登録できます。'),
    ],
    buttons: [
      { label: '閉じる', value: false },
      { label: '画像を選ぶ', value: true, kind: 'primary' },
    ],
  });
  return v ? pickFile() : null;
}

/** ファイルを検証してデコードする */
export async function loadImageFile(file) {
  if (!file) throw new ImageError('画像が選択されていません。');
  const type = (file.type || '').toLowerCase();
  const byExt = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
  if (!(SUPPORTED_TYPES.includes(type) || TRY_TYPES.includes(type) || (!type && byExt))) {
    throw new ImageError(`対応していないファイル形式です（${type || file.name || '不明'}）。${SUPPORTED_LABEL} の画像を選んでください。`);
  }
  if (file.size > MAX_FILE_BYTES) throw new ImageError('ファイルが大きすぎます（40MBまで）。');
  if (file.size === 0) throw new ImageError('ファイルが空です。別の画像を選んでください。');
  let source;
  try {
    // 写真の向き情報（EXIF）に従って正しい向きで読み込む
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await loadViaImg(file).catch(() => null);
  }
  if (!source || !source.width) {
    throw new ImageError(`画像を読み込めませんでした。ファイルが壊れているか、このブラウザで表示できない形式です。${SUPPORTED_LABEL} の画像でお試しください。`);
  }
  const originalHash = await sha256Hex(await file.arrayBuffer()).catch(() => '');
  return { source, originalHash, name: file.name || '' };
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/**
 * 回転・縮小してJPEGにする（OCRと保存用）
 * 長辺は 2400px まで縮小、小さい画像は長辺 1400px（最大1.8倍）まで拡大（実測で 1200〜1500px が最も安定して正確だったため）して文字を読みやすくする。
 */
export async function renderImage(source, rotation = 0) {
  const sw = source.width;
  const sh = source.height;
  const long = Math.max(sw, sh);
  let scale = 1;
  if (long > 2400) scale = 2400 / long;
  else if (long < 1400) scale = Math.min(1.8, 1400 / long);
  const w = Math.round(sw * scale);
  const hgt = Math.round(sh * scale);
  const rot = ((rotation % 360) + 360) % 360;
  const canvas = document.createElement('canvas');
  canvas.width = rot % 180 === 0 ? w : hgt;
  canvas.height = rot % 180 === 0 ? hgt : w;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 半ピクセルのずれで文字がぼやけないよう、回転は整数座標で行う
  if (rot === 90) ctx.setTransform(0, 1, -1, 0, hgt, 0);
  else if (rot === 180) ctx.setTransform(-1, 0, 0, -1, w, hgt);
  else if (rot === 270) ctx.setTransform(0, -1, 1, 0, 0, w);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, hgt);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) throw new ImageError('画像の変換に失敗しました。別の画像でお試しください。');
  const dataBase64 = await blobToBase64(blob);
  return { blob, dataBase64, width: canvas.width, height: canvas.height, url: URL.createObjectURL(blob) };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---------- SHA-256（http接続では crypto.subtle が使えないため純JS版も用意） ----------
export async function sha256Hex(buf) {
  if (window.crypto?.subtle && window.isSecureContext) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Js(new Uint8Array(buf));
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

export function sha256Js(bytes) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 0x100000000));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}
