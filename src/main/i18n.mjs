/**
 * 主进程 i18n 极简实现：仅覆盖主进程少量面向用户的文案（托盘菜单等）。
 * 渲染进程的完整文案见 src/renderer/src/i18n/。
 */
import { getSetting } from './settings'

const MESSAGES = {
  'zh-CN': {
    tray: {
      open: '打开 Image Browser',
      quit: '退出'
    }
  },
  'en-US': {
    tray: {
      open: 'Open Image Browser',
      quit: 'Quit'
    }
  }
}

const SUPPORTED = ['zh-CN', 'en-US']

export function currentLocale() {
  const saved = getSetting('language', 'zh-CN')
  return SUPPORTED.includes(saved) ? saved : 'zh-CN'
}

export function t(key) {
  const parts = key.split('.')
  let node = MESSAGES[currentLocale()] || MESSAGES['zh-CN']
  for (const part of parts) {
    node = node?.[part]
    if (node == null) return key
  }
  return typeof node === 'string' ? node : key
}
