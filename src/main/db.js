import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'

/**
 * 基于 Node 内置 node:sqlite 的轻量封装（零依赖、零编译）。
 * 数据库文件存放在系统 userData 目录下：image-browser.db
 */

let db = null

// prepared statement 缓存：按 SQL 文本复用，避免每次查询都重新编译（热点路径收益明显）。
// 仅在 db 连接重建时清空。
const stmtCache = new Map()

export function initDb() {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'image-browser.db')
  db = new DatabaseSync(dbPath)
  stmtCache.clear()

  // WAL 模式：读写并发更好，适合桌面应用
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  return db
}

export function getDb() {
  return db || initDb()
}

/**
 * 获取（并缓存）预编译语句。
 * @param {string} sql
 */
export function prep(sql) {
  let stmt = stmtCache.get(sql)
  if (!stmt) {
    stmt = getDb().prepare(sql)
    stmtCache.set(sql, stmt)
  }
  return stmt
}

/**
 * 便捷查询：返回全部行
 * @param {string} sql
 * @param {unknown[]} params
 */
export function queryAll(sql, params = []) {
  return prep(sql).all(...params)
}

/**
 * 便捷查询：返回单行
 */
export function queryOne(sql, params = []) {
  return prep(sql).get(...params)
}

/**
 * 便捷执行：INSERT / UPDATE / DELETE，返回 { changes, lastInsertRowid }
 */
export function run(sql, params = []) {
  const result = prep(sql).run(...params)
  return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) }
}

/**
 * 事务包裹：fn 内抛错会自动回滚
 */
export function transaction(fn) {
  const database = getDb()
  database.exec('BEGIN')
  try {
    const result = fn()
    database.exec('COMMIT')
    return result
  } catch (err) {
    database.exec('ROLLBACK')
    throw err
  }
}

export function closeDb() {
  if (db) {
    db.close()
    db = null
    stmtCache.clear()
  }
}
