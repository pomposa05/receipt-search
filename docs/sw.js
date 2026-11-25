// オフラインでも開けるよう、アプリ本体をこの端末にキャッシュする（登録データは扱わない）
const CACHE = 'receipt-search-5284261011b8';
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "vendor/core/tesseract-core-lstm.wasm.js", "vendor/core/tesseract-core-relaxedsimd-lstm.wasm.js", "vendor/core/tesseract-core-simd-lstm.wasm.js", "vendor/lang/eng.traineddata.gz.b64.txt", "vendor/lang/jpn.traineddata.gz.b64.txt", "vendor/tesseract.min.js", "vendor/worker.min.js"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 本体はネットにつながれば最新を取り、つながらなければキャッシュを使う
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put('index.html', c)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
