/**
 * 浏览器调试专用 mock（仅开发验证用）
 *
 * 仅在 window.api 不存在时注入 —— Electron 里 preload 总会提供 window.api，
 * 所以这段代码在生产环境永远不会生效；只有用普通浏览器打开渲染进程页面
 * （例如 CDP 远程浏览器 + 静态服务器验证 UI）时才会被用到。
 */

// 模拟目录树（多层文件夹，用于验证折叠/搜索/选中）
const MOCK_TREE = {
  name: '图片素材库',
  path: 'D:/图片素材库',
  children: [
    {
      name: '壁纸',
      path: 'D:/图片素材库/壁纸',
      children: [
        {
          name: '4K壁纸',
          path: 'D:/图片素材库/壁纸/4K壁纸',
          children: [
            { name: '风景', path: 'D:/图片素材库/壁纸/4K壁纸/风景', children: [] },
            { name: '动漫', path: 'D:/图片素材库/壁纸/4K壁纸/动漫', children: [] },
            { name: '游戏', path: 'D:/图片素材库/壁纸/4K壁纸/游戏', children: [] }
          ]
        },
        { name: '手机壁纸', path: 'D:/图片素材库/壁纸/手机壁纸', children: [] }
      ]
    },
    {
      name: '项目截图',
      path: 'D:/图片素材库/项目截图',
      children: [
        {
          name: 'UI设计',
          path: 'D:/图片素材库/项目截图/UI设计',
          children: [
            { name: '初版', path: 'D:/图片素材库/项目截图/UI设计/初版', children: [] },
            { name: 'v2', path: 'D:/图片素材库/项目截图/UI设计/v2', children: [] },
            { name: '最终版', path: 'D:/图片素材库/项目截图/UI设计/最终版', children: [] }
          ]
        },
        { name: '测试图', path: 'D:/图片素材库/项目截图/测试图', children: [] }
      ]
    },
    {
      name: 'Pinterest',
      path: 'D:/图片素材库/Pinterest',
      children: [
        { name: '插画', path: 'D:/图片素材库/Pinterest/插画', children: [] },
        { name: '摄影', path: 'D:/图片素材库/Pinterest/摄影', children: [] }
      ]
    },
    { name: '旧照片', path: 'D:/图片素材库/旧照片', children: [] }
  ]
}

const MOCK_ROOTS = [
  {
    id: 1,
    path: 'D:/图片素材库',
    alias: '素材库',
    created_at: '2026-08-12 10:00:00',
    updated_at: '2026-08-12 10:00:00'
  },
  {
    id: 2,
    path: 'D:/项目截图',
    alias: '',
    created_at: '2026-08-12 10:00:00',
    updated_at: '2026-08-12 10:00:00'
  }
]

export function ensureDevMock() {
  if (window.api) return

  // 模拟扫描进度：onScanProgress 回调 + 可中止
  let mockAbort = false
  let mockProgressCb = null
  // 模拟缓存任务进度
  let mockCacheAbort = false
  let mockCacheCb = null
  // 模拟 OCR 任务进度
  let mockOcrCb = null
  // 模拟 OCR 运行时组件状态
  let mockOcrAddonInstalled = false
  let mockOcrAddonCb = null
  // 模拟关闭询问（windowClose 触发）
  let mockAskCloseCb = null
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))

  const ls = {
    get(key, fb) {
      try {
        const v = localStorage.getItem('ib-mock:' + key)
        return v == null ? fb : JSON.parse(v)
      } catch {
        return fb
      }
    },
    set(key, value) {
      localStorage.setItem('ib-mock:' + key, JSON.stringify(value))
    }
  }

  window.api = {
    getDbVersion: async () => 'dev-mock',
    appVersion: async () => 'dev-mock',
    windowMinimize: async () => {},
    windowToggleMaximize: async () => false,
    // 浏览器调试：模拟主进程的关闭行为（读 closeAction 配置）
    windowClose: async () => {
      const action = (await ls.get('closeAction', 'ask')) || 'ask'
      if (action === 'ask') {
        mockAskCloseCb?.()
      } else {
        window.__askCloseResult = { action, fromSetting: true }
        console.log('[dev-mock] windowClose by setting:', action)
      }
    },
    windowCloseResult: async (payload) => {
      // 浏览器里没有真实窗口/托盘，仅提示；remember 时模拟主进程保存设置
      if (payload?.remember) {
        ls.set('closeAction', payload.action === 'quit' ? 'quit' : 'tray')
      }
      window.__askCloseResult = payload
      console.log('[dev-mock] windowCloseResult:', payload)
    },
    onAskClose: (cb) => {
      mockAskCloseCb = cb
      return () => {
        if (mockAskCloseCb === cb) mockAskCloseCb = null
      }
    },
    onMaximizedChange: () => () => {},
    openSettings: async () => {},
    getSetting: async (key, fallback = null) => ls.get(key, fallback),
    setSetting: async (key, value) => {
      ls.set(key, value)
      return true
    },
    onSettingsChanged: () => () => {},
    appRelaunch: async () => {},
    checkUpdate: async () => ({
      hasUpdate: false,
      latestVersion: 'dev-mock',
      checkedAt: new Date().toISOString()
    }),
    rootsList: async () => MOCK_ROOTS,
    rootsAdd: async (path, alias) => ({
      id: Date.now(),
      path,
      alias,
      created_at: '',
      updated_at: ''
    }),
    rootsUpdate: async (id, path, alias) => ({ id, path, alias }),
    rootsRemove: async () => true,
    rootsReorder: async (ids) => ids,
    rootsGetCurrent: async () => 1,
    rootsSetCurrent: async () => true,
    selectDirectory: async () => 'D:/图片素材库',
    onRootsChanged: () => () => {},
    onRootsCurrentChanged: () => () => {},
    scanTree: async (rootPath) => {
      mockAbort = false
      const tree = (() => {
        const find = (nodes) => {
          for (const n of nodes) {
            if (n.path === rootPath) return n
            if (n.children) {
              const hit = find(n.children)
              if (hit) return hit
            }
          }
          return null
        }
        return find([MOCK_TREE]) || MOCK_TREE
      })()

      // 模拟分块扫描进度（每次 ~350ms，共 10 批，方便观察进度通知）
      for (let i = 1; i <= 10; i++) {
        await delay(350)
        if (mockAbort) {
          mockProgressCb?.({ rootPath, scanned: i * 8, aborted: true })
          return null
        }
        mockProgressCb?.({ rootPath, scanned: i * 8 })
      }
      mockProgressCb?.({ rootPath, scanned: 80, done: true })
      return tree
    },
    scanAbort: async () => {
      mockAbort = true
      return true
    },
    onScanProgress: (cb) => {
      mockProgressCb = cb
      return () => {
        if (mockProgressCb === cb) mockProgressCb = null
      }
    },

    // --- 缓存维护 mock（模拟进度，方便观察通知）---
    cacheRun: async (rootId, mode) => {
      mockCacheAbort = false
      const total = mode === 'clean' ? 6 : 15
      for (let i = 1; i <= total; i++) {
        await delay(180)
        if (mockCacheAbort) {
          mockCacheCb?.({ rootId, rootPath: 'D:/图片素材库', aborted: true })
          return { started: true }
        }
        if (mode === 'clean') {
          mockCacheCb?.({
            rootId,
            rootPath: 'D:/图片素材库',
            phase: 'scan',
            scanned: i * 3
          })
        } else {
          mockCacheCb?.({
            rootId,
            rootPath: 'D:/图片素材库',
            phase: 'thumb',
            done: i,
            total,
            current: `image-${i * 7}.jpg`
          })
        }
      }
      mockCacheCb?.({
        rootId,
        rootPath: 'D:/图片素材库',
        done: true,
        stats: {
          mode,
          added: mode === 'rebuild' ? 48 : 3,
          updated: mode === 'rebuild' ? 0 : 5,
          removed: mode === 'clean' ? 2 : 0,
          thumbs: mode === 'clean' ? 0 : 40,
          failed: 1,
          cleanedThumbs: mode === 'clean' ? 6 : 0
        }
      })
      return { started: true }
    },
    cacheAbort: async () => {
      mockCacheAbort = true
      return true
    },
    cacheStatus: async () => ({ running: mockCacheAbort }),
    cacheStats: async () =>
      MOCK_ROOTS.map((r, i) => ({
        rootId: r.id,
        hasCache: i !== 1,
        total: 1200 + i * 340,
        cached: i !== 1 ? 1100 + i * 300 : 0,
        srcBytes: 3435973836 + i * 536870912,
        thumbBytes: i !== 1 ? 125829120 + i * 20971520 : 0,
        folderCount: 40 + i * 10,
        lastTaskAt: i === 0 ? '2026-09-01T10:20:30.000Z' : null
      })),
    onCacheProgress: (cb) => {
      mockCacheCb = cb
      return () => {
        if (mockCacheCb === cb) mockCacheCb = null
      }
    },

    // --- 图片浏览 mock ---
    imagesList: async (rootId, folderPath, searchQuery, opts = {}) => {
      // 40 张不同尺寸的本地渐变图（scripts/gen_mock_imgs.py 生成，瀑布流效果）
      const list = []
      const seeds = [
        'aurora',
        'forest',
        'mountain',
        'ocean',
        'city',
        'sunset',
        'flower',
        'snow',
        'desert',
        'lake',
        'stars',
        'rain',
        'spring',
        'summer',
        'autumn',
        'winter',
        'cloud',
        'river',
        'valley',
        'island',
        'bridge',
        'tower',
        'street',
        'night',
        'dawn',
        'dusk',
        'garden',
        'park',
        'beach',
        'canyon',
        'waterfall',
        'meadow',
        'harbor',
        'village',
        'castle',
        'temple',
        'statue',
        'fountain',
        'pier',
        'skyline'
      ]
      seeds.forEach((seed, i) => {
        const w = 300 + ((i * 97) % 520) // 300-820
        const h = 220 + ((i * 173) % 640) // 220-860
        list.push({
          absPath: `http://127.0.0.1:8931/mock-img/${seed}.svg`,
          name: `${seed}-${i + 1}.svg`,
          width: w,
          height: h,
          hasThumb: true
        })
      })
      // 模拟按文件名搜索（支持 * ? 通配符，与主进程一致）
      const q = (searchQuery || '').trim()
      let result = list
      if (q) {
        let re
        if (/[*?]/.test(q)) {
          let out = ''
          for (const ch of q) {
            if (ch === '*') out += '.*'
            else if (ch === '?') out += '.'
            else out += ch.replace(/[\\^$+.()|[\]{}]/g, '\\$&')
          }
          re = new RegExp('^' + out + '$', 'i')
        } else {
          re = new RegExp(q.replace(/[\\^$+.()|[\]{}]/g, '\\$&'), 'i')
        }
        result = list.filter((it) => re.test(it.name))
      }
      // 分页：与主进程 images:list 返回结构一致 { items, total }
      const limit = Number(opts.limit) > 0 ? Math.floor(Number(opts.limit)) : 0
      const offset = Number(opts.offset) > 0 ? Math.floor(Number(opts.offset)) : 0
      return {
        items: limit > 0 ? result.slice(offset, offset + limit) : result,
        total: result.length
      }
    },
    copyImageDataUrl: async () => true,

    // --- OCR 图内文字搜索 mock（仅调试用）---
    ocrCheck: async () => ({ available: true, running: false, rootId: null }),
    ocrIndex: async (rootId, mode) => {
      setTimeout(() => {
        mockOcrCb?.({
          rootId,
          rootPath: 'D:/图片素材库',
          done: true,
          stats: { mode, count: 40, removed: 0, failed: 0 }
        })
      }, 800)
      return { started: true }
    },
    ocrAbort: async () => true,
    ocrStatus: async () => ({ running: false, rootId: null }),
    onOcrProgress: (cb) => {
      mockOcrCb = cb
      return () => {
        if (mockOcrCb === cb) mockOcrCb = null
      }
    },
    // OCR 运行时组件管理 mock
    ocrAddonStatus: async () => ({
      installed: mockOcrAddonInstalled,
      supported: true,
      platform: 'win32-x64',
      installing: false,
      dir: 'D:/userData/ocr-addon',
      downloadUrl: 'https://github.com/BUGJI/image_browser/releases/download/ocr-runtime/mock.zip',
      sizeBytes: mockOcrAddonInstalled ? 80000000 : 0
    }),
    ocrAddonDownload: async () => {
      mockOcrAddonCb?.({ phase: 'download', received: 40, total: 100 })
      await delay(300)
      mockOcrAddonCb?.({ phase: 'extract' })
      await delay(300)
      mockOcrAddonInstalled = true
      mockOcrAddonCb?.({ phase: 'done' })
      return { ok: true }
    },
    ocrAddonImport: async () => {
      mockOcrAddonInstalled = true
      mockOcrAddonCb?.({ phase: 'done' })
      return { ok: true, canceled: false }
    },
    ocrAddonRemove: async () => {
      mockOcrAddonInstalled = false
      return { ok: true }
    },
    onOcrAddonProgress: (cb) => {
      mockOcrAddonCb = cb
      return () => {
        if (mockOcrAddonCb === cb) mockOcrAddonCb = null
      }
    }
  }
}
