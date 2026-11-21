// 取り込み画像（メタ情報はDB、画像本体は data/images/ に保存）
export function createImagesRepo(db) {
  const q = {
    get: db.prepare('SELECT * FROM images WHERE id = ?'),
    bySha: db.prepare('SELECT * FROM images WHERE sha256 = ?'),
    byHashes: db.prepare("SELECT * FROM images WHERE sha256 = $h OR (original_hash <> '' AND original_hash = $o) OR sha256 = $o ORDER BY id"),
    insert: db.prepare(`INSERT INTO images (sha256, original_hash, mime, file_name, original_name, width, height, ocr_text, created_at)
      VALUES ($sha256, $original_hash, $mime, $file_name, $original_name, $width, $height, '', $now)`),
    setOcr: db.prepare('UPDATE images SET ocr_text = ? WHERE id = ?'),
    link: db.prepare('INSERT OR IGNORE INTO entity_images (entity_type, entity_id, image_id, created_at) VALUES (?, ?, ?, ?)'),
    unlinkEntity: db.prepare('DELETE FROM entity_images WHERE entity_type = ? AND entity_id = ?'),
    forEntity: db.prepare(`SELECT i.id, i.mime, i.original_name, i.width, i.height, i.created_at, ei.created_at AS linked_at
      FROM entity_images ei JOIN images i ON i.id = ei.image_id WHERE ei.entity_type = ? AND ei.entity_id = ? ORDER BY ei.id`),
    linksForImage: db.prepare('SELECT entity_type, entity_id FROM entity_images WHERE image_id = ? ORDER BY id'),
    orphans: db.prepare(`SELECT * FROM images i WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM entity_images ei WHERE ei.image_id = i.id)`),
    delete: db.prepare('DELETE FROM images WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM images'),
  };
  return {
    get: (id) => q.get.get(id) ?? null,
    bySha: (sha) => q.bySha.get(sha) ?? null,
    byHashes: (sha, original) => q.byHashes.all({ $h: sha, $o: original || '' }),
    insert(img, now) {
      return Number(q.insert.run({
        $sha256: img.sha256, $original_hash: img.original_hash || '', $mime: img.mime, $file_name: img.file_name,
        $original_name: img.original_name || '', $width: img.width ?? null, $height: img.height ?? null, $now: now,
      }).lastInsertRowid);
    },
    setOcr: (id, text) => q.setOcr.run(text, id),
    link: (type, entityId, imageId, now) => q.link.run(type, entityId, imageId, now),
    unlinkEntity: (type, entityId) => q.unlinkEntity.run(type, entityId),
    forEntity: (type, entityId) => q.forEntity.all(type, entityId),
    linksForImage: (imageId) => q.linksForImage.all(imageId),
    orphans: (before) => q.orphans.all(before),
    delete: (id) => q.delete.run(id),
    count: () => q.count.get().n,
  };
}
