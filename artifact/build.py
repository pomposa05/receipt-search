# アーティファクト版を1つのHTMLにまとめる（検索エンジンはPC版と同じソースを使う）
import re, pathlib, shutil, base64
root = pathlib.Path(__file__).resolve().parent
nm = root.parent / 'node_modules'

def build_vendor():
    """端末内での文字認識に使うファイルを node_modules から作る（artifact/vendor/。公開時に一緒にアップロードする）"""
    v = root / 'vendor'
    (v / 'core').mkdir(parents=True, exist_ok=True)
    (v / 'lang').mkdir(parents=True, exist_ok=True)
    shutil.copy(nm / 'tesseract.js/dist/tesseract.min.js', v / 'tesseract.min.js')
    shutil.copy(nm / 'tesseract.js/dist/tesseract.min.js.LICENSE.txt', v / 'LICENSE-tesseract.txt')
    # tesseract.js 7.0.0 の不具合修正: 言語データをオブジェクトで渡すと名前に data が使われる → code に直す
    w = (nm / 'tesseract.js/dist/worker.min.js').read_text()
    old = 'return"string"==typeof t?t:t.data})).join("+")'
    assert w.count(old) == 1, 'worker.min.js の修正箇所が見つかりません（tesseract.js のバージョンを確認してください）'
    w = w.replace(old, 'return"string"==typeof t?t:t.code})).join("+")')
    (v / 'worker.min.js').write_text('/* 修正: tesseract.js 7.0.0 の initialize で言語オブジェクトの名前に data を使っていた不具合を code に修正 */\n' + w)
    for f in ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']:
        shutil.copy(nm / 'tesseract.js-core' / f, v / 'core' / f)
    # 言語データは gzip を base64 テキストにする（アーティファクトで配信できる形式のため）
    for lang in ['jpn', 'eng']:
        data = (nm / f'@tesseract.js-data/{lang}/4.0.0_best_int/{lang}.traineddata.gz').read_bytes()
        (v / 'lang' / f'{lang}.traineddata.gz.b64.txt').write_text(base64.b64encode(data).decode())
    print('vendor/ を作成しました')

build_vendor()
srv = root.parent / 'server' / 'search'
def strip(src):
    src = re.sub(r"^import[\s\S]*?from\s+'[^']+';\n", '', src, flags=re.M)
    return re.sub(r'^export\s+(?=(const|function|class|let|async))', '', src, flags=re.M)
parts = ['// ---- 検索エンジン（PC版 server/search と同一）----']
for f in ['normalize.js', 'similarity.js', 'engine.js']:
    parts.append(f'// --- {f} ---\n' + strip((srv / f).read_text()))
parts.append('// --- ocr/extract.js（PC版と同一の抽出規則）---\n' + strip((root.parent / 'server' / 'ocr' / 'extract.js').read_text()))
parts.append((root / 'src' / 'core.js').read_text())
parts.append((root / 'src' / 'selection.js').read_text())
parts.append((root / 'src' / 'photo.js').read_text())
parts.append((root / 'src' / 'groups.js').read_text())
parts.append((root / 'src' / 'bulk.js').read_text())
parts.append((root / 'src' / 'views.js').read_text())
script = '\n'.join(parts)
assert '</script' not in script
page = (root / 'src' / 'page.html').read_text().replace('/*__SCRIPT__*/', script)
out = root / 'dist' / 'receipt-search.html'
out.write_text(page)
print(out, len(page.encode()), 'bytes')

# ===== GitHub Pages版（スマホ保存）: docs/ に出力する =====
# データは各端末のブラウザ内（IndexedDB）だけに保存され、リポジトリにも外部にも送られない。
import hashlib, json
docs = root.parent / 'docs'
if docs.exists():
    shutil.rmtree(docs)
shutil.copytree(root / 'vendor', docs / 'vendor')
body = (root / 'src' / 'page.html').read_text()
# 外部フォント（Google Fonts）は読み込まない（オフラインで動かすため・外部への通信をなくすため）
body = re.sub(r'<link rel="preconnect"[^>]*>\n', '', body)
body = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>\n', '', body)
body = body.replace('<title>領収証宛名検索</title>\n', '')
body = re.sub(r'<meta name="claude:[^>]*>\n', '', body)
local_rt = (root / 'src' / 'local-runtime.js').read_text()
assert '</script' not in local_rt
local_script = "const APP_MODE = 'local';\n" + script
body = body.replace('/*__SCRIPT__*/', local_script)
version = hashlib.sha256((local_rt + body).encode()).hexdigest()[:12]
sw_reg = """if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});"""
html = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'">
<meta name="theme-color" content="#1d5bbf">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="宛名検索">
<title>領収証宛名検索</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>[hidden]{{display:none!important}} body{{margin:0}}</style>
<script>
{local_rt}
{sw_reg}
</script>
</head>
<body>
{body}
</body>
</html>
"""
(docs / 'index.html').write_text(html)

# アイコン（領収証の形を描いた単純な図形）
def make_icon(size, path):
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (size, size), '#1d5bbf')
    d = ImageDraw.Draw(im)
    s = size / 192
    d.rounded_rectangle([46*s, 30*s, 146*s, 162*s], radius=10*s, fill='#ffffff')
    for i, w in enumerate([70, 56, 70, 40]):
        y = (58 + i * 22) * s
        d.rounded_rectangle([61*s, y, (61 + w)*s, y + 8*s], radius=4*s, fill='#1d5bbf' if i == 0 else '#9fb6dc')
    d.ellipse([112*s, 112*s, 166*s, 166*s], fill='#ffb020')
    d.ellipse([124*s, 124*s, 148*s, 148*s], outline='#1d5bbf', width=max(2, int(6*s)))
    d.line([146*s, 146*s, 158*s, 158*s], fill='#1d5bbf', width=max(2, int(6*s)))
    im.save(path)
for sz, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')]:
    make_icon(sz, docs / name)

(docs / 'manifest.webmanifest').write_text(json.dumps({
    'name': '領収証宛名検索', 'short_name': '宛名検索', 'lang': 'ja',
    'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#f3f5f9', 'theme_color': '#1d5bbf',
    'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
              {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any maskable'}],
}, ensure_ascii=False, indent=2))

# オフライン用キャッシュ（アプリ本体と文字認識のファイル）。登録データはキャッシュしない（IndexedDBにある）
files = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']
files += sorted(str(p.relative_to(docs)) for p in (docs / 'vendor').rglob('*') if p.is_file() and not p.name.startswith('LICENSE'))
vh = hashlib.sha256()
for f in files[1:]:
    vh.update((docs / f).read_bytes())
sw = f"""// オフラインでも開けるよう、アプリ本体をこの端末にキャッシュする（登録データは扱わない）
const CACHE = 'receipt-search-{vh.hexdigest()[:12]}';
const FILES = {json.dumps(files)};
self.addEventListener('install', (e) => {{ e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); }});
self.addEventListener('activate', (e) => {{ e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); }});
self.addEventListener('fetch', (e) => {{
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 本体はネットにつながれば最新を取り、つながらなければキャッシュを使う
  if (e.request.mode === 'navigate') {{
    e.respondWith(fetch(e.request).then((r) => {{ const c = r.clone(); caches.open(CACHE).then((x) => x.put('index.html', c)); return r; }}).catch(() => caches.match('index.html')));
    return;
  }}
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
}});
"""
(docs / 'sw.js').write_text(sw)
(docs / '.nojekyll').write_text('')
print('docs/ を作成しました', len(html.encode()), 'bytes')
