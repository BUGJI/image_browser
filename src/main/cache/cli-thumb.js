import { promises as fsp, existsSync } from 'fs'
import { spawn } from 'child_process'
import { join } from 'path'
import { probeImageSize } from './image-size'

/**
 * 外部转换器（image_compressor.exe）缩略图生成。从 cache.js 拆出。
 */

/** 解析外部转换器 exe 路径：优先用设置值，否则在常见位置探测（dev 项目根/打包 extraResources） */
export function resolveCliExe(configured) {
  if (configured && existsSync(configured)) return configured
  const candidates = [
    join(__dirname, '..', '..', 'image_compressor.exe'), // dev：<proj>/out/main -> <proj>/
    join(__dirname, 'image_compressor.exe')
  ]
  try {
    candidates.push(join(process.resourcesPath, 'image_compressor.exe')) // 打包：extraResources
  } catch {
    /* ignore */
  }
  return candidates.find((p) => existsSync(p)) || null
}

/**
 * 用外部转换器（image_compressor.exe）一次生成整个根的缩略图。
 * 它的输出镜像输入目录并命名为 `<原名含扩展名>.webp`，与我们缓存布局一致。
 * 只在 DB 阶段维护（扫描/增删）后调用本函数，回写 thumb/宽高。
 */
export async function runCliThumbStage({
  cfg,
  rootPath,
  cache,
  mode,
  needThumb,
  db,
  stats,
  onProgress,
  exePath
}) {
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
    '-i',
    rootPath,
    '-o',
    cache.thumbDir,
    '--resize',
    '--width',
    String(cfg.thumbWidth),
    '-q',
    String(cfg.thumbQuality),
    '-j',
    String(Math.max(0, cfg.thumbWorkers | 0)),
    '--output-format',
    'json'
  ]
  if (overwrite) args.push('--overwrite')

  console.log(`[cache] cli thumb start: ${exePath} ${args.join(' ')}`)

  // thumb_size 置空：CLI 不回传字节数，交由任务末尾的 folder SHA 阶段 stat 回填一次
  const updateThumbStmt = db.prepare(
    'UPDATE files SET thumb=?, width=?, height=?, thumb_size=NULL, updated_at=? WHERE id=?'
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
