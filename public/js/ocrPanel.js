// 画像からの読み取りパネル（カメラ撮影・画像取り込み → 回転 → OCR → 結果の確認・入力欄への反映）
import { h, loading } from './ui.js';
import { post } from './api.js';
import {
  chooseImageFile, captureFromCamera, loadImageFile, renderImage, ImageError, SUPPORTED_LABEL,
} from './imageInput.js';

/**
 * @param {object} o
 * @param {(fields:object)=>void} o.onFields  OCRで抽出した項目を受け取る
 * @param {(target:string, text:string)=>void} o.onLine 読み取った行を指定の入力欄へ入れる
 * @param {()=>{key:string,label:string}[]} o.targets 行の反映先（登録の種類で変わる）
 */
export function createOcrPanel({ onFields, onLine, targets }) {
  let loaded = null; // { source, originalHash, name }
  let rotation = 0;
  let imageId = null;
  let previewUrl = null;
  let busy = false;
  let used = false;

  const preview = h('img', { class: 'ocr-preview', alt: '取り込んだ画像', hidden: true });
  const statusBox = h('div', { class: 'ocr-status', 'aria-live': 'polite' });
  const linesBox = h('div', { class: 'ocr-lines' });
  const rotateBar = h('div', { class: 'row ocr-tools', hidden: true }, [
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => rotate(-90) }, '⟲ 左に回転'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => rotate(90) }, '⟳ 右に回転'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => runOcr() }, 'もう一度読み取る'),
  ]);

  async function pick(kind) {
    if (busy) return;
    const file = kind === 'camera' ? await captureFromCamera() : await chooseImageFile();
    if (file) await loadFile(file);
  }

  async function loadFile(file) {
    statusBox.replaceChildren(loading('画像を読み込んでいます…'));
    linesBox.replaceChildren();
    try {
      loaded = await loadImageFile(file);
      rotation = 0;
      await runOcr();
    } catch (e) {
      const msg = e instanceof ImageError ? e.message : `画像を読み込めませんでした（${e.message}）。${SUPPORTED_LABEL} の画像を選んでください。`;
      statusBox.replaceChildren(h('div', { class: 'notice notice-error', role: 'alert' }, [
        h('p', {}, msg),
        h('p', { class: 'small' }, '下の入力欄に手動で入力して登録することもできます。'),
      ]));
    }
  }

  async function rotate(deg) {
    if (!loaded || busy) return;
    rotation = (rotation + deg + 360) % 360;
    await runOcr();
  }

  async function runOcr() {
    if (!loaded || busy) return;
    busy = true;
    try {
      const img = await renderImage(loaded.source, rotation);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = img.url;
      preview.src = img.url;
      preview.hidden = false;
      rotateBar.hidden = false;
      linesBox.replaceChildren();
      statusBox.replaceChildren(loading('文字を読み取っています…（初回や大きな画像は数十秒かかることがあります）'));
      let r;
      try {
        r = await post('/api/ocr', {
          dataBase64: img.dataBase64, width: img.width, height: img.height,
          originalHash: rotation === 0 ? loaded.originalHash : '', originalName: loaded.name,
        }, { timeoutMs: 180000 });
      } catch (e) {
        if (e.details?.imageId) imageId = e.details.imageId; // 画像は保存済み（登録情報に紐付けられる）
        statusBox.replaceChildren(h('div', { class: 'notice notice-error', role: 'alert' }, [
          h('p', {}, e.message),
          h('p', { class: 'small' }, '画像を見ながら、下の入力欄に手動で入力してください。'),
        ]));
        return;
      }
      imageId = r.imageId;
      used = true;
      renderResult(r);
      onFields(r.ocr.fields, r.ocr);
    } catch (e) {
      statusBox.replaceChildren(h('div', { class: 'notice notice-error', role: 'alert' }, e.message));
    } finally {
      busy = false;
    }
  }

  function renderResult(r) {
    const parts = [];
    if (r.duplicates?.length) {
      parts.push(h('div', { class: 'notice notice-warn', role: 'alert' }, [
        h('p', {}, '⚠ この画像は既に取り込まれています。重複登録にご注意ください。'),
        h('ul', {}, r.duplicates.map((d) => h('li', {}, h('a', { href: `#/${d.type}/${d.id}`, target: '_blank', rel: 'noopener' },
          d.type === 'person' ? `👤 ${d.name}${d.companyName ? `（${d.companyName}）` : ''} ID ${d.id}` : `🏢 ${d.name} ID ${d.id}`)))),
      ]));
    }
    if (!r.ocr.readable) {
      parts.push(h('div', { class: 'notice notice-error', role: 'alert' }, [
        h('p', {}, r.ocr.message),
        h('p', { class: 'small' }, '向きが違う場合は「回転」を押すと読み直します。'),
      ]));
    } else {
      parts.push(h('div', { class: 'notice notice-info' }, [
        h('p', {}, h('strong', {}, '読み取り結果を入力欄に反映しました。必ず画像と見比べて、間違いがあれば修正してください。')),
        h('p', { class: 'small' }, '黄色の入力欄は画像から読み取った内容です。判別できなかった項目は空欄のままです（推測では入力しません）。'),
      ]));
    }
    statusBox.replaceChildren(...parts);
    if (!r.ocr.lines.length) return;
    const extra = ['email', 'phone', 'address', 'url'].map((k) => r.ocr.fields[k]).filter((f) => f && f.value);
    linesBox.replaceChildren(
      h('details', { class: 'ocr-lines-box', open: true }, [
        h('summary', {}, `読み取った文字（${r.ocr.lines.length}行）— ボタンで入力欄へ入れられます`),
        h('ul', { class: 'ocr-line-list' }, r.ocr.lines.map((l) => h('li', { class: 'ocr-line' }, [
          h('span', { class: `ocr-line-text ${l.confidence < 60 ? 'low' : ''}`, title: `認識の確かさ ${l.confidence}%` }, l.text),
          h('span', { class: 'ocr-line-actions' }, targets().map((t) => h('button', {
            type: 'button', class: 'btn btn-xs', onclick: () => onLine(t.key, l.text),
          }, `${t.label}へ`))),
        ]))),
        extra.length ? h('div', { class: 'row' }, [
          h('span', { class: 'small muted' }, '連絡先などの情報:'),
          h('button', {
            type: 'button', class: 'btn btn-xs',
            onclick: () => onLine('memo', ['email', 'phone', 'address', 'url']
              .map((k) => [k, r.ocr.fields[k]]).filter(([, f]) => f?.value)
              .map(([k, f]) => `${{ email: 'メール', phone: '電話', address: '住所', url: 'URL' }[k]}: ${f.value}`).join('\n')),
          }, 'メモに追加'),
        ]) : null,
      ]),
    );
  }

  const el = h('section', { class: 'card ocr-card' }, [
    h('div', { class: 'card-head' }, [h('h2', { class: 'card-title' }, '名刺・資料から読み取る'), h('span', { class: 'muted small' }, '任意')]),
    h('p', { class: 'small muted' }, `名刺や資料を撮影するか、保存済みの画像（${SUPPORTED_LABEL}）を選ぶと、文字を読み取って入力欄に反映します。読み取りはこの端末とサーバー内で行い、外部には送信しません。`),
    h('div', { class: 'row' }, [
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => pick('camera') }, '📷 カメラで撮影'),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => pick('file') }, '🖼 画像を取り込む'),
    ]),
    h('div', { class: 'ocr-body' }, [h('div', { class: 'ocr-image' }, [preview, rotateBar]), h('div', { class: 'ocr-result' }, [statusBox, linesBox])]),
  ]);

  return {
    el,
    loadFile,
    imageId: () => imageId,
    used: () => used,
    isBusy: () => busy,
  };
}
