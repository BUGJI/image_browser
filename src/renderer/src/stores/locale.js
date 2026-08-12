import { defineStore } from 'pinia'
import { ref } from 'vue'
import { i18n, DEFAULT_LOCALE, normalizeLocale } from '../i18n'

/**
 * 全局界面语言
 * - 持久化到主进程 settings 表（key: language）
 * - 驱动 vue-i18n locale + Element Plus 组件库文案
 * - 主窗口与设置窗口共用（监听 settings:changed 广播保持同步）
 */
export const useLocaleStore = defineStore('locale', () => {
  const locale = ref(DEFAULT_LOCALE) // 'zh-CN' | 'en-US'

  function apply() {
    i18n.global.locale.value = locale.value
    document.documentElement.lang = locale.value
  }

  async function load() {
    const saved = await window.api.getSetting('language', DEFAULT_LOCALE)
    locale.value = normalizeLocale(saved)
    apply()
  }

  async function setLocale(l) {
    locale.value = normalizeLocale(l)
    apply()
    try {
      await window.api.setSetting('language', locale.value)
    } catch {
      /* 浏览器调试环境无 window.api 时忽略 */
    }
  }

  function onSettingsChanged(payload) {
    if (payload?.key === 'language') {
      locale.value = normalizeLocale(payload.value)
      apply()
    }
  }

  return { locale, apply, load, setLocale, onSettingsChanged }
})
