import { screen, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getSetting, setSetting } from './settings'

/**
 * 窗口管理：主窗口 + 设置窗口（单例）
 */

let mainWindow = null
let settingsWindow = null

function getRendererUrl(page = 'index.html') {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return process.env['ELECTRON_RENDERER_URL'] + '/' + page
  }
  return join(__dirname, '../renderer/' + page)
}

// ---------------------------------------------------------------- 窗口状态记忆

function loadWindowState(key) {
  if (getSetting('rememberWindowSize', 'false') !== 'true') return null
  const raw = getSetting(key, '')
  if (!raw) return null
  try {
    const s = JSON.parse(raw)
    if (
      s &&
      Number.isFinite(s.width) &&
      s.width >= 200 &&
      Number.isFinite(s.height) &&
      s.height >= 200
    ) {
      return s
    }
  } catch {
    /* ignore */
  }
  return null
}

function isVisibleOnSomeDisplay(bounds) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      bounds.x < a.x + a.width &&
      bounds.x + bounds.width > a.x &&
      bounds.y < a.y + a.height &&
      bounds.y + bounds.height > a.y
    )
  })
}

function saveWindowState(win, key) {
  if (getSetting('rememberWindowSize', 'false') !== 'true') return
  if (!win || win.isDestroyed()) return
  let bounds
  try {
    bounds = win.getNormalBounds()
  } catch {
    bounds = win.getBounds()
  }
  setSetting(
    key,
    JSON.stringify({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen()
    })
  )
}

function attachWindowStateTracking(win, key) {
  let timer = null
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => saveWindowState(win, key), 300)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('enter-full-screen', schedule)
  win.on('leave-full-screen', schedule)
  win.on('close', () => {
    clearTimeout(timer)
    saveWindowState(win, key)
  })
}

function applyWindowState(win, key) {
  const s = loadWindowState(key)
  if (!s) return
  // 全屏状态优先：直接进入全屏，不再恢复边界
  if (s.fullscreen) {
    win.setFullScreen(true)
    return
  }
  // 只恢复仍位于某个显示器可视区域内的窗口
  if (isVisibleOnSomeDisplay(s)) {
    win.setBounds({ x: s.x, y: s.y, width: s.width, height: s.height })
  }
  if (s.maximized) win.maximize()
}

// ---------------------------------------------------------------- 主窗口

export function createMainWindow() {
  const titlebar = getSetting('titlebar', 'custom')
  // custom: 自绘顶栏（无边框）；system: 系统默认顶栏
  const frame = titlebar === 'system'

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  applyWindowState(mainWindow, 'mainWindowState')
  attachWindowStateTracking(mainWindow, 'mainWindowState')

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // 仅允许在系统浏览器打开 http(s) 链接，拒绝 file:/自定义协议等潜在危险 scheme
    if (/^https?:\/\//i.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 设置窗口始终保持在主窗口之上：主窗口获得焦点时，把设置窗口重新抬到最前
  mainWindow.on('focus', () => {
    const sw = settingsWindow
    if (sw && !sw.isDestroyed() && sw.isVisible()) {
      sw.moveTop()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(getRendererUrl('index.html'))
  } else {
    mainWindow.loadFile(getRendererUrl('index.html'))
  }
  return mainWindow
}

export function createSettingsWindow() {
  // 单例：已打开则聚焦
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 700,
    minHeight: 480,
    // 不要设置 parent：Windows 上 owned 子窗口不占独立任务栏按钮，
    // 最小化会退化到“缩到左下角”而不是进任务栏
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  applyWindowState(settingsWindow, 'settingsWindowState')
  attachWindowStateTracking(settingsWindow, 'settingsWindowState')

  settingsWindow.on('ready-to-show', () => {
    settingsWindow.show()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(getRendererUrl('settings.html'))
  } else {
    settingsWindow.loadFile(getRendererUrl('settings.html'))
  }
  return settingsWindow
}

export function getMainWindow() {
  return mainWindow
}

export function getSettingsWindow() {
  return settingsWindow
}

export function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}
