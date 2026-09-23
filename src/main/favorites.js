import { getDb, prep } from './db'

/**
 * 图片收藏管理：favorites 表（每根目录独立的收藏集合）
 * abs_path 存的是相对根目录的路径（与瀑布流 item.absPath 一致）。
 */

export function initFavoritesTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      root_id    INTEGER NOT NULL,
      abs_path   TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (root_id, abs_path)
    )
  `)
}

export function listFavorites(rootId) {
  if (!rootId) return []
  return prep(
    'SELECT root_id, abs_path AS absPath, name FROM favorites WHERE root_id = ? ORDER BY created_at DESC, id DESC'
  ).all(rootId)
}

/**
 * 收藏 / 取消收藏。
 * @returns {{ added: boolean }}
 */
export function toggleFavorite(rootId, item) {
  const path = item?.absPath
  if (!rootId || typeof path !== 'string' || !path) {
    throw new Error('参数不完整，无法收藏')
  }
  const name = item?.name || path.split(/[\\/]+/).pop() || path
  const existing = prep('SELECT id FROM favorites WHERE root_id = ? AND abs_path = ?').get(
    rootId,
    path
  )
  if (existing) {
    prep('DELETE FROM favorites WHERE root_id = ? AND abs_path = ?').run(rootId, path)
    return { added: false }
  }
  prep('INSERT INTO favorites (root_id, abs_path, name, created_at) VALUES (?, ?, ?, ?)').run(
    rootId,
    path,
    name,
    new Date().toISOString()
  )
  return { added: true }
}

/** 删除某根目录下的全部收藏（根目录被移除时清理） */
export function removeFavoritesOfRoot(rootId) {
  prep('DELETE FROM favorites WHERE root_id = ?').run(rootId)
}
