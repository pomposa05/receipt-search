// 企業情報テーブルの読み書き（SQLのみ。業務ルールは services 層）
export function createCompaniesRepo(db) {
  const q = {
    get: db.prepare('SELECT * FROM companies WHERE id = ?'),
    all: db.prepare('SELECT * FROM companies ORDER BY id'),
    insert: db.prepare(`INSERT INTO companies (name, name_kana, keywords, receipt_name, memo, memo_version, memo_updated_at, version, created_at, updated_at)
      VALUES ($name, $name_kana, $keywords, $receipt_name, $memo, $memo_version, $memo_updated_at, 1, $now, $now)`),
    update: db.prepare(`UPDATE companies SET name=$name, name_kana=$name_kana, keywords=$keywords, receipt_name=$receipt_name,
      version = version + 1, updated_at=$now WHERE id=$id AND version=$version`),
    updateMemo: db.prepare(`UPDATE companies SET memo=$memo, memo_version = memo_version + 1, memo_updated_at=$now, updated_at=$now
      WHERE id=$id AND memo_version=$memo_version`),
    updateReceipt: db.prepare('UPDATE companies SET receipt_name=?, version = version + 1, updated_at=? WHERE id=?'),
    delete: db.prepare('DELETE FROM companies WHERE id = ?'),
    listWithCounts: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM persons p WHERE p.company_id = c.id) AS person_count
      FROM companies c ORDER BY c.id`),
    history: db.prepare('SELECT * FROM company_name_history WHERE company_id = ? ORDER BY changed_at DESC, id DESC'),
    allHistory: db.prepare('SELECT * FROM company_name_history ORDER BY id'),
    insertHistory: db.prepare('INSERT INTO company_name_history (company_id, old_name, new_name, changed_at) VALUES (?, ?, ?, ?)'),
  };
  return {
    get: (id) => q.get.get(id) ?? null,
    all: () => q.all.all(),
    listWithCounts: () => q.listWithCounts.all(),
    insert(c, now) {
      const r = q.insert.run({
        $name: c.name, $name_kana: c.name_kana, $keywords: c.keywords, $receipt_name: c.receipt_name,
        $memo: c.memo, $memo_version: c.memo ? 1 : 0, $memo_updated_at: c.memo ? now : null, $now: now,
      });
      return Number(r.lastInsertRowid);
    },
    update(id, version, c, now) {
      return q.update.run({
        $id: id, $version: version, $name: c.name, $name_kana: c.name_kana, $keywords: c.keywords,
        $receipt_name: c.receipt_name, $now: now,
      }).changes;
    },
    updateMemo: (id, memoVersion, memo, now) => q.updateMemo.run({ $id: id, $memo_version: memoVersion, $memo: memo, $now: now }).changes,
    updateReceipt: (id, receipt, now) => q.updateReceipt.run(receipt, now, id).changes,
    delete: (id) => q.delete.run(id).changes,
    history: (id) => q.history.all(id),
    allHistory: () => q.allHistory.all(),
    insertHistory: (id, oldName, newName, now) => q.insertHistory.run(id, oldName, newName, now),
  };
}
