import { promises as fsp, createWriteStream } from 'fs'
import { join, relative, extname, dirname } from 'path'
import { pipeline } from 'stream/promises'
import { getRoot, listRoots } from '../roots'
import { getProvider, isRemoteRoot } from '../storage'
import { ensureRemoteCache } from '../storage/cache-sync'
import { absFromRel, baseName, extName, joinPath, relFromRoot } from '../storage/path-utils'
import { broadcast } from '../windows'
import { handleWorkerLog } from '../logger'
import { ScanAbortedError } from '../fs-scan.mjs'
import {
  CACHE_DIR_NAME,
  GIF_NAME_RE,
  IMAGE_EXTS,
  VIDEO_EXTS,
  isSkipDir
} from '../scan-constants.mjs'
import { metaGet, metaSet, prep as prepCache } from '../cache-db-utils.mjs'
import { mapLimit } from '../concurrency.mjs'
import { buildNameMatcher, mergeSearchResults, ocrTextMatches, wildcardToRegex } from './search'
import { getCacheConfig } from './config'
import { openRootCache } from './connection'
import { invalidateThumbIndex, primeThumbIndex } from './thumb-index'
import {
  HEAVY_MP,
  WORKER_RESTART_JOBS,
  buildThumbQueue,
  maxInflightMP,
  pickThumbWorkerCount,
  rebuildFolderShas,
  spawnCacheWorker
} from './workers'
import { resolveCliExe, runCliThumbStage } from './cli-thumb'
import { mpOf, probeImageSizeAsync, webpDimsFromFile } from './image-size'

/**
 * 缓存维护任务、列表/搜索与 IPC。从 cache.js 拆出。
 */

// ---------------------------------------------------------------- 扫描/列表

/**
 * 递归遍历目录树的图片/媒体文件（本地与远程 Provider 通用）。
 * - 迭代式（显式栈）避免超深目录爆栈；跳过系统/隐藏目录。
 * - 逐文件 stat 确认存在，yield { absPath, name, dir, size, mtime }。
 * - skipCacheDir=true 时额外跳过缓存目录；filter(name) 可做文件名筛选。
 * - shouldAbort() 为真时抛 ScanAbortedError。
 */
async function* walkImageFiles(
  rootPath,
  { provider, shouldAbort, skipCacheDir = false, filter } = {}
) {
  const pv = provider || getProvider('local')
  const stack = [rootPath]
  while (stack.length) {
    if (shouldAbort?.()) throw new ScanAbortedError()
    const dir = stack.pop()
    let entries
    try {
      entries = await pv.list(dir)
    } catch {
      continue // 无权限/不存在则跳过
    }
    for (const entry of entries) {
      if (shouldAbort?.()) throw new ScanAbortedError()
      const name = entry.name
      if (skipCacheDir && name === CACHE_DIR_NAME) continue
      const absPath = joinPath(dir, name)
      if (entry.isDir) {
        if (!isSkipDir(name)) stack.push(absPath)
        continue
      }
      if (!entry.isFile) continue
      if (!IMAGE_EXTS.has(extName(name))) continue
      if (filter && !filter(name)) continue
      // 目录列表已带 size（如 WebDAV）时直接使用，省去每个文件一次 stat 往返
      let size = entry.size
      let mtime = entry.mtimeMs
      if (typeof size !== 'number') {
        const st = await pv.stat(absPath)
        if (!st || !st.isFile) continue
        size = st.size
        mtime = st.mtimeMs
      }
      yield { absPath, name, dir, size: size || 0, mtime: mtime || 0 }
    }
  }
}

/** 不建缓存时快速递归列出目录图片（含子文件夹，不带尺寸） */
export async function listFolderQuick(folderAbsPath, provider = getProvider('local')) {
  const out = []
  for await (const e of walkImageFiles(folderAbsPath, { provider })) {
    out.push({
      absPath: e.absPath,
      name: e.name,
      width: null,
      height: null,
      hasThumb: false,
      size: e.size
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
}

/**
 * 远程根（或任意 Provider）递归扫描图片：在主进程内经 provider.list/stat 完成。
 * 本地根仍走 Worker 扫描（避免阻塞主进程），此函数仅供远程根使用。
 */
async function scanImagesViaProvider(root, provider, scanBatch, onProgress, shouldAbort) {
  const out = []
  for await (const e of walkImageFiles(root.path, { provider, shouldAbort, skipCacheDir: true })) {
    out.push({
      absPath: e.absPath,
      relPath: relFromRoot(root.path, e.absPath),
      folder: relFromRoot(root.path, e.dir),
      name: e.name,
      size: e.size,
      mtime: Math.floor(e.mtime)
    })
    if (scanBatch && out.length % scanBatch === 0) {
      onProgress({ phase: 'scan', scanned: out.length })
    }
  }
  return out
}

/** 无缓存时按文件名模式快速递归搜索根目录图片 */
async function searchImagesQuick(rootPath, re, provider = getProvider('local')) {
  const out = []
  for await (const e of walkImageFiles(rootPath, { provider, filter: (name) => re.test(name) })) {
    out.push({
      absPath: e.absPath,
      name: e.name,
      width: null,
      height: null,
      hasThumb: false,
      size: e.size
    })
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
async function scanCacheIntoIndex({ db, thumbDir, root, provider, onProgress, shouldAbort }) {
  const stats = {
    mode: 'scan-cache',
    added: 0,
    updated: 0,
    removed: 0,
    thumbs: 0,
    failed: 0,
    cleanedThumbs: 0
  }
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
    `INSERT INTO files (abs_path, rel_path, name, folder, size, mtime, width, height, thumb, thumb_size, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const updateThumbStmt = db.prepare(
    `UPDATE files SET thumb=?, width=?, height=?, thumb_size=?, updated_at=? WHERE abs_path=?`
  )
  const deleteStmt = db.prepare('DELETE FROM files WHERE abs_path = ?')

  let processed = 0
  let reported = 0
  // 源图 stat 与缩略图头部读取都按批并发，避免逐张串行等待磁盘
  const CONC = 16
  db.exec('BEGIN')
  try {
    for (let i = 0; i < thumbs.length; i += CONC) {
      if (shouldAbort?.()) throw new ScanAbortedError()
      const chunk = thumbs.slice(i, i + CONC)
      const metas = await mapLimit(chunk, CONC, async (thumbAbs) => {
        if (shouldAbort?.()) throw new ScanAbortedError()
        // 相对 image_cache 的路径（/ 分隔），如 相册/风景/photo.jpg.webp
        const relThumb = relative(thumbDir, thumbAbs)
          .split(/[\\/]+/)
          .join('/')
        // 镜像路径还原源图相对路径：去掉末尾 .webp
        const srcRel = relThumb.slice(0, -'.webp'.length)
        const srcAbs = absFromRel(root.path, srcRel)
        const st = await provider.stat(srcAbs)
        if (!st || !st.isFile) return { thumbAbs, srcAbs, orphan: true }
        const dim = await webpDimsFromFile(thumbAbs)
        return { thumbAbs, srcAbs, srcRel, relThumb, st, dim }
      })
      for (const m of metas) {
        if (m.orphan) {
          // 源图已不存在 → 孤儿缩略图，删除并移除对应索引
          await fsp.rm(m.thumbAbs, { force: true })
          stats.cleanedThumbs++
          if (dbByAbs.has(m.srcAbs)) {
            deleteStmt.run(m.srcAbs)
            dbByAbs.delete(m.srcAbs)
          }
          processed++
          continue
        }
        const folder = m.srcRel.includes('/') ? m.srcRel.slice(0, m.srcRel.lastIndexOf('/')) : ''
        const row = dbByAbs.get(m.srcAbs)
        if (!row) {
          insertStmt.run(
            m.srcAbs,
            m.srcRel,
            baseName(m.srcAbs),
            folder,
            m.st.size,
            Math.floor(m.st.mtimeMs),
            m.dim?.w ?? null,
            m.dim?.h ?? null,
            m.relThumb,
            m.dim?.size ?? null,
            nowMs,
            nowMs
          )
          dbByAbs.set(m.srcAbs, { abs_path: m.srcAbs, thumb: m.relThumb })
          stats.added++
        } else if (!row.thumb) {
          updateThumbStmt.run(
            m.relThumb,
            m.dim?.w ?? null,
            m.dim?.h ?? null,
            m.dim?.size ?? null,
            nowMs,
            m.srcAbs
          )
          row.thumb = m.relThumb
          stats.updated++
        }
        stats.thumbs++
        processed++
      }
      if (processed - reported >= 200) {
        reported = processed
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
  const provider = getProvider(root)
  // 远程根：维护前先同步远程缓存库到本地工作库
  if (isRemoteRoot(root)) {
    try {
      await ensureRemoteCache(root)
    } catch (err) {
      console.warn('[cache] ensureRemoteCache failed:', err?.message || err)
    }
  }
  const cache = openRootCache(root, { create: true })
  const { db, thumbDir } = cache
  const stats = { mode, added: 0, updated: 0, removed: 0, thumbs: 0, failed: 0, cleanedThumbs: 0 }

  // --- scan-cache：扫描缓存文件夹，把已生成的缩略图计入索引（无需 worker） ---
  if (mode === 'scan-cache') {
    const scanStats = await scanCacheIntoIndex({
      db,
      thumbDir,
      root,
      provider,
      onProgress,
      shouldAbort
    })
    await rebuildFolderShas(cache)
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

  let stagingRoot = null

  try {
    // --- 1. 扫描磁盘：本地走 Worker，远程走 Provider（主进程内） ---
    onProgress({ phase: 'scan', scanned: 0 })
    let files = isRemoteRoot(root)
      ? await scanImagesViaProvider(root, provider, cfg.scanBatch, onProgress, shouldAbort)
      : await new Promise((resolve, reject) => {
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

    let diskByAbs = new Map(files.map((f) => [f.absPath, f]))

    const nowMs = Date.now()
    // 只取差异阶段需要的列（避免 SELECT * 全列驻留）
    let existing = db.prepare('SELECT id, abs_path, mtime, size, thumb FROM files').all()
    let dbByAbs = new Map(existing.map((r) => [r.abs_path, r]))

    // 需要重新生成缩略图的（新增/变更/上次失败）
    const needThumb = []

    if (mode !== 'clean') {
      const insertStmt = db.prepare(
        `INSERT INTO files (abs_path, rel_path, name, folder, size, mtime, width, height, thumb, thumb_size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const updateStmt = db.prepare(
        `UPDATE files SET name=?, folder=?, size=?, mtime=?, updated_at=? WHERE abs_path=?`
      )
      const clearThumbStmt = db.prepare(
        `UPDATE files SET thumb=NULL, thumb_size=NULL WHERE abs_path=?`
      )
      const deleteStmt = db.prepare('DELETE FROM files WHERE abs_path = ?')

      // 批量写入包进事务：逐条 autocommit 会触发大量 fsync，3 万图可卡住主进程上百秒
      let goneThumbs = []
      db.exec('BEGIN')
      try {
        for (const f of files) {
          const row = dbByAbs.get(f.absPath)
          if (!row) {
            const info = insertStmt.run(
              f.absPath,
              f.relPath,
              f.name,
              f.folder,
              f.size,
              f.mtime,
              null,
              null,
              null,
              null,
              nowMs,
              nowMs
            )
            const isGif = GIF_NAME_RE.test(f.name)
            const isVideo = VIDEO_EXTS.has(extname(f.name).toLowerCase())
            // 「实时获取」开启时 GIF 首帧不落盘；视频一律不落盘（首帧实时取）
            if (!isVideo && !(cfg.gifRealtime && isGif)) {
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
            if (
              !VIDEO_EXTS.has(extname(f.name).toLowerCase()) &&
              !(cfg.gifRealtime && GIF_NAME_RE.test(f.name))
            ) {
              needThumb.push({ id: row.id, absPath: f.absPath, relPath: f.relPath, name: f.name })
            }
            stats.updated++
          } else if (!row.thumb) {
            // 索引在但缩略图缺失（上次失败/旧版平铺缓存）→ 重试
            // 「实时获取」开启时 GIF 首帧不落盘，跳过，避免每次维护都重试；视频同理
            if (
              !VIDEO_EXTS.has(extname(f.name).toLowerCase()) &&
              !(cfg.gifRealtime && GIF_NAME_RE.test(f.name))
            ) {
              needThumb.push({ id: row.id, absPath: f.absPath, relPath: f.relPath, name: f.name })
            }
          }
        }

        // 磁盘上已消失的记录：先删索引，缩略图文件删除延后到事务提交后，
        // 避免在事务内 await 文件 I/O（拉长写锁 / 大 WAL）
        const gone = existing.filter((r) => !diskByAbs.has(r.abs_path))
        for (const row of gone) {
          deleteStmt.run(row.abs_path)
          if (row.thumb) goneThumbs.push(row.thumb)
          stats.removed++
        }
      } finally {
        db.exec('COMMIT')
      }
      for (const rel of goneThumbs) {
        await fsp.rm(join(thumbDir, rel), { force: true })
      }
    }
    console.log(
      '[cache] db update done, stats =',
      JSON.stringify(stats),
      'needThumb =',
      needThumb.length
    )

    // 差异阶段的大对象在缩略图生成前释放：重建十万级图库时可省下数十~上百 MB 常驻内存
    files = null
    diskByAbs = null
    existing = null
    dbByAbs = null

    // --- 2. 生成缩略图：优先外部转换器（image_compressor.exe），否则走 worker 池 ---
    // 外部转换器仅支持本地目录，远程根强制走内置 Worker
    const cliExe = cfg.cacheUseCli && !isRemoteRoot(root) ? resolveCliExe(cfg.cacheCliExe) : null
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
      // 远程根：先把源图流式下载到本地临时区，供 Worker 解码（Worker 只读本地文件）
      if (isRemoteRoot(root)) {
        stagingRoot = join(cache.cacheDir, '.staging')
        await fsp.rm(stagingRoot, { recursive: true, force: true })
        await fsp.mkdir(stagingRoot, { recursive: true })
        onProgress({ phase: 'thumb', done: 0, total: needThumb.length, current: '下载远程原图' })
        for (const job of needThumb) {
          if (aborted || shouldAbort?.()) throw new ScanAbortedError()
          const rel = job.relPath || relFromRoot(root.path, job.absPath)
          const tmp = join(stagingRoot, ...rel.split('/'))
          await fsp.mkdir(dirname(tmp), { recursive: true })
          await pipeline(provider.createReadStream(job.absPath), createWriteStream(tmp))
          job.absPath = tmp
        }
      }
      const total = needThumb.length
      let done = 0
      let lastCurrent = ''

      const updateThumbStmt = db.prepare(
        'UPDATE files SET thumb=?, width=?, height=?, thumb_size=?, updated_at=? WHERE id=?'
      )

      // 预估每张图的解码像素（内存预算调度用）。只读文件头，但改为异步 + 并发，
      // 避免重建几十万图时在主进程做大量同步 read 阻塞事件循环。
      let heavyCount = 0
      await mapLimit(needThumb, 32, async (job) => {
        job.estMP = mpOf(await probeImageSizeAsync(job.absPath))
      })
      for (const job of needThumb) {
        if ((job.estMP || 0) >= HEAVY_MP) heavyCount++
      }
      console.log(`[cache] thumb mp-probe done, heavy(>=${HEAVY_MP}MP)=${heavyCount}`)

      // 缩略图状态回写也包进事务，避免逐条 fsync 卡住主进程
      db.exec('BEGIN')
      try {
        // 任务队列：开关打开 = 保持扫描顺序（连续读，机械硬盘友好）；关闭 = 跨目录打散
        const queue = buildThumbQueue(needThumb, cfg.cacheSequential)

        const W = Math.max(1, Math.min(pickThumbWorkerCount(cfg.thumbWorkers), needThumb.length, 8))

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
                updateThumbStmt.run(m.relThumb, m.width, m.height, m.size ?? null, Date.now(), m.id)
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
                console.error(
                  `[cache] thumb batch timeout after ${cfg.thumbTimeout}ms, skipping ${remaining} jobs`
                )
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
      const rows = db.prepare('SELECT abs_path, rel_path, thumb FROM files').all()
      const delStmt = db.prepare('DELETE FROM files WHERE abs_path = ?')
      let removedRows = 0
      // 源图存在性探测按批并发，磁盘往返不再逐张串行
      const CLEAN_CONC = 24
      for (let i = 0; i < rows.length; i += CLEAN_CONC) {
        checkAbort()
        const chunk = rows.slice(i, i + CLEAN_CONC)
        const results = await mapLimit(chunk, CLEAN_CONC, async (row) => {
          if (shouldAbort?.()) throw new ScanAbortedError()
          const abs = absFromRel(root.path, row.rel_path || relFromRoot(root.path, row.abs_path))
          const st = await provider.stat(abs)
          return { row, gone: !st || !st.isFile }
        })
        for (const { row, gone } of results) {
          if (!gone) continue
          delStmt.run(row.abs_path)
          if (row.thumb) await fsp.rm(join(thumbDir, row.thumb), { force: true })
          removedRows++
        }
      }
      stats.removed += removedRows

      // 扫描 image_cache，删除索引外的孤儿缩略图
      const validThumbs = new Set(
        db
          .prepare('SELECT thumb FROM files WHERE thumb IS NOT NULL')
          .all()
          .map((r) => r.thumb)
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
            const rel = relative(thumbDir, full)
              .split(/[\\/]+/)
              .join('/')
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
    if (stagingRoot) {
      await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
    }
  }

  await rebuildFolderShas(cache)
  metaSet(db, 'last_task', mode)
  metaSet(db, 'last_task_at', new Date().toISOString())
  onProgress({ phase: 'done' })
  console.log('[cache] task finished, stats =', JSON.stringify(stats))
  return stats
}

// ---------------------------------------------------------------- 缓存概况

/**
 * 汇总各根目录的缓存概况（供「设置 - 根目录」展示）。
 * 只对各自 cache.db 做聚合查询（COUNT/SUM），不遍历磁盘，代价很低。
 * - srcBytes：已索引媒体的原始字节数
 * - thumbBytes：已缓存缩略图字节数（thumb_size，旧库未回填前可能偏低）
 */
export function getCacheStats() {
  return listRoots().map((root) => {
    const base = {
      rootId: root.id,
      hasCache: false,
      total: 0,
      cached: 0,
      srcBytes: 0,
      thumbBytes: 0,
      folderCount: 0,
      lastTaskAt: null
    }
    let cache = null
    try {
      cache = openRootCache(root, { create: false })
    } catch {
      cache = null
    }
    if (!cache) return base

    const { db } = cache
    let row = { total: 0, cached: 0, srcBytes: 0, thumbBytes: 0 }
    try {
      row = prepCache(
        db,
        `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN thumb IS NOT NULL THEN 1 ELSE 0 END) AS cached,
             COALESCE(SUM(size), 0) AS srcBytes,
             COALESCE(SUM(CASE WHEN thumb IS NOT NULL THEN thumb_size ELSE 0 END), 0) AS thumbBytes
           FROM files`
      ).get()
    } catch {
      /* 空库/旧库：返回零值 */
    }
    return {
      ...base,
      hasCache: true,
      total: row.total || 0,
      cached: row.cached || 0,
      srcBytes: row.srcBytes || 0,
      thumbBytes: row.thumbBytes || 0,
      folderCount: Number(metaGet(db, 'folder_count', 0)) || 0,
      lastTaskAt: metaGet(db, 'last_task_at', null)
    }
  })
}

// ---------------------------------------------------------------- IPC

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
        console.log(
          '[cache] task promise resolved, sending done once, stats =',
          JSON.stringify(stats)
        )
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
      .finally(() => {
        if (cacheTaskController === ac) cacheTaskController = null
      })

    return { started: true }
  })

  ipcMain.handle('cache:abort', () => {
    cacheTaskController?.abort()
    return true
  })

  ipcMain.handle('cache:status', () => {
    return {
      running: !!cacheTaskController && !cacheTaskController.signal.aborted,
      rootId: cacheTaskController?.rootId
    }
  })

  ipcMain.handle('cache:stats', () => getCacheStats())
}

/**
 * 图片列表：优先读缓存索引（含尺寸/缩略图），无缓存回退即时递归扫描（原图）。
 * 选中文件夹时同时返回其下所有子文件夹的图片（与 PHP 参考版行为一致）。
 * searchQuery 非空时忽略 folderAbsPath，改为跨整个根目录按文件名搜索。
 *
 * 分页：opts.limit > 0 时按 offset 切片返回（大根目录首屏不必一次传输全部行），
 * 返回 { items, total }；总数为筛选后的完整数量，供前端判断是否还有下一页。
 * limit <= 0（默认）时不分页，items 为全部结果（兼容旧行为）。
 *
 * @param {number} rootId
 * @param {string} folderAbsPath
 * @param {string} [searchQuery]
 * @param {{offset?:number, limit?:number}} [opts]
 * @returns {Promise<{items:Array, total:number}>}
 */
export async function handleImagesList(rootId, folderAbsPath, searchQuery, opts = {}) {
  const root = getRoot(rootId)
  if (!root) return { items: [], total: 0 }
  const provider = getProvider(root)
  // abs_path 以 rel_path 为准重建（DB 可移植：远程换挂载点/主机仍可用）
  const absOf = (r) =>
    r.rel_path != null && r.rel_path !== '' ? absFromRel(root.path, r.rel_path) : r.abs_path

  const limit = Number(opts?.limit) > 0 ? Math.floor(Number(opts.limit)) : 0
  const offset = Number(opts?.offset) > 0 ? Math.floor(Number(opts.offset)) : 0
  // 内存切分（搜索/无缓存回退路径用；缓存文件夹列表走 SQL LIMIT/OFFSET 更省）
  const wrap = (all) => ({
    items: limit > 0 ? all.slice(offset, offset + limit) : all,
    total: all.length
  })

  // 远程根：先确保本地工作库与远程缓存一致（下载 DB / 按 SHA 判断）
  if (isRemoteRoot(root)) {
    try {
      await ensureRemoteCache(root)
    } catch (err) {
      console.warn('[cache] ensureRemoteCache failed:', err?.message || err)
    }
  }

  const cache = openRootCache(root, { create: false })
  // 防御：searchQuery/opts 由渲染层传入，类型异常时按空值处理，避免 (query||'').trim 崩溃
  const query = typeof searchQuery === 'string' ? searchQuery : ''
  const matcher = buildNameMatcher(query)

  // --- 搜索模式：跨整个根目录按文件名 +（可选）图内文字匹配 ---
  if (matcher) {
    if (cache) {
      const pattern = (matcher.anchored ? '' : '%') + matcher.like + (matcher.anchored ? '' : '%')
      const nameRows = prepCache(
        cache.db,
        `SELECT abs_path, rel_path, name, width, height, thumb, folder FROM files
           WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE
           ORDER BY folder, name COLLATE NOCASE`
      ).all(pattern)
      const textRows = ocrTextMatches(cache, query)
      const merged = mergeSearchResults(nameRows, textRows, query.trim(), matcher.anchored)
      primeThumbIndex(
        cache,
        root,
        merged.map((m) => m.row)
      )
      return wrap(
        merged.map((m) => ({
          absPath: absOf(m.row),
          name: m.row.name,
          folder: m.row.folder || '',
          width: m.row.width,
          height: m.row.height,
          hasThumb: !!m.row.thumb,
          match: m.match
        }))
      )
    }
    const rows = await searchImagesQuick(root.path, wildcardToRegex(query), provider)
    return wrap(
      rows.map((r) => ({
        absPath: r.absPath,
        name: r.name,
        folder: r.folder || '',
        width: r.width,
        height: r.height,
        hasThumb: !!r.hasThumb,
        match: 'name'
      }))
    )
  }

  // --- 普通文件夹列表 ---
  if (cache) {
    const rel = relFromRoot(root.path, folderAbsPath)
    // 用索引友好的前缀范围替代 `folder LIKE 'rel/%'`：默认排序规则下 LIKE 无法命中索引，
    // 会退化为全表扫描 + 排序。folder 以 '/' 分隔，后代范围为 [rel+'/', rel+'0')。
    const where = rel === '' ? '' : 'WHERE folder = ? OR (folder >= ? AND folder < ?)'
    const params = rel === '' ? [] : [rel, rel + '/', rel + '0']
    // 先取总数：避免「缓存存在但某页为空」时误回退到即时扫描
    const total = Number(
      prepCache(cache.db, `SELECT COUNT(*) AS c FROM files ${where}`).get(...params).c
    )
    if (total > 0) {
      let sql =
        `SELECT abs_path, rel_path, name, width, height, thumb, folder FROM files ${where}` +
        ' ORDER BY folder, name COLLATE NOCASE'
      const qp = params.slice()
      if (limit > 0) {
        sql += ' LIMIT ? OFFSET ?'
        qp.push(limit, offset)
      }
      const rows = prepCache(cache.db, sql).all(...qp)
      primeThumbIndex(cache, root, rows)
      return {
        items: rows.map((r) => ({
          absPath: absOf(r),
          name: r.name,
          folder: r.folder,
          width: r.width,
          height: r.height,
          hasThumb: !!r.thumb
        })),
        total
      }
    }
    // 索引已建立（该根成功跑过维护）时以缓存为准：空文件夹直接返回空。
    // 否则每次访问空目录都会触发整盘递归扫描（大库/远程根下极慢）。
    // 仅当从未成功维护过（无 last_task 记录）才回退即时扫描，供尚未建缓存的根首次浏览。
    if (metaGet(cache.db, 'last_task', null)) {
      return { items: [], total: 0 }
    }
  }
  return wrap(await listFolderQuick(folderAbsPath, provider))
}
