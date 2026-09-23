import { getDb, prep, transaction } from './db'
import { getSetting, setSetting } from './settings'
import { removeTagsOfRoot } from './tags'
import { getProvider, isRemoteRoot } from './storage'
import { ROOT_TYPE, ROOT_TYPES } from './storage/types.js'
import { removeRootSecret } from './secrets'

/**
 * 根目录注册管理：roots 表（路径唯一 + 可选别名 + 手动排序 + 存储类型/连接配置/只读）
 *
 * path 语义：
 *   - 本地根：系统绝对路径
 *   - 远程根：伪 URL，如 webdav://host/base
 * config 为 JSON（不含密钥）；密钥单独存 root_secrets 表。
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
  const cols = getDb().prepare('PRAGMA table_info(roots)').all()
  const has = (name) => cols.some((c) => c.name === name)

  // 旧库迁移：排序
  if (!has('sort_order')) {
    getDb().exec('ALTER TABLE roots ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
    const rows = getDb().prepare('SELECT id FROM roots ORDER BY created_at ASC, id ASC').all()
    const update = getDb().prepare('UPDATE roots SET sort_order = ? WHERE id = ?')
    rows.forEach((r, i) => update.run(i + 1, r.id))
  }
  // 旧库迁移：存储类型 / 连接配置 / 可写标记
  if (!has('type')) {
    getDb().exec(`ALTER TABLE roots ADD COLUMN type TEXT NOT NULL DEFAULT '${ROOT_TYPE.LOCAL}'`)
  }
  if (!has('config')) {
    getDb().exec('ALTER TABLE roots ADD COLUMN config TEXT')
  }
  if (!has('writable')) {
    getDb().exec('ALTER TABLE roots ADD COLUMN writable INTEGER NOT NULL DEFAULT 1')
  }
}

function now() {
  return new Date().toISOString()
}

/** 把 DB 行转为对外对象（解析 config JSON） */
function toRoot(row) {
  if (!row) return row
  let config = null
  try {
    config = row.config ? JSON.parse(row.config) : null
  } catch {
    config = null
  }
  return { ...row, type: row.type || ROOT_TYPE.LOCAL, config }
}

/** 校验路径存在且是目录（远程走 Provider） */
export async function validateDir(root) {
  const path = typeof root === 'string' ? root : root?.path
  if (!path) return false
  try {
    const provider = getProvider(typeof root === 'string' ? { type: ROOT_TYPE.LOCAL } : root)
    const st = await provider.stat(path)
    return !!st && st.isDir
  } catch {
    return false
  }
}

/** 显示名：别名 > 目录名 > 完整路径 */
export function displayName(root) {
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = String(root.path)
    .split(/[\\/]+/)
    .filter(Boolean)
  if (isRemoteRoot(root) && parts.length <= 2) return root.path
  return parts.length ? parts[parts.length - 1] : root.path
}

export function listRoots() {
  return prep('SELECT * FROM roots ORDER BY sort_order ASC, created_at ASC, id ASC')
    .all()
    .map(toRoot)
}

/**
 * 重新排序：传入按新顺序排列的 id 数组，事务内一次性更新 sort_order
 * @param {number[]} ids
 */
export function reorderRoots(ids) {
  if (!Array.isArray(ids)) return listRoots()
  transaction(() => {
    const update = prep('UPDATE roots SET sort_order = ?, updated_at = ? WHERE id = ?')
    ids.forEach((id, index) => {
      if (Number.isFinite(id)) update.run(index + 1, now(), id)
    })
  })
  return listRoots()
}

export function getRoot(id) {
  // node:sqlite 对参数类型严格：null/undefined 无法绑定，直接按「找不到」处理
  const n = Number(id)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return toRoot(prep('SELECT * FROM roots WHERE id = ?').get(n))
}

/** 按路径查找根（路径唯一） */
export function getRootByPath(path) {
  if (!path) return undefined
  return toRoot(prep('SELECT * FROM roots WHERE path = ?').get(String(path)))
}

/**
 * 根据绝对路径反查所属根目录（取最长前缀匹配，兼容多根嵌套与远程伪路径）。
 */
export function findRootForPath(absPath) {
  if (!absPath) return undefined
  const norm = String(absPath).replace(/\\/g, '/')
  let best = null
  for (const root of listRoots()) {
    const rp = String(root.path).replace(/\\/g, '/').replace(/\/+$/, '')
    if (norm === rp || norm.startsWith(rp + '/')) {
      if (!best || rp.length > best.len) best = { root, len: rp.length }
    }
  }
  return best?.root
}

function normalizeType(type) {
  return ROOT_TYPES.includes(type) ? type : ROOT_TYPE.LOCAL
}

/**
 * 新增根目录。
 * @param {string} path 本地绝对路径或远程伪 URL
 * @param {string} alias 别名
 * @param {{type?:string, config?:object, writable?:boolean}} [opts]
 */
export async function addRoot(path, alias = '', opts = {}) {
  const type = normalizeType(opts.type)
  const record = {
    path,
    type,
    config: opts.config || null,
    writable: opts.writable === false ? 0 : 1
  }
  // 凭据尚未落库：校验时用临时密钥，避免用空密码去连
  if (opts.secret != null) record.__secret = opts.secret
  if (!(await validateDir(record))) throw new Error('目录不存在或不可访问')
  const dup = prep('SELECT id FROM roots WHERE path = ?').get(path)
  if (dup) throw new Error('该目录已注册')
  const ts = now()
  const info = prep(
    `INSERT INTO roots (path, alias, type, config, writable, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    path,
    String(alias || '').trim(),
    type,
    opts.config ? JSON.stringify(opts.config) : null,
    record.writable,
    ts,
    ts
  )
  return getRoot(Number(info.lastInsertRowid))
}

/**
 * 更新根目录。
 * @param {number} id
 * @param {string} path
 * @param {string} alias
 * @param {{type?:string, config?:object, writable?:boolean}} [opts]
 */
export async function updateRoot(id, path, alias = '', opts = {}) {
  const existing = getRoot(id)
  if (!existing) throw new Error('根目录不存在')
  const type = opts.type ? normalizeType(opts.type) : existing.type
  const config = opts.config !== undefined ? opts.config : existing.config
  const writable = opts.writable === undefined ? (existing.writable ? 1 : 0) : opts.writable ? 1 : 0
  const record = { id, path, type, config, writable }
  // 密码留空=沿用原有（此时不传 secret，由 provider 读库）；传了则用新密码校验
  if (opts.secret != null) record.__secret = opts.secret
  if (!(await validateDir(record))) throw new Error('目录不存在或不可访问')
  const dup = prep('SELECT id FROM roots WHERE path = ? AND id != ?').get(path, id)
  if (dup) throw new Error('该目录已被其他项注册')
  prep(
    `UPDATE roots SET path = ?, alias = ?, type = ?, config = ?, writable = ?, updated_at = ? WHERE id = ?`
  ).run(
    path,
    String(alias || '').trim(),
    type,
    config ? JSON.stringify(config) : null,
    writable,
    now(),
    id
  )
  return getRoot(id)
}

export function removeRoot(id) {
  // 事务包裹：任一步失败整体回滚，避免只删掉一半的关联数据
  transaction(() => {
    prep('DELETE FROM roots WHERE id = ?').run(id)
    prep('DELETE FROM favorites WHERE root_id = ?').run(id)
    removeTagsOfRoot(id)
    removeRootSecret(id)
    // 删除的是当前选中时清空
    if (getSetting('currentRootId', '') === String(id)) {
      setSetting('currentRootId', '')
    }
  })
}
