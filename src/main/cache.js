import { promises as fsp } from 'fs'
import { existsSync, mkdirSync, createReadStream } from 'fs'
import { execFile } from 'child_process'
import { join, relative, extname, basename } from 'path'
import { Readable } from 'stream'
import { Worker } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { getRoot } from './roots'
import { getSetting } from './settings'
import { broadcast } from './windows'
import { handleWorkerLog } from './logger'
import { ScanAbortedError } from './fs-scan.mjs'

/**
 * 根目录独立缓存引擎
 *
 * 每个注册根目录内建立：
 *   <root>/.image_browser_cache/
 *     ├── cache.db        —— 独立 SQLite：files 表（图片索引 + 尺寸）+ meta 表
 *     └── image_cache/    —— webp 缩略图，镜像源目录结构：
 *                            image_cache/<相对目录>/<文件名>.<原扩展名>.webp
 *
 * 重型任务（递归扫描、图片解码、缩放、webp 编码）全部运行在
 * Worker 线程（cache-worker.mjs），主进程只做 DB 读写与调度，
 * 避免扫描/建缓存时 UI 卡死。
 *
 * 四种维护模式：
 *   update  增量：扫描新增/变更/删除，为新图生成缩略图
 *   rebuild 全量：清空缓存目录与索引，重新扫描 + 全部生成缩略图
 *   clean   清理：移除索引中已不存在的记录，删除无引用的缩略图文件
 *   scan-cache  扫描缓存文件夹里已生成的缩略图，计入索引（复用已处理结果）
 */

export const CACHE_DIR_NAME = '.image_browser_cache'
export const THUMB_DIR_NAME = 'image_cache'

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

// 默认值（可被开发者选项里的设置覆盖）
const DEFAULT_THUMB_WIDTH = 512
const DEFAULT_THUMB_QUALITY = 80
const DEFAULT_SCAN_BATCH = 100 // 扫描批次：防止一次性消息过大/进程卡死
const DEFAULT_THUMB_BATCH = 100

/** 从设置表读取缓存参数（开发者选项可调），返回带默认值的对象 */
export function getCacheConfig() {
  const num = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    thumbWidth: num(getSetting('cacheThumbWidth', null), DEFAULT_THUMB_WIDTH),
    thumbQuality: Math.min(100, Math.max(1, num(getSetting('cacheThumbQuality', null), DEFAULT_THUMB_QUALITY))),
    scanBatch: num(getSetting('cacheScanBatch', null), DEFAULT_SCAN_BATCH),
    thumbBatch: num(getSetting('cacheThumbBatch', null), DEFAULT_THUMB_BATCH),
    // GIF 首帧来源：realtime = 渲染进程实时取首帧、不写磁盘缓存（节省空间，消耗性能）
    gifRealtime: getSetting('gifThumbSource', 'disk') === 'realtime'
  }
}

const GIF_NAME_RE = /\.gif$/i

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff'
])

const SKIP_DIRS = new Set([
  '@eaDir', '#recycle', '.seekMeta', '.seekTrash', '.thumbnails', '.git', 'node_modules'
])

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

// rootPath -> { db, cacheDir, thumbDir }
const cacheConnections = new Map()

// ---------------------------------------------------------------- 连接管理

/**
 * 打开（或读取）某个根目录的缓存。create=false 且目录不存在时返回 null。
 */
export function openRootCache(rootPath, { create = false } = {}) {
  const hit = cacheConnections.get(rootPath)
  if (hit && existsSync(hit.cacheDir)) return hit

  const cacheDir = join(rootPath, CACHE_DIR_NAME)
  if (!existsSync(cacheDir)) {
    if (!create) return null
    mkdirSync(cacheDir, { recursive: true })
  }
  // 确保缓存目录为隐藏（新建或已有都尝试，attrib 幂等）
  makeDirHidden(cacheDir)
  const thumbDir = join(cacheDir, THUMB_DIR_NAME)
  if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true })

  const dbPath = join(cacheDir, 'cache.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder);
  `)

  const conn = { db, cacheDir, thumbDir, rootPath }
  cacheConnections.set(rootPath, conn)
  return conn
}

function closeRootCache(rootPath) {
  const conn = cacheConnections.get(rootPath)
  if (conn) {
    try {
      conn.db.close()
    } catch {
      /* ignore */
    }
    cacheConnections.delete(rootPath)
  }
}

function metaGet(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return row ? row.value : fallback
}

function metaSet(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}

// ---------------------------------------------------------------- Worker

let workerCounter = 0

function spawnCacheWorker() {
  const worker = new Worker(join(__dirname, 'cache-worker.js'), {
    resourceLimits: {
      // 大图解码需要较大堆：pngjs 解码 40Mpx RGBA ≈ 160MB，多张并发会占内存
      maxOldGenerationSizeMb: 4096,
      maxYoungGenerationSizeMb: 512,
      stackSizeMb: 8
    }
  })
  worker.on('error', (err) => {
    console.error('[cache] worker error:', err)
  })
  return worker
}

/** LIKE 转义（配合 ESCAPE '\'） */
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/**
 * 从 WebP 文件头读取宽高（只读前 30 字节，不整图解码）。
 * 返回 { w, h }；解析失败返回 null。
 */
async function webpDimsFromFile(filePath) {
  try {
    const fh = await fsp.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(30)
      const { bytesRead } = await fh.read(buf, 0, 30, 0)
      if (bytesRead < 30) return null
      if (buf.toString('latin1', 0, 4) !== 'RIFF') return null
      if (buf.toString('latin1', 8, 12) !== 'WEBP') return null
      const fourcc = buf.toString('latin1', 12, 16)
      if (fourcc === 'VP8X') {
        return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
      }
      if (fourcc === 'VP8 ') {
        return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
      }
      if (fourcc === 'VP8L') {
        const bits = buf.readUInt32LE(21)
        return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }
      }
      return null
    } finally {
      await fh.close().catch(() => {})
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 扫描/列表

function relSlash(rootPath, target) {
  return relative(rootPath, target).split(/[\\/]+/).join('/')
}

function isSkipDir(name) {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

/** 不建缓存时快速递归列出目录图片（含子文件夹，不带尺寸） */
export async function listFolderQuick(folderAbsPath) {
  const out = []
  const stack = [folderAbsPath]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const name = entry.name
      const absPath = join(dir, name)
      if (entry.isDirectory()) {
        if (!isSkipDir(name)) stack.push(absPath)
        continue
      }
      if (!entry.isFile()) continue
      if (!IMAGE_EXTS.has(extname(name).toLowerCase())) continue
      let st
      try {
        st = await fsp.stat(absPath)
      } catch {
        continue
      }
      out.push({ absPath, name, width: null, height: null, hasThumb: false, size: st.size })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
}

/**
 * 把用户输入转为大小写不敏感的 LIKE 匹配规则。
 * - 含 * 或 ? 时按通配符整体匹配文件名（* 任意串，? 单个字符）
 * - 否则按子串匹配
 * 返回 { like, anchored }；空输入返回 null
 */
function buildNameMatcher(query) {
  const q = (query || '').trim()
  if (!q) return null
  const anchored = /[*?]/.test(q)
  // 先转义 LIKE 特殊字符（\ % _），再把 * ? 转成通配符
  const like = q
    .replace(/[\\%_]/g, (m) => '\\' + m)
    .replace(/\*/g, '%')
    .replace(/\?/g, '_')
  return { like, anchored }
}

/** 把通配符模式转为大小写不敏感的 JS 正则（无缓存兜底扫描用） */
function wildcardToRegex(pattern) {
  let out = ''
  let anchored = false
  for (const ch of pattern) {
    if (ch === '*') {
      out += '.*'
      anchored = true
    } else if (ch === '?') {
      out += '.'
      anchored = true
    } else {
      out += ch.replace(/[\\^$+.()|[\]{}]/g, '\\$&')
    }
  }
  return new RegExp(anchored ? '^' + out + '$' : out, 'i')
}

/** 无缓存时按文件名模式快速递归搜索根目录图片 */
async function searchImagesQuick(rootPath, re) {
  const out = []
  const stack = [rootPath]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const name = entry.name
      const absPath = join(dir, name)
      if (entry.isDirectory()) {
        if (!isSkipDir(name)) stack.push(absPath)
        continue
      }
      if (!entry.isFile()) continue
      if (!IMAGE_EXTS.has(extname(name).toLowerCase())) continue
      if (!re.test(name)) continue
      let st
      try {
        st = await fsp.stat(absPath)
      } catch {
        continue
      }
      out.push({ absPath, name, width: null, height: null, hasThumb: false, size: st.size })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
}

// ---------------------------------------------------------------- 维护任务

/**
 * scan-cache 模式：扫描缓存文件夹（image_cache/）里已生成的 webp 缩略图，
 * 把它们镜像回源图路径并计入 files 索引，让「已经处理过的图片」直接复用，
 * 而无需重新生成。孤儿缩略图（源图已不存在）一并清理。
 */
async function scanCacheIntoIndex({ db, thumbDir, root, onProgress, shouldAbort }) {
  const stats = { mode: 'scan-cache', added: 0, updated: 0, removed: 0, thumbs: 0, failed: 0, cleanedThumbs: 0 }
  const nowMs = Date.now()

  // 收集 image_cache 下所有 webp 缩略图
  const thumbs = []
  const walk = async (dir) => {
    let names = []
    try {
      names = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of names) {
      if (shouldAbort?.()) throw new ScanAbortedError()
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (extname(entry.name).toLowerCase() === '.webp') {
        thumbs.push(full)
      }
    }
  }
  await walk(thumbDir)

  const existing = db.prepare('SELECT * FROM files').all()
  const dbByAbs = new Map(existing.map((r) => [r.abs_path, r]))

  const insertStmt = db.prepare(
    `INSERT INTO files (abs_path, rel_path, name, folder, size, mtime, width, height, thumb, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const updateThumbStmt = db.prepare(
    `UPDATE files SET thumb=?, width=?, height=?, updated_at=? WHERE abs_path=?`
  )
  const deleteStmt = db.prepare('DELETE FROM files WHERE abs_path = ?')

  let processed = 0
  db.exec('BEGIN')
  try {
    for (const thumbAbs of thumbs) {
      if (shouldAbort?.()) throw new ScanAbortedError()
      // 相对 image_cache 的路径（/ 分隔），如 相册/风景/photo.jpg.webp
      const relThumb = relative(thumbDir, thumbAbs).split(/[\\/]+/).join('/')
      // 镜像路径还原源图相对路径：去掉末尾 .webp
      const srcRel = relThumb.slice(0, -'.webp'.length)
      const srcAbs = join(root.path, ...srcRel.split('/'))

      let st = null
      try {
        st = await fsp.stat(srcAbs)
      } catch {
        st = null
      }
      if (!st || !st.isFile()) {
        // 源图已不存在 → 孤儿缩略图，删除并移除对应索引
        await fsp.rm(thumbAbs, { force: true })
        stats.cleanedThumbs++
        if (dbByAbs.has(srcAbs)) {
          deleteStmt.run(srcAbs)
          dbByAbs.delete(srcAbs)
        }
        processed++
        continue
      }

      const dim = await webpDimsFromFile(thumbAbs)
      const folder = srcRel.includes('/') ? srcRel.slice(0, srcRel.lastIndexOf('/')) : ''
      const row = dbByAbs.get(srcAbs)

      if (!row) {
        insertStmt.run(
          srcAbs, srcRel, basename(srcAbs), folder, st.size, Math.floor(st.mtimeMs),
          dim?.w ?? null, dim?.h ?? null, relThumb, nowMs, nowMs
        )
        dbByAbs.set(srcAbs, { abs_path: srcAbs, thumb: relThumb })
        stats.added++
      } else if (!row.thumb) {
        updateThumbStmt.run(relThumb, dim?.w ?? null, dim?.h ?? null, nowMs, srcAbs)
        row.thumb = relThumb
        stats.updated++
      }
      stats.thumbs++
      processed++

      if (processed % 200 === 0) {
        onProgress({ phase: 'scan-cache', scanned: processed })
      }
    }
  } finally {
    db.exec('COMMIT')
  }
  onProgress({ phase: 'scan-cache', scanned: processed })
  return stats
}

/**
 * 执行缓存维护任务
 * @param {{id:number, path:string, alias?:string}} root
 * @param {'update'|'rebuild'|'clean'|'scan-cache'} mode
 * @param {object} opts
 * @param {(p: object) => void} opts.onProgress
 * @param {() => boolean} opts.shouldAbort
 * @returns {Promise<object>} stats
 */
export async function runCacheTask(root, mode, { onProgress = () => {}, shouldAbort } = {}) {
  const cfg = getCacheConfig()
  console.log('[cache] task start', { mode, root: root.path, cfg })
  const cache = openRootCache(root.path, { create: true })
  const { db, thumbDir } = cache
  const stats = { mode, added: 0, updated: 0, removed: 0, thumbs: 0, failed: 0, cleanedThumbs: 0 }

  // --- scan-cache：扫描缓存文件夹，把已生成的缩略图计入索引（无需 worker） ---
  if (mode === 'scan-cache') {
    const scanStats = await scanCacheIntoIndex({ db, thumbDir, root, onProgress, shouldAbort })
    metaSet(db, 'last_task', mode)
    metaSet(db, 'last_task_at', new Date().toISOString())
    onProgress({ phase: 'done' })
    console.log('[cache] scan-cache finished, stats =', JSON.stringify(scanStats))
    return scanStats
  }

  // --- rebuild：先清空 ---
  if (mode === 'rebuild') {
    await fsp.rm(thumbDir, { recursive: true, force: true })
    await fsp.mkdir(thumbDir, { recursive: true })
    db.exec('DELETE FROM files')
  }

  const worker = spawnCacheWorker()
  let aborted = false
  const abortWorker = () => {
    if (aborted) return
    aborted = true
    try {
      worker.postMessage({ type: 'abort' })
    } catch {
      /* ignore */
    }
  }
  const checkAbort = () => {
    if (aborted || shouldAbort?.()) throw new ScanAbortedError()
  }

  try {
    // --- 1. 扫描磁盘（worker 线程） ---
    onProgress({ phase: 'scan', scanned: 0 })
    const files = await new Promise((resolve, reject) => {
      const all = []
      const onMsg = (m) => {
        if (m.type === 'log') {
          handleWorkerLog(m)
          return
        }
        if (m.type === 'scan-batch') {
          all.push(...m.files)
          onProgress({ phase: 'scan', scanned: all.length })
        } else if (m.type === 'scan-done') {
          cleanup()
          resolve(all)
        } else if (m.type === 'error') {
          cleanup()
          reject(new Error(m.message || 'worker error'))
        }
      }
      const onErr = (err) => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        worker.removeListener('message', onMsg)
        worker.removeListener('error', onErr)
      }
      worker.on('message', onMsg)
      worker.on('error', onErr)
      worker.postMessage({ type: 'scan', rootPath: root.path, scanBatch: cfg.scanBatch })
    })
    checkAbort()
    onProgress({ phase: 'scan', scanned: files.length })
    console.log('[cache] scan done, files =', files.length)

    const diskByAbs = new Map(files.map((f) => [f.absPath, f]))

    const nowMs = Date.now()
    const existing = db.prepare('SELECT * FROM files').all()
    const dbByAbs = new Map(existing.map((r) => [r.abs_path, r]))

    // 需要重新生成缩略图的（新增/变更/上次失败）
    const needThumb = []

    if (mode !== 'clean') {
      const insertStmt = db.prepare(
        `INSERT INTO files (abs_path, rel_path, name, folder, size, mtime, width, height, thumb, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const updateStmt = db.prepare(
        `UPDATE files SET name=?, folder=?, size=?, mtime=?, updated_at=? WHERE abs_path=?`
      )
      const clearThumbStmt = db.prepare(`UPDATE files SET thumb=NULL WHERE abs_path=?`)
      const deleteStmt = db.prepare('DELETE FROM files WHERE abs_path = ?')

      // 批量写入包进事务：逐条 autocommit 会触发大量 fsync，3 万图可卡住主进程上百秒
      db.exec('BEGIN')
      try {
        for (const f of files) {
          const row = dbByAbs.get(f.absPath)
          if (!row) {
            const info = insertStmt.run(
              f.absPath, f.relPath, f.name, f.folder, f.size, f.mtime,
              null, null, null, nowMs, nowMs
            )
            const isGif = GIF_NAME_RE.test(f.name)
            // 「实时获取」开启时 GIF 首帧不落盘
            if (!(cfg.gifRealtime && isGif)) {
              needThumb.push({
                id: Number(info.lastInsertRowid),
                absPath: f.absPath,
                relPath: f.relPath,
                name: f.name
              })
            }
            stats.added++
          } else if (row.mtime !== f.mtime || row.size !== f.size) {
            updateStmt.run(f.name, f.folder, f.size, f.mtime, nowMs, f.absPath)
            clearThumbStmt.run(f.absPath) // 原图变了，旧缩略图作废
            if (!(cfg.gifRealtime && GIF_NAME_RE.test(f.name))) {
              needThumb.push({ id: row.id, absPath: f.absPath, relPath: f.relPath, name: f.name })
            }
            stats.updated++
          } else if (!row.thumb) {
            // 索引在但缩略图缺失（上次失败/旧版平铺缓存）→ 重试
            // 「实时获取」开启时 GIF 首帧不落盘，跳过，避免每次维护都重试
            if (!(cfg.gifRealtime && GIF_NAME_RE.test(f.name))) {
              needThumb.push({ id: row.id, absPath: f.absPath, relPath: f.relPath, name: f.name })
            }
          }
        }

        // 磁盘上已消失的记录
        const gone = existing.filter((r) => !diskByAbs.has(r.abs_path))
        for (const row of gone) {
          deleteStmt.run(row.abs_path)
          if (row.thumb) {
            await fsp.rm(join(thumbDir, row.thumb), { force: true })
          }
          stats.removed++
        }
      } finally {
        db.exec('COMMIT')
      }
    }
    console.log('[cache] db update done, stats =', JSON.stringify(stats), 'needThumb =', needThumb.length)

    // --- 2. 生成缩略图（worker 线程，分批） ---
    if (mode !== 'clean' && needThumb.length) {
      console.log('[cache] thumb start, total =', needThumb.length, 'batch =', cfg.thumbBatch)
      const total = needThumb.length
      let done = 0
      let lastCurrent = ''
      const BATCH = cfg.thumbBatch

      const updateThumbStmt = db.prepare(
        'UPDATE files SET thumb=?, width=?, height=?, updated_at=? WHERE id=?'
      )

      // 缩略图状态回写也包进事务，避免逐条 fsync 卡住主进程
      db.exec('BEGIN')
      try {
        for (let i = 0; i < needThumb.length; i += BATCH) {
          checkAbort()
          const chunk = needThumb.slice(i, i + BATCH)

          // 每批独立 worker：崩溃只影响本批，重建后继续，保证任务跑完并返回成功/失败数
          const batchWorker = spawnCacheWorker()
          const batchStartDone = done

          await new Promise((resolve) => {
            let settled = false
            const settle = (failedExtra = 0) => {
              if (settled) return
              settled = true
              clearTimeout(batchTimer)
              batchWorker.removeAllListeners()
              batchWorker.terminate().catch(() => {})
              if (failedExtra > 0) {
                stats.failed += failedExtra
                done += failedExtra
              }
              resolve()
            }

            const onMsg = (m) => {
              if (m.type === 'log') {
                handleWorkerLog(m)
                return
              }
              if (m.type === 'thumb-done') {
                updateThumbStmt.run(m.relThumb, m.width, m.height, Date.now(), m.id)
                stats.thumbs++
                done++
                lastCurrent = m.name || lastCurrent
              } else if (m.type === 'thumb-fail') {
                stats.failed++
                done++
                lastCurrent = m.name || lastCurrent
              } else if (m.type === 'thumb-done-all') {
                settle()
                return
              } else if (m.type === 'error') {
                settle(chunk.length - (done - batchStartDone))
                return
              }
              if (done % 5 === 0 || done === total) {
                onProgress({ phase: 'thumb', done, total, current: lastCurrent })
              }
            }
            const onErr = () => {
              settle(chunk.length - (done - batchStartDone))
            }
            const onExit = () => {
              settle(chunk.length - (done - batchStartDone))
            }
            // 批次超时保护：worker 卡死（未崩溃也未返回）则跳过本批剩余
            const batchTimer = setTimeout(() => {
              const remaining = chunk.length - (done - batchStartDone)
              if (remaining > 0) {
                console.error(`[cache] thumb batch timeout, skipping ${remaining} jobs`)
                settle(remaining)
              } else {
                settle()
              }
            }, 120000)

            batchWorker.on('message', onMsg)
            batchWorker.on('error', onErr)
            batchWorker.on('exit', onExit)
            batchWorker.postMessage({
              type: 'thumb',
              jobs: chunk,
              thumbDir,
              thumbWidth: cfg.thumbWidth,
              thumbQuality: cfg.thumbQuality
            })
          })
          checkAbort()
        }
      } finally {
        db.exec('COMMIT')
      }
      console.log('[cache] thumb done, stats =', JSON.stringify(stats))
    }

    // --- 3. 清理无用缓存（clean 模式，或顺带清理 rebuild 之外的孤儿）---
    if (mode === 'clean') {
      const rows = db.prepare('SELECT abs_path, thumb FROM files').all()
      let removedRows = 0
      for (const row of rows) {
        checkAbort()
        let ok = false
        try {
          ok = existsSync(row.abs_path)
        } catch {
          ok = false
        }
        if (!ok) {
          db.prepare('DELETE FROM files WHERE abs_path = ?').run(row.abs_path)
          if (row.thumb) await fsp.rm(join(thumbDir, row.thumb), { force: true })
          removedRows++
        }
      }
      stats.removed += removedRows

      // 扫描 image_cache，删除索引外的孤儿缩略图
      const validThumbs = new Set(
        db.prepare('SELECT thumb FROM files WHERE thumb IS NOT NULL').all().map((r) => r.thumb)
      )
      const walkThumbs = async (dir) => {
        let names = []
        try {
          names = await fsp.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of names) {
          checkAbort()
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            await walkThumbs(full)
          } else {
            const rel = relative(thumbDir, full).split(/[\\/]+/).join('/')
            if (!validThumbs.has(rel)) {
              await fsp.rm(full, { force: true })
              stats.cleanedThumbs++
            }
          }
        }
      }
      await walkThumbs(thumbDir)
    }
  } catch (err) {
    console.error('[cache] task error:', err?.stack || err)
    if (aborted || shouldAbort?.() || err instanceof ScanAbortedError) {
      abortWorker()
      throw new ScanAbortedError()
    }
    throw err
  } finally {
    await worker.terminate().catch(() => {})
  }

  metaSet(db, 'last_task', mode)
  metaSet(db, 'last_task_at', new Date().toISOString())
  onProgress({ phase: 'done' })
  console.log('[cache] task finished, stats =', JSON.stringify(stats))
  return stats
}

// ---------------------------------------------------------------- IPC + 协议

let cacheTaskController = null

export function registerCacheIpc({ ipcMain }) {
  ipcMain.handle('cache:run', async (e, rootId, mode) => {
    const root = getRoot(rootId)
    if (!root) throw new Error('根目录不存在')
    if (!['update', 'rebuild', 'clean', 'scan-cache'].includes(mode)) {
      throw new Error('未知维护模式: ' + mode)
    }

    cacheTaskController?.abort()
    const ac = new AbortController()
    cacheTaskController = ac
    cacheTaskController.rootId = rootId

    // 进度广播到所有窗口（主窗口通知列表也能看到）+ 节流，避免海量图片时 IPC 风暴
    let lastEmit = 0
    const MIN_EMIT_INTERVAL = 120
    const send = (payload) => {
      const now = Date.now()
      // 注意：thumb 进度事件里 done 是数字，仅 done === true 才算任务完成（强制发送）
      const forced = payload.done === true || payload.aborted || payload.error
      if (!forced && now - lastEmit < MIN_EMIT_INTERVAL) return
      lastEmit = now
      broadcast('cache:progress', { rootId, rootPath: root.path, ...payload })
    }

    // 后台执行，不阻塞 invoke
    runCacheTask(root, mode, {
      onProgress: (p) => send(p),
      shouldAbort: () => ac.signal.aborted
    })
      .then((stats) => {
        console.log('[cache] task promise resolved, sending done once, stats =', JSON.stringify(stats))
        send({ done: true, stats })
      })
      .catch((err) => {
        if (ac.signal.aborted || err instanceof ScanAbortedError) {
          send({ aborted: true })
        } else {
          console.error('[cache] task failed:', err)
          send({ error: String(err?.message || err) })
        }
      })

    return { started: true }
  })

  ipcMain.handle('cache:abort', () => {
    cacheTaskController?.abort()
    return true
  })

  ipcMain.handle('cache:status', () => {
    const root = getRoot(cacheTaskController?.rootId)
    return {
      running: !!cacheTaskController && !cacheTaskController.signal.aborted,
      rootId: cacheTaskController?.rootId
    }
  })
}

/**
 * 图片列表：优先读缓存索引（含尺寸/缩略图），无缓存回退即时递归扫描（原图）。
 * 选中文件夹时同时返回其下所有子文件夹的图片（与 PHP 参考版行为一致）。
 * searchQuery 非空时忽略 folderAbsPath，改为跨整个根目录按文件名搜索。
 */
export async function handleImagesList(rootId, folderAbsPath, searchQuery) {
  const root = getRoot(rootId)
  if (!root) return []

  const cache = openRootCache(root.path, { create: false })
  const matcher = buildNameMatcher(searchQuery)

  // --- 搜索模式：跨整个根目录按文件名匹配 ---
  if (matcher) {
    let rows = []
    if (cache) {
      const pattern = (matcher.anchored ? '' : '%') + matcher.like + (matcher.anchored ? '' : '%')
      rows = cache.db
        .prepare(
          `SELECT abs_path, name, width, height, thumb, folder FROM files
           WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE
           ORDER BY folder, name COLLATE NOCASE`
        )
        .all(pattern)
    } else {
      rows = await searchImagesQuick(root.path, wildcardToRegex(searchQuery))
    }
    return rows.map((r) => ({
      absPath: r.abs_path,
      name: r.name,
      folder: r.folder || '',
      width: r.width,
      height: r.height,
      hasThumb: !!r.thumb
    }))
  }

  // --- 普通文件夹列表 ---
  if (cache) {
    const rel = relative(root.path, folderAbsPath).split(/[\\/]+/).join('/')
    let rows
    if (rel === '') {
      // 根目录：返回全部图片（含所有子文件夹）
      rows = cache.db
        .prepare('SELECT abs_path, name, width, height, thumb, folder FROM files ORDER BY folder, name COLLATE NOCASE')
        .all()
    } else {
      const esc = likeEscape(rel)
      rows = cache.db
        .prepare(
          `SELECT abs_path, name, width, height, thumb, folder FROM files
           WHERE folder = ? OR folder LIKE ? ESCAPE '\\'
           ORDER BY folder, name COLLATE NOCASE`
        )
        .all(rel, esc + '/%')
    }
    if (rows.length) {
      return rows.map((r) => ({
        absPath: r.abs_path,
        name: r.name,
        folder: r.folder,
        width: r.width,
        height: r.height,
        hasThumb: !!r.thumb
      }))
    }
  }
  return listFolderQuick(folderAbsPath)
}

/**
 * 注册 image:// 自定义协议（需在 app ready 前 registerSchemesAsPrivileged）。
 * URL: image://<rootId>/<encodedAbsPath>?size=orig|auto
 * - auto（默认）：有 webp 缩略图返回缩略图，否则回退原图
 * - orig：始终返回原图（灯箱用）
 * 返回体用 fs 流（不再依赖 net.fetch(file://)，兼容性更好）。
 */
export function registerImageProtocol({ protocol }) {
  protocol.handle('image', async (req) => {
    try {
      const url = new URL(req.url)
      const rootId = Number(url.hostname || url.host)
      const absPath = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!absPath) return new Response('bad request', { status: 400 })

      const size = url.searchParams.get('size')
      let file = absPath
      let thumbServed = false

      if (size !== 'orig' && Number.isFinite(rootId) && rootId > 0) {
        const root = getRoot(rootId)
        if (root) {
          const cache = openRootCache(root.path, { create: false })
          if (cache) {
            let thumbPath = null
            // 1) DB 索引
            const row = cache.db
              .prepare('SELECT thumb FROM files WHERE abs_path = ?')
              .get(absPath)
            if (row?.thumb) {
              const p = join(cache.thumbDir, row.thumb)
              if (existsSync(p)) thumbPath = p
            }
            // 2) 兼容/推导：镜像路径 image_cache/<rel_path>.webp
            if (!thumbPath) {
              const rel = relative(root.path, absPath).split(/[\\/]+/).join('/')
              const p = join(cache.thumbDir, rel + '.webp')
              if (existsSync(p)) thumbPath = p
            }
            if (thumbPath) {
              file = thumbPath
              thumbServed = true
            }
          }
        }
      }

      if (!existsSync(file)) return new Response('not found', { status: 404 })
      const st = await fsp.stat(file)
      const mime = MIME_BY_EXT[extname(file).toLowerCase()] || 'application/octet-stream'
      // 原图请求不缓存；缩略图请求（?size=thumb）若回退到原图（缩略图尚未生成）
      // 也不缓存，避免浏览器把缓存建立前的原图响应当作缩略图复用。
      const cacheControl =
        size === 'orig' || (size === 'thumb' && !thumbServed)
          ? 'no-cache'
          : 'public, max-age=86400'
      const headers = new Headers({
        'Content-Type': mime,
        'Content-Length': String(st.size),
        // 渲染端 canvas 读取像素（复制/导出）需要跨域许可
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': cacheControl
      })
      const body = Readable.toWeb(createReadStream(file))
      return new Response(body, { status: 200, headers })
    } catch (err) {
      return new Response('error: ' + String(err?.message || err), { status: 500 })
    }
  })
}

export { closeRootCache }
