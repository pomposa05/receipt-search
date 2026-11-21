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
