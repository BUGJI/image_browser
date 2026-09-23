<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

import Lightbox from './Lightbox.vue'
import GifThumb from './GifThumb.vue'
import VideoThumb from './VideoThumb.vue'
import { isGifName, isVideoName } from '../utils/image-url'
import { useGifStore } from '../stores/gif'
import { useFavoritesStore } from '../stores/favorites'
import { useWaterfallLayout } from '../utils/use-waterfall-layout'
import { useImageLoader } from '../utils/use-image-loader'

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
  // 卡片比例限制（设置-开发者选项-瀑布流）：开 = 宽高比限制在 1:5 ~ 2:1（宽:高），
  // 更长的图封顶 1:5、更宽的图封底 2:1，超出的整图等比适配显示
  capTall: { type: Boolean, default: true },
  // 浏览模式：waterfall = 瀑布流（保持原比例）；rect = 矩形（等高卡片，object-fit: cover 裁切超出部分）
  mode: { type: String, default: 'waterfall' }
})

const gifStore = useGifStore()
const favoritesStore = useFavoritesStore()

// 虚拟布局引擎 + 图片加载调度（实现见 utils/use-waterfall-layout.js / use-image-loader.js）
const layout = useWaterfallLayout(props)
const {
  items,
  layoutVersion,
  totalHeight,
  setItems,
  visibleItems,
  inViewport,
  isRatioCapped,
  scheduleFullLayout,
  applyInitialLayout,
  appendItems,
  reflowIncremental,
  reflowFull,
  updateScrollTop,
  onItemLoaded,
  observeResize,
  disconnectResize,
  cancelPending: cancelLayout
} = layout

const loader = useImageLoader(props, { visibleItems, inViewport })
const {
  srcFor,
  loadMode,
  priorityMode,
  deferLoad,
  primeViewportSrcs,
  scheduleIdlePump,
  enterScroll,
  scheduleScrollIdle,
  reset: resetSrcCache,
  cancelPending: cancelLoader
} = loader

const scrollEl = ref(null)
const loading = ref(false)
const error = ref('')

// 分页 / 无限滚动：大根目录首批只取一页，滚动接近底部再追加下一页
const PAGE_SIZE = 300
let loadedOffset = 0 // 已加载条数（下一页 offset）
let loadToken = 0 // 请求代次：换目录/换搜索时作废在途请求
const hasMore = ref(false)
const loadingMore = ref(false)

const lightboxIndex = ref(-1)

// 媒体（图/GIF/视频）实际加载完成的版本号：渲染时读取以驱动骨架屏显隐。
// 按帧合并自增，避免同屏多张图各自触发一次重渲染。
const mediaVersion = ref(0)
let mediaRaf = 0
function bumpMediaVersion() {
  if (mediaRaf) return
  mediaRaf = requestAnimationFrame(() => {
    mediaRaf = 0
    mediaVersion.value++
  })
}
function isMediaLoaded(item) {
  void mediaVersion.value
  return !!item._loaded || !!item._failed
}

// ---------------------------------------------------------------- 数据

const isSearching = computed(() => !!props.searchQuery && props.searchQuery.trim() !== '')

function extOfName(name) {
  const n = name || ''
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i + 1).toLowerCase() : ''
}

function initItems(list) {
  return (list || []).map((it) => ({
    ...it,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    col: 0,
    _loaded: null,
    _ext: extOfName(it.name)
  }))
}

/** 当前列表对应的 imagesList 前三个参数（搜索模式忽略 folderPath）。
 * 必须始终占满 searchQuery 位，否则后续 opts 会错位顶替成 searchQuery。 */
function listArgs() {
  return isSearching.value
    ? [props.rootId, null, props.searchQuery]
    : [props.rootId, props.folderPath, null]
}

/** 拉取一页，兼容旧版纯数组返回 */
async function fetchPage(offset) {
  const page = await window.api.imagesList(...listArgs(), { offset, limit: PAGE_SIZE })
  if (Array.isArray(page)) return { items: page, total: page.length }
  return { items: page?.items || [], total: page?.total ?? page?.items?.length ?? 0 }
}

async function load() {
  // 外部直接注入的列表（收藏 / 标签 / AI 结果）优先渲染，不拉取 imagesList
  const injected = [props.favItems, props.tagItems, props.aiResults].find((v) => Array.isArray(v))
  if (injected) {
    loadToken++
    hasMore.value = false
    loadingMore.value = false
    setItems(initItems(injected))
    totalHeight.value = 0
    await nextTick()
    applyInitialLayout()
    return
  }

  if (!isSearching.value && !props.folderPath) {
    loadToken++
    hasMore.value = false
    loadingMore.value = false
    setItems([])
    totalHeight.value = 0
    return
  }

  const token = ++loadToken
  loading.value = true
  error.value = ''
  hasMore.value = false
  loadingMore.value = false
  loadedOffset = 0
  try {
    const page = await fetchPage(0)
    if (token !== loadToken) return
    loadedOffset = page.items.length
    setItems(initItems(page.items))
    hasMore.value = loadedOffset < page.total
    await nextTick()
    applyInitialLayout()
  } catch (err) {
    if (token !== loadToken) return
    error.value = String(err?.message || err)
  } finally {
    if (token === loadToken) {
      loading.value = false
      maybeLoadMore()
    }
  }
}

/** 追加下一页（滚动接近底部时调用，失败保持现状待下次滚动重试） */
async function loadMore() {
  if (loadingMore.value || !hasMore.value || loading.value) return
  const token = loadToken
  loadingMore.value = true
  try {
    const page = await fetchPage(loadedOffset)
    if (token !== loadToken) return
    if (!page.items.length) {
      hasMore.value = false
      return
    }
    appendItems(initItems(page.items))
    loadedOffset += page.items.length
    hasMore.value = loadedOffset < page.total
  } catch {
    /* 忽略：保留已加载内容 */
  } finally {
    if (token === loadToken) loadingMore.value = false
  }
}

/** 剩余可滚动高度不足一个预载距离时，提前拉下一页 */
function maybeLoadMore() {
  if (!hasMore.value || loadingMore.value || loading.value) return
  const el = scrollEl.value
  if (!el) return
  if (totalHeight.value - el.scrollTop - el.clientHeight < props.preload) loadMore()
}

watch(
  () => [
    props.rootId,
    props.folderPath,
    props.searchQuery,
    props.aiResults,
    props.favItems,
    props.tagItems
  ],
  load,
  { immediate: true }
)

// 缩放变化 → 全量重建布局（rAF 合并，避免滑块连发时逐 tick 全表重算）
watch(() => props.zoom, scheduleFullLayout)

// 卡片比例限制开关变化：即时按新比例刷新（保留列分配，增量重排即可）
watch(() => props.capTall, reflowIncremental)

// 浏览模式切换：瀑布流 ↔ 矩形，整表重新布局
watch(() => props.mode, reflowFull)

// 缓存维护完成后 → 重新加载（此时 hasThumb 更新，改用缩略图 URL）。
// 必须先清空已分配的 src 缓存，否则旧的原图 URL 命中缓存不会升级为缩略图。
watch(
  () => props.refreshTick,
  () => {
    if (props.refreshTick > 0) {
      resetSrcCache()
      load()
    }
  }
)

// ---------------------------------------------------------------- 滚动/尺寸

let scrollRaf = 0
function onScroll() {
  // 立即进入滚动态：暂停缓冲区加载（滚动优先）
  enterScroll()
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    updateScrollTop(scrollEl.value?.scrollTop || 0)
    // 只保证严格可视区图片有 src；缓冲区等滚动空闲后由 idle 调度填充
    primeViewportSrcs()
    scheduleScrollIdle()
    maybeLoadMore()
  })
}

onMounted(() => observeResize(scrollEl.value))
onBeforeUnmount(() => {
  loadToken++ // 作废在途分页请求，避免卸载后追加
  disconnectResize()
  cancelLayout()
  cancelLoader()
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  if (mediaRaf) cancelAnimationFrame(mediaRaf)
})

// 布局完成（首屏/换目录/缩放/尺寸变化/追加分页）后：可视区立即取图，缓冲区空闲时再填。
// 同时检查是否需要继续拉下一页（首屏不足一屏时自动填充）。
watch(layoutVersion, () => {
  primeViewportSrcs()
  scheduleIdlePump()
  maybeLoadMore()
})

// 换根目录：URL 依赖 rootId，清空已分配缓存
watch(() => props.rootId, resetSrcCache)

// 图片就绪：回填真实尺寸并按需排队增量重排；同时驱动骨架屏隐藏
function onImgLoad(item, e) {
  const img = e.target
  const nw = img.naturalWidth || img.videoWidth
  const nh = img.naturalHeight || img.videoHeight
  onItemLoaded(item, nw, nh)
  bumpMediaVersion()
}

// 加载失败（文件被删/损坏/格式不支持）：结束骨架屏，保留估算尺寸
function onImgError(item) {
  item._failed = true
  bumpMediaVersion()
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
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
      <span>{{ t('waterfall.loading') }}</span>
    </div>

    <div v-else-if="error" class="waterfall-state">
      <el-empty :description="t('waterfall.loadFailed', { error })">
        <el-button size="small" type="primary" plain @click="load">{{
          t('waterfall.retry')
        }}</el-button>
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
        role="button"
        tabindex="0"
        :aria-label="item.name"
        @click="handleItemClick(item, $event)"
        @keydown.enter.prevent="handleItemClick(item, $event)"
        @keydown.space.prevent="handleItemClick(item, $event)"
      >
        <!-- 占位骨架：媒体加载完成前显示，加载后移除 -->
        <div v-if="!isMediaLoaded(item)" class="waterfall-skeleton" aria-hidden="true" />
        <!-- 加载失败：移出媒体元素（否则浏览器会显示破损图标 + alt 文件名），改用占位 -->
        <template v-if="!item._failed">
          <VideoThumb
            v-if="isVideoName(item.name)"
            :root-id="rootId"
            :item="item"
            :play-mode="gifStore.webmAsGif ? gifStore.playMode : 'none'"
            :defer-load="deferLoad(item)"
            :native-priority="priorityMode(item)"
            :class="{ 'fit-contain': isRatioCapped(item) }"
            @load="onImgLoad(item, $event)"
            @error="onImgError(item)"
          />
          <GifThumb
            v-else-if="isGifName(item.name)"
            :root-id="rootId"
            :item="item"
            :play-mode="gifStore.playMode"
            :thumb-source="gifStore.thumbSource"
            :defer-load="deferLoad(item)"
            :native-loading="loadMode(item)"
            :native-priority="priorityMode(item)"
            :class="{ 'fit-contain': isRatioCapped(item) }"
            @load="onImgLoad(item, $event)"
            @error="onImgError(item)"
          />
          <img
            v-else
            :src="srcFor(item) || undefined"
            :alt="item.name"
            draggable="false"
            decoding="async"
            :class="{ 'fit-contain': isRatioCapped(item) }"
            :loading="loadMode(item)"
            :fetchpriority="priorityMode(item)"
            @load="onImgLoad(item, $event)"
            @error="onImgError(item)"
          />
        </template>
        <div v-else class="waterfall-broken" :title="item.name" aria-hidden="true">
          <el-icon :size="22"><PictureFilled /></el-icon>
        </div>
        <span
          v-if="isVideoName(item.name) && !gifStore.webmAsGif && !item._failed"
          class="waterfall-play-badge"
        >
          <el-icon :size="20"><VideoPlay /></el-icon>
        </span>
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
        <span v-if="item._ext" class="waterfall-badge">{{ item._ext }}</span>
        <span v-if="item.match === 'text'" class="waterfall-text-badge">
          {{ t('waterfall.textMatch') }}
        </span>
        <div class="waterfall-hover">
          <span class="waterfall-name">{{ item.name }}</span>
        </div>
      </div>
    </div>

    <!-- 分页追加中的底部loading（不遮挡已有内容） -->
    <div v-if="loadingMore" class="waterfall-more" aria-hidden="true">
      <el-icon class="is-loading" :size="18"><Loading /></el-icon>
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
  /* 左右留白由父级 RootView 的 --content-gutter 统一提供，避免与标题/横幅错位 */
  padding: 0 0 24px;
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

.waterfall-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 0 8px;
  color: var(--app-text-secondary);
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
  transition: box-shadow 0.18s ease;
}

.waterfall-item:hover,
.waterfall-item:focus-visible {
  z-index: 2;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.waterfall-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

/* 占位骨架：底层的流光动画，媒体加载完成后由 v-if 移除 */
.waterfall-skeleton {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: linear-gradient(
    100deg,
    var(--panel-bg) 30%,
    var(--panel-hover) 50%,
    var(--panel-bg) 70%
  );
  background-size: 200% 100%;
  animation: waterfall-skeleton-shimmer 1.2s ease-in-out infinite;
}

/* 加载失败占位：替换破损的 <img>，只留一个淡淡的图标 */
.waterfall-broken {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-secondary);
  opacity: 0.5;
}

@keyframes waterfall-skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* 媒体置于骨架之上；背景透明以便骨架透出 */
.waterfall-item > img,
.waterfall-item > video,
.waterfall-item > .gif-thumb-pending,
.waterfall-item > .video-thumb-pending {
  position: relative;
  z-index: 1;
}

.waterfall-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.25s ease;
  background: transparent;
}

.waterfall-item:hover img {
  transform: scale(1.03);
}

.waterfall-item video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: transparent;
  transition: transform 0.25s ease;
}

.waterfall-item:hover video {
  transform: scale(1.03);
}

/* 比例限制开启时：整图等比显示（不被裁剪），卡片比例已限制在 1:5 ~ 2:1 */
.waterfall-item img.fit-contain {
  object-fit: contain;
}

.waterfall-item video.fit-contain {
  object-fit: contain;
}

.waterfall-play-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  pointer-events: none;
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
  transition:
    opacity 0.18s ease,
    background 0.18s ease,
    color 0.18s ease;
}

.waterfall-fav:hover {
  background: rgba(0, 0, 0, 0.6);
  color: #ffd04b;
}

.waterfall-item:hover .waterfall-fav,
.waterfall-item:focus-within .waterfall-fav {
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
