import { statSync } from 'fs'
import { getDb, transaction } from './db'
import { getSetting, setSetting } from './settings'
import { removeTagsOfRoot } from './tags'

/**
 * 根目录注册管理：roots 表（路径唯一 + 可选别名 + 手动排序）
 */

export function initRootsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS roots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      path       TEXT NOT NULL UNIQUE,
      alias      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  // 旧库迁移：补 sort_order 列，并按现有顺序（created_at, id）填充初始序号
  const cols = getDb().prepare('PRAGMA table_info(roots)').all()
  if (!cols.some((c) => c.name === 'sort_order')) {
    getDb().exec('ALTER TABLE roots ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
    const rows = getDb()
      .prepare('SELECT id FROM roots ORDER BY created_at ASC, id ASC')
      .all()
    const update = getDb().prepare('UPDATE roots SET sort_order = ? WHERE id = ?')
    rows.forEach((r, i) => update.run(i + 1, r.id))
  }
}

function now() {
  return new Date().toISOString()
}

/** 校验路径存在且是目录 */
export function validateDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 显示名：别名 > 目录名 > 完整路径 */
export function displayName(root) {
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = root.path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root.path
}

export function listRoots() {
  return getDb()
    .prepare('SELECT * FROM roots ORDER BY sort_order ASC, created_at ASC, id ASC')
    .all()
}

/**
 * 重新排序：传入按新顺序排列的 id 数组，事务内一次性更新 sort_order
 * @param {number[]} ids
 */
export function reorderRoots(ids) {
  if (!Array.isArray(ids)) return listRoots()
  transaction(() => {
    const update = getDb().prepare(
      'UPDATE roots SET sort_order = ?, updated_at = ? WHERE id = ?'
    )
    ids.forEach((id, index) => {
      if (Number.isFinite(id)) update.run(index + 1, now(), id)
    })
  })
  return listRoots()
}

export function getRoot(id) {
  return getDb().prepare('SELECT * FROM roots WHERE id = ?').get(id)
}

export function addRoot(path, alias = '') {
  if (!validateDir(path)) throw new Error('目录不存在或不可访问')
  const dup = getDb().prepare('SELECT id FROM roots WHERE path = ?').get(path)
  if (dup) throw new Error('该目录已注册')
  const ts = now()
  const info = getDb()
    .prepare('INSERT INTO roots (path, alias, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(path, alias.trim(), ts, ts)
  return getRoot(Number(info.lastInsertRowid))
}

export function updateRoot(id, path, alias = '') {
  if (!validateDir(path)) throw new Error('目录不存在或不可访问')
  const dup = getDb().prepare('SELECT id FROM roots WHERE path = ? AND id != ?').get(path, id)
  if (dup) throw new Error('该目录已被其他项注册')
  getDb()
    .prepare('UPDATE roots SET path = ?, alias = ?, updated_at = ? WHERE id = ?')
    .run(path, alias.trim(), now(), id)
  return getRoot(id)
}

export function removeRoot(id) {
  getDb().prepare('DELETE FROM roots WHERE id = ?').run(id)
  getDb().prepare('DELETE FROM favorites WHERE root_id = ?').run(id)
  removeTagsOfRoot(id)
  // 删除的是当前选中时清空
  if (getSetting('currentRootId', '') === String(id)) {
    setSetting('currentRootId', '')
  }
}
