<script setup>
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Star, StarFilled } from '@element-plus/icons-vue'
import Lightbox from './Lightbox.vue'
import GifThumb from './GifThumb.vue'
import { buildImageUrl, isGifName } from '../utils/image-url'
import { useGifStore } from '../stores/gif'
import { useFavoritesStore } from '../stores/favorites'

const { t } = useI18n()

/**
 * Pinterest 式瀑布流 + 虚拟滚动
 * - 多列绝对定位布局，图片高度来自缓存索引（width/height），缺失时 onload 校准
 * - 只渲染可视区域附近的 item（虚拟化），图片天然懒加载
 * - 缩略图优先（image:// auto → webp），无缓存回退原图
 * - GIF 网格卡片交给 GifThumb（遵循 gifPlayMode / gifThumbSource 动图设置）
 */

const props = defineProps({
  rootId: { type: Number, required: true },
  folderPath: { type: String, required: true },
  // 缩放值：越大 item 越小（基准列宽越小），一行可容纳更多图片
  zoom: { type: Number, default: 1 },
  // 外部触发刷新（如缓存维护完成后）：数值变化时重新加载图片列表
  refreshTick: { type: Number, default: 0 },
  // 非空时进入搜索模式：跨根目录按文件名搜索（支持 * ? 通配符）
  searchQuery: { type: String, default: '' },
  // AI 搜索结果（非 null 时优先渲染，跳过 imagesList 拉取）
  aiResults: { type: Array, default: null },
  // 快速复制：开启后点击图片直接复制（不进灯箱）
  quickCopy: { type: Boolean, default: false },
  // 快速复制类型：file = 复制原文件；image = 复制图片
  quickCopyType: { type: String, default: 'file' },
  // 文件名显示方式：none / hover / always
  nameMode: { type: String, default: 'hover' },
  // 右上角格式角标显示方式：none / hover / always
  extMode: { type: String, default: 'none' },
  // 左上角收藏按钮显示方式：none / hover / always
  favMode: { type: String, default: 'none' },
  // 左下角「图内文字」角标显示方式：none / hover / always（默认不显示）
  textMatchMode: { type: String, default: 'none' },
  // 收藏列表（“我的收藏”视图）：非 null 时直接渲染这些图片
  favItems: { type: Array, default: null },
  // 某标签下的图片列表（“标签”视图）：非 null 时直接渲染这些图片
  tagItems: { type: Array, default: null },
  // 覆盖空态文案（如“我的收藏”为空时的提示）
  emptyText: { type: String, default: '' },
  // 虚拟化在视口前后各多渲染的距离（px，设置-性能 可调）：越大提前预载越多
  preload: { type: Number, default: 900 },
  // 缓冲（视口外预载区）图片是否用浏览器原生懒加载：开=接近视口才解码（省无效加载/解码阵雨），
  // 关=缓冲区内全部立即加载（旧行为，更激进预取、更耗 CPU/IO）
  bufferLazy: { type: Boolean, default: true },
  // 超长图高度限制（设置-开发者选项-瀑布流）：开 = 卡片比例不超过 1:5，更长的整图等比适配显示
  capTall: { type: Boolean, default: true }
})

const gifStore = useGifStore()
const favoritesStore = useFavoritesStore()

const GAP = 10
const COL_BASE_WIDTH = 200
const FALLBACK_RATIO = 0.75
const MAX_TILE_RATIO = 5 // 超长图高度限制：宽:高 不超过 1:5

// 内存维度缓存：`rootId\u0000absPath -> {w,h}`。跨文件夹导航/滚动复用，
// 让没有缓存索引（未跑维护）的图片也能用上一次加载到的真实比例，减少占位跳动。
// 纯内存（本会话有效），有上限，超限淘汰最旧插入项。
const DIM_CACHE_MAX = 120000
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

// 列表用 shallowRef：item 是普通对象，几何字段（x/y/w/h/col）与加载状态（width/height/_loaded）
// 都不再逐条响应式，布局时的批量写入只触发一次 layoutVersion 变更，避免快速滚动时反复重排卡顿。
const items = shallowRef([])
const layoutVersion = ref(0)
const loading = ref(false)
const error = ref('')

const scrollEl = ref(null)
const scrollTop = ref(0)
const viewportH = ref(0)
const containerW = ref(0)
const totalHeight = ref(0)

const lightboxIndex = ref(-1)

// ---------------------------------------------------------------- 布局
// 几何信息直接写在 item 普通字段上（非响应式），
// 布局只分两种：全量重建（换目录/缩放/容器尺寸变化）与增量提交（图片真实比例就绪后）。
// 滚动过程中不做增量提交，等滚动停止后再批量 commit，消除“边滚边回排”的抖动与风暴。
let curCols = 1 // 当前列数（决定是否保持列分配）
let itemW = 0 // 当前列宽
let avgRatio = FALLBACK_RATIO // 未知比例占位用的平均比例
let lastScrollAt = 0 // 最近一次滚动时间戳（滚动空闲判定）
let layoutTimer = null // 增量提交 debounce
let layoutRaf = 0 // 全量重建 rAF 去重
let layoutDirty = false // 是否有待提交的比例修正

const COMMIT_DEBOUNCE = 200 // 距离最后一张图加载的等待毫秒数
const SCROLL_IDLE = 250 // 距最近一次滚动至少空闲这么多毫秒才允许提交

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

/** 布局用高度比例：开启高度限制时把超 1:5 的截到 1:5 */
function effectiveRatio(item) {
  const raw = ratioOf(item) ?? avgRatio
  if (props.capTall && raw > MAX_TILE_RATIO) return MAX_TILE_RATIO
  return raw
}

/** 该卡片的原图是否超高（用于给 <img> 切换 contain，保证超长图整图可见） */
function isTallCapped(item) {
  if (!props.capTall) return false
  const r = ratioOf(item)
  return r != null && r > MAX_TILE_RATIO + 1e-6
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
  // 1) 用内存里的真实尺寸回填（缓存索引缺失时），避免重复抖动
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
}

/** 增量布局：保留已分配的列，仅按最新比例刷新各列 y/h（单遍 O(n)，不再重新分配列） */
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
}

/** 全量重建（换目录/缩放/尺寸变化）：rAF 合并到每帧一次，完成后统一触发重绘 */
function scheduleFullLayout() {
  if (layoutRaf) return
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0
    doFullLayout()
    layoutVersion.value++
  })
}

/**
 * 图片真实比例就绪后的增量提交：
 * 滚动中 / 图片还在陆续加载时不提交（避免边滚边回排造成抖动与全表重算风暴），
 * 空闲后把攒下的一批修正一次性 commit。
 */
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

// ---------------------------------------------------------------- 数据

const isSearching = computed(() => !!props.searchQuery && props.searchQuery.trim() !== '')

function initItems(list) {
  return (list || []).map((it) => ({ ...it, x: 0, y: 0, w: 0, h: 0, col: 0, _loaded: null }))
}

/** 列表就绪后的首次布局（同步执行，避免首帧占位闪烁） */
function applyInitialLayout() {
  doFullLayout()
  layoutVersion.value++
}

async function load() {
  if (Array.isArray(props.favItems)) {
    items.value = initItems(props.favItems)
    totalHeight.value = 0
    await nextTick()
    applyInitialLayout()
    return
  }
  if (Array.isArray(props.tagItems)) {
    items.value = initItems(props.tagItems)
    totalHeight.value = 0
    await nextTick()
    applyInitialLayout()
    return
  }
  if (Array.isArray(props.aiResults)) {
    items.value = initItems(props.aiResults)
    totalHeight.value = 0
    await nextTick()
    applyInitialLayout()
    return
  }

  if (!isSearching.value && !props.folderPath) {
    items.value = []
    totalHeight.value = 0
    return
  }
  loading.value = true
  error.value = ''
  try {
    const list = isSearching.value
      ? await window.api.imagesList(props.rootId, null, props.searchQuery)
      : await window.api.imagesList(props.rootId, props.folderPath)
    items.value = initItems(list)
    await nextTick()
    applyInitialLayout()
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.rootId, props.folderPath, props.searchQuery, props.aiResults, props.favItems, props.tagItems],
  load,
  { immediate: true }
)

// 缩放变化 → 全量重建布局（rAF 合并，避免滑块连发时逐 tick 全表重算）
watch(() => props.zoom, scheduleFullLayout)

// 超长图限制开关变化：即时按新比例刷新（保留列分配，增量重排即可）
watch(
  () => props.capTall,
  () => {
    if (!items.value.length) return
    doIncrementalLayout()
    layoutVersion.value++
  }
)

// 缓存维护完成后 → 重新加载（此时 hasThumb 更新，改用缩略图 URL）
watch(
  () => props.refreshTick,
  () => {
    if (props.refreshTick > 0) load()
  }
)

// ---------------------------------------------------------------- 滚动/尺寸

function measure() {
  if (!scrollEl.value) return
  const el = scrollEl.value
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

let scrollRaf = 0
function onScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    lastScrollAt = Date.now()
    scrollTop.value = scrollEl.value?.scrollTop || 0
  })
}

let resizeObs = null
onMounted(() => {
  if (scrollEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => measure())
    resizeObs.observe(scrollEl.value)
  }
})
onBeforeUnmount(() => {
  resizeObs?.disconnect()
  clearTimeout(layoutTimer)
  if (layoutRaf) cancelAnimationFrame(layoutRaf)
})

// ---------------------------------------------------------------- 渲染

const visibleItems = computed(() => {
  // 依赖版本号：几何只写普通字段，全量/增量布局完成后自增一次，触发本屏重算
  void layoutVersion.value
  const top = scrollTop.value - props.preload
  const bottom = scrollTop.value + viewportH.value + props.preload
  return items.value.filter((it) => it.y + it.h > top && it.y < bottom)
})

/** item 是否落在「精确可视区」（非缓冲）内 */
function inViewport(item) {
  const top = scrollTop.value
  const bottom = top + viewportH.value
  return item.y + item.h > top && item.y < bottom
}

/** img 的 loading 属性：可视区内立即加载，缓冲区内按开关决定懒加载 */
function loadMode(item) {
  return inViewport(item) ? 'eager' : props.bufferLazy ? 'lazy' : 'eager'
}

/** img 的 fetchpriority：可视区内高优先级，缓冲区低优先级（懒加载关闭时回到 auto） */
function priorityMode(item) {
  return inViewport(item) ? 'high' : props.bufferLazy ? 'low' : 'auto'
}

function srcFor(item) {
  // 已知有缩略图时用 ?size=thumb（与无缩略图时的 URL 不同，避免复用缓存建立前的原图）
  return buildImageUrl(props.rootId, item.absPath, item.hasThumb ? 'thumb' : 'auto')
}

function extOf(item) {
  const n = item?.name || ''
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i + 1).toLowerCase() : ''
}

function onImgLoad(item, e) {
  const img = e.target
  if (img.naturalWidth && img.naturalHeight) {
    rememberDims(props.rootId, item.absPath, img.naturalWidth, img.naturalHeight)
    const prevH = item.h
    item._loaded = { w: img.naturalWidth, h: img.naturalHeight }
    item.width = img.naturalWidth
    item.height = img.naturalHeight
    // 比例与占位一致（如缓存索引已带尺寸）就不必重排；确有出入才排队批量提交
    const naturalRatio = img.naturalHeight / img.naturalWidth
    const cappedRatio = props.capTall && naturalRatio > MAX_TILE_RATIO ? MAX_TILE_RATIO : naturalRatio
    const newH = itemW ? itemW * cappedRatio : 0
    if (Math.abs(newH - prevH) > 0.5) {
      scheduleLayoutCommit()
    }
  }
}

function openLightbox(item) {
  lightboxIndex.value = items.value.findIndex((it) => it.absPath === item.absPath)
}
function closeLightbox() {
  lightboxIndex.value = -1
}

// ---------------------------------------------------------------- 点击 / 快速复制

function handleItemClick(item, e) {
  if (props.quickCopy) {
    doQuickCopy(item, e)
    return
  }
  openLightbox(item)
}

async function toggleFav(item) {
  try {
    await favoritesStore.toggle({ id: props.rootId }, item)
  } catch (err) {
    ElMessage.error(String(err?.message || t('common.operationFailed')))
  }
}

async function doQuickCopy(item, e) {
  try {
    const abs = item.absPath
    if (props.quickCopyType === 'file') {
      if (window.api?.copyFile) {
        await window.api.copyFile(abs)
      } else {
        await copyViaCanvas(e)
      }
      ElMessage.success(t('lightbox.copiedFile'))
    } else {
      if (window.api?.copyImagePath) {
        await window.api.copyImagePath(abs)
      } else {
        await copyViaCanvas(e)
      }
      ElMessage.success(t('lightbox.copied'))
    }
  } catch (err) {
    ElMessage.error(t('lightbox.copyFailed', { error: String(err?.message || err) }))
  }
}

// 浏览器调试回退：把点击到的 <img> 转成 dataURL 复制（dev-mock 环境）
async function copyViaCanvas(e) {
  const img = e?.target?.closest?.('img')
  if (!img || !img.naturalWidth || !window.api?.copyImageDataUrl) {
    throw new Error('not supported')
  }
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d').drawImage(img, 0, 0)
  await window.api.copyImageDataUrl(canvas.toDataURL('image/png'))
}
</script>

<template>
  <div ref="scrollEl" class="waterfall-scroll" @scroll.passive="onScroll">
    <div v-if="loading" class="waterfall-state">
      <el-icon class="is-loading" :size="24"><VideoPlay /></el-icon>
      <span>{{ t('waterfall.loading') }}</span>
    </div>

    <div v-else-if="error" class="waterfall-state">
      <el-empty :description="t('waterfall.loadFailed', { error })">
        <el-button size="small" type="primary" plain @click="load">{{ t('waterfall.retry') }}</el-button>
      </el-empty>
    </div>

    <div v-else-if="!items.length" class="waterfall-state">
      <el-empty
        :description="
          props.emptyText || (isSearching ? t('waterfall.noSearchResult') : t('waterfall.empty'))
        "
      />
    </div>

    <div v-else class="waterfall-inner" :style="{ height: totalHeight + 'px' }">
      <div
        v-for="item in visibleItems"
        :key="item.absPath"
        class="waterfall-item"
        :class="{
          'wf-name-none': props.nameMode === 'none',
          'wf-name-always': props.nameMode === 'always',
          'wf-ext-none': props.extMode === 'none',
          'wf-ext-always': props.extMode === 'always',
          'wf-fav-none': props.favMode === 'none',
          'wf-fav-always': props.favMode === 'always',
          'wf-text-none': props.textMatchMode === 'none',
          'wf-text-always': props.textMatchMode === 'always'
        }"
        :style="{
          transform: `translate(${item.x}px, ${item.y}px)`,
          width: item.w + 'px',
          height: item.h + 'px'
        }"
        @click="handleItemClick(item, $event)"
      >
        <GifThumb
          v-if="isGifName(item.name)"
          :root-id="rootId"
          :item="item"
          :play-mode="gifStore.playMode"
          :thumb-source="gifStore.thumbSource"
          :native-loading="loadMode(item)"
          :native-priority="priorityMode(item)"
          :class="{ 'fit-contain': isTallCapped(item) }"
          @load="onImgLoad(item, $event)"
        />
        <img
          v-else
          :src="srcFor(item)"
          :alt="item.name"
          draggable="false"
          decoding="async"
          :class="{ 'fit-contain': isTallCapped(item) }"
          :loading="loadMode(item)"
          :fetchpriority="priorityMode(item)"
          @load="onImgLoad(item, $event)"
        />
        <button
          type="button"
          class="waterfall-fav"
          :class="{ 'is-fav': favoritesStore.isFav(item.absPath) }"
          :title="item.name"
          @click.stop="toggleFav(item)"
        >
          <el-icon :size="13">
            <Star v-if="!favoritesStore.isFav(item.absPath)" />
            <StarFilled v-else />
          </el-icon>
        </button>
        <span v-if="extOf(item)" class="waterfall-badge">{{ extOf(item) }}</span>
        <span v-if="item.match === 'text'" class="waterfall-text-badge">
          {{ t('waterfall.textMatch') }}
        </span>
        <div class="waterfall-hover">
          <span class="waterfall-name">{{ item.name }}</span>
        </div>
      </div>
    </div>

    <Lightbox
      v-if="lightboxIndex >= 0 && items.length"
      :root-id="rootId"
      :items="items"
      :index="lightboxIndex"
      @close="closeLightbox"
      @change="(i) => (lightboxIndex = i)"
    />
  </div>
</template>

<style scoped>
.waterfall-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  padding: 0 8px 24px;
}

.waterfall-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--app-text-secondary);
  font-size: 13px;
}

.waterfall-inner {
  position: relative;
  width: 100%;
}

.waterfall-item {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.waterfall-item:hover {
  z-index: 2;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.waterfall-item:hover img {
  transform: scale(1.03);
}

.waterfall-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.25s ease;
  background: var(--panel-bg);
}

/* 超长图高度限制开启时：整图等比显示（不被裁剪），卡片比例已封顶 1:5 */
.waterfall-item img.fit-contain {
  object-fit: contain;
}

.waterfall-hover {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6px 8px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent);
  color: #fff;
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
}

.waterfall-item:hover .waterfall-hover {
  opacity: 1;
}

.wf-name-always .waterfall-hover {
  opacity: 1;
}

.wf-name-none .waterfall-hover {
  display: none;
}

.waterfall-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 1px 6px;
  font-size: 11px;
  line-height: 16px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
  text-transform: lowercase;
}

.waterfall-item:hover .waterfall-badge {
  opacity: 1;
}

.wf-ext-always .waterfall-badge {
  opacity: 1;
}

.wf-ext-none .waterfall-badge {
  display: none;
}

/* 图内文字命中角标：左下角，提示“该图因图内文字被搜到” */
.waterfall-text-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 1px 6px;
  font-size: 11px;
  line-height: 16px;
  border-radius: 4px;
  background: rgba(64, 120, 255, 0.82);
  color: #fff;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.waterfall-item:hover .waterfall-text-badge {
  opacity: 1;
}

.wf-text-always .waterfall-text-badge {
  opacity: 1;
}

.wf-text-none .waterfall-text-badge {
  display: none;
}

.waterfall-fav {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.waterfall-fav:hover {
  background: rgba(0, 0, 0, 0.6);
  color: #ffd04b;
}

.waterfall-item:hover .waterfall-fav {
  opacity: 1;
}

.waterfall-fav.is-fav {
  color: #ffd04b;
}

.waterfall-fav.is-fav:hover {
  color: #fff;
}

.wf-fav-always .waterfall-fav {
  opacity: 1;
}

.wf-fav-none .waterfall-fav {
  display: none;
}

.waterfall-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
