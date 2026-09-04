<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
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
  // 收藏列表（“我的收藏”视图）：非 null 时直接渲染这些图片
  favItems: { type: Array, default: null },
  // 覆盖空态文案（如“我的收藏”为空时的提示）
  emptyText: { type: String, default: '' }
})

const gifStore = useGifStore()
const favoritesStore = useFavoritesStore()

const GAP = 10
const COL_BASE_WIDTH = 200
const OVERSCAN = 900
const FALLBACK_RATIO = 0.75

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

const items = ref([])
const loading = ref(false)
const error = ref('')

const scrollEl = ref(null)
const scrollTop = ref(0)
const viewportH = ref(0)
const containerW = ref(0)
const totalHeight = ref(0)

const lightboxIndex = ref(-1)

// ---------------------------------------------------------------- 布局

function calcCols() {
  if (!containerW.value) return 1
  const colMin = COL_BASE_WIDTH / Math.max(0.05, props.zoom)
  // 不再硬限制列数：zoom 越大 colMin 越小，列数随之增加，缩放持续生效
  return Math.max(1, Math.floor((containerW.value + GAP) / (colMin + GAP)))
}

/** 已知真实比例时返回比例，未知返回 null */
function rawRatio(item) {
  if (item.width && item.height) return item.height / item.width
  if (item._loaded) return item._loaded.h / item._loaded.w
  return null
}

function doLayout() {
  // 1) 用内存里的真实尺寸回填（缓存索引缺失时），避免重复抖动
  for (const it of items.value) {
    if (it.width && it.height) continue
    const d = knownDims(props.rootId, it.absPath)
    if (d) {
      it.width = d.w
      it.height = d.h
    }
  }

  // 2) 占位比例：用本屏已知图片比例均值，尽量贴近真实（不再一律 3:4）
  let sum = 0
  let n = 0
  for (const it of items.value) {
    const r = rawRatio(it)
    if (r != null) {
      sum += r
      n++
    }
  }
  const avgRatio = n ? sum / n : FALLBACK_RATIO

  const cols = calcCols()
  const colH = new Array(cols).fill(0)
  const itemW = (containerW.value - GAP * (cols - 1)) / cols
  for (const item of items.value) {
    const h = itemW * (rawRatio(item) ?? avgRatio)
    let col = 0
    let minH = Infinity
    for (let i = 0; i < cols; i++) {
      if (colH[i] < minH) {
        minH = colH[i]
        col = i
      }
    }
    item.x = col * (itemW + GAP)
    item.y = colH[col]
    item.w = itemW
    item.h = h
    colH[col] += h + GAP
  }
  totalHeight.value = Math.max(...colH, 0)
}

let layoutTimer = null
function scheduleLayout() {
  clearTimeout(layoutTimer)
  layoutTimer = setTimeout(doLayout, 120)
}

// ---------------------------------------------------------------- 数据

const isSearching = computed(() => !!props.searchQuery && props.searchQuery.trim() !== '')

function initItems(list) {
  return (list || []).map((it) => ({ ...it, x: 0, y: 0, w: 0, h: 0, _loaded: null }))
}

async function load() {
  if (Array.isArray(props.favItems)) {
    items.value = initItems(props.favItems)
    totalHeight.value = 0
    await nextTick()
    doLayout()
    return
  }
  if (Array.isArray(props.aiResults)) {
    items.value = initItems(props.aiResults)
    totalHeight.value = 0
    await nextTick()
    doLayout()
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
    doLayout()
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.rootId, props.folderPath, props.searchQuery, props.aiResults, props.favItems],
  load,
  { immediate: true }
)

// 缩放变化 → 重新布局
watch(() => props.zoom, doLayout)

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
    doLayout()
  }
}

let scrollRaf = 0
function onScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
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
})

// ---------------------------------------------------------------- 渲染

const visibleItems = computed(() => {
  const top = scrollTop.value - OVERSCAN
  const bottom = scrollTop.value + viewportH.value + OVERSCAN
  return items.value.filter((it) => it.y + it.h > top && it.y < bottom)
})

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
    item._loaded = { w: img.naturalWidth, h: img.naturalHeight }
    item.width = img.naturalWidth
    item.height = img.naturalHeight
    scheduleLayout()
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
          'wf-fav-always': props.favMode === 'always'
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
          @load="onImgLoad(item, $event)"
        />
        <img
          v-else
          :src="srcFor(item)"
          :alt="item.name"
          draggable="false"
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
