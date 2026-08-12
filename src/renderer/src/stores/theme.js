import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useAnimationsStore } from './animations'

/**
 * 全局主题：亮色 / 暗色
 * - 持久化到主进程 settings 表（key: theme）
 * - 通过 html.dark class 驱动 Element Plus 暗色变量 + 自定义暗色样式
 * - 主窗口与设置窗口共用（监听 settings:changed 广播保持同步）
 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref('light') // 'light' | 'dark'

  // 主题切换临时过渡类：切换瞬间给 html 加上，过渡结束移除
  let transitionTimer = null
  const THEME_TRANSITION_MS = 400

  function apply() {
    const html = document.documentElement
    // 开启全局渐变过渡（颜色/背景/边框），避免瞬间切换；
    // 「动画 - 主题过渡动画」关闭时不加过渡类，瞬间切换
    const animations = useAnimationsStore()
    clearTimeout(transitionTimer)
    if (animations.animTheme) {
      html.classList.add('theme-transition')
      transitionTimer = setTimeout(() => {
        html.classList.remove('theme-transition')
      }, THEME_TRANSITION_MS)
    } else {
      html.classList.remove('theme-transition')
    }
    html.classList.toggle('dark', mode.value === 'dark')
  }

  async function load() {
    // 主题启动方式：dark = 默认暗色；light = 默认亮色；last = 上次状态（默认）
    const startup = await window.api.getSetting('themeStartup', 'last')
    if (startup === 'dark') {
      mode.value = 'dark'
    } else if (startup === 'light') {
      mode.value = 'light'
    } else {
      const saved = await window.api.getSetting('theme', 'light')
      mode.value = saved === 'dark' ? 'dark' : 'light'
    }
    apply()
  }

  async function setMode(m) {
    mode.value = m === 'dark' ? 'dark' : 'light'
    apply()
    try {
      await window.api.setSetting('theme', mode.value)
    } catch {
      /* 浏览器调试环境无 window.api 时忽略 */
    }
  }

  function toggle() {
    setMode(mode.value === 'light' ? 'dark' : 'light')
  }

  function onSettingsChanged(payload) {
    if (payload?.key === 'theme') {
      mode.value = payload.value === 'dark' ? 'dark' : 'light'
      apply()
    }
  }

  return { mode, apply, load, setMode, toggle, onSettingsChanged }
})
