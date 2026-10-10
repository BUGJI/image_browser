import { ref } from 'vue'
import { isGifName, isVideoName } from './image-url'
import { useFavoritesStore } from '../stores/favorites'
import { useGifStore } from '../stores/gif'

function extOfName(name) {
  const n = name || ''
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i + 1).toLowerCase() : ''
}

/**
 * 瀑布流卡片数据与媒体加载状态。从 WaterfallGrid.vue 拆出。
 * - initItems：把接口返回的图片项规整为布局/渲染所需的字段
 * - memoDeps：v-memo 依赖（卡片 DOM 只由这些原始值决定，命中即跳过 VNode 重建）
 * - mediaVersion / isMediaLoaded：媒体加载完成版本号（按帧合并）驱动骨架屏显隐
 *
 * @param {Object} props 组件 props（读取显示模式等）
 * @param {Object} deps 布局/加载器派生函数 { isRatioCapped, inViewport, loadMode, priorityMode, deferLoad }
 */
export function useWaterfallItems(
  props,
  { isRatioCapped, inViewport, loadMode, priorityMode, deferLoad }
) {
  const gifStore = useGifStore()
  const favoritesStore = useFavoritesStore()

  function initItems(list) {
    return (list || []).map((it) => ({
      ...it,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      col: 0,
      _loaded: null,
      _failed: false,
      _src: null,
      _ext: extOfName(it.name),
      _isVideo: isVideoName(it.name),
      _isGif: isGifName(it.name)
    }))
  }

  function memoDeps(item) {
    return [
      item.x,
      item.y,
      item.w,
      item.h,
      item._src,
      item._loaded,
      item._failed,
      item._isVideo,
      item._isGif,
      item._ext,
      item.match,
      favoritesStore.isFav(item.absPath),
      isRatioCapped(item),
      inViewport(item),
      loadMode(item),
      priorityMode(item),
      deferLoad(item),
      props.nameMode,
      props.extMode,
      props.favMode,
      props.textMatchMode,
      props.mode,
      props.capTall,
      gifStore.webmAsGif,
      gifStore.playMode,
      gifStore.thumbSource
    ]
  }

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
  function cancelMedia() {
    if (mediaRaf) cancelAnimationFrame(mediaRaf)
  }

  return {
    gifStore,
    favoritesStore,
    initItems,
    memoDeps,
    mediaVersion,
    bumpMediaVersion,
    isMediaLoaded,
    cancelMedia
  }
}
