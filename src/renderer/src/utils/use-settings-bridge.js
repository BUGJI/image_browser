import { useThemeStore } from '../stores/theme'
import { useLocaleStore } from '../stores/locale'
import { useAnimationsStore } from '../stores/animations'
import { useGifStore } from '../stores/gif'

/**
 * 设置加载与变更广播桥接：把「应用启动时的 store 初始化」与
 * 「主进程 settings-changed 广播分发到各全局 store」集中到一处。从 App.vue 拆出。
 *
 * @param {Object} deps
 * @param {(key: string, value: string) => void} deps.applySettingChange useSettings 的归一化入口
 * @param {Function} [deps.onAiSearchChange] AI 搜索开关变化时的额外处理（主界面固定关闭）
 */
export function useSettingsBridge({ applySettingChange, onAiSearchChange }) {
  const themeStore = useThemeStore()
  const localeStore = useLocaleStore()
  const animationsStore = useAnimationsStore()
  const gifStore = useGifStore()

  /** 初始化全局主题/语言/动图（先加载动画开关，主题过渡依赖它） */
  async function init() {
    await animationsStore.load()
    themeStore.load()
    localeStore.load()
    await gifStore.load()
  }

  /** 处理主进程 settings-changed 广播：优先 AI 搜索特殊处理，再归一化并分发到各 store */
  function onSettingsChanged({ key, value }) {
    if (key === 'aiSearchEnabled') onAiSearchChange?.()
    applySettingChange(key, value)
    themeStore.onSettingsChanged({ key, value })
    localeStore.onSettingsChanged({ key, value })
    animationsStore.onSettingsChanged({ key, value })
    gifStore.onSettingsChanged({ key, value })
  }

  return { init, onSettingsChanged }
}
