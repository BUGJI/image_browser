import { ref } from 'vue'
import { DEFAULT_SHORTCUTS, loadShortcuts } from './shortcuts'

/**
 * 灯箱设置读取：快捷键 / 滚轮行为 / 扩展功能开关 / 动图处理 / 缩放限制。
 * 从 Lightbox.vue 拆出；所有设置项并发读取（避免十几次串行 IPC 往返）。
 *
 * @returns refs + load({ setZoomConfig })；setZoomConfig 来自 useLightboxZoom
 */
export function useLightboxSettings() {
  const shortcuts = ref({ ...DEFAULT_SHORTCUTS })
  const wheelAction = ref('zoom')
  // 扩展功能开关：收藏夹 / 标签（功能总开关 × 灯箱按钮显示开关）
  const favoritesEnabled = ref(true)
  const favLightboxBtn = ref(true)
  const tagsEnabled = ref(true)
  const tagsLightboxBtn = ref(true)
  // WebM 是否按动图（GIF 同类）处理：循环静音自动播放
  const webmAsGif = ref(false)

  const parseNum = (raw, fb) => {
    const n = parseFloat(raw || '')
    return Number.isFinite(n) && n > 0 ? n : fb
  }

  async function load({ setZoomConfig } = {}) {
    const api = window.api
    const [savedShortcuts, wa, favEnabled, favBtn, tagEnabled, tagBtn, webmGif, zmin, zmax, zstep] =
      await Promise.all([
        loadShortcuts(),
        api?.getSetting('lightboxWheelAction', 'zoom'),
        api?.getSetting('favoritesEnabled', 'true'),
        api?.getSetting('favoritesLightboxBtn', 'true'),
        api?.getSetting('tagsEnabled', 'true'),
        api?.getSetting('tagsLightboxBtn', 'true'),
        api?.getSetting('webmAsGif', 'false'),
        api?.getSetting('lightboxZoomMin', '0.5'),
        api?.getSetting('lightboxZoomMax', '8'),
        api?.getSetting('lightboxZoomStep', '1.2')
      ])
    shortcuts.value = savedShortcuts
    wheelAction.value = ['zoom', 'navigate'].includes(wa) ? wa : 'zoom'
    favoritesEnabled.value = favEnabled !== 'false'
    favLightboxBtn.value = favBtn !== 'false'
    tagsEnabled.value = tagEnabled !== 'false'
    tagsLightboxBtn.value = tagBtn !== 'false'
    webmAsGif.value = webmGif === 'true'
    // 读取开发者选项里的灯箱缩放限制
    setZoomConfig?.({
      min: parseNum(zmin, 0.5),
      max: parseNum(zmax, 8),
      step: parseNum(zstep, 1.2)
    })
  }

  return {
    shortcuts,
    wheelAction,
    favoritesEnabled,
    favLightboxBtn,
    tagsEnabled,
    tagsLightboxBtn,
    webmAsGif,
    load
  }
}
