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

// 事务嵌套深度：>0 表示已处于事务中，内层改用 SAVEPOINT（node:sqlite 不允许嵌套 BEGIN）。
let txDepth = 0

export function initDb() {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'image-browser.db')
  db = new DatabaseSync(dbPath)
  stmtCache.clear()
  txDepth = 0

  // WAL 模式：读写并发更好，适合桌面应用
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')

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
 * 便捷查询：返回单行
 */
export function queryOne(sql, params = []) {
  return prep(sql).get(...params)
}

/**
 * 事务包裹：fn 内抛错会自动回滚。
 * 支持嵌套调用：外层 BEGIN/COMMIT，内层退化为 SAVEPOINT/RELEASE。
 * （node:sqlite 在已开启的事务里再执行 BEGIN 会直接报错，故必须区分层级。）
 */
export function transaction(fn) {
  const database = getDb()
  const nested = txDepth > 0
  const savepoint = `sp_${txDepth}`
  txDepth++
  database.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN')
  try {
    const result = fn()
    database.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT')
    return result
  } catch (err) {
    if (nested) {
      database.exec(`ROLLBACK TO ${savepoint}`)
      database.exec(`RELEASE ${savepoint}`)
    } else {
      database.exec('ROLLBACK')
    }
    throw err
  } finally {
    txDepth--
  }
}
