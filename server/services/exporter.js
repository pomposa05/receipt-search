// データの書き出し（JSON: 全データ・移行用 / CSV: 表計算ソフト用）と統計
export function createExporter({ db, companies, persons, images }) {
  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // 表計算ソフトの数式として実行されないようにする
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return {
    json() {
      const version = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
      return {
        format: 'receipt-search-export',
        schemaVersion: version,
        exportedAt: new Date().toISOString(),
        companies: companies.all(),
        persons: persons.all(),
        companyNameHistory: companies.allHistory(),
        personAffiliationHistory: db.prepare('SELECT * FROM person_affiliation_history ORDER BY id').all(),
        images: db.prepare('SELECT id, sha256, original_hash, mime, file_name, original_name, width, height, ocr_text, created_at FROM images ORDER BY id').all(),
        entityImages: db.prepare('SELECT * FROM entity_images ORDER BY id').all(),
      };
    },
    csv() {
      const header = ['種別', '人物ID', '名前', '名前の読み', '企業ID', '企業名', '企業名の読み', '部署', '役職', '領収証宛名', 'キーワード', 'メモ', '登録日時', '最終更新日時'];
      const rows = [header];
      for (const p of persons.listWithCompany()) {
        rows.push(['人物', p.id, p.name, p.name_kana, p.company_id ?? '', p.company_name ?? '', p.company_name_kana ?? '', p.department, p.title, p.receipt_name, p.keywords, p.memo, p.created_at, p.updated_at]);
      }
      for (const c of companies.all()) {
        rows.push(['企業', '', '', '', c.id, c.name, c.name_kana, '', '', c.receipt_name, c.keywords, c.memo, c.created_at, c.updated_at]);
      }
      return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    },
    stats() {
      return {
        persons: persons.all().length,
        companies: companies.all().length,
        images: images.count(),
      };
    },
  };
}
