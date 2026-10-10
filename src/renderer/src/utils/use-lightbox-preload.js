import { buildImageUrl, isVideoName } from './image-url'

/**
 * 灯箱相邻原图预加载（切换时秒开）。从 Lightbox.vue 拆出。
 *
 * - 用 absPath 索引避免重复请求；不再相邻的项显式取消（src=''），
 *   防止快速翻页堆积大量在途原图请求。保留 Image 引用使浏览器缓存对下一张生效。
 * - 视频不预载（较重）。
 *
 * @param {Object} deps
 * @param {() => Array} deps.getItems 图片列表
 * @param {() => number} deps.getIndex 当前下标
 * @param {() => number} deps.getRootId 根目录 id
 */
export function useLightboxPreload({ getItems, getIndex, getRootId }) {
  const preloads = new Map() // absPath -> Image

  function preloadNeighbors() {
    const list = getItems()
    const cur = getIndex()
    const want = new Map()
    for (const i of [cur - 1, cur + 1]) {
      const it = list[i]
      if (!it || isVideoName(it.name)) continue
      want.set(it.absPath, it)
    }
    for (const [abs, el] of preloads) {
      if (!want.has(abs)) {
        try {
          el.src = '' // 取消仍在途的加载
        } catch {
          /* ignore */
        }
        preloads.delete(abs)
      }
    }
    for (const [abs, it] of want) {
      if (preloads.has(abs)) continue
      const el = new Image()
      el.decoding = 'async'
      el.src = buildImageUrl(getRootId(), it.absPath, 'orig')
      preloads.set(abs, el)
    }
  }

  function cancelPreload() {
    for (const el of preloads.values()) {
      try {
        el.src = ''
      } catch {
        /* ignore */
      }
    }
    preloads.clear()
  }

  return { preloadNeighbors, cancelPreload }
}
