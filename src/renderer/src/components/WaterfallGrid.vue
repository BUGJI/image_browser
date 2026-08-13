<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import Lightbox from './Lightbox.vue'
import { buildImageUrl } from '../utils/image-url'

const { t } = useI18n()

/**
 * Pinterest 式瀑布流 + 虚拟滚动
 * - 多列绝对定位布局，图片高度来自缓存索引（width/height），缺失时 onload 校准
 * - 只渲染可视区域附近的 item（虚拟化），图片天然懒加载
 * - 缩略图优先（image:// auto → webp），无缓存回退原图
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
  aiResults: { type: Array, default: null }
})

const GAP = 10
const COL_BASE_WIDTH = 200
const OVERSCAN = 900

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

function itemRatio(item) {
  if (item.width && item.height) return item.height / item.width
  if (item._loaded) return item._loaded.h / item._loaded.w
  return 0.75 // 未知尺寸占位 3:4
}

function doLayout() {
  const cols = calcCols()
  const colH = new Array(cols).fill(0)
  const itemW = (containerW.value - GAP * (cols - 1)) / cols
  for (const item of items.value) {
    const h = itemW * itemRatio(item)
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

async function load() {
  if (Array.isArray(props.aiResults)) {
    items.value = props.aiResults.map((it) => ({
      ...it,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      _loaded: null
    }))
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
    items.value = (list || []).map((it) => ({
      ...it,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      _loaded: null
    }))
    await nextTick()
    doLayout()
  } catch (err) {
    error.value = String(err?.message || err)
  } finally {
    loading.value = false
  }
}

watch(() => [props.rootId, props.folderPath, props.searchQuery, props.aiResults], load, { immediate: true })

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

function onImgLoad(item, e) {
  const img = e.target
  if (img.naturalWidth && img.naturalHeight) {
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
      <el-empty :description="isSearching ? t('waterfall.noSearchResult') : t('waterfall.empty')" />
    </div>

    <div v-else class="waterfall-inner" :style="{ height: totalHeight + 'px' }">
      <div
        v-for="item in visibleItems"
        :key="item.absPath"
        class="waterfall-item"
        :style="{
          transform: `translate(${item.x}px, ${item.y}px)`,
          width: item.w + 'px',
          height: item.h + 'px'
        }"
        @click="openLightbox(item)"
      >
        <img
          :src="srcFor(item)"
          :alt="item.name"
          draggable="false"
          @load="onImgLoad(item, $event)"
        />
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

.waterfall-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
