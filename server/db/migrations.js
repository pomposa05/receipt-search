// データベース定義（マイグレーション）
// 変更・拡張時は既存の項目を書き換えず、配列の末尾に新しい version を追加すること。
export const migrations = [
  {
    version: 1,
    name: '初期構造',
    up: `
      -- 企業情報
      CREATE TABLE companies (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
        name_kana       TEXT    NOT NULL DEFAULT '',
        keywords        TEXT    NOT NULL DEFAULT '',
        receipt_name    TEXT    NOT NULL DEFAULT '',   -- 企業宛ての領収証宛名（例: 株式会社サンプル 御中）
        memo            TEXT    NOT NULL DEFAULT '',   -- 企業メモ（企業IDに紐付く）
        memo_version    INTEGER NOT NULL DEFAULT 0,
        memo_updated_at TEXT,
        version         INTEGER NOT NULL DEFAULT 1,    -- 同時編集の衝突検知用
        created_at      TEXT    NOT NULL,
        updated_at      TEXT    NOT NULL
      );

      -- 人物情報（＝人物の登録情報。所属企業は company_id で内部ID参照）
      CREATE TABLE persons (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id      INTEGER REFERENCES companies(id) ON DELETE RESTRICT,
        name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
        name_kana       TEXT    NOT NULL DEFAULT '',
        department      TEXT    NOT NULL DEFAULT '',
        title           TEXT    NOT NULL DEFAULT '',
        keywords        TEXT    NOT NULL DEFAULT '',
        receipt_name    TEXT    NOT NULL DEFAULT '',   -- 領収証宛名（例: 株式会社サンプル 山田太郎 様）
        memo            TEXT    NOT NULL DEFAULT '',   -- 人物メモ（人物IDに紐付く）
        memo_version    INTEGER NOT NULL DEFAULT 0,
        memo_updated_at TEXT,
        version         INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT    NOT NULL,
        updated_at      TEXT    NOT NULL
      );
      CREATE INDEX idx_persons_company ON persons(company_id);

      -- 企業名の変更履歴（旧企業名でも検索できる）
      CREATE TABLE company_name_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        old_name   TEXT    NOT NULL,
        new_name   TEXT    NOT NULL,
        changed_at TEXT    NOT NULL
      );
      CREATE INDEX idx_cnh_company ON company_name_history(company_id);

      -- 人物の所属変更履歴（企業名は変更時点の名称を記録）
      CREATE TABLE person_affiliation_history (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id        INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        old_company_id   INTEGER,
        old_company_name TEXT    NOT NULL DEFAULT '',
        new_company_id   INTEGER,
        new_company_name TEXT    NOT NULL DEFAULT '',
        changed_at       TEXT    NOT NULL
      );
      CREATE INDEX idx_pah_person ON person_affiliation_history(person_id);

      -- 取り込み画像
      CREATE TABLE images (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        sha256        TEXT    NOT NULL UNIQUE,          -- 保存画像のハッシュ
        original_hash TEXT    NOT NULL DEFAULT '',      -- 元ファイルのハッシュ（重複検知用）
        mime          TEXT    NOT NULL,
        file_name     TEXT    NOT NULL,
        original_name TEXT    NOT NULL DEFAULT '',
        width         INTEGER,
        height        INTEGER,
        ocr_text      TEXT    NOT NULL DEFAULT '',
        created_at    TEXT    NOT NULL
      );
      CREATE INDEX idx_images_original_hash ON images(original_hash);

      -- 登録情報と取り込み元画像の関連
      CREATE TABLE entity_images (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT    NOT NULL CHECK (entity_type IN ('person', 'company')),
        entity_id   INTEGER NOT NULL,
        image_id    INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        created_at  TEXT    NOT NULL,
        UNIQUE (entity_type, entity_id, image_id)
      );
      CREATE INDEX idx_entity_images_entity ON entity_images(entity_type, entity_id);
    `,
  },
];
