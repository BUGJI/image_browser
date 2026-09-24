import { nativeImage } from 'electron'
import { getProvider } from './storage/index.js'
import { extName } from './storage/path-utils.js'

/**
 * 主进程图片解码（复制到剪贴板用）
 *
 * nativeImage 只可靠解码 PNG/JPEG 等少数格式；GIF/WebP 等原图
 * 会返回空图像。这里在读入文件后，若原生解码失败就调用项目内的
 * 解码器把原图转为 RGBA，再编码成 PNG 返回。
 *
 * 解码库（pngjs / jpeg-js / omggif / webp-wasm）改为按需动态导入：
 * 仅「复制」这一条低频路径才会用到，避免主进程启动即加载（尤其 webp 的 WASM）。
 */

let decodersPromise = null
function loadDecoders() {
  if (!decodersPromise) {
    decodersPromise = Promise.all([
      import('pngjs'),
      import('jpeg-js'),
      import('omggif'),
      import('webp-wasm')
    ]).then(([pngjs, jpegjs, omggifMod, webpMod]) => ({
      PNG: pngjs.PNG || pngjs.default,
      decodeJpeg: jpegjs.decode || (jpegjs.default && jpegjs.default.decode),
      GifReader: (omggifMod.default || omggifMod).GifReader,
      WebP: webpMod.default || webpMod
    }))
  }
  return decodersPromise
}

let webpReady = false

async function decodeToRGBA(absPath, buf) {
  const ext = extName(absPath)
  const dec = await loadDecoders()
  if (ext === '.png') {
    const png = dec.PNG.sync.read(buf)
    return { width: png.width, height: png.height, data: png.data }
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const jpeg = dec.decodeJpeg(buf, { useTArray: true, maxMemoryUsageInMB: 1024 })
    return { width: jpeg.width, height: jpeg.height, data: jpeg.data }
  }
  if (ext === '.gif') {
    const reader = new dec.GifReader(new Uint8Array(buf))
    const data = new Uint8Array(reader.width * reader.height * 4)
    reader.decodeAndBlitFrameRGBA(0, data)
    return { width: reader.width, height: reader.height, data }
  }
  if (ext === '.webp') {
    if (!webpReady) {
      await dec.WebP.load()
      webpReady = true
    }
    const img = await dec.WebP.decode(buf)
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
  const dec = await loadDecoders()
  return dec.PNG.sync.write({
    width: rgba.width,
    height: rgba.height,
    data: Buffer.from(rgba.data)
  })
}
