/**
 * 各根目录 cache.db（node:sqlite DatabaseSync）通用小工具。
 * cache.js / ai.js / ocr.js 的 meta 表读写共用同一实现，避免逐份复制。
 */

export function metaGet(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function metaSet(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}
