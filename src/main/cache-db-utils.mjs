/**
 * 各根目录 cache.db（node:sqlite DatabaseSync）通用小工具。
 * cache.js / ai.js / ocr.js 的 meta 表读写共用同一实现，避免逐份复制。
 */

// 按连接缓存预编译语句：node:sqlite 不自动缓存，热点路径（image:// 解析、列表、搜索）
// 每次 prepare 都是多余的编译开销。WeakMap 便于连接关闭后随对象回收。
const stmtCache = new WeakMap()

/** @param {import('node:sqlite').DatabaseSync} db */
export function prep(db, sql) {
  let bySql = stmtCache.get(db)
  if (!bySql) stmtCache.set(db, (bySql = new Map()))
  let stmt = bySql.get(sql)
  if (!stmt) bySql.set(sql, (stmt = db.prepare(sql)))
  return stmt
}

/**
 * 全 Unicode 大小写折叠（JS toLowerCase）。
 * SQLite 的 NOCASE 排序规则与 lower() 只折叠 A–Z，non-ASCII（Ä / С / Ζ …）按原样比较。
 * 因此写入索引时用本函数落库折叠值，检索时对查询做同样折叠，
 * 保证「大小写不敏感」覆盖全部 Unicode，且与无缓存兜底扫描（JS）结论一致。
 */
export function foldText(s) {
  return String(s == null ? '' : s).toLowerCase()
}

export function metaGet(db, key, fallback = null) {
  const row = prep(db, 'SELECT value FROM meta WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function metaSet(db, key, value) {
  prep(
    db,
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}
