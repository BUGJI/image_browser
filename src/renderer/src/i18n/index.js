import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

// 支持的语言列表（settings 表 key: language）
export const LOCALES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' }
]

export const DEFAULT_LOCALE = 'zh-CN'

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
})

// 将任意设置值规范化为受支持的语言代码
export function normalizeLocale(value) {
  return LOCALES.some((l) => l.value === value) ? value : DEFAULT_LOCALE
}
