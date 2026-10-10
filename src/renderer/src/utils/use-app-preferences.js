import { ref } from 'vue'

/**
 * 主界面本地偏好：瀑布流缩放 / 浏览模式 / 快速复制。从 App.vue 拆出。
 * 这些项仅本地记忆（localStorage），不经过主进程设置。
 */
const ZOOM_STORAGE_KEY = 'waterfall-zoom'
const BROWSE_MODE_KEY = 'browse-mode'
const QUICK_COPY_KEY = 'quick-copy'
export const ZOOM_MIN = 0.5
const DEFAULT_ZOOM = 1.5

export function useAppPreferences() {
  // 瀑布流缩放：值越大 item 越小，一行容纳更多图片
  const itemZoom = ref(DEFAULT_ZOOM)
  // 浏览模式：瀑布流（保持原比例） / 矩形（等高卡片，超出部分裁切）
  const browseMode = ref('waterfall') // 'waterfall' | 'rect'
  // 快速复制：开启后点击图片直接复制（类型见设置-常规），不进灯箱
  const quickCopyEnabled = ref(false)

  function saveZoom() {
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(itemZoom.value))
    } catch {
      /* ignore */
    }
  }

  function toggleBrowseMode() {
    browseMode.value = browseMode.value === 'waterfall' ? 'rect' : 'waterfall'
    try {
      localStorage.setItem(BROWSE_MODE_KEY, browseMode.value)
    } catch {
      /* ignore */
    }
  }

  function toggleQuickCopy() {
    quickCopyEnabled.value = !quickCopyEnabled.value
    try {
      localStorage.setItem(QUICK_COPY_KEY, quickCopyEnabled.value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  /** 启动恢复：快速复制 / 浏览模式 / 缩放（记忆缩放开启时钳制到 [ZOOM_MIN, zoomMax]） */
  function load({ rememberZoom = false, zoomMax = DEFAULT_ZOOM } = {}) {
    try {
      quickCopyEnabled.value = localStorage.getItem(QUICK_COPY_KEY) === '1'
    } catch {
      /* ignore */
    }
    try {
      browseMode.value = localStorage.getItem(BROWSE_MODE_KEY) === 'rect' ? 'rect' : 'waterfall'
    } catch {
      /* ignore */
    }
    if (rememberZoom) {
      try {
        const saved = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY))
        if (Number.isFinite(saved)) {
          itemZoom.value = Math.min(zoomMax, Math.max(ZOOM_MIN, saved))
        }
      } catch {
        /* ignore */
      }
    } else {
      itemZoom.value = DEFAULT_ZOOM
    }
  }

  return {
    itemZoom,
    browseMode,
    quickCopyEnabled,
    saveZoom,
    toggleBrowseMode,
    toggleQuickCopy,
    load,
    ZOOM_MIN
  }
}
