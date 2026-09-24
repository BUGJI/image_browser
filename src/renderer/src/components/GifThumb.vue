<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { buildImageUrl } from '../utils/image-url'
import { getGifPosterUrl, retainGifPoster, releaseGifPoster } from '../utils/gif-poster'

/**
 * 网格卡片里的 GIF 缩略图组件（替代原生 <img>）
 *
 * 依据 gifPlayMode 分发：
 *   all   = 全部播放：src 直接用原图（GIF 自动播放，与旧版一致）
 *   none  = 不播放：始终显示首帧海报
 *   hover = 悬停播放：平时首帧海报，鼠标进入换原图播放，离开即停；再次进入从头播
 *
 * 海报来源（gifThumbSource）：
 *   disk     = 优先使用磁盘 webp 缩略图（hasThumb），缺失时临时实时解码兜底
 *   realtime = 忽略磁盘缩略图，一律实时解码首帧（不新增磁盘缓存）
 *
 * 组件根节点直接是 <img>（或加载中的占位 div），父级 .waterfall-item 的
 * 作用域样式（尺寸/object-fit/hover 缩放）可正常命中。
 * 布局校准：把 img 的 load 事件原样转发给父级（onImgLoad 读 naturalWidth）。
 */

const props = defineProps({
  rootId: { type: Number, required: true },
  item: { type: Object, required: true },
  // 'all' | 'hover' | 'none'
  playMode: { type: String, default: 'all' },
  // 'disk' | 'realtime'
  thumbSource: { type: String, default: 'disk' },
  // 透传给根 <img> 的原生 loading 属性（网格缓冲懒加载策略）
  nativeLoading: { type: String, default: 'eager' },
  // 透传给根 <img> 的 fetchpriority 属性（可视区优先解码）
  nativePriority: { type: String, default: 'auto' },
  // 滚动中且处于缓冲区时为 true：暂不加载/解码首帧，等滚动空闲再补（给滚动让路）
  deferLoad: { type: Boolean, default: false }
})
const emit = defineEmits(['load', 'error'])

const gifUrl = computed(() => buildImageUrl(props.rootId, props.item.absPath, 'orig'))
const diskPoster = computed(() =>
  props.item?.hasThumb ? buildImageUrl(props.rootId, props.item.absPath, 'thumb') : ''
)

// 海报状态：idle → loading → ready / failed（'' 表示尚未就绪）
const posterUrl = ref('')
const posterState = ref('idle')
const hovering = ref(false)

const needPoster = computed(() => props.playMode !== 'all')

const showGif = computed(
  () => props.playMode === 'all' || (props.playMode === 'hover' && hovering.value)
)

/** 当前 <img> 的 src；'' 时组件渲染占位块（不显示破损图标） */
const src = computed(() => {
  if (props.deferLoad) return '' // 滚动中的缓冲区：先不加载，滚动空闲后再补
  if (showGif.value) return gifUrl.value
  if (posterState.value === 'failed') return gifUrl.value // 解码失败兜底：宁可动图也有内容
  return posterUrl.value
})

// 引用计数：实时解码得到的 objectURL 在组件存活期间不可被海报缓存逐出回收
let retainedAbs = ''
function retainRealtime(abs) {
  if (retainedAbs === abs) return
  if (retainedAbs) releaseGifPoster(props.rootId, retainedAbs)
  retainedAbs = abs
  if (abs) retainGifPoster(props.rootId, abs)
}
function releaseRealtime() {
  if (retainedAbs) {
    releaseGifPoster(props.rootId, retainedAbs)
    retainedAbs = ''
  }
}
onBeforeUnmount(releaseRealtime)

let resolveSeq = 0
async function ensurePoster() {
  if (!needPoster.value || props.deferLoad) return
  const seq = ++resolveSeq
  // 磁盘来源且已有缩略图：直接复用缓存（不走实时解码，最快）
  if (props.thumbSource === 'disk' && diskPoster.value) {
    releaseRealtime()
    posterState.value = 'ready'
    posterUrl.value = diskPoster.value
    return
  }
  if (posterState.value === 'ready' && props.thumbSource !== 'realtime') return
  // 实时解码（disk 模式下 hasThumb=false 也临时走这里兜底）
  posterState.value = 'loading'
  posterUrl.value = ''
  retainRealtime(props.item.absPath)
  const url = await getGifPosterUrl(props.rootId, props.item.absPath)
  if (seq !== resolveSeq) return // 已有更新的解析请求，丢弃旧结果
  posterState.value = url ? 'ready' : 'failed'
  posterUrl.value = url
  if (!url) releaseRealtime() // 失败回退动图，无需再保留
}

// 播放模式 / 来源 / 缩略图就绪情况变化时刷新海报
watch(() => props.playMode, ensurePoster)
watch(() => props.thumbSource, ensurePoster)
watch(() => props.item?.hasThumb, ensurePoster)
watch(needPoster, (need) => {
  if (need) ensurePoster()
})
// 滚动停止（deferLoad 解除）后补生成首帧
watch(
  () => props.deferLoad,
  (d) => {
    if (!d) ensurePoster()
  }
)

function onEnter() {
  if (props.playMode === 'hover' && needPoster.value) hovering.value = true
}
function onLeave() {
  hovering.value = false
}

ensurePoster()
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="item.name"
    draggable="false"
    decoding="async"
    :loading="nativeLoading"
    :fetchpriority="nativePriority"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @load="emit('load', $event)"
    @error="emit('error', $event)"
  />
  <div v-else class="gif-thumb-pending" @mouseenter="onEnter" @mouseleave="onLeave" />
</template>

<style scoped>
.gif-thumb-pending {
  width: 100%;
  height: 100%;
  /* 透明：让父级瀑布流的占位骨架透出 */
  background: transparent;
}
</style>
