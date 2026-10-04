import { promises as fsp, openSync, readSync, closeSync } from 'fs'
import { extname } from 'path'

/**
 * 图片尺寸探测：从文件头字节解析宽高（不整图解码）。从 cache.js 拆出。
 */

/** 从文件头字节解析图片宽高（纯函数，无 IO） */
export function parseImageSize(b, name) {
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
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }
      }
      const segLen = b.readUInt16BE(i + 2)
      if (segLen < 2) break
      i += 2 + segLen
    }
    return null
  }
  if (
    name === '.webp' &&
    b.subarray(0, 4).toString() === 'RIFF' &&
    b.subarray(8, 12).toString() === 'WEBP'
  ) {
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
}

/** 同步版：只读文件头解析像素（仅 CLI 兜底重算尺寸的冷路径使用） */
export function probeImageSize(absPath) {
  try {
    const fd = openSync(absPath, 'r')
    try {
      const head = Buffer.alloc(2048)
      const read = readSync(fd, head, 0, head.length, 0)
      return parseImageSize(head.subarray(0, read), extname(absPath).toLowerCase())
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

/** 异步版：只读文件头解析像素，不阻塞事件循环（缩略图调度主路径） */
export async function probeImageSizeAsync(absPath) {
  let fh = null
  try {
    fh = await fsp.open(absPath, 'r')
    const head = Buffer.alloc(2048)
    const { bytesRead } = await fh.read(head, 0, head.length, 0)
    return parseImageSize(head.subarray(0, bytesRead), extname(absPath).toLowerCase())
  } catch {
    return null
  } finally {
    if (fh) await fh.close().catch(() => {})
  }
}

export function mpOf(size) {
  if (!size || !size.w || !size.h) return 0
  return (size.w * size.h) / 1e6
}

/**
 * 从 WebP 文件头读取宽高（只读前 30 字节，不整图解码）+ 文件字节数。
 * 返回 { w, h, size }；解析失败返回 null。
 */
export async function webpDimsFromFile(filePath) {
  try {
    const fh = await fsp.open(filePath, 'r')
    try {
      const st = await fh.stat()
      const buf = Buffer.alloc(30)
      const { bytesRead } = await fh.read(buf, 0, 30, 0)
      if (bytesRead < 30) return null
      if (buf.toString('latin1', 0, 4) !== 'RIFF') return null
      if (buf.toString('latin1', 8, 12) !== 'WEBP') return null
      const fourcc = buf.toString('latin1', 12, 16)
      if (fourcc === 'VP8X') {
        return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), size: st.size }
      }
      if (fourcc === 'VP8 ') {
        return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, size: st.size }
      }
      if (fourcc === 'VP8L') {
        const bits = buf.readUInt32LE(21)
        return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff), size: st.size }
      }
      return null
    } finally {
      await fh.close().catch(() => {})
    }
  } catch {
    return null
  }
}
