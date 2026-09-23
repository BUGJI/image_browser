import { buildImageUrl } from './image-url'

/**
 * 视频首帧「实时获取」工具（仅会话内缓存，不写磁盘）
 *
 * 原理：创建离屏 <video>（crossOrigin=anonymous，协议已带 CORS 头，
 * 画布不会被污染）→ 取元数据后 seek 到极小时间点 → 画到 canvas →
 * 编码 webp blob → objectURL 给 <img> 使用（可正常走 object-fit / onload 校准）。
 *
 * 结果按 rootId|absPath 缓存在 Map（LRU，最多 MAX_CACHE 条），
 * 被挤出或会话结束时释放 objectURL。失败返回 ''，调用方自行回退到 <video>。
 */

const POSTER_MAX_WIDTH = 512
const POSTER_QUALITY = 0.82
const MAX_CACHE = 160
const DECODE_TIMEOUT = 15000

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

/** 等待 el 上指定的任一事件（或 error），超时 reject */
function waitEvent(el, events, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false
    const onEvent = (e) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(e.type)
    }
    const onError = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('media error'))
    }
    const cleanup = () => {
      for (const ev of events) el.removeEventListener(ev, onEvent)
      el.removeEventListener('error', onError)
      clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('media timeout'))
    }, timeout)
    for (const ev of events) el.addEventListener(ev, onEvent)
    el.addEventListener('error', onError)
  })
}

async function decodePoster(rootId, absPath) {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = buildImageUrl(rootId, absPath, 'orig')
  try {
    await waitEvent(video, ['loadedmetadata'], DECODE_TIMEOUT)
    try {
      const d = video.duration
      video.currentTime = d && isFinite(d) && d > 0.2 ? Math.min(0.1, d / 2) : 0
    } catch {
      /* ignore */
    }
    // 已缓冲到当前帧则直接取，否则等 seeked / loadeddata（避免错过事件）
    if (video.readyState < 2) {
      await waitEvent(video, ['seeked', 'loadeddata', 'canplay'], DECODE_TIMEOUT)
    }
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return ''
    const scale = Math.min(1, POSTER_MAX_WIDTH / vw)
    const dw = Math.max(1, Math.round(vw * scale))
    const dh = Math.max(1, Math.round(vh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = dw
    canvas.height = dh
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(video, 0, 0, dw, dh)
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/webp', POSTER_QUALITY)
    )
    if (!blob) return ''
    return URL.createObjectURL(blob)
  } finally {
    try {
      video.removeAttribute('src')
      video.load()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 取视频首帧海报 objectURL；解码失败返回 ''。
 * 返回 Promise：命中缓存或复用进行中的任务。
 */
export async function getVideoPosterUrl(rootId, absPath) {
  const key = `${rootId}|${absPath}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let p = pending.get(key)
  if (!p) {
    p = decodePoster(rootId, absPath)
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
export function clearVideoPosterCache() {
  for (const url of cache.values()) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
  cache.clear()
}
