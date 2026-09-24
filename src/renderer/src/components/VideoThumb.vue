<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { buildImageUrl } from '../utils/image-url'
import { getVideoPosterUrl, retainVideoPoster, releaseVideoPoster } from '../utils/video-poster'

/**
 * 网格卡片里的视频缩略图组件（替代原生 <img>）
 *
 * 与 GifThumb 同构，按 playMode 分发：
 *   all   = 全部播放：直接显示原视频（自动播放、循环、静音）
 *   none  = 不播放：始终显示首帧海报（视频模式下即静态预览）
 *   hover = 悬停播放：平时首帧海报，鼠标进入播放，离开暂停
 *
 * 海报由 video-poster.js 实时取首帧生成（objectURL），失败时回退 <video>。
 * 组件根节点为 <video> 或 <img>，父级 .waterfall-item 作用域样式可命中。
 * load 事件原样转发给父级（onImgLoad 兼容 videoWidth/videoHeight）。
 */

const props = defineProps({
  rootId: { type: Number, required: true },
  item: { type: Object, required: true },
  // 'all' | 'hover' | 'none'
  playMode: { type: String, default: 'none' },
  // 透传给根元素的 fetchpriority（可视区优先加载）
  nativePriority: { type: String, default: 'auto' },
  // 滚动中且处于缓冲区时为 true：暂不加载/取首帧，等滚动空闲再补（给滚动让路）
  deferLoad: { type: Boolean, default: false }
})
const emit = defineEmits(['load', 'error'])

const videoUrl = computed(() => buildImageUrl(props.rootId, props.item.absPath, 'orig'))

const posterUrl = ref('')
const posterState = ref('idle') // idle | loading | ready | failed
const hovering = ref(false)

const needPoster = computed(() => props.playMode !== 'all')
const showVideo = computed(
  () => props.playMode === 'all' || (props.playMode === 'hover' && hovering.value)
)

// 引用计数：实时取帧得到的 objectURL 在组件存活期间不可被海报缓存逐出回收
let retainedAbs = ''
function retainRealtime(abs) {
  if (retainedAbs === abs) return
  if (retainedAbs) releaseVideoPoster(props.rootId, retainedAbs)
  retainedAbs = abs
  if (abs) retainVideoPoster(props.rootId, abs)
}
function releaseRealtime() {
  if (retainedAbs) {
    releaseVideoPoster(props.rootId, retainedAbs)
    retainedAbs = ''
  }
}
onBeforeUnmount(releaseRealtime)

let resolveSeq = 0
async function ensurePoster() {
  if (!needPoster.value || props.deferLoad) return
  if (posterState.value === 'ready') return
  const seq = ++resolveSeq
  posterState.value = 'loading'
  retainRealtime(props.item.absPath)
  const url = await getVideoPosterUrl(props.rootId, props.item.absPath)
  if (seq !== resolveSeq) return
  posterState.value = url ? 'ready' : 'failed'
  posterUrl.value = url
  if (!url) releaseRealtime() // 失败回退 <video>，无需再保留
}

watch(() => props.playMode, ensurePoster)
watch(needPoster, (need) => {
  if (need) ensurePoster()
})
// 滚动停止（deferLoad 解除）后补取首帧
watch(
  () => props.deferLoad,
  (d) => {
    if (!d) ensurePoster()
  }
)
ensurePoster()

function onEnter() {
  if (props.playMode === 'hover' && needPoster.value) hovering.value = true
}
function onLeave() {
  hovering.value = false
}

const videoEl = ref(null)

function emitLoad(e) {
  emit('load', e)
}

function onVideoReady(e) {
  emitLoad(e)
  if (showVideo.value) videoEl.value?.play?.().catch(() => {})
}

watch(showVideo, (show) => {
  const v = videoEl.value
  if (!v) return
  if (show) v.play?.().catch(() => {})
  else {
    try {
      v.pause()
      v.currentTime = 0
    } catch {
      /* ignore */
    }
  }
})
</script>

<template>
  <video
    v-if="!deferLoad && (showVideo || posterState === 'failed')"
    ref="videoEl"
    :src="videoUrl"
    :fetchpriority="nativePriority"
    :autoplay="showVideo"
    :loop="showVideo"
    muted
    playsinline
    preload="auto"
    @loadeddata="onVideoReady"
    @error="emit('error', $event)"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  />
  <img
    v-else-if="!deferLoad && posterUrl"
    :src="posterUrl"
    :alt="item.name"
    draggable="false"
    decoding="async"
    :fetchpriority="nativePriority"
    @load="emitLoad($event)"
    @error="emit('error', $event)"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  />
  <div v-else class="video-thumb-pending" @mouseenter="onEnter" @mouseleave="onLeave" />
</template>

<style scoped>
.video-thumb-pending {
  width: 100%;
  height: 100%;
  /* 透明：让父级瀑布流的占位骨架透出 */
  background: transparent;
}
</style>
