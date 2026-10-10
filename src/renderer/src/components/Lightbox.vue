<script setup>
import { ref, watch, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useEventListener, useScrollLock } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { buildImageUrl, isVideoName } from '../utils/image-url'
import { useFavoritesStore } from '../stores/favorites'
import { useLightboxZoom } from '../utils/use-lightbox-zoom'
import { useLightboxSettings } from '../utils/use-lightbox-settings'
import { useLightboxPreload } from '../utils/use-lightbox-preload'
import { useLightboxActions } from '../utils/use-lightbox-actions'
import { useLightboxKeyboard } from '../utils/use-lightbox-keyboard'

const { t } = useI18n()
const favoritesStore = useFavoritesStore()

/**
 * 灯箱：查看原图 + 键盘导航（←/→/Esc）
 * 复制：快捷键可自定义（默认 Ctrl+C 复制原文件 / Ctrl+Shift+C 复制图片）。
 * 复制图片实现：img → canvas → PNG blob → navigator.clipboard；失败回退主进程剪贴板
 */
const props = defineProps({
  rootId: { type: Number, required: true },
  items: { type: Array, default: () => [] },
  index: { type: Number, required: true }
})

const emit = defineEmits(['close', 'change'])

// 对话框语义与焦点管理：遮罩持有焦点、Tab 在灯箱内循环、关闭后归还焦点
const maskRef = ref(null)
let previouslyFocused = null
// 打开期间锁定 body 滚动（避免背景随滚轮/方向键滚动）
const bodyScrollLocked = useScrollLock(document.body, true)

// 单一数据源：cur 直接映射父级 index，navigation 通过 emit('change') 回写，
// 避免「内部 cur + props.index 双 watcher」导致每次切图重复 reset/preload。
const cur = computed({
  get: () => props.index,
  set: (v) => emit('change', v)
})
const imgRef = ref(null)
const videoRef = ref(null)
const loading = ref(true)
const loadError = ref('')

// 图片缩放/平移视图（以中心为缩放锚点）；限制来自「设置 - 开发者选项」
const {
  view,
  imgStyle,
  resetView,
  zoomIn,
  zoomOut,
  onImgMouseDown,
  onWinMouseMove,
  onWinMouseUp,
  setZoomConfig
} = useLightboxZoom()

// 设置读取（快捷键 / 滚轮行为 / 扩展功能开关 / 动图处理 / 缩放限制）
const {
  shortcuts,
  wheelAction,
  favoritesEnabled,
  favLightboxBtn,
  tagsEnabled,
  tagsLightboxBtn,
  webmAsGif,
  load: loadSettings
} = useLightboxSettings()

// 相邻原图预加载
const { preloadNeighbors, cancelPreload } = useLightboxPreload({
  getItems: () => props.items,
  getIndex: () => cur.value,
  getRootId: () => props.rootId
})

// 复制 / 收藏 / 标签交互
const {
  copied,
  copyFile,
  copyImage,
  onCopyImageClick,
  toggleFavCurrent,
  tagPopOpen,
  tagBusy,
  selTagNames,
  tagOptions,
  onTagPopShow,
  onTagNamesChange,
  dispose: disposeActions
} = useLightboxActions({
  getItem: () => current.value,
  getRootId: () => props.rootId,
  videoRef,
  imgRef
})

// 键盘导航 / 复制快捷键 / Tab 焦点陷阱（全局 keydown 监听随之自动清理）
useLightboxKeyboard({
  maskRef,
  onPrev: prev,
  onNext: next,
  onClose: close,
  onCopyFile: copyFile,
  onCopyImage: copyImage,
  getShortcuts: () => shortcuts.value
})

// 全局监听随组件卸载自动清理（@vueuse/core）
useEventListener(window, 'mousemove', onWinMouseMove)
useEventListener(window, 'mouseup', onWinMouseUp)

// 滚轮：navigate 模式节流连跳；zoom 模式缩放（视频交给原生控件，不拦截）
let navCooldownAt = 0
function onWheel(e) {
  if (isVideo.value) return
  e.preventDefault()
  if (wheelAction.value === 'navigate') {
    const now = Date.now()
    if (now - navCooldownAt < 150) return
    navCooldownAt = now
    if (e.deltaY > 0) next()
    else prev()
    return
  }
  if (e.deltaY > 0) zoomOut()
  else zoomIn()
}

const current = computed(() => props.items[cur.value] || null)
const isVideo = computed(() => isVideoName(current.value?.name))

function resetState() {
  loading.value = true
  loadError.value = ''
  copied.value = ''
}

function resetForImage() {
  resetView()
  resetState()
  const v = videoRef.value
  if (v) {
    try {
      v.pause()
      v.currentTime = 0
    } catch {
      /* ignore */
    }
  }
}

watch(cur, () => {
  resetForImage()
  preloadNeighbors()
})

function prev() {
  if (cur.value > 0) cur.value--
}
function next() {
  if (cur.value < props.items.length - 1) cur.value++
}
function close() {
  emit('close')
}

function onImgLoad() {
  loading.value = false
  loadError.value = ''
}

function onImgError() {
  loading.value = false
  loadError.value = t('lightbox.origLoadFailed')
}

// 视频首帧就绪：结束 loading 并显式播放（动态切换 src 时 autoplay 属性不一定会触发）
function onVideoReady() {
  loading.value = false
  loadError.value = ''
  videoRef.value?.play?.().catch(() => {})
}

onMounted(async () => {
  // 记住打开前的焦点，关闭时归还；并把初始焦点移入灯箱
  previouslyFocused = document.activeElement
  await nextTick()
  maskRef.value?.focus?.()
  await loadSettings({ setZoomConfig })
  preloadNeighbors()
})
onBeforeUnmount(() => {
  cancelPreload()
  disposeActions()
  bodyScrollLocked.value = false
  previouslyFocused?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="maskRef"
      class="lightbox-mask"
      role="dialog"
      aria-modal="true"
      :aria-label="t('lightbox.dialogLabel')"
      tabindex="-1"
      @click.self="close"
    >
      <div class="lightbox-toolbar">
        <span class="lightbox-count">
          {{ cur + 1 }} / {{ items.length }}
          <span class="lightbox-name">{{ current?.name || '' }}</span>
        </span>
        <div class="lightbox-toolbar-right">
          <el-popover
            v-if="tagsEnabled && tagsLightboxBtn"
            v-model:visible="tagPopOpen"
            placement="bottom-end"
            :width="280"
            trigger="click"
            popper-class="lightbox-tag-popper"
            @show="onTagPopShow"
          >
            <template #reference>
              <button
                class="lb-btn"
                :class="{ 'lb-btn-tag-active': selTagNames.length }"
                :title="t('lightbox.tagImage')"
              >
                <el-icon :size="16"><CollectionTag /></el-icon>
              </button>
            </template>
            <div class="lightbox-tag-editor">
              <div class="lightbox-tag-title">{{ t('lightbox.tagImage') }}</div>
              <el-select
                v-model="selTagNames"
                multiple
                filterable
                allow-create
                :reserve-keyword="false"
                :default-first-option="false"
                collapse-tags
                :max-collapse-tags="2"
                :placeholder="t('lightbox.tagSelectPlaceholder')"
                :disabled="tagBusy"
                class="lightbox-tag-select"
                @change="onTagNamesChange"
              >
                <el-option
                  v-for="opt in tagOptions"
                  :key="opt.id"
                  :label="opt.name"
                  :value="opt.name"
                />
              </el-select>
              <p class="lightbox-tag-tip">{{ t('lightbox.tagSelectTip') }}</p>
            </div>
          </el-popover>

          <el-tooltip
            v-if="favoritesEnabled && favLightboxBtn"
            :content="
              favoritesStore.isFav(current?.absPath)
                ? t('lightbox.favRemove')
                : t('lightbox.favAdd')
            "
            placement="bottom"
          >
            <button
              class="lb-btn lb-btn-fav"
              :class="{ 'is-fav': favoritesStore.isFav(current?.absPath) }"
              @click="toggleFavCurrent"
            >
              <el-icon :size="16">
                <Star v-if="!favoritesStore.isFav(current?.absPath)" />
                <StarFilled v-else />
              </el-icon>
            </button>
          </el-tooltip>
          <el-tooltip
            :content="t('lightbox.copyFileTip', { key: shortcuts.copyFile })"
            placement="bottom"
          >
            <button
              class="lb-btn"
              :class="{ 'lb-btn-copied': copied === 'file' }"
              @click="copyFile"
            >
              <el-icon :size="16"><Files /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip
            :content="t('lightbox.copyImageTip', { key: shortcuts.copyImage })"
            placement="bottom"
          >
            <button
              class="lb-btn"
              :class="{ 'lb-btn-copied': copied === 'image' }"
              @click="onCopyImageClick"
            >
              <el-icon :size="16"><CopyDocument /></el-icon>
            </button>
          </el-tooltip>
          <button
            class="lb-btn"
            :title="t('lightbox.close')"
            :aria-label="t('lightbox.close')"
            @click="close"
          >
            <el-icon :size="16"><Close /></el-icon>
          </button>
        </div>
      </div>

      <button
        v-if="cur > 0"
        class="lb-nav lb-nav-left"
        :title="t('lightbox.prev')"
        :aria-label="t('lightbox.prev')"
        @click="prev"
      >
        <el-icon :size="26"><ArrowLeft /></el-icon>
      </button>
      <button
        v-if="cur < items.length - 1"
        class="lb-nav lb-nav-right"
        :title="t('lightbox.next')"
        :aria-label="t('lightbox.next')"
        @click="next"
      >
        <el-icon :size="26"><ArrowRight /></el-icon>
      </button>

      <div class="lightbox-stage" @click.self="close" @wheel="onWheel">
        <div v-show="loading" class="lightbox-loading">
          <el-icon class="is-loading" :size="30"><Loading /></el-icon>
          <span>{{ t('lightbox.loadingOrig') }}</span>
        </div>
        <div v-if="loadError" class="lightbox-error">
          <el-icon :size="30"><CircleCloseFilled /></el-icon>
          <span>{{ loadError }}</span>
        </div>
        <video
          v-if="current && isVideo"
          ref="videoRef"
          class="lightbox-video"
          :src="buildImageUrl(rootId, current.absPath, 'orig')"
          :controls="!webmAsGif"
          :loop="webmAsGif"
          :muted="webmAsGif"
          autoplay
          crossorigin="anonymous"
          @loadeddata="onVideoReady"
          @error="onImgError"
        />
        <img
          v-else-if="current"
          ref="imgRef"
          class="lightbox-img"
          :class="{ 'is-pannable': view.scale > 1 }"
          :src="buildImageUrl(rootId, current.absPath, 'orig')"
          :alt="current.name"
          :style="imgStyle"
          draggable="false"
          @load="onImgLoad"
          @error="onImgError"
          @mousedown="onImgMouseDown"
          @dblclick="resetView"
        />
        <span v-if="!isVideo && view.scale > 1" class="lightbox-zoom-badge">
          {{ Math.round(view.scale * 100) }}%
        </span>
      </div>

      <div class="lightbox-hint">
        <template v-if="shortcuts.copyFile">
          <kbd class="hint-key">{{ shortcuts.copyFile }}</kbd
          >{{ t('lightbox.copyFileAction') }}<i class="hint-sep">·</i>
        </template>
        <template v-if="shortcuts.copyImage">
          <kbd class="hint-key">{{ shortcuts.copyImage }}</kbd
          >{{ t('lightbox.copyImageAction') }}<i class="hint-sep">·</i>
        </template>
        <span>{{ t('lightbox.navHint') }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lightbox-mask {
  position: fixed;
  inset: 0;
  z-index: 5000;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 自绘顶栏窗口顶部是 -webkit-app-region: drag 的拖拽区（原生 caption），
     会抢走灯箱顶栏按钮的点击/右键。整屏覆盖层声明 no-drag 即可把这部分
     从拖拽区中挖出来，灯箱内全部可正常交互。 */
  -webkit-app-region: no-drag;
}

.lightbox-toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  color: #fff;
  z-index: 2;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent);
}

.lightbox-count {
  font-size: 13px;
  color: #e5e6eb;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.lightbox-name {
  color: #9aa0a6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40vw;
}

.lightbox-toolbar-right {
  display: flex;
  gap: 8px;
}

.lb-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.lb-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}

.lb-btn-copied {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.22);
}

.lb-btn-fav.is-fav {
  color: #ffd04b;
  background: rgba(255, 208, 75, 0.18);
}

.lb-btn-tag-active {
  color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.18);
}

.lb-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  width: 46px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  transition: background 0.2s;
}

.lb-nav:hover {
  background: rgba(255, 255, 255, 0.28);
}

.lb-nav-left {
  left: 18px;
}

.lb-nav-right {
  right: 18px;
}

.lightbox-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 60px 72px 48px;
  box-sizing: border-box;
}

.lightbox-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  user-select: none;
  -webkit-user-drag: none;
}

.lightbox-img.is-pannable {
  cursor: grab;
  /* 仅在放大可平移时提升合成层，避免常驻占用 */
  will-change: transform;
}

.lightbox-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  background: #000;
  outline: none;
  z-index: 1;
}

.lightbox-img.is-pannable:active {
  cursor: grabbing;
}

.lightbox-zoom-badge {
  position: absolute;
  top: 64px;
  right: 28px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}

.lightbox-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #b9bec4;
  font-size: 13px;
}

.lightbox-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #f56c6c;
  font-size: 13px;
}

.lightbox-hint {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  white-space: nowrap;
  z-index: 2;
}

.hint-key {
  font-family: inherit;
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #e5e6eb;
}

.hint-sep {
  font-style: normal;
  color: rgba(255, 255, 255, 0.3);
}
</style>

<style>
/* 灯箱标签编辑面板（el-popover 挂 body 下，需全局样式） */
.lightbox-tag-popper {
  padding: 6px;
}

.lightbox-tag-editor {
  min-height: 90px;
}

.lightbox-tag-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.lightbox-tag-select {
  width: 100%;
}

.lightbox-tag-tip {
  margin: 8px 0 2px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
