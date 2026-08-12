// 子进程：接收 jobs，逐个 pngjs 解码 + webp 编码，回传进度
import { parentPort } from 'node:worker_threads'

const { PNG } = await import('pngjs')
const WebP = (await import('webp-wasm')).default
await WebP.load()

parentPort.on('message', async (msg) => {
  const { jobs, thumbDir } = msg
  let done = 0
  for (const job of jobs) {
    try {
      const relThumb = `${job.relPath}.webp`
      const result = await makeThumb(job.absPath, thumbDir, relThumb)
      done++
      if (result) parentPort.postMessage({ type: 'thumb-done', id: job.id, relThumb, width: result.width, height: result.height, name: job.name })
      else parentPort.postMessage({ type: 'thumb-fail', id: job.id, name: job.name })
    } catch (e) {
      done++
      parentPort.postMessage({ type: 'thumb-fail', id: job.id, name: job.name })
    }
  }
  parentPort.postMessage({ type: 'thumb-done-all', total: jobs.length })
})

async function makeThumb(absPath, thumbDir, relThumb) {
  const { promises: fsp } = await import('fs')
  const { join, dirname, extname } = await import('path')
  const buf = await fsp.readFile(absPath)
  const img = decode(buf, extname(absPath))
  if (!img) return null
  let data = img.data, w = img.width, h = img.height
  if (w > 256) {
    const dw = 256, dh = Math.max(1, Math.round(h * 256 / w))
    data = resizeRGBA(data, w, h, dw, dh)
    w = dw; h = dh
  }
  const webpBuf = await WebP.encode({ data, width: w, height: h }, { quality: 30 })
  const outPath = join(thumbDir, relThumb)
  await fsp.mkdir(dirname(outPath), { recursive: true })
  await fsp.writeFile(outPath, webpBuf)
  return { width: img.width, height: img.height }
}

function decode(buf, ext) {
  if (ext === '.png') {
    const png = PNG.sync.read(buf)
    return { width: png.width, height: png.height, data: png.data }
  }
  return null
}

function resizeRGBA(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4)
  const xr = sw / dw, yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const sy = y * yr, y0 = Math.floor(sy), y1 = Math.min(y0 + 1, sh - 1), fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = x * xr, x0 = Math.floor(sx), x1 = Math.min(x0 + 1, sw - 1), fx = sx - x0
      const i00 = (y0 * sw + x0) * 4, i01 = (y0 * sw + x1) * 4, i10 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4
      const o = (y * dw + x) * 4
      for (let c = 0; c < 4; c++) out[o + c] = (src[i00+c]*(1-fx)+src[i01+c]*fx)*(1-fy)+(src[i10+c]*(1-fx)+src[i11+c]*fx)*fy
    }
  }
  return out
}
