// 人物情報テーブルの読み書き
const SELECT_WITH_COMPANY = `SELECT p.*, c.name AS company_name, c.name_kana AS company_name_kana
  FROM persons p LEFT JOIN companies c ON c.id = p.company_id`;

export function createPersonsRepo(db) {
  const q = {
    get: db.prepare(`${SELECT_WITH_COMPANY} WHERE p.id = ?`),
    all: db.prepare('SELECT * FROM persons ORDER BY id'),
    listWithCompany: db.prepare(`${SELECT_WITH_COMPANY} ORDER BY p.id`),
    byCompany: db.prepare('SELECT * FROM persons WHERE company_id = ? ORDER BY id'),
    countByCompany: db.prepare('SELECT COUNT(*) AS n FROM persons WHERE company_id = ?'),
    insert: db.prepare(`INSERT INTO persons (company_id, name, name_kana, department, title, keywords, receipt_name, memo, memo_version, memo_updated_at, version, created_at, updated_at)
      VALUES ($company_id, $name, $name_kana, $department, $title, $keywords, $receipt_name, $memo, $memo_version, $memo_updated_at, 1, $now, $now)`),
    update: db.prepare(`UPDATE persons SET company_id=$company_id, name=$name, name_kana=$name_kana, department=$department, title=$title,
      keywords=$keywords, receipt_name=$receipt_name, version = version + 1, updated_at=$now WHERE id=$id AND version=$version`),
    updateMemo: db.prepare(`UPDATE persons SET memo=$memo, memo_version = memo_version + 1, memo_updated_at=$now, updated_at=$now
      WHERE id=$id AND memo_version=$memo_version`),
    updateReceipt: db.prepare('UPDATE persons SET receipt_name=?, version = version + 1, updated_at=? WHERE id=?'),
    delete: db.prepare('DELETE FROM persons WHERE id = ?'),
    history: db.prepare('SELECT * FROM person_affiliation_history WHERE person_id = ? ORDER BY changed_at DESC, id DESC'),
    insertHistory: db.prepare(`INSERT INTO person_affiliation_history (person_id, old_company_id, old_company_name, new_company_id, new_company_name, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    recent: db.prepare(`${SELECT_WITH_COMPANY} ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`),
  };
  return {
    get: (id) => q.get.get(id) ?? null,
    all: () => q.all.all(),
    listWithCompany: () => q.listWithCompany.all(),
    byCompany: (companyId) => q.byCompany.all(companyId),
    countByCompany: (companyId) => q.countByCompany.get(companyId).n,
    recent: (limit) => q.recent.all(limit),
    insert(p, now) {
      const r = q.insert.run({
        $company_id: p.company_id, $name: p.name, $name_kana: p.name_kana, $department: p.department, $title: p.title,
        $keywords: p.keywords, $receipt_name: p.receipt_name, $memo: p.memo,
        $memo_version: p.memo ? 1 : 0, $memo_updated_at: p.memo ? now : null, $now: now,
      });
      return Number(r.lastInsertRowid);
    },
    update(id, version, p, now) {
      return q.update.run({
        $id: id, $version: version, $company_id: p.company_id, $name: p.name, $name_kana: p.name_kana,
        $department: p.department, $title: p.title, $keywords: p.keywords, $receipt_name: p.receipt_name, $now: now,
      }).changes;
    },
    updateMemo: (id, memoVersion, memo, now) => q.updateMemo.run({ $id: id, $memo_version: memoVersion, $memo: memo, $now: now }).changes,
    updateReceipt: (id, receipt, now) => q.updateReceipt.run(receipt, now, id).changes,
    delete: (id) => q.delete.run(id).changes,
    history: (id) => q.history.all(id),
    insertHistory: (id, oldId, oldName, newId, newName, now) => q.insertHistory.run(id, oldId, oldName, newId, newName, now),
  };
}
