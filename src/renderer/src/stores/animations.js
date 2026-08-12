import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 动画开关：控制界面各动画效果是否启用
 * - 持久化到主进程 settings 表（animTheme / animNotify / animElement）
 * - 主窗口与设置窗口共用（监听 settings:changed 广播保持同步）
 * - 各开关默认开启（值为 'true' 或 'false'）
 */
export const useAnimationsStore = defineStore('animations', () => {
  // 主题过渡动画（亮暗切换渐变）
  const animTheme = ref(true)
  // 通知弹出/收起动画
  const animNotify = ref(true)
  // Element Plus 组件动画（弹窗/提示/菜单等）
  const animElement = ref(true)

  // 把「禁用组件动画」落到 html.no-element-anim 类（全局 CSS 关掉过渡/动画）
  function apply() {
    document.documentElement.classList.toggle('no-element-anim', !animElement.value)
  }

  async function load() {
    animTheme.value = (await window.api.getSetting('animTheme', 'true')) !== 'false'
    animNotify.value = (await window.api.getSetting('animNotify', 'true')) !== 'false'
    animElement.value = (await window.api.getSetting('animElement', 'true')) !== 'false'
    apply()
  }

  async function setFlag(key, value) {
    if (key === 'animTheme') animTheme.value = !!value
    else if (key === 'animNotify') animNotify.value = !!value
    else if (key === 'animElement') {
      animElement.value = !!value
      apply()
    }
    try {
      await window.api.setSetting(key, value ? 'true' : 'false')
    } catch {
      /* 浏览器调试环境无 window.api 时忽略 */
    }
  }

  function onSettingsChanged(payload) {
    if (payload?.key === 'animTheme') {
      animTheme.value = payload.value !== 'false'
    } else if (payload?.key === 'animNotify') {
      animNotify.value = payload.value !== 'false'
    } else if (payload?.key === 'animElement') {
      animElement.value = payload.value !== 'false'
      apply()
    }
  }

  return { animTheme, animNotify, animElement, apply, load, setFlag, onSettingsChanged }
})
