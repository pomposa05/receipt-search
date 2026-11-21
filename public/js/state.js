// 画面間で一時的に受け渡す値（例: ホームで選んだ画像を登録画面へ渡す）
let pendingImage = null;
export function setPendingImage(file) { pendingImage = file; }
export function takePendingImage() { const f = pendingImage; pendingImage = null; return f; }
