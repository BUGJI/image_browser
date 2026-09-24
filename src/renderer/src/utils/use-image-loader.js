import { ref, computed } from 'vue'
import { buildImageUrl } from './image-url'

/**
 * 图片加载优先级调度（与布局解耦）
 *
 * 目标：滚动 > 渲染框架 > 图片加载。
 * - 滚动进行中：只给「严格可视区」的图片分配 src，缓冲区不加载/不解码，避免抢占主线程。
 * - 停止滚动后：用 requestIdleCallback 小批量填充缓冲区图片，避免一次性解码阵雨。
 * - 已分配的 src 缓存在 srcCache，来回滚动不重复加载、不闪烁；换根目录时 reset()。
 *
 * @param {Object} props 组件 props（用到 rootId / bufferLazy）
 * @param {Object} ctx   { visibleItems, inViewport }
 */

const SCROLL_IDLE_MS = 180
const SRC_CACHE_MAX = 20000

export function useImageLoader(props, { visibleItems, inViewport }) {
  const scrollIdle = ref(true)
  const isScrolling = computed(() => !scrollIdle.value)
  // 普通 Map + 版本号：避免 reactive(Map) 代理在大量 has/get 时的开销；
  // 变更时自增版本号触发模板重渲染（同一同步批次内的多次变更由 Vue 合并为一次）。
  const srcCache = new Map() // absPath -> 已分配的 url
  const srcVersion = ref(0)
  let scrollIdleTimer = 0
  let idleHandle = 0

  /** 将命中项移到 Map 末尾（Map 迭代顺序即 LRU 顺序） */
  function touchSrc(key) {
    const v = srcCache.get(key)
    if (v === undefined) return v
    srcCache.delete(key)
    srcCache.set(key, v)
    return v
  }

  function assignSrc(item) {
    if (srcCache.has(item.absPath)) return
    if (srcCache.size >= SRC_CACHE_MAX) {
      // 淘汰最久未访问项（Map 头部）
      srcCache.delete(srcCache.keys().next().value)
    }
    // 已知有缩略图时用 ?size=thumb（与无缩略图时的 URL 不同，避免复用缓存建立前的原图）
    const url = buildImageUrl(props.rootId, item.absPath, item.hasThumb ? 'thumb' : 'auto')
    srcCache.set(item.absPath, url)
    // 同步写到 item 普通字段，供 WaterfallGrid 的 v-memo 依赖比较
    item._src = url
    srcVersion.value++
  }

  /** 给严格可视区内的图片分配 src（在 rAF/布局后调用，避免在 render 内改状态） */
  function primeViewportSrcs() {
    for (const it of visibleItems.value) {
      if (srcCache.has(it.absPath)) continue
      if (inViewport(it)) assignSrc(it)
    }
  }

  function hasPendingVisible() {
    for (const it of visibleItems.value) {
      if (!srcCache.has(it.absPath)) return true
    }
    return false
  }

  /** 空闲时小批量填充缓冲区图片，每帧最多 8 张，给渲染留出时间 */
  function pumpLoads() {
    idleHandle = 0
    if (isScrolling.value) return
    let budget = 8
    for (const it of visibleItems.value) {
      if (srcCache.has(it.absPath)) continue
      assignSrc(it)
      if (--budget <= 0) break
    }
    if (hasPendingVisible()) scheduleIdlePump()
  }

  function scheduleIdlePump() {
    if (idleHandle || isScrolling.value) return
    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(pumpLoads, { timeout: 200 })
    } else {
      idleHandle = setTimeout(pumpLoads, 50)
    }
  }

  function cancelIdlePump() {
    if (!idleHandle) return
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle)
    else clearTimeout(idleHandle)
    idleHandle = 0
  }

  /** 模板用：未分配的图片返回 undefined（不写 src 属性，浏览器不发请求、也无破损图标） */
  function srcFor(item) {
    void srcVersion.value // 建立响应式依赖：srcCache 变更后重渲染
    return touchSrc(item.absPath) // 命中时刷新 LRU 顺序
  }

  /** img 的 loading 属性：可视区内立即加载，缓冲区内按开关决定懒加载 */
  function loadMode(item) {
    return inViewport(item) ? 'eager' : props.bufferLazy ? 'lazy' : 'eager'
  }

  /** img 的 fetchpriority：可视区内高优先级，缓冲区低优先级（懒加载关闭时回到 auto） */
  function priorityMode(item) {
    return inViewport(item) ? 'high' : props.bufferLazy ? 'low' : 'auto'
  }

  /** GIF/视频海报是否延迟生成：滚动中且不在严格可视区时暂缓（实时解码很重） */
  function deferLoad(item) {
    return isScrolling.value && !inViewport(item)
  }

  /** 滚动开始：立即进入滚动态，暂停缓冲区加载（滚动优先） */
  function enterScroll() {
    scrollIdle.value = false
  }

  /** 滚动空闲计时重启：停止滚动 SCROLL_IDLE_MS 后进入空闲并补载缓冲图 */
  function scheduleScrollIdle() {
    clearTimeout(scrollIdleTimer)
    scrollIdleTimer = setTimeout(() => {
      scrollIdle.value = true
      scheduleIdlePump()
    }, SCROLL_IDLE_MS)
  }

  /** 换根目录：URL 依赖 rootId，清空已分配缓存 */
  function reset() {
    srcCache.clear()
    srcVersion.value++
  }

  /** 卸载清理 */
  function cancelPending() {
    clearTimeout(scrollIdleTimer)
    cancelIdlePump()
  }

  return {
    isScrolling,
    srcFor,
    loadMode,
    priorityMode,
    deferLoad,
    primeViewportSrcs,
    scheduleIdlePump,
    enterScroll,
    scheduleScrollIdle,
    reset,
    cancelPending
  }
}
