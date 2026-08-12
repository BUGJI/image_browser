import { app, ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync, createWriteStream } from 'fs'
import { getSetting } from './settings'

/**
 * 主进程日志模块（开发者选项「记录日志」开关控制）
 *
 * 开启后捕获三类日志并写入 <userData>/logs/app-YYYYMMDD.log：
 *   1. 主进程 console（log/debug/info/warn/error），通过替换 console 方法拦截
 *   2. 渲染进程 console（通过 webContents 'console-message' 事件转发）
 *   3. worker 线程日志（worker 内通过 parentPort 转发）
 *
 * 按天分文件，写入是 append 流，避免频繁打开文件。
 */

const LOG_DIR = 'logs'

let enabled = false
let logStream = null
let currentDate = ''
let rendererHookBound = false

function getLogDir() {
  return join(app.getPath('userData'), LOG_DIR)
}

function getLogPath(dateStr) {
  return join(getLogDir(), `app-${dateStr}.log`)
}

function today() {
  const d = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 打开（或复用）当天的日志流 */
function ensureStream() {
  const date = today()
  if (logStream && date === currentDate) return
  logStream?.end()
  mkdirSync(getLogDir(), { recursive: true })
  logStream = createWriteStream(getLogPath(date), { flags: 'a', encoding: 'utf8' })
  logStream.on('error', () => {
    /* 写盘失败不致命 */
  })
  currentDate = date
}

function formatArg(v) {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack || String(v)
  if (v instanceof Map || v instanceof Set) {
    try {
      return JSON.stringify(Object.fromEntries(v))
    } catch {
      return String(v)
    }
  }
  try {
    const s = JSON.stringify(v)
    return s === undefined ? String(v) : s
  } catch {
    return String(v)
  }
}

/**
 * 写入一条日志
 * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'} level
 * @param {string} source  'main' | 'renderer:<windowId>' | 'worker'
 * @param {...unknown} args
 */
function write(level, source, args) {
  if (!enabled) return
  const line = `[${new Date().toISOString()}] [${level}] [${source}] ${args.map(formatArg).join(' ')}`
  try {
    ensureStream()
    logStream.write(line + '\n')
  } catch {
    /* ignore */
  }
}

/** 包装主进程 console 方法，写入文件后再走原始实现 */
function wrapConsole() {
  for (const method of ['debug', 'log', 'info', 'warn', 'error']) {
    const original = console[method]
    if (typeof original !== 'function') continue
    const level = (method === 'debug' ? 'DEBUG' : method === 'warn' ? 'WARN' : method === 'error' ? 'ERROR' : 'INFO')
    console[method] = function (...args) {
      write(level, 'main', args)
      original.apply(console, args)
    }
  }
}

/** 开启 / 关闭日志记录 */
export function setLoggingEnabled(v) {
  enabled = !!v
  if (enabled) {
    ensureStream()
    write('INFO', 'main', ['日志记录已开启'])
  }
  return enabled
}

export function isLoggingEnabled() {
  return enabled
}

/** worker 内调用：通过 parentPort 转发日志给主进程 */
export function installWorkerLogger(parentPort) {
  const send = (level, args) => {
    try {
      parentPort?.postMessage({
        type: 'log',
        level,
        args: args.map((a) => {
          if (a instanceof Error) return a.stack || String(a)
          try {
            return typeof a === 'string' ? a : JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
      })
    } catch {
      /* ignore */
    }
  }
  for (const method of ['debug', 'log', 'info', 'warn', 'error']) {
    const original = console[method]
    if (typeof original !== 'function') continue
    const level = method === 'debug' ? 'DEBUG' : method === 'warn' ? 'WARN' : method === 'error' ? 'ERROR' : 'INFO'
    console[method] = function (...args) {
      send(level, args)
      original.apply(console, args)
    }
  }
}

/** 处理 worker 发来的日志消息 */
export function handleWorkerLog(msg) {
  if (msg?.type === 'log') {
    write(msg.level || 'INFO', 'worker', msg.args || [])
  }
}

/** 注册 IPC：渲染进程上报 console 日志 */
export function registerLoggerIpc() {
  ipcMain.handle('logging:get', () => enabled)
  ipcMain.handle('logging:set', (_e, v) => setLoggingEnabled(!!v))

  // 渲染进程 console 转发：渲染端脚本里拦截 console 后通过此 IPC 上报
  ipcMain.handle('logging:forward', (_e, level, message) => {
    if (!enabled) return
    write(level || 'INFO', 'renderer', [message])
  })

  // 监听所有现有及未来窗口的 console-message
  bindRendererConsoleHook()
}

function bindRendererConsoleHook() {
  if (rendererHookBound) return
  rendererHookBound = true

  const onWindowCreated = (win) => {
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      if (!enabled) return
      // Electron 新版可能传入对象形式参数，兼容两种签名
      let lv = level
      let msg = message
      let ln = line
      let src = sourceId
      if (typeof level === 'object' && level !== null) {
        lv = level.level
        msg = level.message
        ln = level.lineNumber
        src = level.sourceId
      }
      const name = lv === 0 ? 'DEBUG' : lv === 2 ? 'WARN' : lv === 3 ? 'ERROR' : 'INFO'
      write(name, 'renderer', [`${msg} (${src || '?'}:${ln})`])
    })
  }

  // 已存在窗口
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) onWindowCreated(win)
  }

  // 通过 windows.js 的创建事件挂钩——这里用 app 全局 browser-window-created 更稳
  app.on('browser-window-created', (_e, win) => {
    if (win.isDestroyed()) return
    onWindowCreated(win)
  })
}

/** 初始化：替换主进程 console + 注册 IPC（在 app ready 后调用） */
export function initLogger() {
  wrapConsole()
  // 启动时按设置恢复开关（若已存在）
  try {
    const saved = getSetting('loggingEnabled', 'false')
    setLoggingEnabled(saved === 'true')
  } catch {
    /* settings 尚未初始化时忽略 */
  }
  registerLoggerIpc()
}
