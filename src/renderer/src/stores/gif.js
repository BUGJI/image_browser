import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * GIF 动图设置（仅作用于网格缩略图；灯箱始终显示原图播放）
 * - gifPlayMode：网格卡片里 GIF 的播放方式
 *     'all'   = 全部播放（直接显示原图动画，默认，与旧版一致）
 *     'hover' = 悬停后播放（平时首帧海报，鼠标悬停播放原图，移开停止）
 *     'none'  = 不播放（始终显示首帧海报）
 * - gifThumbSource：GIF 首帧海报的来源
 *     'disk'     = 记录磁盘缓存（缓存维护时生成 webp 首帧缩略图，默认）
 *     'realtime' = 实时获取（渲染进程按需解首帧，不写磁盘缓存，节省空间消耗性能）
 * - webmAsGif：是否把 WebM 视频当作动图（GIF 同类）处理：
 *     开 = 网格遵循 gifPlayMode（首帧海报实时获取、可播放），灯箱循环静音自动播放；
 *     关 = 网格显示静态首帧 + 播放角标，灯箱带原生控件播放。
 * 持久化到主进程 settings 表；主窗口与设置窗口共用（监听 settings:changed 广播保持同步）
 */
export const useGifStore = defineStore('gif', () => {
  const playMode = ref('all') // 'all' | 'hover' | 'none'
  const thumbSource = ref('disk') // 'disk' | 'realtime'
  const webmAsGif = ref(false)

  function normalizeMode(v) {
    return v === 'hover' || v === 'none' ? v : 'all'
  }

  function normalizeSource(v) {
    return v === 'realtime' ? 'realtime' : 'disk'
  }

  async function load() {
    playMode.value = normalizeMode(await window.api.getSetting('gifPlayMode', 'all'))
    thumbSource.value = normalizeSource(await window.api.getSetting('gifThumbSource', 'disk'))
    webmAsGif.value = (await window.api.getSetting('webmAsGif', 'false')) === 'true'
  }

  async function setPlayMode(v) {
    const mode = normalizeMode(v)
    playMode.value = mode
    try {
      await window.api.setSetting('gifPlayMode', mode)
    } catch {
      /* 浏览器调试环境无 window.api 时忽略 */
    }
  }

  async function setThumbSource(v) {
    const source = normalizeSource(v)
    thumbSource.value = source
    try {
      await window.api.setSetting('gifThumbSource', source)
    } catch {
      /* 浏览器调试环境无 window.api 时忽略 */
    }
  }

  async function setWebmAsGif(v) {
    webmAsGif.value = !!v
    try {
      await window.api.setSetting('webmAsGif', webmAsGif.value ? 'true' : 'false')
    } catch {
      /* 浏览器调试环境无 window.api 时忽略 */
    }
  }

  function onSettingsChanged(payload) {
    if (payload?.key === 'gifPlayMode') {
      playMode.value = normalizeMode(payload.value)
    } else if (payload?.key === 'gifThumbSource') {
      thumbSource.value = normalizeSource(payload.value)
    } else if (payload?.key === 'webmAsGif') {
      webmAsGif.value = payload.value === 'true'
    }
  }

  return {
    playMode,
    thumbSource,
    webmAsGif,
    load,
    setPlayMode,
    setThumbSource,
    setWebmAsGif,
    onSettingsChanged
  }
})
