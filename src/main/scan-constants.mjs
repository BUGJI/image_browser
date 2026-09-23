/**
 * 扫描 / 媒体类型共享常量
 *
 * 主进程（cache.js / ai.js）、目录树扫描（fs-scan.mjs）与缓存 worker
 * （cache-worker.mjs）必须使用同一套扩展名/跳过目录规则，否则索引出的
 * 文件集合会不一致。集中在此，避免多处各写一份导致漂移。
 */

export const CACHE_DIR_NAME = '.image_browser_cache'

export const GIF_NAME_RE = /\.gif$/i

/** 视频扩展名：纳入索引与浏览，但不生成 webp 静态缩略图 */
export const VIDEO_EXTS = new Set(['.webm'])

/** 参与索引与浏览的图片/媒体扩展名 */
export const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.webm'
])

/** 跳过的系统/隐藏目录（NAS 常见垃圾目录） */
export const SKIP_DIRS = new Set([
  '@eaDir',
  '#recycle',
  '.seekMeta',
  '.seekTrash',
  '.thumbnails',
  '.git',
  'node_modules'
])

export function isSkipDir(name) {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

export const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webm': 'video/webm'
}

export const DEFAULT_SCAN_BATCH = 100
export const DEFAULT_THUMB_WIDTH = 512
export const DEFAULT_THUMB_QUALITY = 80
