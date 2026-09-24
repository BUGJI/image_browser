import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 暴露给渲染进程的 API（主窗口 / 设置窗口共用）
const api = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },

  // --- 数据库 ---
  getDbVersion: () => ipcRenderer.invoke('db:version'),

  // --- 窗口控制（自绘顶栏按钮）---
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  // 关闭询问框结果：{ action: 'tray' | 'quit', remember?: boolean }
  windowCloseResult: (payload) => ipcRenderer.invoke('window:ask-close-result', payload),
  // 主进程请求弹「关闭询问框」（关闭行为为 ask 时触发）
  onAskClose: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('window:ask-close', listener)
    return () => ipcRenderer.removeListener('window:ask-close', listener)
  },
  // 监听最大化状态变化，返回取消订阅函数
  onMaximizedChange: (cb) => {
    const listener = (_e, maximized) => cb(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },

  // --- 设置窗口 ---
  openSettings: () => ipcRenderer.invoke('settings:open'),

  // --- 设置读写 ---
  getSetting: (key, fallback = null) => ipcRenderer.invoke('settings:get', key, fallback),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  onSettingsChanged: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },

  // --- 应用 ---
  // 应用自身版本号（来自 package.json / app.getVersion()）
  appVersion: () => ipcRenderer.invoke('app:get-version'),
  appRelaunch: () => ipcRenderer.invoke('app:relaunch'),
  // 检测更新（桩实现，返回 { hasUpdate, latestVersion, checkedAt }）
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  // 启动检测到新版本时主进程推送；返回取消订阅函数
  onUpdateAvailable: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('app:update-available', listener)
    return () => ipcRenderer.removeListener('app:update-available', listener)
  },
  // 用系统默认浏览器打开外部链接
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  // 开关所有窗口的开发者工具
  toggleDevtools: (open) => ipcRenderer.invoke('devtools:toggle', open),
  // 重启所有窗口的开发者工具（关闭再打开）
  restartDevtools: () => ipcRenderer.invoke('devtools:restart'),
  // 日志记录开关
  loggingSet: (enabled) => ipcRenderer.invoke('logging:set', enabled),

  // --- 根目录注册 ---
  rootsList: () => ipcRenderer.invoke('roots:list'),
  // opts: { type, config, writable, secret }
  rootsAdd: (path, alias, opts) => ipcRenderer.invoke('roots:add', path, alias, opts),
  rootsUpdate: (id, path, alias, opts) => ipcRenderer.invoke('roots:update', id, path, alias, opts),
  rootsRemove: (id) => ipcRenderer.invoke('roots:remove', id),
  // 测试连接：payload { type, path, config, secret } => { ok, message }
  rootsTest: (payload) => ipcRenderer.invoke('roots:test', payload),
  // 重新排序：传入按新顺序排列的 id 数组
  rootsReorder: (ids) => ipcRenderer.invoke('roots:reorder', ids),
  rootsGetCurrent: () => ipcRenderer.invoke('roots:get-current'),
  rootsSetCurrent: (id) => ipcRenderer.invoke('roots:set-current', id),
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  // 扫描目录树（只收集文件夹，返回 { name, path, children }）
  scanTree: (rootPath) => ipcRenderer.invoke('fs:scan-tree', rootPath),
  // 中止当前目录树扫描
  scanAbort: () => ipcRenderer.invoke('fs:scan-abort'),
  // 扫描进度事件：{ rootPath, scanned?, done?, aborted? }；返回取消订阅函数
  onScanProgress: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('fs:scan-progress', listener)
    return () => ipcRenderer.removeListener('fs:scan-progress', listener)
  },
  // 根目录增删改后广播；返回取消订阅函数
  onRootsChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('roots:changed', listener)
    return () => ipcRenderer.removeListener('roots:changed', listener)
  },
  // 当前选中根目录变化广播
  onRootsCurrentChanged: (cb) => {
    const listener = (_e, id) => cb(id)
    ipcRenderer.on('roots:current-changed', listener)
    return () => ipcRenderer.removeListener('roots:current-changed', listener)
  },

  // --- 图片收藏（按根目录）---
  // 返回 [{ rootId, absPath, name }]
  favList: (rootId) => ipcRenderer.invoke('favorites:list', rootId),
  // 收藏/取消收藏：传入 { absPath, name }；返回 { added }
  favToggle: (rootId, item) => ipcRenderer.invoke('favorites:toggle', rootId, item),

  // --- 图片标签（按根目录）---
  // 全部标签（含命中图片数）：[{ id, name, count }]
  tagsList: (rootId) => ipcRenderer.invoke('tags:list', rootId),
  // 某标签下的图片列表：[{ absPath, name }]
  tagsImages: (rootId, tagId) => ipcRenderer.invoke('tags:images', rootId, tagId),
  // 某张图片当前带的标签：[{ id, name }]
  tagsGet: (rootId, absPath) => ipcRenderer.invoke('tags:get', rootId, absPath),
  // 整体覆盖设置某张图片的标签：传入 { absPath, name } + 标签名数组；返回更新后标签列表
  tagsSet: (rootId, item, tagNames) => ipcRenderer.invoke('tags:set', rootId, item, tagNames),
  // 新建/重命名/删除/合并标签；均返回该根目录更新后的标签列表
  tagsAdd: (rootId, name) => ipcRenderer.invoke('tags:add', rootId, name),
  tagsRename: (rootId, tagId, name) => ipcRenderer.invoke('tags:rename', rootId, tagId, name),
  tagsDelete: (rootId, tagId) => ipcRenderer.invoke('tags:delete', rootId, tagId),
  tagsMerge: (rootId, fromIds, toId) => ipcRenderer.invoke('tags:merge', rootId, fromIds, toId),
  // 标签增删改后广播：{ rootId }；返回取消订阅函数
  onTagsChanged: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('tags:changed', listener)
    return () => ipcRenderer.removeListener('tags:changed', listener)
  },

  // --- 缓存维护（每根目录独立缓存）---
  // mode: 'update' | 'rebuild' | 'clean'
  cacheRun: (rootId, mode) => ipcRenderer.invoke('cache:run', rootId, mode),
  cacheAbort: () => ipcRenderer.invoke('cache:abort'),
  cacheStatus: () => ipcRenderer.invoke('cache:status'),
  // 各根目录缓存概况（媒体数 / 已缓存数 / 原图与缩略图字节数 / 最近维护时间）
  cacheStats: () => ipcRenderer.invoke('cache:stats'),
  // 缓存任务进度事件：{ rootId, rootPath, phase, scanned/done/total, done/aborted/error }
  onCacheProgress: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('cache:progress', listener)
    return () => ipcRenderer.removeListener('cache:progress', listener)
  },

  // --- 图片浏览 ---
  // 文件夹图片列表（优先缓存索引带尺寸/缩略图，无缓存回退即时扫描）；
  // 传入 searchQuery 时跨整个根目录按文件名搜索（支持 * ? 通配符）。
  // opts { offset, limit } 分页，返回 { items, total }
  imagesList: (rootId, folderPath, searchQuery, opts) =>
    ipcRenderer.invoke('images:list', rootId, folderPath, searchQuery, opts),

  // --- AI 语义搜索 ---
  // 向量索引维护：mode: 'update' | 'rebuild' | 'clean'
  aiIndex: (rootId, mode) => ipcRenderer.invoke('ai:index', rootId, mode),
  aiAbort: () => ipcRenderer.invoke('ai:abort'),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  // AI 语义搜索：把 query 向量化，返回与瀑布流一致的图片列表（Top-K）
  aiSearch: (rootId, query) => ipcRenderer.invoke('ai:search', rootId, query),
  // AI 流程测试（设置-测试）：图片 dataURL → 描述
  aiTestCaption: (dataUrl) => ipcRenderer.invoke('ai:test-caption', dataUrl),
  // AI 流程测试：文本 → 向量
  aiTestEmbed: (text) => ipcRenderer.invoke('ai:test-embed', text),
  // 测试 AI 接口连接（校验 baseUrl + API key，检查配置模型是否存在）
  aiTestConnection: () => ipcRenderer.invoke('ai:test-connection'),
  // 向量索引维护进度事件：{ rootId, rootPath, phase, done/total/current, done/aborted/error }
  onAiProgress: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('ai:progress', listener)
    return () => ipcRenderer.removeListener('ai:progress', listener)
  },
  // --- OCR 图内文字搜索（PaddleOCR，可选依赖）---
  // 检测 OCR 依赖是否已安装 + 当前任务状态：{ available, running, rootId }
  ocrCheck: () => ipcRenderer.invoke('ocr:check'),
  // 文字索引维护：mode: 'update' | 'rebuild' | 'clean'
  ocrIndex: (rootId, mode) => ipcRenderer.invoke('ocr:index', rootId, mode),
  ocrAbort: () => ipcRenderer.invoke('ocr:abort'),
  ocrStatus: () => ipcRenderer.invoke('ocr:status'),
  // OCR 索引维护进度事件：{ rootId, rootPath, phase, done/total/current, done/aborted/error }
  onOcrProgress: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('ocr:progress', listener)
    return () => ipcRenderer.removeListener('ocr:progress', listener)
  },
  // --- OCR 运行时组件（onnxruntime + sharp）管理 ---
  ocrAddonStatus: () => ipcRenderer.invoke('ocr:addon-status'),
  ocrAddonDownload: (url) => ipcRenderer.invoke('ocr:addon-download', url),
  ocrAddonImport: () => ipcRenderer.invoke('ocr:addon-import'),
  ocrAddonRemove: () => ipcRenderer.invoke('ocr:addon-remove'),
  // 组件下载/安装进度：{ phase: 'download'|'extract'|'apply'|'done'|'error', received, total, message }
  onOcrAddonProgress: (cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on('ocr:addon-progress', listener)
    return () => ipcRenderer.removeListener('ocr:addon-progress', listener)
  },

  // 复制图片（dataURL → 系统剪贴板）
  copyImageDataUrl: (dataUrl) => ipcRenderer.invoke('clipboard:write-image', dataUrl),
  // 复制图片（直接读文件 → 系统剪贴板）
  copyImagePath: (absPath) => ipcRenderer.invoke('clipboard:write-image-path', absPath),
  // 复制原文件（文件列表 → 剪贴板，可在文件管理器直接粘贴）
  copyFile: (absPath) => ipcRenderer.invoke('clipboard:copy-file', absPath)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
