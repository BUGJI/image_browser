import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'

/**
 * 基于 Node 内置 node:sqlite 的轻量封装（零依赖、零编译）。
 * 数据库文件存放在系统 userData 目录下：image-browser.db
 */

let db = null

export function initDb() {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'image-browser.db')
  db = new DatabaseSync(dbPath)

  // WAL 模式：读写并发更好，适合桌面应用
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  return db
}

export function getDb() {
  return db || initDb()
}

/**
 * 便捷查询：返回全部行
 * @param {string} sql
 * @param {unknown[]} params
 */
export function queryAll(sql, params = []) {
  return getDb().prepare(sql).all(...params)
}

/**
 * 便捷查询：返回单行
 */
export function queryOne(sql, params = []) {
  return getDb().prepare(sql).get(...params)
}

/**
 * 便捷执行：INSERT / UPDATE / DELETE，返回 { changes, lastInsertRowid }
 */
export function run(sql, params = []) {
  const stmt = getDb().prepare(sql)
  const result = stmt.run(...params)
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
  }
}
