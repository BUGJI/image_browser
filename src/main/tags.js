import { getDb, prep, transaction } from './db'

/**
 * 图片标签管理（每根目录独立）：
 * - tags       标签定义（root_id + name 唯一）
 * - image_tags 图片 ↔ 标签多对多（root_id, abs_path 与收藏一致，存相对根目录路径 + 名称快照）
 */

const NAME_MAX = 40

export function initTagsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      root_id    INTEGER NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (root_id, name)
    )
  `)
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS image_tags (
      root_id    INTEGER NOT NULL,
      abs_path   TEXT NOT NULL,
      tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (root_id, abs_path, tag_id)
    )
  `)
  getDb().exec('CREATE INDEX IF NOT EXISTS idx_image_tags_path ON image_tags(root_id, abs_path)')
  getDb().exec('CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag_id)')
}

function now() {
  return new Date().toISOString()
}

function normalizeName(name) {
  if (typeof name !== 'string') return ''
  const n = name.trim()
  if (!n) throw new Error('标签名称不能为空')
  if (n.length > NAME_MAX) throw new Error(`标签名称过长（最多 ${NAME_MAX} 字符）`)
  return n
}

/**
 * 某根目录全部标签及命中图片数（含 0）。
 * @returns {Array<{id:number,name:string,count:number}>}
 */
export function listTags(rootId) {
  if (!rootId) return []
  return prep(
    `SELECT t.id, t.name, COUNT(it.tag_id) AS count
     FROM tags t
     LEFT JOIN image_tags it ON it.tag_id = t.id AND it.root_id = t.root_id
     WHERE t.root_id = ?
     GROUP BY t.id
     ORDER BY t.name COLLATE NOCASE, t.id`
  )
    .all(rootId)
    .map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }))
}

/** 某张图片当前带的所有标签 */
export function getImageTags(rootId, absPath) {
  if (!rootId || !absPath) return []
  return prep(
    `SELECT t.id, t.name
     FROM image_tags it
     JOIN tags t ON t.id = it.tag_id
     WHERE it.root_id = ? AND it.abs_path = ?
     ORDER BY it.rowid`
  )
    .all(rootId, absPath)
    .map((r) => ({ id: r.id, name: r.name }))
}

/**
 * 整体覆盖写某张图片的标签（先清空再写入，事务内）。
 * @param {number} rootId
 * @param {{absPath:string,name:string}} item
 * @param {string[]} tagNames 目标标签名集合（自动 trim / 去重 / 忽略空）
 * @returns {Array} 更新后的标签列表（含计数）
 */
export function setImageTags(rootId, item, tagNames) {
  const path = item?.absPath
  if (!rootId || typeof path !== 'string' || !path) {
    throw new Error('参数不完整，无法保存标签')
  }
  const imageName = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : path
  const seen = new Set()
  const names = (Array.isArray(tagNames) ? tagNames : [])
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter((n) => n && !seen.has(n) && seen.add(n))
  if (names.length > 50) throw new Error('单张图片的标签数量过多（最多 50 个）')

  transaction(() => {
    prep('DELETE FROM image_tags WHERE root_id = ? AND abs_path = ?').run(rootId, path)
    if (!names.length) return
    const getTag = prep('SELECT id FROM tags WHERE root_id = ? AND name = ?')
    const insertTag = prep(
      'INSERT OR IGNORE INTO tags (root_id, name, created_at) VALUES (?, ?, ?)'
    )
    const insertRel = prep(
      'INSERT OR IGNORE INTO image_tags (root_id, abs_path, tag_id, name, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const ts = now()
    for (const name of names) {
      if (name.length > NAME_MAX) throw new Error(`标签名称过长（最多 ${NAME_MAX} 字符）`)
      insertTag.run(rootId, name, ts)
      const row = getTag.get(rootId, name)
      if (row) insertRel.run(rootId, path, row.id, imageName, ts)
    }
  })
  return listTags(rootId)
}

/** 新建一个空标签 */
export function addTag(rootId, name) {
  const n = normalizeName(name)
  if (!rootId) throw new Error('参数不完整，无法新建标签')
  const dup = prep('SELECT id FROM tags WHERE root_id = ? AND name = ?').get(rootId, n)
  if (dup) throw new Error('已存在同名标签')
  prep('INSERT INTO tags (root_id, name, created_at) VALUES (?, ?, ?)').run(rootId, n, now())
  return listTags(rootId)
}

/** 重命名标签（新名与同根目录其它标签冲突时报错） */
export function renameTag(rootId, tagId, name) {
  const n = normalizeName(name)
  const own = prep('SELECT id FROM tags WHERE id = ? AND root_id = ?').get(tagId, rootId)
  if (!own) throw new Error('标签不存在')
  const conflict = prep('SELECT id FROM tags WHERE root_id = ? AND name = ? AND id != ?').get(
    rootId,
    n,
    tagId
  )
  if (conflict) throw new Error('已存在同名标签')
  prep('UPDATE tags SET name = ? WHERE id = ? AND root_id = ?').run(n, tagId, rootId)
  return listTags(rootId)
}

/** 删除标签（image_tags 通过外键级联删除） */
export function deleteTag(rootId, tagId) {
  prep('DELETE FROM tags WHERE id = ? AND root_id = ?').run(tagId, rootId)
  return listTags(rootId)
}

/**
 * 把 fromIds 里所有标签合并到 toId（图片去重归并，随后删除被合并标签）。
 */
export function mergeTags(rootId, fromIds, toId) {
  if (!rootId || !Array.isArray(fromIds) || !fromIds.length) return listTags(rootId)
  transaction(() => {
    const target = prep('SELECT id FROM tags WHERE id = ? AND root_id = ?').get(toId, rootId)
    if (!target) throw new Error('合并目标标签不存在')
    const move = prep(
      `UPDATE image_tags SET tag_id = ?
       WHERE root_id = ? AND tag_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM image_tags dup
           WHERE dup.root_id = image_tags.root_id
             AND dup.abs_path = image_tags.abs_path
             AND dup.tag_id = ?
         )`
    )
    const delRel = prep('DELETE FROM image_tags WHERE root_id = ? AND tag_id = ?')
    const delTag = prep('DELETE FROM tags WHERE id = ? AND root_id = ?')
    for (const fromId of fromIds) {
      if (Number(fromId) === Number(toId)) continue
      const from = prep('SELECT id FROM tags WHERE id = ? AND root_id = ?').get(fromId, rootId)
      if (!from) continue
      move.run(toId, rootId, fromId, toId)
      delRel.run(rootId, fromId)
      delTag.run(fromId, rootId)
    }
  })
  return listTags(rootId)
}

/** 某标签下的图片列表（与瀑布流 item 结构一致，含名称快照） */
export function listTagImages(rootId, tagId) {
  if (!rootId || !tagId) return []
  return prep(
    `SELECT it.abs_path AS absPath, it.name
     FROM image_tags it
     WHERE it.root_id = ? AND it.tag_id = ?
     ORDER BY it.rowid DESC`
  ).all(rootId, tagId)
}

/** 某根目录下的全部标签数据（根目录被移除时清理） */
export function removeTagsOfRoot(rootId) {
  transaction(() => {
    prep('DELETE FROM image_tags WHERE root_id = ?').run(rootId)
    prep('DELETE FROM tags WHERE root_id = ?').run(rootId)
  })
}
