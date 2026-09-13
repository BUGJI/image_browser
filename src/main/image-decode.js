import { nativeImage } from 'electron'
import { PNG } from 'pngjs'
import { decode as decodeJpeg } from 'jpeg-js'
import omggif from 'omggif'
import WebP from 'webp-wasm'
import { getProvider } from './storage/index.js'
import { extName } from './storage/path-utils.js'

/**
 * 主进程图片解码（复制到剪贴板用）
 *
 * nativeImage 只可靠解码 PNG/JPEG 等少数格式；GIF/WebP 等原图
 * 会返回空图像。这里在读入文件后，若原生解码失败就调用项目内的
 * 解码器把原图转为 RGBA，再编码成 PNG 返回。
 */

let webpReady = false
async function ensureWebP() {
  if (!webpReady) {
    await WebP.load()
    webpReady = true
  }
}

async function decodeToRGBA(absPath, buf) {
  const ext = extName(absPath)
  if (ext === '.png') {
    const png = PNG.sync.read(buf)
    return { width: png.width, height: png.height, data: png.data }
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const jpeg = decodeJpeg(buf, { useTArray: true, maxMemoryUsageInMB: 1024 })
    return { width: jpeg.width, height: jpeg.height, data: jpeg.data }
  }
  if (ext === '.gif') {
    const reader = new omggif.GifReader(new Uint8Array(buf))
    const data = new Uint8Array(reader.width * reader.height * 4)
    reader.decodeAndBlitFrameRGBA(0, data)
    return { width: reader.width, height: reader.height, data }
  }
  if (ext === '.webp') {
    await ensureWebP()
    const img = await WebP.decode(buf)
    return { width: img.width, height: img.height, data: img.data }
  }
  return null
}

/**
 * 读取图片并返回可直接 createFromBuffer 的 Buffer：
 * 原生可解码的格式直接返回原始文件内容；否则转码为 PNG。
 * 无法读取或解码时返回 null。
 */
export async function readClipboardImageBuffer(absPath, provider = getProvider('local')) {
  let buf
  try {
    buf = await provider.readFile(absPath)
  } catch {
    return null
  }
  if (!nativeImage.createFromBuffer(buf).isEmpty()) return buf

  const rgba = await decodeToRGBA(absPath, buf)
  if (!rgba || !rgba.width || !rgba.height) return null
  return PNG.sync.write({ width: rgba.width, height: rgba.height, data: Buffer.from(rgba.data) })
}
