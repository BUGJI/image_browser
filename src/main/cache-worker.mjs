/**
 * cache-worker.mjs —— 缓存重型任务 Worker 线程
 *
 * 把「递归扫描图片」和「解码 → 缩放 → webp 编码 → 写缩略图」这些
 * CPU 密集/大内存操作从 Electron 主进程移到 worker 线程，避免阻塞
 * 主进程事件循环导致窗口卡死。
 *
 * 缩略图按「镜像目录结构」存放：
 *   <root>/.image_browser_cache/image_cache/<相对目录>/<文件名>.<原扩展名>.webp
 * 与源目录保持一致的相对路径，方便按目录直接定位/清理/迁移。
 *
 * 消息协议（parentPort）：
 *   in   { type: 'scan', rootPath }
 *   out  { type: 'scan-batch', files: [...] }（分批）
 *   out  { type: 'scan-done', total }
 *   in   { type: 'thumb', jobs: [{ id, absPath, relPath, name }], thumbDir }
 *   out  { type: 'thumb-done', id, relThumb, width, height, name }
 *   out  { type: 'thumb-fail', id, name }
 *   out  { type: 'thumb-done-all', total }
 *   in   { type: 'abort' }  —— 设置中止标志，下一轮循环抛出
 *   out  { type: 'error', message }
 */

import { parentPort } from 'node:worker_threads'
import { promises as fsp } from 'fs'
import { join, extname, relative, dirname } from 'path'
import { decode as decodeJpeg } from 'jpeg-js'
import { PNG } from 'pngjs'
import omggif from 'omggif'
import WebP from 'webp-wasm'

const CACHE_DIR_NAME = '.image_browser_cache'
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff'
])
const SKIP_DIRS = new Set([
  '@eaDir', '#recycle', '.seekMeta', '.seekTrash', '.thumbnails', '.git', 'node_modules'
])
const DEFAULT_SCAN_BATCH = 100
const DEFAULT_THUMB_WIDTH = 512
const DEFAULT_THUMB_QUALITY = 80

let aborted = false

function isSkipDir(name) {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

function relSlash(rootPath, target) {
  return relative(rootPath, target).split(/[\\/]+/).join('/')
}

function post(msg) {
  parentPort?.postMessage(msg)
}

// 转发 console 日志给主进程（开发者选项「记录日志」开启时落盘）
for (const method of ['debug', 'log', 'info', 'warn', 'error']) {
  const original = console[method]
  if (typeof original !== 'function') continue
  const level = method === 'debug' ? 'DEBUG' : method === 'warn' ? 'WARN' : method === 'error' ? 'ERROR' : 'INFO'
  console[method] = function (...args) {
    try {
      parentPort?.postMessage({
        type: 'log',
        level,
        args: args.map((a) => {
          if (a instanceof Error) return a.stack || String(a)
          try {
            return typeof a === 'string' ? a : JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
      })
    } catch {
      /* ignore */
    }
    original.apply(console, args)
  }
}

// ---------------------------------------------------------------- 扫描

/**
 * 递归收集根目录下所有图片文件（迭代式，避免爆栈）。
 * 每满 SCAN_BATCH 条发一批出去，避免单次消息过大。
 */
async function scanImages(rootPath, scanBatch = DEFAULT_SCAN_BATCH) {
  const stack = [rootPath]
  let scanned = 0
  let batch = []

  while (stack.length) {
    if (aborted) throw new Error('scan aborted')
    const dir = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const name = entry.name
      if (name === CACHE_DIR_NAME) continue
      if (entry.isDirectory()) {
        if (!isSkipDir(name)) stack.push(join(dir, name))
      } else if (entry.isFile() && IMAGE_EXTS.has(extname(name).toLowerCase())) {
        const absPath = join(dir, name)
        let st
        try {
          st = await fsp.stat(absPath)
        } catch {
          continue
        }
        batch.push({
          absPath,
          relPath: relSlash(rootPath, absPath),
          folder: relSlash(rootPath, dir),
          name,
          size: st.size,
          mtime: Math.floor(st.mtimeMs)
        })
        scanned++
        if (batch.length >= scanBatch) {
          post({ type: 'scan-batch', files: batch })
          batch = []
        }
      }
    }
  }
  if (batch.length) post({ type: 'scan-batch', files: batch })
  return scanned
}

// ---------------------------------------------------------------- 缩略图

let webpLoaded = false
async function ensureWebP() {
  if (!webpLoaded) {
    await WebP.load()
    webpLoaded = true
  }
}

/** 解码 jpg/png/webp/gif 为 RGBA；不支持的格式返回 null（bmp/tiff 暂无解码器） */
async function decodeImage(absPath) {
  const ext = extname(absPath).toLowerCase()
  const buf = await fsp.readFile(absPath)
  if (ext === '.png') {
    const png = PNG.sync.read(buf)
    return { width: png.width, height: png.height, data: png.data }
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const jpeg = decodeJpeg(buf, { useTArray: true, maxMemoryUsageInMB: 1024 })
    return { width: jpeg.width, height: jpeg.height, data: jpeg.data }
  }
  if (ext === '.webp') {
    const img = await WebP.decode(buf)
    return { width: img.width, height: img.height, data: img.data }
  }
  if (ext === '.gif') {
    // 只解第一帧作为静态缩略图（gif 原生会在 <img> 里自动播放，磁盘缓存只用首帧）
    const reader = new omggif.GifReader(new Uint8Array(buf))
    const { width, height } = reader
    const data = new Uint8Array(width * height * 4)
    reader.decodeAndBlitFrameRGBA(0, data)
    return { width, height, data }
  }
  return null
}


/** 双线性缩放 RGBA */
function resizeRGBA(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = y * yr
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, sh - 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = x * xr
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, sw - 1)
      const fx = sx - x0
      const i00 = (y0 * sw + x0) * 4
      const i01 = (y0 * sw + x1) * 4
      const i10 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const o = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) {
        out[o + c] =
          (src[i00 + c] * (1 - fx) + src[i01 + c] * fx) * (1 - fy) +
          (src[i10 + c] * (1 - fx) + src[i11 + c] * fx) * fy
      }
    }
  }
  return out
}

/**
 * 生成 webp 缩略图（镜像目录），返回 { width, height }；失败返回 null。
 * relThumb：相对 thumbDir 的路径，如 `相册/风景/photo.jpg.webp`
 */
async function makeThumb(absPath, thumbDir, relThumb, { thumbWidth = DEFAULT_THUMB_WIDTH, thumbQuality = DEFAULT_THUMB_QUALITY } = {}) {
  let img
  try {
    img = await decodeImage(absPath)
  } catch {
    return null
  }
  if (!img || !img.width || !img.height) return null

  const orig = { width: img.width, height: img.height }
  let data = img.data
  let w = img.width
  let h = img.height

  try {
    if (w > thumbWidth) {
      const dw = thumbWidth
      const dh = Math.max(1, Math.round((h * thumbWidth) / w))
      data = resizeRGBA(data, w, h, dw, dh)
      w = dw
      h = dh
    }
    await ensureWebP()
    const webpBuf = await WebP.encode({ data, width: w, height: h }, { quality: thumbQuality })
    const outPath = join(thumbDir, relThumb)
    await fsp.mkdir(dirname(outPath), { recursive: true })
    await fsp.writeFile(outPath, webpBuf)
    return orig
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 消息分发

parentPort?.on('message', async (msg) => {
  try {
    if (msg.type === 'scan') {
      const total = await scanImages(msg.rootPath, msg.scanBatch)
      post({ type: 'scan-done', total })
    } else if (msg.type === 'thumb') {
      const { jobs, thumbDir, thumbWidth, thumbQuality } = msg
      let done = 0
      for (const job of jobs) {
        if (aborted) throw new Error('scan aborted')
        // 镜像目录：<相对目录>/<文件名>.<原扩展名>.webp
        const relThumb = `${job.relPath}.webp`
        const result = await makeThumb(job.absPath, thumbDir, relThumb, { thumbWidth, thumbQuality })
        done++
        if (done % 100 === 0) {
          console.log(`worker thumb progress ${done}/${jobs.length} last=${job.name}`)
        }
        if (result) {
          post({
            type: 'thumb-done',
            id: job.id,
            relThumb,
            width: result.width,
            height: result.height,
            name: job.name
          })
        } else {
          post({ type: 'thumb-fail', id: job.id, name: job.name })
        }
      }
      post({ type: 'thumb-done-all', total: jobs.length })
    } else if (msg.type === 'abort') {
      aborted = true
    }
  } catch (err) {
    post({ type: 'error', message: String(err?.message || err) })
  }
})
