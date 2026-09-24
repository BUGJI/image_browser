import { app, Tray, Menu, nativeImage } from 'electron'
import icon from '../../resources/icon.png?asset'
import { getSetting, setSetting } from './settings'
import { getMainWindow, getSettingsWindow, createMainWindow } from './windows'
import { t } from './i18n'

/**
 * 托盘常驻 + 关闭行为策略
 *
 * 关闭行为配置（settings 表 closeAction）：
 *   'ask'  — 每次询问（默认，无配置时）
 *   'tray' — 最小化到托盘
 *   'quit' — 关闭软件（直接退出）
 */

let tray = null
let isQuitting = false
let closeAskPending = false

export function getCloseAction() {
  return getSetting('closeAction', 'ask')
}

// 隐藏到托盘（主窗口 + 设置窗口一起隐藏）
export function hideToTray() {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.hide()
  const sw = getSettingsWindow()
  if (sw && !sw.isDestroyed()) sw.hide()
}

// 从托盘恢复主窗口
export function showMainWindow() {
  let win = getMainWindow()
  if (!win || win.isDestroyed()) {
    win = createMainWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

// 真正退出（托盘菜单「退出」/ 询问框选「关闭软件」）
export function quitApp() {
  isQuitting = true
  app.quit()
}

/**
 * 主窗口 close 拦截：
 *   - quit：不阻止，正常关闭（window-all-closed 里再退出）
 *   - tray：阻止 + 隐藏到托盘
 *   - ask：阻止 + 通知渲染进程弹询问框
 */
export function attachWindowCloseBehavior(win) {
  win.on('close', (e) => {
    if (isQuitting) return
    const action = getCloseAction()
    if (action === 'quit') return

    e.preventDefault()
    if (action === 'tray') {
      hideToTray()
      return
    }

    // ask：弹询问框（防重复触发）
    if (closeAskPending) return
    closeAskPending = true
    if (!win.isDestroyed()) {
      win.webContents.send('window:ask-close')
    }
  })
}

// 渲染进程询问框结果回传：{ action: 'tray' | 'quit', remember?: boolean }
export function registerTrayIpc({ ipcMain }) {
  ipcMain.handle('window:ask-close-result', (_e, payload) => {
    const action = payload?.action === 'quit' ? 'quit' : 'tray'
    const remember = !!payload?.remember
    closeAskPending = false

    if (remember) {
      setSetting('closeAction', action)
    }

    if (action === 'quit') {
      quitApp()
    } else {
      hideToTray()
    }
    return true
  })
}

export function createTray() {
  if (tray) return tray
  const image = nativeImage.createFromPath(icon)
  tray = new Tray(image)
  tray.setToolTip('Image Browser')

  const menu = Menu.buildFromTemplate([
    { label: t('tray.open'), click: showMainWindow },
    { type: 'separator' },
    { label: t('tray.quit'), click: quitApp }
  ])
  tray.setContextMenu(menu)

  // 左键点击打开（Windows/Linux 生效；macOS 点击弹菜单，菜单首项即打开）
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  return tray
}

// 所有窗口关闭：托盘常驻不退出；仅「正在退出」或配置为「关闭软件」时退出
export function handleWindowAllClosed() {
  if (!tray || isQuitting || getCloseAction() === 'quit') {
    app.quit()
  }
}
