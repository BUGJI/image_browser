import { ref, shallowRef, computed } from 'vue'

/**
 * 瀑布流虚拟布局引擎（与业务无关）
 *
 * - 多列最短列分配；几何字段直接写在 item 普通字段上（非响应式），
 *   布局完成后只自增 layoutVersion 触发一次重算，避免快速滚动时逐条重排。
 * - 两套布局：全量重建（换目录/缩放/尺寸变化）与增量提交（图片真实比例就绪）。
 * - 空间索引：按 item 纵向覆盖范围分桶，滚动时只遍历与视口相交的桶。
 * - 内存维度缓存：跨文件夹/滚动复用已加载到的真实比例，减少占位跳动。
 */

const GAP = 10
const COL_BASE_WIDTH = 200
const FALLBACK_RATIO = 0.75
const MAX_TILE_RATIO = 5 // 卡片比例上限：宽:高 不超过 1:5（高图）
const MIN_TILE_RATIO = 0.5 // 卡片比例下限：宽:高 不小于 2:1（宽图）
// 矩形模式卡片固定宽高比（高/宽）：1:1 正方形，配合 object-fit: cover 裁切超出部分
const RECT_TILE_RATIO = 1
const VIS_BUCKET = 800
const DIM_CACHE_MAX = 120000
const COMMIT_DEBOUNCE = 200 // 距离最后一张图加载的等待毫秒数
const SCROLL_IDLE = 250 // 距最近一次滚动至少空闲这么多毫秒才允许提交

export function useWaterfallLayout(props) {
  const isRect = computed(() => props.mode === 'rect')

  // 内存维度缓存：`rootId\u0000absPath -> {w,h}`（纯内存，本会话有效，有上限）
  const dimCache = new Map()
  function rememberDims(rootId, absPath, w, h) {
    if (!absPath || !w || !h) return
    const key = rootId + '\u0000' + absPath
    if (dimCache.has(key)) return
    if (dimCache.size >= DIM_CACHE_MAX) {
      dimCache.delete(dimCache.keys().next().value)
    }
    dimCache.set(key, { w, h })
  }
  function knownDims(rootId, absPath) {
    return dimCache.get(rootId + '\u0000' + absPath) || null
  }

  const items = shallowRef([])
  const layoutVersion = ref(0)
  const scrollTop = ref(0)
  const viewportH = ref(0)
  const containerW = ref(0)
  const totalHeight = ref(0)

  // 可视区空间索引（桶在每次布局后重建；items 列表替换时清空）
  let visBuckets = []
  let visBucketCount = 0

  function rebuildVisIndex() {
    const count = Math.max(1, Math.ceil((totalHeight.value || 0) / VIS_BUCKET) + 1)
    const buckets = new Array(count)
    for (const it of items.value) {
      const s = Math.max(0, Math.floor(it.y / VIS_BUCKET))
      const e = Math.min(count - 1, Math.floor((it.y + it.h) / VIS_BUCKET))
      for (let k = s; k <= e; k++) {
        const arr = buckets[k] || (buckets[k] = [])
        arr.push(it)
      }
    }
    visBuckets = buckets
    visBucketCount = count
  }

  function setItems(list) {
    items.value = list
    visBuckets = []
    visBucketCount = 0
  }

  let curCols = 1 // 当前列数（决定是否保持列分配）
  let itemW = 0 // 当前列宽
  let avgRatio = FALLBACK_RATIO // 未知比例占位用的平均比例
  let lastScrollAt = 0 // 最近一次滚动时间戳（滚动空闲判定）
  let layoutTimer = null // 增量提交 debounce
  let layoutRaf = 0 // 全量重建 rAF 去重
  let layoutDirty = false // 是否有待提交的比例修正

  function calcCols() {
    if (!containerW.value) return 1
    const colMin = COL_BASE_WIDTH / Math.max(0.05, props.zoom)
    // 不再硬限制列数：zoom 越大 colMin 越小，列数随之增加，缩放持续生效
    return Math.max(1, Math.floor((containerW.value + GAP) / (colMin + GAP)))
  }

  /** 已知真实比例时返回比例，未知返回 null */
  function ratioOf(item) {
    if (item.width && item.height) return item.height / item.width
    if (item._loaded) return item._loaded.h / item._loaded.w
    return null
  }

  /** 布局用高度比例：矩形模式统一等高；瀑布流模式开启比例限制时封顶/封底 */
  function effectiveRatio(item) {
    if (isRect.value) return RECT_TILE_RATIO
    const raw = ratioOf(item) ?? avgRatio
    if (props.capTall) {
      if (raw > MAX_TILE_RATIO) return MAX_TILE_RATIO
      if (raw < MIN_TILE_RATIO) return MIN_TILE_RATIO
    }
    return raw
  }

  /** 该卡片原图比例是否被限制（用于切换 contain，保证整图可见）；矩形模式恒为 cover */
  function isRatioCapped(item) {
    if (isRect.value) return false
    if (!props.capTall) return false
    const r = ratioOf(item)
    if (r == null) return false
    return r > MAX_TILE_RATIO + 1e-6 || r < MIN_TILE_RATIO - 1e-6
  }

  /** 用本列表已知图片比例算均值，作为未知占位比例 */
  function recomputeAvg() {
    let sum = 0
    let n = 0
    for (const it of items.value) {
      const r = ratioOf(it)
      if (r != null) {
        sum += r
        n++
      }
    }
    avgRatio = n ? sum / n : FALLBACK_RATIO
  }

  /** 全量布局：先用内存真实尺寸回填，再逐条分配最短列并写几何 */
  function doFullLayout() {
    for (const it of items.value) {
      if (it.width && it.height) continue
      const d = knownDims(props.rootId, it.absPath)
      if (d) {
        it.width = d.w
        it.height = d.h
      }
    }

    curCols = calcCols()
    itemW = (containerW.value - GAP * (curCols - 1)) / curCols
    recomputeAvg()
    const colBottom = new Array(curCols).fill(0)
    for (const item of items.value) {
      const h = itemW * effectiveRatio(item)
      let col = 0
      let minH = Infinity
      for (let i = 0; i < curCols; i++) {
        if (colBottom[i] < minH) {
          minH = colBottom[i]
          col = i
        }
      }
      item.x = col * (itemW + GAP)
      item.y = colBottom[col]
      item.w = itemW
      item.h = h
      item.col = col
      colBottom[col] += h + GAP
    }
    totalHeight.value = Math.max(...colBottom, 0)
    rebuildVisIndex()
  }

  /** 增量布局：保留已分配的列，仅按最新比例刷新各列 y/h（单遍 O(n)） */
  function doIncrementalLayout() {
    if (!curCols) {
      doFullLayout()
      return
    }
    recomputeAvg()
    const colBottom = new Array(curCols).fill(0)
    for (const it of items.value) {
      const h = itemW * effectiveRatio(it)
      it.y = colBottom[it.col]
      it.h = h
      colBottom[it.col] = it.y + h + GAP
    }
    totalHeight.value = Math.max(...colBottom, 0)
    rebuildVisIndex()
  }

  /** 全量重建（换目录/缩放/尺寸变化）：rAF 合并到每帧一次 */
  function scheduleFullLayout() {
    if (layoutRaf) return
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0
      doFullLayout()
      layoutVersion.value++
    })
  }

  /** 图片真实比例就绪后的增量提交：滚动中/持续加载时不提交，空闲后一次性 commit */
  function scheduleLayoutCommit() {
    if (!curCols) {
      scheduleFullLayout()
      return
    }
    layoutDirty = true
    clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => {
      if (!layoutDirty) return
      if (Date.now() - lastScrollAt < SCROLL_IDLE) {
        scheduleLayoutCommit()
        return
      }
      layoutDirty = false
      doIncrementalLayout()
      layoutVersion.value++
    }, COMMIT_DEBOUNCE)
  }

  /** 立即（同步）全量重排并触发重绘，用于列表就绪后的首屏 */
  function applyInitialLayout() {
    doFullLayout()
    layoutVersion.value++
  }

  /** 开关类变化：保留列分配，增量重排 */
  function reflowIncremental() {
    if (!items.value.length) return
    doIncrementalLayout()
    layoutVersion.value++
  }

  /** 模式类变化：整表重新布局 */
  function reflowFull() {
    if (!items.value.length) return
    doFullLayout()
    layoutVersion.value++
  }

  /** 记录滚动位置（同时作为「最近滚动时间」用于增量提交空闲判定） */
  function updateScrollTop(top) {
    lastScrollAt = Date.now()
    scrollTop.value = top
  }

  const visibleItems = computed(() => {
    // 依赖版本号：几何只写普通字段，布局完成后自增一次，触发本屏重算
    void layoutVersion.value
    if (!visBuckets.length) return []
    const top = scrollTop.value - props.preload
    const bottom = scrollTop.value + viewportH.value + props.preload
    const start = Math.max(0, Math.floor(top / VIS_BUCKET))
    const end = Math.min(visBucketCount - 1, Math.floor(bottom / VIS_BUCKET))
    const out = []
    const seen = new Set()
    for (let k = start; k <= end; k++) {
      const bucket = visBuckets[k]
      if (!bucket) continue
      for (const it of bucket) {
        if (it.y + it.h <= top || it.y >= bottom) continue
        if (seen.has(it)) continue
        seen.add(it)
        out.push(it)
      }
    }
    return out
  })

  /** item 是否落在「精确可视区」（非缓冲）内 */
  function inViewport(item) {
    const top = scrollTop.value
    const bottom = top + viewportH.value
    return item.y + item.h > top && item.y < bottom
  }

  /** 图片真实尺寸就绪：回填尺寸并按需排队增量重排 */
  function onItemLoaded(item, w, h) {
    if (!w || !h) return
    rememberDims(props.rootId, item.absPath, w, h)
    const prevH = item.h
    item._loaded = { w, h }
    item.width = w
    item.height = h
    // 矩形模式卡片等高等宽，比例不参与布局，无需重排
    if (isRect.value) return
    const naturalRatio = h / w
    let cappedRatio = naturalRatio
    if (props.capTall) {
      if (naturalRatio > MAX_TILE_RATIO) cappedRatio = MAX_TILE_RATIO
      else if (naturalRatio < MIN_TILE_RATIO) cappedRatio = MIN_TILE_RATIO
    }
    const newH = itemW ? itemW * cappedRatio : 0
    if (Math.abs(newH - prevH) > 0.5) {
      scheduleLayoutCommit()
    }
  }

  /** 测量容器可视尺寸，变化时全量重排 */
  function measure(el) {
    if (!el) return
    const cs = getComputedStyle(el)
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    const w = el.clientWidth - padX
    const h = el.clientHeight
    if (w !== containerW.value || h !== viewportH.value) {
      containerW.value = w
      viewportH.value = h
      scheduleFullLayout()
    }
  }

  let resizeObs = null
  function observeResize(el) {
    if (el && typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => measure(el))
      resizeObs.observe(el)
    }
  }
  function disconnectResize() {
    resizeObs?.disconnect()
  }

  /** 卸载清理：取消待执行的布局任务 */
  function cancelPending() {
    clearTimeout(layoutTimer)
    if (layoutRaf) cancelAnimationFrame(layoutRaf)
  }

  return {
    items,
    layoutVersion,
    scrollTop,
    viewportH,
    totalHeight,
    isRect,
    setItems,
    visibleItems,
    inViewport,
    isRatioCapped,
    scheduleFullLayout,
    applyInitialLayout,
    reflowIncremental,
    reflowFull,
    updateScrollTop,
    onItemLoaded,
    observeResize,
    disconnectResize,
    cancelPending,
    rememberDims
  }
}
