// ===== 人物の顔写真 =====
// 写真は正方形に切り抜いて（400×400px）このページの保存領域（assets）に保存し、人物の photo.assetId で紐付ける。
// 名刺から自動で顔を探すことはしない（誤った切り抜きを防ぐため、利用者が範囲を決める）。

const PHOTO_SIZE = 400;
const photoUrl = (p) => (p?.photo?.assetId ? assetUrl(p.photo.assetId) : null);

/** 丸い顔写真（なければ頭文字） */
function avatar(p, size = 'md') {
  const url = photoUrl(p);
  const initial = String(p?.name || '?').replace(/^[（(].*?[）)]/, '').trim().slice(0, 1) || '?';
  if (url) {
    const img = h('img', { class: `avatar avatar-${size}`, src: url, alt: `${p.name}の写真`, loading: 'lazy' });
    img.addEventListener('error', () => { img.replaceWith(h('span', { class: `avatar avatar-${size} avatar-empty`, 'aria-hidden': 'true' }, initial)); });
    return img;
  }
  return h('span', { class: `avatar avatar-${size} avatar-empty`, 'aria-hidden': 'true' }, initial);
}

/** 顔写真を大きく表示する（写真がなければ追加の画面へ） */
async function showPersonPhoto(p) {
  const cur = S.persons.get(p.id) || p;
  const url = photoUrl(cur);
  if (!url) { choosePersonPhoto(cur); return; }
  const c = cur.companyId ? S.companies.get(cur.companyId) : null;
  const v = await dialog({
    title: `${cur.name}の写真`,
    body: (done) => {
      const img = h('img', { class: 'photo-zoom', src: url, alt: `${cur.name}の写真` });
      img.addEventListener('click', () => done(null));
      return [img, c ? h('p', { class: 'small muted photo-zoom-cap' }, c.name) : null];
    },
    buttons: [{ label: '写真を変更', value: 'change' }, { label: '閉じる', value: true, kind: 'primary' }],
  });
  if (v === 'change') choosePersonPhoto(cur);
}
/** 一覧の小さい写真: タップで拡大（行全体のタップ＝詳細を開く、とは別に動く） */
function zoomableAvatar(p, size) {
  const a = avatar(p, size);
  if (!photoUrl(p)) return a;
  const w = h('span', { class: 'avatar-zoom', role: 'button', tabindex: '0', title: '写真を拡大', 'aria-label': `${p.name}の写真を拡大` }, a);
  const open = (e) => { e.stopPropagation(); e.preventDefault(); showPersonPhoto(p); };
  w.addEventListener('click', open);
  w.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  return w;
}

async function setPersonPhoto(personId, blob) {
  if (!RT.assets) throw new AppError('NO_ASSETS', 'このアカウントでは写真を保存できません（ページの所有者・編集者のみ保存できます）。');
  const cur = await fresh('persons', personId);
  const up = await RT.assets.upload(blob, { type: 'image/jpeg' });
  const patch = { photo: { assetId: up.id, updatedAt: nowIso() }, version: (cur.version || 1) + 1, updatedAt: nowIso() };
  await RT.db.doc(`persons/${personId}`).update(patch);
  applyLocal('persons', personId, patch);
  if (cur.photo?.assetId && cur.photo.assetId !== up.id) await deletePhotoAsset(cur.photo.assetId, null);
}
async function removePersonPhoto(personId) {
  const cur = await fresh('persons', personId);
  if (!cur.photo?.assetId) return;
  const patch = { photo: null, version: (cur.version || 1) + 1, updatedAt: nowIso() };
  await RT.db.doc(`persons/${personId}`).update(patch);
  applyLocal('persons', personId, patch);
  await deletePhotoAsset(cur.photo.assetId, personId);
}
async function deletePhotoAsset(assetId, excludeId = null) {
  // 他の人物が同じ写真を使っていなければ削除（使っていれば残す）
  const used = [...S.persons.values()].some((p) => p.id !== excludeId && p.photo?.assetId === assetId);
  if (used || !RT.assets) return;
  try { await RT.assets.delete(assetId); } catch (e) { console.warn('写真の削除に失敗', e); }
}

/** 写真の用意方法を選ぶ → 切り抜き → 保存 */
async function choosePersonPhoto(p) {
  if (!RT.assets) {
    await dialog({ title: '写真を保存できません', body: h('p', {}, 'このアカウントでは写真を保存できません。ページの所有者、または編集者として招待されたアカウントで操作してください。'), buttons: [{ label: '閉じる', value: true, kind: 'primary' }] });
    return;
  }
  const cards = (p.imageIds || []).map((i) => [i, imageUrl(i)]).filter(([, u]) => u);
  const source = await dialog({
    title: `${p.name}の写真`,
    body: (done) => [
      h('p', { class: 'small muted' }, '写真を用意する方法を選んでください。次の画面で、顔の部分を正方形に切り抜きます。'),
      h('div', { class: 'photo-sources' }, [
        cards.length ? h('div', { class: 'photo-source' }, [
          h('div', { class: 'field-label' }, '名刺画像から切り抜く'),
          h('div', { class: 'thumbs' }, cards.map(([i, u]) => h('button', { type: 'button', class: 'thumb-btn', onclick: () => done({ kind: 'card', url: u, imageId: i }) }, h('img', { class: 'thumb', src: u, alt: '取り込み元画像' })))),
        ]) : null,
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => done({ kind: 'camera' }) }, 'カメラで撮影'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => done({ kind: 'file' }) }, '保存済みの画像を選ぶ'),
      ]),
    ],
    buttons: [{ label: 'キャンセル', value: null }],
  });
  if (!source) return;
  let bitmap;
  try {
    if (source.kind === 'card') {
      const res = await fetch(source.url);
      if (!res.ok) throw new AppError('LOAD', '名刺画像を読み込めませんでした。');
      bitmap = await createImageBitmap(await res.blob());
    } else {
      const file = await pickImageFile(source.kind === 'camera');
      if (!file) return;
      bitmap = (await loadImageFile(file)).source;
    }
  } catch (e) {
    toast(e instanceof AppError ? e.message : `画像を読み込めませんでした。${SUPPORTED_LABEL} の画像でお試しください。`, 'error', 6000);
    return;
  }
  const blob = await cropSquare(bitmap, { title: source.kind === 'card' ? '名刺から顔の部分を切り抜く' : '写真を切り抜く' });
  if (!blob) return;
  try {
    await setPersonPhoto(p.id, blob);
    toast('写真を保存しました', 'success');
  } catch (e) {
    toast(`写真を保存できませんでした: ${e instanceof AppError ? e.message : dbErrorMessage(e)}`, 'error', 7000);
  }
}

/**
 * 正方形の切り抜き画面。枠をドラッグして移動、スライダーで大きさを変える。
 * @returns {Promise<Blob|null>} 400×400 の JPEG
 */
function cropSquare(source, { title = '写真を切り抜く' } = {}) {
  return new Promise((resolve) => {
    let src = source;
    let rot = 0;
    const view = document.createElement('canvas');
    view.className = 'crop-canvas';
    const preview = document.createElement('canvas');
    preview.width = preview.height = 120;
    preview.className = 'crop-preview';
    const sizeRange = h('input', { type: 'range', min: '10', max: '100', value: '50', id: 'crop-size', 'aria-label': '切り抜く大きさ' });
    let W = 0; let H = 0; let scale = 1; // 画像の大きさ・表示倍率
    let sel = { x: 0, y: 0, s: 0 }; // 画像上の正方形（左上・一辺）

    function rotated() {
      // 回転した画像を作り直す（90度単位）
      if (rot === 0) return source;
      const c = document.createElement('canvas');
      c.width = rot % 180 === 0 ? source.width : source.height;
      c.height = rot % 180 === 0 ? source.height : source.width;
      const x = c.getContext('2d');
      if (rot === 90) x.setTransform(0, 1, -1, 0, source.height, 0);
      else if (rot === 180) x.setTransform(-1, 0, 0, -1, source.width, source.height);
      else x.setTransform(0, -1, 1, 0, 0, source.width);
      x.drawImage(source, 0, 0);
      return c;
    }
    function layout(resetSel) {
      src = rotated();
      W = src.width; H = src.height;
      const maxW = Math.min(520, window.innerWidth - 64);
      const maxH = Math.min(420, window.innerHeight * 0.5);
      scale = Math.min(maxW / W, maxH / H, 1);
      view.width = Math.round(W * scale); view.height = Math.round(H * scale);
      if (resetSel) {
        const s = Math.round(Math.min(W, H) * (Number(sizeRange.value) / 100));
        sel = { x: Math.round((W - s) / 2), y: Math.round((H - s) / 2), s };
      }
      draw();
    }
    function clamp() {
      sel.s = Math.max(16, Math.min(sel.s, W, H));
      sel.x = Math.max(0, Math.min(sel.x, W - sel.s));
      sel.y = Math.max(0, Math.min(sel.y, H - sel.s));
    }
    function draw() {
      clamp();
      const c = view.getContext('2d');
      c.clearRect(0, 0, view.width, view.height);
      c.drawImage(src, 0, 0, view.width, view.height);
      c.fillStyle = 'rgba(0,0,0,.5)';
      const sx = sel.x * scale; const sy = sel.y * scale; const ss = sel.s * scale;
      c.fillRect(0, 0, view.width, sy); c.fillRect(0, sy + ss, view.width, view.height - sy - ss);
      c.fillRect(0, sy, sx, ss); c.fillRect(sx + ss, sy, view.width - sx - ss, ss);
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(sx + 1, sy + 1, ss - 2, ss - 2);
      c.beginPath(); c.arc(sx + ss / 2, sy + ss / 2, ss / 2 - 2, 0, Math.PI * 2); c.setLineDash([6, 6]); c.stroke(); c.setLineDash([]);
      const pc = preview.getContext('2d');
      pc.clearRect(0, 0, 120, 120);
      pc.drawImage(src, sel.x, sel.y, sel.s, sel.s, 0, 0, 120, 120);
    }
    // ドラッグで移動（マウス・タッチ共通）
    let drag = null;
    view.addEventListener('pointerdown', (e) => {
      const r = view.getBoundingClientRect();
      const px = (e.clientX - r.left) / scale; const py = (e.clientY - r.top) / scale;
      // 枠の外を押したら、その位置に枠を移動
      if (px < sel.x || px > sel.x + sel.s || py < sel.y || py > sel.y + sel.s) { sel.x = px - sel.s / 2; sel.y = py - sel.s / 2; draw(); }
      drag = { px, py, x: sel.x, y: sel.y };
      view.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    view.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = view.getBoundingClientRect();
      const px = (e.clientX - r.left) / scale; const py = (e.clientY - r.top) / scale;
      sel.x = drag.x + (px - drag.px); sel.y = drag.y + (py - drag.py); draw();
    });
    const endDrag = () => { drag = null; };
    view.addEventListener('pointerup', endDrag);
    view.addEventListener('pointercancel', endDrag);
    sizeRange.addEventListener('input', () => {
      const cx = sel.x + sel.s / 2; const cy = sel.y + sel.s / 2;
      sel.s = Math.round(Math.min(W, H) * (Number(sizeRange.value) / 100));
      sel.x = cx - sel.s / 2; sel.y = cy - sel.s / 2; draw();
    });
    // キーボードでも移動できる
    view.tabIndex = 0;
    view.addEventListener('keydown', (e) => {
      const step = Math.max(4, Math.round(sel.s / 20));
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) { e.preventDefault(); sel.x += d[0]; sel.y += d[1]; draw(); }
    });

    dialog({
      title,
      body: [
        h('p', { class: 'small muted' }, '白い枠をドラッグして顔の位置に合わせ、スライダーで大きさを調整してください（丸い点線の内側が表示されます）。'),
        h('div', { class: 'crop-wrap' }, [view, h('div', { class: 'crop-side' }, [h('div', { class: 'small muted' }, '表示の見本'), preview])]),
        h('div', { class: 'row' }, [h('label', { for: 'crop-size', class: 'small' }, '大きさ'), sizeRange,
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { rot = (rot + 90) % 360; layout(true); } }, '⟳ 回転')]),
      ],
      buttons: [
        { label: 'キャンセル', value: null },
        { label: 'この範囲で保存', kind: 'primary', value: () => sel },
      ],
    }).then((v) => {
      if (!v) { resolve(null); return; }
      const out = document.createElement('canvas');
      out.width = out.height = PHOTO_SIZE;
      const x = out.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(src, sel.x, sel.y, sel.s, sel.s, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
      try {
        out.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
      } catch {
        toast('この画像は切り抜けませんでした。別の画像でお試しください。', 'error');
        resolve(null);
      }
    });
    requestAnimationFrame(() => layout(true));
  });
}
