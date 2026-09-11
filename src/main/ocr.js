import { Worker } from 'node:worker_threads'
import { join } from 'path'
import { createRequire } from 'module'
import { getRoot } from './roots'
import { openRootCache } from './cache'
import { broadcast } from './windows'
import { ScanAbortedError } from './fs-scan.mjs'
import {
  isAddonInstalled,
  getAddonNodeModules,
  getAddonStatus,
  getAddonDownloadUrl,
  installAddonFromUrl,
  pickAndInstallAddon,
  removeAddon,
  emitAddonProgress
} from './ocr-addon'

/**
 * OCR 图内文字搜索（PaddleOCR，可选依赖）
 *
 * 模型随包内置（@repeato/ocr），但 onnxruntime/sharp 运行时按需下载 → 见 ocr-addon.js。
 * 运行时未就绪时 `checkOcrAvailable()` 返回 false，索引维护给出明确提示。
 *
 *   1. 索引维护（ocr:index）：对根目录缓存中的每张图片用 OCR 识别文字，
 *      存入该根目录 .image_browser_cache/cache.db 的 ocr_text 表。
 *   2. 搜索：已并入 cache.js 的 images:list —— 文件名命中与 ocr_text.text
 *      命中合并去重、按权重排序返回（主界面搜索框回车即触发，无需开关）。
 *
 * 三种维护模式：
 *   update  增量：为新增/变更（mtime 不同）的图片补建文字识别
 *   rebuild 全量：清空 ocr_text，重新为全部图片识别
 *   clean   清理：仅移除源文件已不存在的失效记录
 *
 * 重活（OCR 推理）在 ocr-worker.mjs 线程内执行；模型较重在 worker 内
 * 懒加载并复用于整批，任务结束 terminate 并释放 ONNX 会话。
 */

const OCROCR_BATCH = 20

/**
 * OCR 是否可用：@repeato/ocr（含模型）随包内置，
 * 但体积巨大的 ONNX Runtime + sharp 需先通过「模型管理」下载/导入。
 */
export function checkOcrAvailable() {
  const require = createRequire(import.meta.url)
  try {
    require.resolve('@repeato/ocr')
  } catch {
    return false
  }
  // 运行时（onnxruntime + sharp）：已下载 addon，或开发环境下 node_modules 直接可用
  if (isAddonInstalled()) return true
  try {
    require.resolve('onnxruntime-node')
    require.resolve('sharp')
    return true
  } catch {
    return false
  }
}

function spawnOcrWorker() {
  const opts = {
    resourceLimits: {
      // OCR 模型 + 图片预处理需要一定堆；上限给足避免大图推理时 OOM
      maxOldGenerationSizeMb: 2048,
      maxYoungGenerationSizeMb: 256,
      stackSizeMb: 8
    }
  }
  // 运行时 addon 解压在 userData：worker 内用同步 resolve 钩子把
  // onnxruntime-node / sharp 等原生依赖重定向到该目录（见 ocr-worker.mjs）
  if (isAddonInstalled()) {
    const addonNm = getAddonNodeModules()
    opts.env = { ...process.env, OCR_ADDON_NODE_MODULES: addonNm, NODE_PATH: addonNm }
  }
  const worker = new Worker(join(__dirname, 'ocr-worker.js'), opts)
  worker.on('error', (err) => {
    console.error('[ocr] worker error:', err)
  })
  return worker
}

function ensureOcrTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ocr_text (
      abs_path   TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      folder     TEXT NOT NULL,
      text       TEXT NOT NULL,
      src_mtime  INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
}

function metaSet(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}

/**
 * 执行 OCR 索引维护任务
 * @param {{id:number, path:string, alias?:string}} root
 * @param {'update'|'rebuild'|'clean'} mode
 * @param {(p: object) => void} opts.onProgress
 * @param {() => boolean} opts.shouldAbort
 */
export async function runOcrIndexTask(root, mode, { onProgress = () => {}, shouldAbort } = {}) {
  if (!checkOcrAvailable()) {
    const err = new Error('未安装 OCR 依赖（@repeato/ocr), 请先执行 `npm install @repeato/ocr sharp`')
    err.code = 'OCR_UNINSTALLED'
    throw err
  }

  const cache = openRootCache(root.path, { create: true })
  const { db } = cache
  ensureOcrTable(db)

  const stats = { mode, count: 0, removed: 0, failed: 0, uninstalled: 0 }
  const nowMs = Date.now()
  const files = db.prepare('SELECT abs_path, name, folder, mtime FROM files').all()
  const fileSet = new Set(files.map((f) => f.abs_path))

  const delStmt = db.prepare('DELETE FROM ocr_text WHERE abs_path = ?')

  if (mode === 'clean') {
    const rows = db.prepare('SELECT abs_path FROM ocr_text').all()
    for (const r of rows) {
      if (shouldAbort?.()) throw new ScanAbortedError()
      if (!fileSet.has(r.abs_path)) {
        delStmt.run(r.abs_path)
        stats.removed++
      }
    }
    metaSet(db, 'ocr_last_task', mode)
    metaSet(db, 'ocr_last_task_at', new Date().toISOString())
    onProgress({ phase: 'done' })
    return stats
  }

  if (mode === 'rebuild') {
    db.exec('DELETE FROM ocr_text')
  }

  const existing = db.prepare('SELECT abs_path, src_mtime FROM ocr_text').all()
  const existingMap = new Map(existing.map((r) => [r.abs_path, r.src_mtime]))

  const need = []
  for (const f of files) {
    const prev = existingMap.get(f.abs_path)
    if (prev === undefined || prev !== f.mtime) need.push(f)
  }

  for (const [abs] of existingMap) {
    if (!fileSet.has(abs)) {
      delStmt.run(abs)
      stats.removed++
    }
  }

  const upsertStmt = db.prepare(
    `INSERT INTO ocr_text (abs_path, name, folder, text, src_mtime, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(abs_path) DO UPDATE SET
       name=excluded.name, folder=excluded.folder, text=excluded.text,
       src_mtime=excluded.src_mtime, updated_at=excluded.updated_at`
  )

  const total = need.length
  let done = 0
  let uninstalled = false

  const worker = spawnOcrWorker()
  let abortedTimer = null
  const abortedState = { aborted: false }
  const checkAbort = () => {
    if (abortedState.aborted || shouldAbort?.()) throw new ScanAbortedError()
  }

  try {
    // 后台监视中止标志；任务结束/出错时清除
    abortedTimer = setInterval(() => {
      if (shouldAbort?.()) abortedState.aborted = true
    }, 200)

    // 每批与 worker 通信一次，批内逐条回写
    for (let i = 0; i < need.length; i += OCROCR_BATCH) {
      checkAbort()
      const batch = need.slice(i, i + OCROCR_BATCH)
      await runOcrBatch(worker, batch, {
        upsertStmt,
        stats,
        createdAt: nowMs,
        onFailure: (j) => {
          if (j.uninstalled) uninstalled = true
        }
      })
      done += batch.length
      onProgress({ phase: 'ocr', done, total, current: batch[batch.length - 1].name })
      if (uninstalled) break // 依赖缺失时整批全失败，无需继续空跑
      checkAbort()
    }

    if (uninstalled) {
      const err = new Error('未安装 OCR 依赖（@repeato/ocr），且已安装的图片识别已回退处理')
      err.code = 'OCR_UNINSTALLED'
      throw err
    }
  } catch (err) {
    if (abortedState.aborted || shouldAbort?.() || err instanceof ScanAbortedError) {
      throw new ScanAbortedError()
    }
    throw err
  } finally {
    clearInterval(abortedTimer)
    // 先释放 ONNX 会话再终止线程，避免原生对象在 GC 时崩溃
    await releaseWorker(worker)
  }

  metaSet(db, 'ocr_last_task', mode)
  metaSet(db, 'ocr_last_task_at', new Date().toISOString())
  onProgress({ phase: 'done' })
  console.log('[ocr] index task finished, stats =', JSON.stringify(stats))
  return stats
}

/** 发送一批 OCR 任务给 worker，逐条回写结果；返回 Promise（批结束 resolve） */
function runOcrBatch(worker, jobs, { upsertStmt, stats, onFailure, createdAt }) {
  return new Promise((resolve, reject) => {
    let pending = jobs.length
    let settled = false
    const jobsByAbs = new Map(jobs.map((j) => [j.abs_path, j]))
    const finish = (err) => {
      if (settled) return
      settled = true
      cleanup()
      if (err) reject(err)
      else resolve()
    }
    const onMsg = (m) => {
      if (m.type === 'ocr-done') {
        const job = jobsByAbs.get(m.id)
        if (job) {
          upsertStmt.run(m.id, job.name, job.folder, m.text, job.mtime, createdAt, createdAt)
        }
        stats.count++
        pending--
      } else if (m.type === 'ocr-fail') {
        stats.failed++
        onFailure?.(m)
        pending--
      } else if (m.type === 'ocr-done-all') {
        finish()
      } else if (m.type === 'error') {
        finish(new Error(m.message))
      }
    }
    const onErr = (err) => finish(err)
    const cleanup = () => {
      worker.removeListener('message', onMsg)
      worker.removeListener('error', onErr)
    }
    worker.on('message', onMsg)
    worker.on('error', onErr)
    worker.postMessage({
      type: 'ocr',
      jobs: jobs.map((j) => ({
        id: j.abs_path,
        absPath: j.abs_path,
        name: j.name
      }))
    })
  })
}

async function releaseWorker(worker) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {}).finally(resolve)
    }, 3000)
    try {
      worker.postMessage({ type: 'release' })
    } catch {
      clearTimeout(timer)
      worker.terminate().catch(() => {}).finally(resolve)
      return
    }
    // 等 release 处理完再 terminate
    const onExit = () => {
      clearTimeout(timer)
      resolve()
    }
    worker.once('exit', onExit)
    // 兜底：若 release 后未及时退出，超时 terminate
    const timer2 = setTimeout(() => {
      worker.terminate().catch(() => {})
    }, 8000)
    worker.once('exit', () => clearTimeout(timer2))
  })
}

// ---------------------------------------------------------------- IPC

let ocrTaskController = null

export function registerOcrIpc({ ipcMain }) {
  ipcMain.handle('ocr:check', () => {
    return {
      available: checkOcrAvailable(),
      running: !!ocrTaskController && !ocrTaskController.signal.aborted,
      rootId: ocrTaskController?.rootId
    }
  })

  // ---------------- 运行时组件（onnxruntime + sharp）管理 ----------------
  ipcMain.handle('ocr:addon-status', () => getAddonStatus())

  ipcMain.handle('ocr:addon-download', async (_e, url) => {
    try {
      await installAddonFromUrl(url || getAddonDownloadUrl(), (p) => emitAddonProgress(p.phase, p))
      return { ok: true }
    } catch (err) {
      emitAddonProgress('error', { message: String(err?.message || err) })
      return { ok: false, error: String(err?.message || err) }
    }
  })

  ipcMain.handle('ocr:addon-import', async () => {
    try {
      const r = await pickAndInstallAddon((p) => emitAddonProgress(p.phase, p))
      return { ok: true, ...r }
    } catch (err) {
      emitAddonProgress('error', { message: String(err?.message || err) })
      return { ok: false, error: String(err?.message || err) }
    }
  })

  ipcMain.handle('ocr:addon-remove', async () => {
    try {
      await removeAddon()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err?.message || err) }
    }
  })

  ipcMain.handle('ocr:index', async (e, rootId, mode) => {
    const root = getRoot(rootId)
    if (!root) throw new Error('根目录不存在')
    if (!['update', 'rebuild', 'clean'].includes(mode)) {
      throw new Error('未知维护模式: ' + mode)
    }
    if (!checkOcrAvailable()) {
      const err = new Error('未安装 OCR 运行时组件，请先在「模型管理」中下载或导入')
      err.code = 'OCR_UNINSTALLED'
      throw err
    }

    ocrTaskController?.abort()
    const ac = new AbortController()
    ocrTaskController = ac
    ocrTaskController.rootId = rootId

    let lastEmit = 0
    const MIN_EMIT_INTERVAL = 120
    const send = (payload) => {
      const now = Date.now()
      const forced = payload.done === true || payload.aborted || payload.error
      if (!forced && now - lastEmit < MIN_EMIT_INTERVAL) return
      lastEmit = now
      broadcast('ocr:progress', { rootId, rootPath: root.path, ...payload })
    }

    runOcrIndexTask(root, mode, {
      onProgress: (p) => send(p),
      shouldAbort: () => ac.signal.aborted
    })
      .then((stats) => {
        send({ done: true, stats })
      })
      .catch((err) => {
        if (ac.signal.aborted || err instanceof ScanAbortedError) {
          send({ aborted: true })
        } else {
          console.error('[ocr] task failed:', err)
          send({ error: String(err?.message || err), code: err?.code })
        }
      })

    return { started: true }
  })

  ipcMain.handle('ocr:abort', () => {
    ocrTaskController?.abort()
    return true
  })

  ipcMain.handle('ocr:status', () => {
    return {
      running: !!ocrTaskController && !ocrTaskController.signal.aborted,
      rootId: ocrTaskController?.rootId
    }
  })
}
