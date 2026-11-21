// ブラウザ内カメラ（PCのWebカメラ等）。https または localhost で利用可能。
import { h } from './ui.js';

export function cameraAvailable() {
  return !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

/** カメラ画面を開き、撮影した画像（Blob）を返す。キャンセル時は null。使用不可の場合は例外。 */
export async function openCameraModal() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    const msg = e.name === 'NotAllowedError'
      ? 'カメラの使用が許可されていません。ブラウザの設定でカメラを許可してください。'
      : e.name === 'NotFoundError' ? 'カメラが見つかりません。' : 'カメラを起動できませんでした。';
    throw new Error(msg);
  }
  return new Promise((resolve) => {
    const video = h('video', { class: 'camera-video', autoplay: true, playsinline: true, muted: true });
    video.srcObject = stream;
    const d = h('dialog', { class: 'dlg dlg-camera' });
    const stop = () => stream.getTracks().forEach((t) => t.stop());
    const finish = (v) => { stop(); d.close(); d.remove(); resolve(v); };
    const shoot = () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob((b) => finish(b), 'image/jpeg', 0.95);
    };
    d.append(
      h('h2', { class: 'dlg-title' }, 'カメラで撮影'),
      h('p', { class: 'muted' }, '名刺や資料を枠いっぱいに、明るい場所で正面から写してください。'),
      video,
      h('div', { class: 'dlg-actions' }, [
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => finish(null) }, 'キャンセル'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: shoot }, '撮影する'),
      ]),
    );
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    document.body.append(d);
    d.showModal();
  });
}
