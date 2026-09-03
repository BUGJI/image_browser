/**
 * 图片 URL 构建
 *
 * Electron 内：image://<rootId>/<encodedAbsPath>?size=auto|thumb|orig
 *   - auto：有 webp 缩略图返回缩略图，否则回退原图（无缓存/未知状态时用）
 *   - thumb：有 webp 缩略图返回缩略图，否则回退原图（已知有缩略图时用；
 *            与 auto 的 URL 不同，避免浏览器缓存误用缓存建立前的原图）
 *   - orig：始终原图（灯箱）
 * 浏览器调试（dev-mock）：absPath 为 http(s) 直出
 */
export function buildImageUrl(rootId, absPath, size = 'auto') {
  if (!absPath) return ''
  if (/^https?:\/\//i.test(absPath)) return absPath
  const encoded = absPath
    .split(/[\\/]+/)
    .map(encodeURIComponent)
    .join('/')
  const q =
    size === 'orig' ? '?size=orig' : size === 'thumb' ? '?size=thumb' : ''
  return `image://${rootId}/${encoded}${q}`
}

/** 按文件名判断是否为 GIF（网格缩略图动图播放控制只针对 .gif） */
export function isGifName(name) {
  return /\.gif$/i.test(String(name || ''))
}
