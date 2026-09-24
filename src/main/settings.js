import { getDb, prep } from './db'

/**
 * 应用设置：持久化到 SQLite settings 表（key-value）。
 * 读取远多于写入，故启动时全量载入内存缓存，getSetting 走内存；setSetting 同步更新缓存。
 */

const cache = new Map()
let loaded = false

function ensureLoaded() {
  if (loaded) return
  loaded = true
  try {
    for (const row of prep('SELECT key, value FROM settings').all()) {
      cache.set(row.key, row.value)
    }
  } catch {
    /* 表尚未创建：保持空缓存，initSettingsTable 会重载 */
  }
}

export function initSettingsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  // 建表后强制重载，避免首次调用 getSetting 时表尚不存在
  loaded = false
  cache.clear()
  ensureLoaded()
}

export function getSetting(key, fallback = null) {
  ensureLoaded()
  return cache.has(key) ? cache.get(key) : fallback
}

export function setSetting(key, value) {
  const v = String(value)
  prep(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, v)
  cache.set(key, v)
}
