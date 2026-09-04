import { app, ipcMain, BrowserWindow, dialog, clipboard, nativeImage, protocol, net, shell } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { initDb, queryOne } from './db'
import { initSettingsTable, getSetting, setSetting } from './settings'
import {
  createMainWindow,
  createSettingsWindow,
  getMainWindow,
  broadcast
} from './windows'
import {
  createTray,
  attachWindowCloseBehavior,
  registerTrayIpc,
  handleWindowAllClosed,
  showMainWindow
} from './tray'
import {
  initRootsTable,
  listRoots,
  addRoot,
  updateRoot,
  removeRoot,
  reorderRoots
} from './roots'
import {
  initFavoritesTable,
  listFavorites,
  toggleFavorite
} from './favorites'
import { scanDirTree, ScanAbortedError } from './fs-scan.mjs'
import {
  registerCacheIpc,
  registerImageProtocol,
  handleImagesList
} from './cache'
import { registerAiIpc } from './ai'
import { initLogger } from './logger'
import { checkForUpdates, getEffectiveVersion } from './updater'
import { readClipboardImageBuffer } from './image-decode'

// 自定义协议特权注册必须在 app ready 之前
// 注意：不能加 standard:true —— 会把数字 host（如 2）按 IPv4 规范化为 0.0.0.2，导致 rootId 解析失败
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'image',
    privileges: { secure: true, supportFetchAPI: true, stream: true }
  }
])

function registerIpc() {
  // --- 数据库 ---
  ipcMain.handle('db:version', () => {
    return queryOne('SELECT sqlite_version() AS version').version
  })

  // --- 窗口控制（自绘顶栏）---
  ipcMain.handle('window:minimize', () => {
    getMainWindow()?.minimize()
  })
  ipcMain.handle('window:toggle-maximize', () => {
    const win = getMainWindow()
    if (!win) return false
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
    return win.isMaximized()
  })
  ipcMain.handle('window:close', () => {
    getMainWindow()?.close()
  })

  // --- 设置窗口 ---
  ipcMain.handle('settings:open', () => {
    createSettingsWindow()
  })

  // --- 设置读写（SQLite）---
  ipcMain.handle('settings:get', (_e, key, fallback = null) => {
    return getSetting(key, fallback)
  })
  ipcMain.handle('settings:set', (_e, key, value) => {
    const before = getSetting(key, undefined)
    setSetting(key, value)
    if (before !== String(value)) {
      broadcast('settings:changed', { key, value: String(value) })
    }
    return true
  })

  // --- 应用 ---
  // 生效版本（设置-测试可覆盖，用于联调更新链路）
  ipcMain.handle('app:get-version', () => getEffectiveVersion())
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  // 检测更新：目前为桩实现，始终返回已是最新
  ipcMain.handle('app:check-update', () => checkForUpdates())

  // 用系统默认浏览器打开外部链接（仅允许 http/https）
  ipcMain.handle('shell:open-external', async (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  // --- 开发者工具开关 ---
  ipcMain.handle('devtools:toggle', (_e, open) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      if (open) {
        win.webContents.openDevTools({ mode: 'detach' })
      } else {
        win.webContents.closeDevTools()
      }
    }
    return true
  })

  // 开发者工具：关闭再重新打开（用于强制刷新 DevTools）
  ipcMain.handle('devtools:restart', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.closeDevTools()
      win.webContents.openDevTools({ mode: 'detach' })
    }
    return true
  })

  // --- 根目录注册 ---
  ipcMain.handle('roots:list', () => listRoots())
  ipcMain.handle('roots:add', (_e, path, alias) => {
    const root = addRoot(path, alias)
    broadcast('roots:changed')
    return root
  })
  ipcMain.handle('roots:update', (_e, id, path, alias) => {
    const root = updateRoot(id, path, alias)
    broadcast('roots:changed')
    return root
  })
  ipcMain.handle('roots:remove', (_e, id) => {
    removeRoot(id)
    broadcast('roots:changed')
    return true
  })
  ipcMain.handle('roots:reorder', (_e, ids) => {
    const roots = reorderRoots(Array.isArray(ids) ? ids.map(Number) : [])
    broadcast('roots:changed')
    return roots
  })

  // --- 图片收藏（按根目录独立） ---
  ipcMain.handle('favorites:list', (_e, rootId) => listFavorites(rootId))
  ipcMain.handle('favorites:toggle', (_e, rootId, item) => toggleFavorite(rootId, item))

  // 当前选中根目录（持久化到 settings 表）
  ipcMain.handle('roots:get-current', () => {
    const id = getSetting('currentRootId', '')
    return id ? Number(id) : null
  })
  ipcMain.handle('roots:set-current', (_e, id) => {
    const value = id == null ? '' : String(id)
    setSetting('currentRootId', value)
    broadcast('roots:current-changed', id == null ? null : Number(id))
    return true
  })

  // --- 目录树扫描（只收集文件夹；进度事件流 + 可中止）---
  let scanAbortController = null

  ipcMain.handle('fs:scan-tree', async (e, rootPath) => {
    if (!rootPath) return null
    // 新扫描开始前中止上一次
    scanAbortController?.abort()
    const ac = new AbortController()
    scanAbortController = ac

    const sender = e.sender
    let lastScanned = 0
    const send = (payload) => {
      if (!sender.isDestroyed()) sender.send('fs:scan-progress', payload)
    }

    try {
      const tree = await scanDirTree(rootPath, {
        onProgress: ({ scanned }) => {
          lastScanned = scanned
          send({ rootPath, scanned })
        },
        shouldAbort: () => ac.signal.aborted
      })
      send({ rootPath, scanned: lastScanned, done: true })
      return tree
    } catch (err) {
      if (err instanceof ScanAbortedError || ac.signal.aborted) {
        send({ rootPath, scanned: lastScanned, aborted: true })
        return null
      }
      throw err
    }
  })

  ipcMain.handle('fs:scan-abort', () => {
    scanAbortController?.abort()
    return true
  })

  // --- 系统目录选择器 ---
  ipcMain.handle('dialog:select-directory', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? getMainWindow()
    const result = await dialog.showOpenDialog(win, {
      title: '选择图片根目录',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // --- 缓存维护（每根目录独立 .image_browser_cache）---
  registerCacheIpc({ ipcMain })

  // --- AI 语义搜索（向量索引维护 + 搜索）---
  registerAiIpc({ ipcMain })

  // 图片列表：优先缓存索引，无缓存回退即时扫描；searchQuery 非空时跨根目录搜索
  ipcMain.handle('images:list', (_e, rootId, folderPath, searchQuery) =>
    handleImagesList(rootId, folderPath, searchQuery)
  )

  // 复制图片到剪贴板（渲染端 canvas 导出 dataURL 后传入）
  ipcMain.handle('clipboard:write-image', (_e, dataUrl) => {
    const img = nativeImage.createFromDataURL(dataUrl)
    if (img.isEmpty()) throw new Error('无法解析图片数据')
    clipboard.writeImage(img)
    return true
  })

  // 复制图片到剪贴板（直接读文件，避免自定义协议下 canvas 污染；
  // nativeImage 解码不了的格式（GIF/WebP 等）自动转 PNG）
  ipcMain.handle('clipboard:write-image-path', async (_e, absPath) => {
    const buf = await readClipboardImageBuffer(absPath)
    if (!buf) throw new Error('无法读取或解码该图片（文件可能已被移动或格式不受支持）')
    const img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) throw new Error('无法读取或解码该图片（文件可能已被移动或格式不受支持）')
    clipboard.writeImage(img)
    return true
  })

  // 复制原文件到剪贴板（Windows 文件列表 CF_HDROP，可在文件管理器直接粘贴出文件）。
  // Electron 未提供写文件列表的 API，借 Windows PowerShell 的 Clipboard.SetFileDropList 实现。
  ipcMain.handle('clipboard:copy-file', (_e, absPath) => copyFileToClipboard(absPath))

  // --- 托盘关闭行为 ---
  registerTrayIpc({ ipcMain })
}

// 把单个文件以「文件」形式放入剪贴板（Windows CF_HDROP）。
// 借 PowerShell 的 Clipboard.SetFileDropList 实现（Electron 未提供写文件列表 API）。
function copyFileToClipboard(absPath) {
  return new Promise((resolve, reject) => {
    if (!absPath || !existsSync(absPath)) {
      reject(new Error('文件不存在或已被移动'))
      return
    }
    const winDir = process.env.WINDIR || 'C:\\Windows'
    const powershell = join(winDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    // 单引号包裹路径，路径内的单引号按 PS 规则双写转义
    const esc = absPath.replace(/'/g, "''")
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$c = New-Object 'System.Collections.Specialized.StringCollection'",
      `[void]$c.Add('${esc}')`,
      "[System.Windows.Forms.Clipboard]::SetFileDropList($c)"
    ].join('; ')
    const b64 = Buffer.from(script, 'utf16le').toString('base64')
    execFile(
      powershell,
      ['-NoProfile', '-STA', '-EncodedCommand', b64],
      { timeout: 15000, windowsHide: true },
      (err) => {
        if (err) reject(new Error('复制文件到剪贴板失败：' + err.message))
        else resolve(true)
      }
    )
  })
}

// 启动更新检测：等主窗口页面加载完成后执行，保证渲染进程已挂载好监听
function scheduleStartupUpdateCheck(win) {
  if (!win || win.isDestroyed()) return
  const web = win.webContents
  if (web.isLoadingMainFrame()) {
    web.once('did-finish-load', () => runStartupUpdateCheck(win))
  } else {
    runStartupUpdateCheck(win)
  }
}

async function runStartupUpdateCheck(win) {
  try {
    const res = await checkForUpdates()
    if (!res?.hasUpdate || !win || win.isDestroyed()) return
    win.webContents.send('app:update-available', {
      currentVersion: getEffectiveVersion(),
      latestVersion: res.latestVersion,
      downloadUrl: res.downloadUrl || '',
      releaseNotes: res.releaseNotes || ''
    })
  } catch {
    /* 检测失败静默 */
  }
}

// 单实例锁：只允许一个进程运行；第二个实例启动时直接退出并唤醒已有实例
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  startApp()
}

function startApp() {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.openclaw.image-browser')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 初始化 SQLite + 设置表 + 根目录表 + 收藏表
    initDb()
    initSettingsTable()
    initRootsTable()
    initFavoritesTable()

    // 日志模块（开发者选项「记录日志」开关；替换 console + 注册 IPC + 监听渲染进程 console）
    initLogger()

    // image:// 图片协议（webp 优先，回退原图）
    registerImageProtocol({ protocol, net })

    registerIpc()

    const mainWindow = createMainWindow()
    attachWindowCloseBehavior(mainWindow)
    createTray()

    // 「每次启动检测更新」开关：页面加载完成后自动检测，发现新版本推送给主窗口提示
    if (getSetting('checkUpdateOnStartup', 'false') === 'true') {
      scheduleStartupUpdateCheck(mainWindow)
    }

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

// 托盘常驻：窗口全关不自动退出（除非正在退出或配置为「关闭软件」）
app.on('window-all-closed', handleWindowAllClosed)
