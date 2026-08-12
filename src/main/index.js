import { app, ipcMain, BrowserWindow, dialog, clipboard, nativeImage, protocol, net } from 'electron'
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
  handleWindowAllClosed
} from './tray'
import {
  initRootsTable,
  listRoots,
  addRoot,
  updateRoot,
  removeRoot,
  reorderRoots
} from './roots'
import { scanDirTree, ScanAbortedError } from './fs-scan.mjs'
import {
  registerCacheIpc,
  registerImageProtocol,
  handleImagesList
} from './cache'
import { initLogger } from './logger'
import { checkForUpdates } from './updater'

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
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  // 检测更新：目前为桩实现，始终返回已是最新
  ipcMain.handle('app:check-update', () => checkForUpdates())

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

  // 复制图片到剪贴板（直接读文件，避免自定义协议下 canvas 污染）
  ipcMain.handle('clipboard:write-image-path', (_e, absPath) => {
    const img = nativeImage.createFromPath(absPath)
    if (img.isEmpty()) throw new Error('无法读取图片文件')
    clipboard.writeImage(img)
    return true
  })

  // --- 托盘关闭行为 ---
  registerTrayIpc({ ipcMain })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.openclaw.image-browser')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 初始化 SQLite + 设置表 + 根目录表
  initDb()
  initSettingsTable()
  initRootsTable()

  // 日志模块（开发者选项「记录日志」开关；替换 console + 注册 IPC + 监听渲染进程 console）
  initLogger()

  // image:// 图片协议（webp 优先，回退原图）
  registerImageProtocol({ protocol, net })

  registerIpc()

  const mainWindow = createMainWindow()
  attachWindowCloseBehavior(mainWindow)
  createTray()

  // 「每次启动检测更新」开关：启动后自动检查（桩实现，接入真实逻辑后在此通知用户）
  if (getSetting('checkUpdateOnStartup', 'false') === 'true') {
    checkForUpdates()
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// 托盘常驻：窗口全关不自动退出（除非正在退出或配置为「关闭软件」）
app.on('window-all-closed', handleWindowAllClosed)
