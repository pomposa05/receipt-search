# 領収証宛名検索アプリ

名前・企業名・キーワード・メモから**領収証の宛名**をすばやく探し、名刺や資料を撮影／画像取り込みして OCR で登録し、検索後にいつでもメモを追記・編集できる Web アプリです。スマートフォンとパソコンの両方で使えます。

- 個人情報は**外部サービスへ一切送信しません**（OCR・読み仮名推定もすべてローカルで処理）
- 追加の DB サーバー不要（Node.js 内蔵の SQLite を使用）
- **登録データはこのリポジトリに含まれません。** データは起動したPCの `data/` フォルダにだけ保存されます（`.gitignore` で除外済み）

> このリポジトリには、PC版（`server/`・`public/`）と、claude.ai のアーティファクトとして動かす版（`artifact/`）の2つが入っています。どちらも同じ検索エンジン（`server/search/`）を使います。

---

## 1. 起動方法

必要なもの: **Node.js 22.13 以上**（https://nodejs.org/ から LTS 版をインストール）

```bash
cd receipt-search
```

```bash
npm install
```

```bash
npm start
```

ブラウザで **http://localhost:3000** を開きます。終了は `Ctrl + C`。

### スマートフォンから使う場合（同じ Wi-Fi 内）

```bash
HOST=0.0.0.0 APP_PASSWORD=好きなパスワード npm start
```

起動時に表示される `http://192.168.x.x:3000` をスマートフォンで開きます。
（Windows の PowerShell では `$env:HOST="0.0.0.0"; $env:APP_PASSWORD="..."; npm start`）

| 環境変数 | 既定値 | 内容 |
|---|---|---|
| `PORT` | 3000 | ポート番号 |
| `HOST` | 127.0.0.1 | 接続を受け付けるアドレス。`0.0.0.0` で LAN 内の他端末から接続可 |
| `APP_PASSWORD` | （なし） | 設定するとログインが必要になる。LAN 公開時は必ず設定 |
| `DATA_DIR` | ./data | データ保存先 |
| `BACKUP_KEEP` | 14 | 自動バックアップの保持数 |

> 起動時に `Error opening data file ./.traineddata` と表示されることがありますが、OCR エンジン初期化時の無害なメッセージです（直後に「文字認識の準備ができました」と出れば正常）。

---

## 2. 基本的な使い方

1. **検索**: ホームの検索欄に名前・企業名・読み・キーワード・メモの一部を入力 → 一致度の高い順に表示。「候補・要確認」は曖昧検索で見つかった候補です。
2. **詳細**: 結果をタップ → 領収証宛名を大きく表示（「コピー」ボタンあり）。メモを入力すると自動保存されます。
3. **登録**: 「新規登録」から手入力、または「カメラで撮影」「画像を取り込む」で名刺を読み取り → 黄色の欄（OCR結果）を画像と見比べて修正 → 「確認しました」にチェック → 登録。
4. **管理**: 一覧・編集・削除・重複候補の確認・CSV/JSON 書き出し・バックアップ。

---

## 3. システム設計

### 使用技術と選定理由

| 部分 | 技術 | 理由 |
|---|---|---|
| サーバー | Node.js（外部フレームワークなし） | 依存を最小化し保守しやすく。`npm start` だけで動く |
| DB | SQLite（`node:sqlite` 内蔵） | リレーショナル・外部キー・トランザクションで整合性を保証。ファイル1つで移行・バックアップが容易 |
| OCR | tesseract.js 7 + 日本語/英語学習データ（npm 同梱） | 無料・オフライン動作・画像を外部送信しない |
| 読み仮名推定 | kuromoji（辞書同梱） | 読み未入力でも「やまだ」で「山田」を検索可能にする |
| 画面 | 素の HTML/CSS/JavaScript（ES Modules、ビルド不要） | 初心者でも起動・改修しやすい |

### フォルダ構成

```
server/
  index.js            起動
  app.js              部品の組み立て（機能追加はここに部品を足す）
  config.js           設定
  db/                 SQLite 接続・マイグレーション・バックアップ
  repositories/       テーブル単位のSQL（companies / persons / images）
  services/           業務ルール（registry=登録・重複・紐付け、images、search、exporter）
  search/             検索エンジン（normalize / similarity / engine / reading）※DBから独立
  ocr/                OCR（provider=エンジン差し替え可能、extract=項目抽出）
  api/routes.js       REST API
public/
  index.html, css/, js/
    views/            画面（search / register / detail / edit / admin / login）
    forms.js          登録・編集フォーム
    ocrPanel.js       画像読み取りパネル
    memoEditor.js     メモ編集部品
    imageInput.js     画像選択・向き補正・縮小・ハッシュ
    camera.js         ブラウザ内カメラ
test/
  unit/               単体・APIテスト（npm test）
  e2e/run.js          ブラウザ操作テスト（npm run test:e2e）
  fixtures/           テスト用名刺画像（架空）
```

### データ構造

```
companies（企業情報）
  id, name, name_kana, keywords, receipt_name(企業宛て宛名), memo(企業メモ),
  memo_version, memo_updated_at, version, created_at, updated_at

persons（人物情報＝人物の登録情報）
  id, company_id → companies.id（ON DELETE RESTRICT）, name, name_kana,
  department, title, keywords, receipt_name(領収証宛名), memo(人物メモ),
  memo_version, memo_updated_at, version, created_at, updated_at

company_name_history       企業名の変更履歴（旧企業名でも検索可能）
person_affiliation_history 人物の所属変更履歴
images                     取り込み画像（sha256 / 元ファイルハッシュで重複検知）
entity_images              登録情報（人物・企業）と取り込み元画像の関連
schema_migrations          DB構造のバージョン管理
```

- **人物と企業は内部ID（`company_id`）でのみ関連付け**。文字列一致で自動的に紐付けません。
- 1企業に複数人物を登録可能。所属変更・企業名変更は履歴に残ります。
- **メモの紐付け先**: 人物メモ＝人物ID、企業メモ＝企業ID。人物が別企業へ移ってもメモは人物に残ります。
- `version` / `memo_version` による楽観ロックで、他の端末の更新を上書きしません（衝突時はどちらを残すか選択）。

### 検索の仕組み

1. **正規化**: NFKC（全角/半角）→ 小文字化 → カタカナ→ひらがな → 異体字統一（髙→高 等）→ 空白・記号除去
2. **企業名の中核名**: 株式会社・(株)・㈱・有限会社・Co., Ltd. 等を除いて比較（「株サンプル」も一致）
3. **照合対象**: 名前 / 企業名 / 企業名+名前 / 読み（登録値、なければ自動推定）/ 領収証宛名 / キーワード / 部署・役職 / 旧企業名 / メモ
4. **順位**（基本点＋項目点）

| 一致レベル | 基本点 | 扱い |
|---|---:|---|
| 完全一致 | 1000 | 確定 |
| 正規化後の一致 | 900 | 確定 |
| 前方一致 | 800 | 確定 |
| 部分一致 | 700 | 確定 |
| 類似（文字の抜け） | 500〜550 | **候補** |
| 類似（誤字・編集距離） | 220〜400 | **候補** |

項目点: 名前60 / 企業名55 / 企業名+名前50 / 読み45 / 宛名40 / キーワード35 / 部署・役職20 / 旧企業名15 / メモ10。
誤字許容数は検索語の長さで決定（4文字以上で1、7文字以上で2、11文字以上で3）。
**同点時**: 一致レベル → 読み（なければ名前）の五十音順 → 企業→人物 → ID昇順（常に同じ結果）。
空白区切りの複数語は全語一致（AND）。企業そのものが結果に出る場合、企業名でのみ一致した人物は企業カード内にまとめて表示します。

### OCR の仕組み

1. ブラウザで画像を検証（形式・サイズ・破損）→ EXIF の向きを補正 → 長辺 2400px に縮小（小さい画像は拡大）→ 手動回転可
2. サーバーで形式を再検証して保存、SHA-256 で重複画像を検知
3. tesseract.js（日本語+英語、自動レイアウト解析 PSM 3）で文字認識
4. 規則ベースで項目抽出（法人格→企業名、役職語・部署語、大きな文字の氏名行、メール・電話・住所）
5. 信頼度: high/medium は入力欄へ反映（黄色表示）、**low は候補提示のみ（入力しない）**、判別不能は空欄＋理由表示
6. 利用者が画像と見比べ「確認しました」にチェックしないと保存できない

---

## 4. データ管理

- 保存先: `data/app.db`（SQLite）、画像は `data/images/`
- **自動バックアップ**: 起動時と24時間ごとに `data/backups/app-日時.db`（最新14件）
- 手動: 管理 → データ管理 →「今すぐバックアップ」「JSONで書き出し（全データ）」「CSVで書き出し（Excel用・BOM付き）」
- **復元**: アプリを止め、`data/backups/` の目的のファイルを `data/app.db` に上書きコピーして起動
- 登録情報に紐付かないまま7日経った画像は自動削除（個人情報を不要に残さない）
- 別PCへの移行: `data` フォルダごとコピー

---

## 5. テスト

```bash
npm test
```

```bash
npm run test:e2e
```

E2E を初めて実行する場合は、先に Playwright を準備します（`npm i -D playwright` → `npx playwright install chromium`）。

`npm test` は単体・APIテスト（検索順位、正規化、OCR抽出、実OCR、登録ルール、重複、衝突検知、永続化、セキュリティ）。
`npm run test:e2e` は Chromium で実際の操作を再現し、`test/e2e/out/` にスクリーンショットを保存します（Playwright が必要）。

---

## 6. 今後の機能追加方法

| 追加したいもの | 手順 |
|---|---|
| DB項目・テーブル | `server/db/migrations.js` の末尾に新しい version を追加（既存は書き換えない） |
| 業務ルール | `server/services/` に新しいサービスを作り `app.js` で接続 |
| API | `server/api/routes.js` に追加 |
| 画面 | `public/js/views/` にファイルを作り `public/js/app.js` で `route()` を1行追加、ヘッダーにリンク追加 |
| 検索の改良 | `server/search/engine.js` のみ変更（DB・画面に影響なし）。`test/unit/search.test.js` で順位を確認 |
| OCRの高度化 | `recognize(buffer) → {text, confidence, lines}` を満たす新プロバイダを `server/ocr/` に作り `app.js` で差し替え。抽出規則は `ocr/extract.js` |

**追加開発時の注意**: 人物と企業の紐付けは必ず ID で行う／同名を自動統合しない／OCR結果は確認なしに確定しない／メモ更新は `memo_version` を必ず送る／変更後は `npm test` と `npm run test:e2e` を実行する。

---

## 7. 制約・未実装事項

- **縦書き名刺**は認識精度が低い（横書き前提）。手書き文字も対象外。
- 読み仮名の自動推定は辞書ベースで、珍しい名前は推定できない（その場合は推定しない）。
- 重複データの**自動統合（マージ）機能はなし**（確認のうえ不要な方を削除する運用）。
- JSON の**取り込み（インポート）画面はなし**（復元はバックアップファイルのコピーで行う）。
- スマホのブラウザ内カメラは https が必要なため、http 接続時は端末のカメラアプリで撮影して取り込む方式になる（自動で切り替え）。
- 複数人での同時利用は想定内（衝突検知あり）だが、ユーザーごとの権限管理はなし（パスワードは1つ）。
- インターネット公開は想定していません。公開する場合は HTTPS のリバースプロキシ等が別途必要です。


---

## 8. 個人情報とデータの保存場所

| 版 | 登録データの保存場所 | リポジトリに入るか |
|---|---|---|
| PC版 | 起動したPCの `data/app.db`（画像は `data/images/`、バックアップは `data/backups/`） | 入らない（`.gitignore` で除外） |
| アーティファクト版 | claude.ai 上のそのページ専用のデータベース | 入らない |

**コミット前の注意**
- `data/` フォルダ、書き出したJSON・CSV（`receipt-search-*.json` / `.csv`）は個人情報を含むため、絶対にコミットしないでください（`.gitignore` で除外していますが、`git add -f` などで強制的に追加しないこと）。
- テスト用の名刺画像（`test/fixtures/`）とテストデータの企業名・人物名はすべて架空のものです。実在の名前をテストに使わないでください。
- 公開リポジトリにする場合でも、上記を守ればプログラムだけが公開され、登録データは各自の手元（またはアーティファクト）にだけ残ります。

## 9. アーティファクト版（claude.ai）

`artifact/` は、claude.ai のアーティファクト（Webページ）として動く版です。PC版と同じ検索エンジンに加えて、Claude による名刺・一覧の読み取り、一覧からの一括登録（確認画面つき）、グループ分け、顔写真、外部検索（Google）リンクを備えます。

```bash
npm install
```

```bash
python3 artifact/build.py
```

`artifact/dist/receipt-search.html`（ページ本体）と `artifact/vendor/`（端末内で文字を読み取るためのエンジンと日本語・英語データ。`node_modules` から生成）ができます。アーティファクトとして公開するときは、`vendor/` 以下のファイルを同じ相対パスで一緒にアップロードしてください。

- データは claude.ai の `db` 機能に保存されます（読み書きは「投稿者」以上の権限を持つ人のみ）。
- 名刺画像の保存には `assets`、Claude による読み取りには `sample`（画像あり）、書き出しには `downloads` 機能を使います。
- 同梱の tesseract.js 7.0.0 の `worker.min.js` には、言語データを直接渡したときの不具合を1か所修正して使っています（`build.py` 内で自動適用）。

**アーティファクト版のテスト**（claude.ai の機能を模擬して Chromium で実行）

```bash
node artifact/test/run.cjs
```

```bash
node artifact/test/bulk.cjs
```

```bash
node artifact/test/groups.cjs
```

```bash
node artifact/test/photo.cjs
```

## 10. 使用しているライブラリ

| ライブラリ | ライセンス | 用途 |
|---|---|---|
| tesseract.js / tesseract.js-core | Apache-2.0 | 文字認識（OCR） |
| @tesseract.js-data/jpn・eng | Apache-2.0 | 日本語・英語の学習データ |
| kuromoji | Apache-2.0 | 読み仮名の推定（PC版） |
