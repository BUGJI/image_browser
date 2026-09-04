import { promises as fsp } from 'fs'
import { existsSync, mkdirSync, createReadStream, openSync, readSync, closeSync } from 'fs'
import { execFile, spawn } from 'child_process'
import { join, relative, extname, basename } from 'path'
import { Readable } from 'stream'
import { Worker } from 'node:worker_threads'
import os from 'os'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
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
const DEFAULT_THUMB_TIMEOUT = 120000 // 单段缩略图超时（ms）
const DEFAULT_THUMB_SLOW_MS = 3000 // 超过此耗时的“重图”打 WARN（ms）
const WORKER_RESTART_JOBS = 200 // worker 池：单个 worker 处理满该数后重启一次（清堆，防巨型 GC）

/** 从设置表读取缓存参数（开发者选项可调），返回带默认值的对象 */
export function getCacheConfig() {
  const num = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  const int0 = (v, d) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 ? n : d
  }
  return {
    thumbWidth: num(getSetting('cacheThumbWidth', null), DEFAULT_THUMB_WIDTH),
    thumbQuality: Math.min(100, Math.max(1, num(getSetting('cacheThumbQuality', null), DEFAULT_THUMB_QUALITY))),
    scanBatch: num(getSetting('cacheScanBatch', null), DEFAULT_SCAN_BATCH),
    thumbBatch: num(getSetting('cacheThumbBatch', null), DEFAULT_THUMB_BATCH),
    // 0 = 自动按核数；>0 = 手动指定并发缩略图 worker 数（最多不超过核数）
    thumbWorkers: int0(getSetting('cacheThumbWorkers', null), 0),
    // 单段（一个 worker 一批）超时上限
    thumbTimeout: num(getSetting('cacheThumbTimeout', null), DEFAULT_THUMB_TIMEOUT),
    // 单张解码+编码超过该毫秒数时打 [WARN]，方便定位重图
    thumbSlowMs: num(getSetting('cacheThumbSlowMs', null), DEFAULT_THUMB_SLOW_MS),
    // true = 按扫描顺序连续取任务（同目录连续读，机械硬盘友好）；
    // false = 跨目录打散轮流取任务（SSD/多目录更平滑）
    cacheSequential: getSetting('cacheSequential', 'true') !== 'false',
    // true = 用外部转换器 image_compresser.exe 生成缩略图（绕过应用内一切解码调度问题）
    cacheUseCli: getSetting('cacheUseCli', 'false') === 'true',
    // 外部转换器 exe 的绝对路径（留空则自动探测 dev 根目录/打包 extraResources）
    cacheCliExe: getSetting('cacheCliExe', '') || '',
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

// 协议层缩略图路径缓存（避免每张图请求都同步查 DB + 磁盘探测）。
// 值：缩略图绝对路径，或 null（负缓存：该图无缩略图，需回退原图）。
// 每个 root 独立 Map，带容量上限（删除最旧插入项）；维护任务开始时整体失效。
const thumbIndexByRoot = new Map()
const THUMB_INDEX_MAX = 30000

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
  thumbIndexByRoot.delete(rootPath)
}

/**
 * 解析缩略图路径，结果缓存于内存（含 null 负缓存）。
 * 返回：缩略图绝对路径，或 null（无缩略图，协议回退原图）。
 */
function resolveThumb(cache, root, absPath) {
  let index = thumbIndexByRoot.get(root.path)
  if (!index) {
    index = new Map()
    thumbIndexByRoot.set(root.path, index)
  }
  if (index.has(absPath)) return index.get(absPath)

  let thumb = null
  const row = cache.db.prepare('SELECT thumb FROM files WHERE abs_path = ?').get(absPath)
  if (row?.thumb) {
    const p = join(cache.thumbDir, row.thumb)
    if (existsSync(p)) thumb = p
  }
  // 兼容/推导：镜像路径 image_cache/<rel_path>.webp
  if (!thumb) {
    const rel = relative(root.path, absPath).split(/[\\/]+/).join('/')
    const p = join(cache.thumbDir, rel + '.webp')
    if (existsSync(p)) thumb = p
  }

  // 容量上限：超出时淘汰最旧插入的条目（Map 迭代序 = 插入序）
  if (index.size >= THUMB_INDEX_MAX && !index.has(absPath)) {
    index.delete(index.keys().next().value)
  }
  index.set(absPath, thumb)
  return thumb
}

/**
 * 批量预热某个根目录的缩略图索引（选目录/搜索返回列表时调用）。
 * 直接把本次查询到的 rows（含 DB 里的 thumb 相对路径）一次性填进内存 Map，
 * 让后续 image:// 请求直接命中，不再逐张做 SQL + 磁盘探测。
 * row.thumb 为 null 的行不写负缓存（保留 resolveThumb 的镜像路径兜底能力）。
 */
function primeThumbIndex(cache, root, rows) {
  let index = thumbIndexByRoot.get(root.path)
  if (!index) {
    index = new Map()
    thumbIndexByRoot.set(root.path, index)
  }
  for (const r of rows) {
    if (index.size >= THUMB_INDEX_MAX) return
    if (index.has(r.abs_path)) continue
    if (r.thumb) {
      index.set(r.abs_path, join(cache.thumbDir, r.thumb))
    }
  }
}

/** 维护任务会增删缩略图，任务开始/结束时清空索引强制重查 */
function invalidateThumbIndex(rootPath) {
  thumbIndexByRoot.delete(rootPath)
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
      // 大图解码需要一定堆，但上限越高、GC 单次停顿越长（pngjs/jpeg-js 会申请几十~几百 MB 大 Buffer）。
      // 2048 是折中：容得下绝大多数图，又不会像 4096 那样拖出十几秒的 Stop-The-World。
      maxOldGenerationSizeMb: 2048,
      maxYoungGenerationSizeMb: 256,
      stackSizeMb: 8
    }
  })
  worker.on('error', (err) => {
    console.error('[cache] worker error:', err)
  })
  return worker
}

/**
 * 缩略图生成并发度：
 * 默认 = 按「内存」与「核数」共同限制（每种解码都会临时占几十~几百 MB，
 * 核多但内存小照样会抖动；一般按 ~4GB/worker 估，兼顾速度与不换页）。
 * 开发者可传 cacheThumbWorkers 手动指定（0/空 = 自动，>0 最多取到核数）。
 */
function pickThumbWorkerCount(override) {
  let cores = 4
  try {
    cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
  } catch {
    /* fallback */
  }
  let memGB = 16
  try {
    memGB = os.totalmem() / 1073741824
  } catch {
    /* fallback */
  }
  const byMem = Math.max(1, Math.floor(memGB / 4) || 1)
  const auto = Math.max(1, Math.min(cores - 1 || 1, byMem, 6))
  const o = Number(override)
  if (Number.isInteger(o) && o > 0) return Math.min(o, Math.max(1, cores))
  return auto
}

/**
 * 同一时刻所有 worker「在解」图像的预估总像素上限（百万像素）。
 * 解码内存 ∝ 像素（RGBA 4B/px），并发的超大图会互相挤压内存导致解码退化（实测可达百倍）；
 * 预算也随内存自适应：内存越小，同时解码的量越少。
 */
function maxInflightMP() {
  let memGB = 16
  try {
    memGB = os.totalmem() / 1073741824
  } catch {
    /* fallback */
  }
  return Math.min(512, Math.max(32, Math.floor((memGB - 2) * 20)))
}
// 预估像素 ≥ 该值视为“重图”（单飞，不进小图批次）
const HEAVY_MP = 20

/** 解析外部转换器 exe 路径：优先用设置值，否则在常见位置探测（dev 项目根/打包 extraResources） */
function resolveCliExe(configured) {
  if (configured && existsSync(configured)) return configured
  const candidates = [
    join(__dirname, '..', '..', 'image_compresser.exe'), // dev：<proj>/out/main -> <proj>/
    join(__dirname, 'image_compresser.exe')
  ]
  try {
    candidates.push(join(process.resourcesPath, 'image_compresser.exe')) // 打包：extraResources
  } catch {
    /* ignore */
  }
  return candidates.find((p) => existsSync(p)) || null
}

/**
 * 用外部转换器（image_compresser.exe）一次生成整个根的缩略图。
 * 它的输出镜像输入目录并命名为 `<原名含扩展名>.webp`，与我们缓存布局一致。
 * 只在 DB 阶段维护（扫描/增删）后调用本函数，回写 thumb/宽高。
 */
async function runCliThumbStage({ cfg, rootPath, cache, mode, needThumb, db, stats, onProgress, exePath }) {
  const total = needThumb.length
  onProgress({ phase: 'thumb', done: 0, total, current: 'external converter' })
  const overwrite = mode === 'rebuild'
  const relOf = (job) => `${job.relPath}.webp`

  // 非 rebuild 时：先把需要重生成的旧产物删掉，让工具“跳过已存在”逻辑正确增量续跑
  if (!overwrite) {
    for (const job of needThumb) {
      await fsp.rm(join(cache.thumbDir, relOf(job)), { force: true }).catch(() => {})
    }
  }

  const args = [
    '-i', rootPath,
    '-o', cache.thumbDir,
    '--resize',
    '--width', String(cfg.thumbWidth),
    '-q', String(cfg.thumbQuality),
    '-j', String(Math.max(0, cfg.thumbWorkers | 0)),
    '--output-format', 'json'
  ]
  if (overwrite) args.push('--overwrite')

  console.log(`[cache] cli thumb start: ${exePath} ${args.join(' ')}`)

  const updateThumbStmt = db.prepare(
    'UPDATE files SET thumb=?, width=?, height=?, updated_at=? WHERE id=?'
  )
  const relToJob = new Map() // rel -> job（只关心需要生成的那批）
  const pending = new Set()
  for (const job of needThumb) {
    relToJob.set(job.relPath, job)
    pending.add(job.relPath)
  }
  const relThumbOf = (rel) => `${rel}.webp`
  let lastCurrent = ''
  const bump = () => {
    const doneCount = total - pending.size
    if (doneCount % 20 === 0 || pending.size === 0) {
      onProgress({ phase: 'thumb', done: doneCount, total, current: lastCurrent })
    }
  }
  // 逐条消费工具的 NDJSON（每文件一事件）。ok:true 的 width/height 为产物(缩放后)尺寸，
  // 网格只用比例，直接入库即可（与源图宽高比例一致）。
  const handleCliLine = (line) => {
    let e
    try {
      e = JSON.parse(line)
    } catch {
      return
    }
    if (!e || e.event !== 'file') return
    const job = relToJob.get(e.rel)
    if (!job || !pending.delete(e.rel)) return
    lastCurrent = job.name || e.rel || lastCurrent
    if (e.ok) {
      updateThumbStmt.run(relThumbOf(e.rel), e.width || null, e.height || null, Date.now(), job.id)
      stats.thumbs++
    } else if (e.reason === 'exists') {
      // 产物已存在（理论不会，删过），视为成功
      const p = join(cache.thumbDir, relThumbOf(e.rel))
      if (existsSync(p)) {
        const d = probeImageSize(job.absPath)
        updateThumbStmt.run(relThumbOf(e.rel), d ? d.w : null, d ? d.h : null, Date.now(), job.id)
        stats.thumbs++
      } else {
        stats.failed++
      }
    } else {
      stats.failed++
    }
    bump()
  }

  db.exec('BEGIN')
  try {
    await new Promise((resolve) => {
      let buf = ''
      const ch = spawn(exePath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      ch.on('error', (err) => {
        console.error('[cache] cli spawn error:', err)
        resolve()
      })
      ch.on('close', (code) => {
        if (buf.trim()) handleCliLine(buf.trim())
        if (code !== 0) console.warn(`[cache] cli thumb finished with exit code ${code}`)
        resolve()
      })
      ch.stdout.on('data', (d) => {
        buf += d
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line) handleCliLine(line)
        }
      })
    })
    bump()

    // 兜底：工具没发事件但确实缺/有产物的极少数（不应发生），按存在性补账
    for (const rel of [...pending]) {
      const job = relToJob.get(rel)
      if (!job) continue
      const p = join(cache.thumbDir, relThumbOf(rel))
      let ok = false
      try {
        await fsp.access(p)
        ok = true
      } catch {
        ok = false
      }
      if (ok) {
        const d = probeImageSize(job.absPath)
        updateThumbStmt.run(relThumbOf(rel), d ? d.w : null, d ? d.h : null, Date.now(), job.id)
        stats.thumbs++
      } else {
        stats.failed++
      }
      bump()
    }
  } finally {
    db.exec('COMMIT')
  }
  console.log('[cache] cli thumb done, stats =', JSON.stringify(stats))
}

/** 只读文件头部解析图片像素，用于调度前的内存预算（读取量小、快） */
function probeImageSize(absPath) {
  try {
    const fd = openSync(absPath, 'r')
    try {
      const head = Buffer.alloc(2048)
      const read = readSync(fd, head, 0, head.length, 0)
      const b = head.subarray(0, read)
      const name = extname(absPath).toLowerCase()
      if (name === '.png' && b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
        return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
      }
      if ((name === '.jpg' || name === '.jpeg') && b[0] === 0xff && b[1] === 0xd8) {
        // 扫描 SOF 段拿宽高（起始若干 KB 内一般就有）
        let i = 2
        while (i + 9 < b.length) {
          if (b[i] !== 0xff) {
            i++
            continue
          }
          const marker = b[i + 1]
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }
          }
          const segLen = b.readUInt16BE(i + 2)
          if (segLen < 2) break
          i += 2 + segLen
        }
        return null
      }
      if (name === '.webp' && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') {
        const four = b.subarray(12, 16).toString()
        if (four === 'VP8 ' && b.length >= 30) {
          return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
        }
        if (four === 'VP8L' && b.length >= 25) {
          const bits = b.readUInt32LE(21)
          return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
        }
        if (four === 'VP8X' && b.length >= 30) {
          return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
        }
        return null
      }
      if (name === '.gif' && b.subarray(0, 6).toString() === 'GIF89a') {
        return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) }
      }
      if (name === '.bmp' && b.subarray(0, 2).toString() === 'BM' && b.length >= 26) {
        const w = b.readInt32LE(18)
        const h = Math.abs(b.readInt32LE(22))
        return { w, h }
      }
      return null
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

function mpOf(size) {
  if (!size || !size.w || !size.h) return 0
  return (size.w * size.h) / 1e6
}

/**
 * 缩略图任务队列构造。
 * cacheSequential = true：保持扫描顺序（同一目录连续读取，机械硬盘友好）；
 * = false：按目录打散后轮流取（跨文件夹交错，某目录出现重图/卡顿时，
 *   其它目录的任务仍在推进，视觉上不易感觉卡在某个文件夹）。
 */
function buildThumbQueue(jobs, sequential) {
  if (sequential || jobs.length < 2) return jobs.slice()
  const buckets = new Map() // 目录 -> jobs（保持内部原有顺序）
  for (const job of jobs) {
    const dir = (job.relPath || '').replace(/[\\/]+[^\\/]*$/, '') || '/'
    let arr = buckets.get(dir)
    if (!arr) buckets.set(dir, (arr = []))
    arr.push(job)
  }
  const lists = [...buckets.values()]
  const out = []
  let taken = true
  while (taken) {
    taken = false
    for (let i = 0; i < lists.length; i++) {
      if (lists[i].length) {
        out.push(lists[i].shift())
        taken = true
      }
    }
  }
  return out
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

    // --- 2. 生成缩略图：优先外部转换器（image_compresser.exe），否则走 worker 池 ---
    const cliExe = cfg.cacheUseCli ? resolveCliExe(cfg.cacheCliExe) : null
    if (mode !== 'clean' && needThumb.length && cliExe) {
      await runCliThumbStage({
        cfg,
        rootPath: root.path,
        cache,
        mode,
        needThumb,
        db,
        stats,
        onProgress,
        exePath: cliExe
      })
    }
    if (mode !== 'clean' && needThumb.length && !cliExe) {
      console.log('[cache] thumb start, total =', needThumb.length, 'batch =', cfg.thumbBatch)
      const total = needThumb.length
      let done = 0
      let lastCurrent = ''

      const updateThumbStmt = db.prepare(
        'UPDATE files SET thumb=?, width=?, height=?, updated_at=? WHERE id=?'
      )

      // 缩略图状态回写也包进事务，避免逐条 fsync 卡住主进程
      db.exec('BEGIN')
      try {
        // 预估每张图的解码像素（用于内存预算调度），只读文件头，开销小
        let heavyCount = 0
        for (const job of needThumb) {
          job.estMP = mpOf(probeImageSize(job.absPath))
          if (job.estMP >= HEAVY_MP) heavyCount++
        }
        console.log(`[cache] thumb mp-probe done, heavy(>=${HEAVY_MP}MP)=${heavyCount}`)

        // 任务队列：开关打开 = 保持扫描顺序（连续读，机械硬盘友好）；关闭 = 跨目录打散
        const queue = buildThumbQueue(needThumb, cfg.cacheSequential)

        const W = Math.max(
          1,
          Math.min(pickThumbWorkerCount(cfg.thumbWorkers), needThumb.length, 8)
        )

        let cursor = 0
        let inflightMP = 0
        const inflightGroups = new Set() // 每个元素是一个“已派发待完成”的批（数组）
        const waiters = []
        let stopped = false

        const wakeWaiters = () => {
          const list = waiters.splice(0)
          for (const r of list) r()
        }
        const releaseGroup = (group) => {
          if (!inflightGroups.delete(group)) return
          let mp = 0
          for (const j of group) mp += j.estMP || 0
          inflightMP -= mp
          wakeWaiters()
        }

        // 一批任务的选取：小图尽量凑满 cfg.thumbBatch 张（且批内总像素有限制）；
        // 预估 ≥ HEAVY_MP 的超大图“单飞”，避免拖住同批其它小图。
        const buildGroup = () => {
          if (stopped || cursor >= queue.length) return null
          const first = queue[cursor]
          cursor++
          if ((first.estMP || 0) >= HEAVY_MP) return [first]
          const group = [first]
          let mp = first.estMP || 0
          while (group.length < cfg.thumbBatch && cursor < queue.length) {
            const c = queue[cursor]
            if ((c.estMP || 0) >= HEAVY_MP) break
            if (mp + (c.estMP || 0) > maxInflightMP()) break
            group.push(c)
            mp += c.estMP || 0
            cursor++
          }
          return group
        }

        // 取下一批可派发任务：超出「同时解码像素」预算就等待（超大图自动降并发）
        const nextGroup = async () => {
          while (true) {
            if (stopped || cursor >= queue.length) return null
            const g = buildGroup()
            if (!g) return null
            let mp = 0
            for (const j of g) mp += j.estMP || 0
            if (inflightGroups.size === 0 || inflightMP + mp <= maxInflightMP()) {
              inflightGroups.add(g)
              inflightMP += mp
              return g
            }
            cursor -= g.length // 放回，等内存释放后重取
            await new Promise((res) => waiters.push(res))
          }
        }

        // 让一个 worker 处理一批任务；返回 'ok' | 'crash' | 'timeout'
        const runOne = (wk, group) =>
          new Promise((resolve) => {
            let groupDone = 0 // 本批已完成数（超时只丢剩余）
            let finished = false
            let timer = null
            const cleanup = () => {
              clearTimeout(timer)
              wk.removeListener('message', onMsg)
              wk.removeListener('error', onErr)
              wk.removeListener('exit', onExit)
            }
            const finish = (mode) => {
              if (finished) return
              finished = true
              cleanup()
              resolve(mode)
            }
            const maybeProgress = () => {
              if (done % 5 === 0 || done === total) {
                onProgress({ phase: 'thumb', done, total, current: lastCurrent })
              }
            }
            const countFailures = (extra) => {
              if (extra > 0) {
                stats.failed += extra
                done += extra
                maybeProgress()
              }
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
                groupDone++
                lastCurrent = m.name || lastCurrent
                maybeProgress()
              } else if (m.type === 'thumb-fail') {
                stats.failed++
                done++
                groupDone++
                lastCurrent = m.name || lastCurrent
                maybeProgress()
              } else if (m.type === 'thumb-done-all') {
                finish('ok')
              } else if (m.type === 'error') {
                countFailures(group.length - groupDone)
                finish('crash')
              }
            }
            const onErr = () => {
              countFailures(group.length - groupDone)
              finish('crash')
            }
            const onExit = () => {
              countFailures(group.length - groupDone)
              finish('crash')
            }
            // 单批超时保护：worker 卡死（未崩溃也未返回）则只丢该批剩余
            timer = setTimeout(() => {
              const remaining = group.length - groupDone
              if (remaining > 0) {
                console.error(`[cache] thumb batch timeout after ${cfg.thumbTimeout}ms, skipping ${remaining} jobs`)
              }
              countFailures(remaining)
              finish('timeout')
            }, cfg.thumbTimeout)
            wk.on('message', onMsg)
            wk.on('error', onErr)
            wk.on('exit', onExit)
            wk.postMessage({
              type: 'thumb',
              jobs: group,
              thumbDir,
              thumbWidth: cfg.thumbWidth,
              thumbQuality: cfg.thumbQuality,
              thumbSlowMs: cfg.thumbSlowMs
            })
          })

        const runSlot = async () => {
          let wk = spawnCacheWorker()
          let sinceSpawn = 0 // 当前 worker 已处理的图数量（用于周期重启，防堆膨胀 GC）
          try {
            while (true) {
              const group = await nextGroup()
              if (!group) break
              const mode = await runOne(wk, group)
              releaseGroup(group)
              sinceSpawn += group.length
              if (mode === 'crash' || mode === 'timeout') {
                // 该 worker 状态未知（崩溃/卡死），换一个新的继续队列
                try {
                  wk.terminate().catch(() => {})
                } catch {
                  /* ignore */
                }
                wk = spawnCacheWorker()
                sinceSpawn = 0
              } else if (sinceSpawn >= WORKER_RESTART_JOBS) {
                // 周期性重启：清空累积的老生代，避免巨型 STW GC 把任务记成几十秒
                try {
                  wk.terminate().catch(() => {})
                } catch {
                  /* ignore */
                }
                wk = spawnCacheWorker()
                sinceSpawn = 0
              }
              if (aborted || shouldAbort?.()) {
                stopped = true
                wakeWaiters()
              }
            }
          } finally {
            try {
              wk.terminate().catch(() => {})
            } catch {
              /* ignore */
            }
          }
        }

        const slotCount = Math.max(1, Math.min(W, queue.length))
        await Promise.all(Array.from({ length: slotCount }, () => runSlot()))
        checkAbort()
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

    // 维护会增删缩略图：清空该根目录的内存索引，让协议重查
    invalidateThumbIndex(root.path)

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
        invalidateThumbIndex(root.path)
        console.log('[cache] task promise resolved, sending done once, stats =', JSON.stringify(stats))
        send({ done: true, stats })
      })
      .catch((err) => {
        invalidateThumbIndex(root.path)
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
      primeThumbIndex(cache, root, rows)
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
      primeThumbIndex(cache, root, rows)
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
            // 走内存索引（命中跳过 DB 查询与磁盘探测），维护任务时会失效重查
            const thumbPath = resolveThumb(cache, root, absPath)
            if (thumbPath) {
              file = thumbPath
              thumbServed = true
            }
          }
        }
      }

      // 单次 stat 同时完成存在性检查与取大小（避免原来的 existsSync + stat 两次 syscall）。
      // 命中缩略图但文件缺失（如被手动删除）时回退原图一次，避免 404 破图。
      let st
      try {
        st = await fsp.stat(file)
      } catch {
        if (thumbServed && file !== absPath) {
          file = absPath
          thumbServed = false
          try {
            st = await fsp.stat(file)
          } catch {
            return new Response('not found', { status: 404 })
          }
        } else {
          return new Response('not found', { status: 404 })
        }
      }
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
