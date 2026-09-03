import { buildImageUrl } from './image-url'

/**
 * GIF 首帧「实时获取」工具（仅会话内缓存，不写磁盘）
 *
 * 原理：Chromium 内置 WebCodecs ImageDecoder 支持动图逐帧解码。
 * fetch image:// 协议字节流 → 解第 0 帧 → 等比缩小到 ≤512px → canvas 编码
 * webp blob → objectURL 给 <img> 使用（可正常走 object-fit / onload 校准）。
 *
 * 结果按 rootId|absPath 缓存在 Map（LRU，最多 MAX_CACHE 条），
 * 被挤出或会话结束时释放 objectURL。解码失败返回 ''，调用方自行回退。
 */

const POSTER_MAX_WIDTH = 512
const POSTER_QUALITY = 0.82
const MAX_CACHE = 160

/** key -> objectURL 字符串（含失败 '' 不入缓存，允许下次重试） */
const cache = new Map()
/** key -> 进行中的 Promise<string>（并发去重） */
const pending = new Map()

function evict() {
  while (cache.size > MAX_CACHE) {
    const key = cache.keys().next().value
    const url = cache.get(key)
    cache.delete(key)
    if (url) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }
  }
}

async function decodeFirstFrame(rootId, absPath) {
  if (!('ImageDecoder' in window)) return ''
  const resp = await fetch(buildImageUrl(rootId, absPath, 'orig'))
  if (!resp.ok) return ''
  const type = resp.headers.get('content-type') || undefined
  const decoder = new ImageDecoder({ data: resp.body, type })
  try {
    const { image } = await decoder.decode({ frameIndex: 0 })
    try {
      const vw = image.displayWidth
      const vh = image.displayHeight
      if (!vw || !vh) return ''
      const scale = Math.min(1, POSTER_MAX_WIDTH / vw)
      const dw = Math.max(1, Math.round(vw * scale))
      const dh = Math.max(1, Math.round(vh * scale))
      const canvas = document.createElement('canvas')
      canvas.width = dw
      canvas.height = dh
      const ctx = canvas.getContext('2d')
      if (!ctx) return ''
      ctx.drawImage(image, 0, 0, dw, dh)
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/webp', POSTER_QUALITY)
      )
      if (!blob) return ''
      return URL.createObjectURL(blob)
    } finally {
      try {
        image.close()
      } catch {
        /* ignore */
      }
    }
  } finally {
    try {
      decoder.close()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 取 GIF 首帧海报 objectURL；解码失败返回 ''。
 * 返回 Promise：命中缓存或复用进行中的任务。
 */
export async function getGifPosterUrl(rootId, absPath) {
  const key = `${rootId}|${absPath}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    // 刷新 LRU 热度
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let p = pending.get(key)
  if (!p) {
    p = decodeFirstFrame(rootId, absPath)
      .then((url) => {
        if (url) {
          cache.set(key, url)
          evict()
        }
        return url
      })
      .catch(() => '')
      .finally(() => pending.delete(key))
    pending.set(key, p)
  }
  return p
}

/** 清空海报缓存（释放全部 objectURL），目前仅调试用途 */
export function clearGifPosterCache() {
  for (const url of cache.values()) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
  cache.clear()
}
