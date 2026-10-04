import { existsSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { isInRootCache, resolveCacheDir } from '../storage/cache-location'
import { setCacheCloser } from '../storage/cache-sync'
import { invalidateThumbIndex } from './thumb-index'

/**
 * 根缓存连接管理：打开/关闭每个根目录的独立 SQLite + 缩略图目录。从 cache.js 拆出。
 *
 * 每个注册根目录内建立：
 *   <root>/.image_browser_cache/
 *     ├── cache.db        —— 独立 SQLite：files 表（图片索引 + 尺寸）+ meta 表
 *     └── image_cache/    —— webp 缩略图，镜像源目录结构
 */

const THUMB_DIR_NAME = 'image_cache'

// rootPath -> { db, cacheDir, thumbDir }
const cacheConnections = new Map()

/**
 * Windows 下把目录设为隐藏（attrib +h）。
 * 其它平台无隐藏概念，静默忽略。
 */
function makeDirHidden(dir) {
  return new Promise((resolve) => {
    execFile('attrib', ['+h', dir], (err) => {
      if (err) {
        // 非 Windows / attrib 不可用时静默忽略
      }
      resolve()
    })
  })
}

/**
 * 打开（或读取）某个根目录的缓存。create=false 且目录不存在时返回 null。
 * 参数可为根对象（推荐，远程根据此决定缓存位置）或旧的本地路径字符串。
 */
export function openRootCache(rootOrPath, { create = false } = {}) {
  const root =
    typeof rootOrPath === 'string'
      ? { path: rootOrPath, type: 'local', writable: 1, id: null }
      : rootOrPath
  const key = root.path
  // 命中内存连接直接复用：缓存目录不会被本进程删除，无需每次请求都同步探测磁盘。
  const hit = cacheConnections.get(key)
  if (hit) return hit

  const cacheDir = resolveCacheDir(root)
  if (!existsSync(cacheDir)) {
    if (!create) return null
    mkdirSync(cacheDir, { recursive: true })
  }
  // 仅当缓存位于源根目录内时才设为隐藏（attrib 幂等）
  if (isInRootCache(root)) makeDirHidden(cacheDir)
  const thumbDir = join(cacheDir, THUMB_DIR_NAME)
  if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true })

  const dbPath = join(cacheDir, 'cache.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  // 多任务可能并发写同一 cache.db：忙等重试 + NORMAL 同步，降低 SQLITE_BUSY 与 fsync 开销
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS files (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      abs_path   TEXT NOT NULL UNIQUE,
      rel_path   TEXT NOT NULL,
      name       TEXT NOT NULL,
      folder     TEXT NOT NULL,          -- 相对根目录（/ 分隔，'' = 根）
      size       INTEGER NOT NULL DEFAULT 0,
      mtime      INTEGER NOT NULL DEFAULT 0,
      width      INTEGER,                -- 原图尺寸
      height     INTEGER,
      thumb      TEXT,                   -- image_cache 下的相对路径，null=未生成
      thumb_size INTEGER,                -- 缩略图字节数（folder SHA 复用，避免全量 stat）
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder);
    -- 覆盖索引：文件夹列表的 WHERE 前缀过滤与 ORDER BY folder, name COLLATE NOCASE 均可命中
    CREATE INDEX IF NOT EXISTS idx_files_folder_name ON files(folder, name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS folders (
      rel_path    TEXT PRIMARY KEY,   -- 相对根目录（/ 分隔，'' = 根）
      src_sha     TEXT,               -- 该目录直接子项（图片 + 子目录名）指纹
      cache_sha   TEXT,               -- 该目录直接子缩略图指纹
      file_count  INTEGER NOT NULL DEFAULT 0,
      thumb_count INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );
  `)

  // 旧库迁移：thumb_size（缩略图字节数），用于免去 folder SHA 计算时的全量 stat
  try {
    const fileCols = db.prepare('PRAGMA table_info(files)').all()
    if (!fileCols.some((c) => c.name === 'thumb_size')) {
      db.exec('ALTER TABLE files ADD COLUMN thumb_size INTEGER')
    }
  } catch {
    /* 迁移失败不致命：后续按存在性回退 stat */
  }

  const conn = { db, cacheDir, thumbDir, rootPath: key, root }
  cacheConnections.set(key, conn)
  return conn
}

export function closeRootCache(rootPath) {
  const conn = cacheConnections.get(rootPath)
  if (conn) {
    try {
      conn.db.close()
    } catch {
      /* ignore */
    }
    cacheConnections.delete(rootPath)
  }
  invalidateThumbIndex(rootPath)
}

// 供 cache-sync 在替换本地工作库前关闭连接（避免循环依赖）
setCacheCloser(closeRootCache)
