import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { i18n } from '../i18n'

/**
 * 统一的设置读写层。
 *
 * 设置持久化在主进程的 SQLite settings 表（key-value，值统一存字符串）。
 * 本模块把「默认值 / 类型 / 取值域 / 校验」集中到 SETTINGS schema，
 * 并提供 useSetting(key) 组合式函数：返回一个可 v-model 的 ref，
 * 自动完成「挂载时读取、变更时写回、跨窗口同步」，各页面不再重复
 * getSetting + onSettingsChanged 的样板代码。
 *
 * 值语义由 spec.type 决定：
 *   - bool   : 存 'true'/'false'，读写为 boolean
 *   - number : 存字符串，读写为 number（自动按 min/max 收敛、按 precision 取整）
 *   - enum   : 存字符串，超出 values 时回退默认值
 *   - json   : 存 JSON 字符串，读写为对象
 *   - string : 其它
 */

export const SETTINGS = {
  // ---------- 常规 ----------
  closeAction: { type: 'enum', default: 'ask', values: ['ask', 'tray', 'quit'] },
  rememberWindowSize: { type: 'bool', default: false },
  checkUpdateOnStartup: { type: 'bool', default: false },
  rememberZoom: { type: 'bool', default: false },
  quickCopyType: { type: 'enum', default: 'file', values: ['file', 'image'] },

  // ---------- 侧栏 / 卡片 ----------
  sidebarShowAllRoots: { type: 'bool', default: false },
  itemNameMode: { type: 'enum', default: 'hover', values: ['none', 'hover', 'always'] },
  itemExtMode: { type: 'enum', default: 'none', values: ['none', 'hover', 'always'] },
  itemFavMode: { type: 'enum', default: 'none', values: ['none', 'hover', 'always'] },
  itemTextMatchMode: { type: 'enum', default: 'none', values: ['none', 'hover', 'always'] },

  // ---------- 外观 ----------
  titlebar: { type: 'enum', default: 'custom', values: ['custom', 'system'] },
  themeStartup: { type: 'enum', default: 'last', values: ['dark', 'light', 'last'] },

  // ---------- 收藏 / 标签 ----------
  favoritesEnabled: { type: 'bool', default: true },
  showFavorites: { type: 'bool', default: false },
  favoritesLightboxBtn: { type: 'bool', default: true },
  tagsEnabled: { type: 'bool', default: true },
  tagsLightboxBtn: { type: 'bool', default: true },

  // ---------- 快捷键 / 灯箱 ----------
  lightboxWheelAction: { type: 'enum', default: 'zoom', values: ['zoom', 'navigate'] },

  // ---------- AI 搜索 ----------
  aiBaseUrl: { type: 'string', default: '' },
  aiApiKey: { type: 'string', default: '' },
  aiModel: { type: 'string', default: '' },
  aiVisionModel: { type: 'string', default: '' },
  aiTopK: { type: 'number', default: 20, min: 1, max: 100 },

  // ---------- OCR ----------
  ocrEnabled: { type: 'bool', default: false },

  // ---------- 浏览与性能 ----------
  imageBufferLazy: { type: 'bool', default: true },
  imagePreload: { type: 'number', default: 900, min: 0, max: 3000 },
  zoomMax: { type: 'number', default: 2, min: 1, max: 8 },
  imageTallCap: { type: 'bool', default: true },
  cacheThumbWidth: { type: 'number', default: 512, min: 64, max: 4096 },
  cacheThumbQuality: { type: 'number', default: 80, min: 1, max: 100 },
  cacheScanBatch: { type: 'number', default: 100, min: 10, max: 1000 },
  cacheThumbBatch: { type: 'number', default: 100, min: 10, max: 500 },
  cacheThumbWorkers: { type: 'number', default: 0, min: 0, max: 64 },
  cacheThumbTimeout: { type: 'number', default: 120000, min: 10000, max: 600000 },
  cacheThumbSlowMs: { type: 'number', default: 3000, min: 1000, max: 60000 },
  cacheSequential: { type: 'bool', default: true },
  cacheUseCli: { type: 'bool', default: false },
  cacheCliExe: { type: 'string', default: '' },

  // ---------- 开发者选项 ----------
  devOptions: { type: 'bool', default: false },
  showTest: { type: 'bool', default: false },
  showHidden: { type: 'bool', default: false },
  loggingEnabled: { type: 'bool', default: false },
  lightboxZoomMin: { type: 'number', default: 0.5, min: 0.1, max: 100, precision: 1 },
  lightboxZoomMax: { type: 'number', default: 8, min: 0.1, max: 100, precision: 1 },
  lightboxZoomStep: { type: 'number', default: 1.2, min: 1.01, max: 2, precision: 2 }
}

// 每个 key 对应一组共享同一 spec 的 ref；外部变更时统一分发
const registry = new Map()
let offExternal = null

function specFor(key, overrides) {
  return { ...(SETTINGS[key] || { type: 'string', default: '' }), ...overrides }
}

function decode(spec, raw) {
  if (raw == null) raw = spec.default
  let value
  switch (spec.type) {
    case 'bool':
      value = raw === true || raw === 'true'
      break
    case 'number': {
      const n = Number(raw)
      if (!Number.isFinite(n)) value = spec.default
      else if (spec.precision != null) value = Number(n.toFixed(spec.precision))
      else value = n
      break
    }
    case 'json':
      try {
        value = typeof raw === 'string' ? JSON.parse(raw) : raw
      } catch {
        value = spec.default
      }
      break
    default: {
      value = raw == null ? spec.default : String(raw)
      if (spec.values && !spec.values.includes(value)) value = spec.default
    }
  }
  if (spec.min != null || spec.max != null) {
    const min = spec.min ?? -Infinity
    const max = spec.max ?? Infinity
    if (typeof value === 'number' && Number.isFinite(value)) {
      value = Math.min(max, Math.max(min, value))
    }
  }
  return spec.normalize ? spec.normalize(value) : value
}

function encode(spec, value) {
  if (spec.type === 'bool') return value ? 'true' : 'false'
  if (spec.type === 'json') return JSON.stringify(value)
  return String(value)
}

function ensureExternalListener() {
  if (offExternal || typeof window === 'undefined' || !window.api?.onSettingsChanged) return
  offExternal = window.api.onSettingsChanged(({ key, value }) => {
    const entry = registry.get(key)
    if (!entry) return
    const decoded = decode(entry.spec, value)
    for (const h of entry.refs) h.ref.value = decoded
  })
}

/**
 * @param {string} key settings 表键名
 * @param {object} [options] 覆盖 schema：default / type / min / max / precision /
 *   values / normalize（读写都会应用）/ silent / message / messageType / onSaved
 * @returns {import('vue').WritableComputedRef} 可直接 v-model 的响应式设置值
 */
export function useSetting(key, options = {}) {
  const spec = specFor(key, options)
  const local = ref(decode(spec, spec.default))

  let entry = registry.get(key)
  if (!entry) {
    entry = { spec, refs: new Set() }
    registry.set(key, entry)
  }
  ensureExternalListener()

  async function load() {
    try {
      const raw = await window.api.getSetting(key, null)
      local.value = decode(spec, raw)
    } catch {
      /* 读取失败时保留默认值 */
    }
  }

  async function persist(next) {
    try {
      await window.api.setSetting(key, encode(spec, next))
      if (options.onSaved) options.onSaved(next)
      else if (!options.silent) {
        const message =
          typeof options.message === 'function' ? options.message(next) : options.message
        const type =
          typeof options.messageType === 'function'
            ? options.messageType(next)
            : options.messageType || 'success'
        ElMessage({ type, message: message || i18n.global.t('common.saved') })
      }
    } catch {
      ElMessage.error(i18n.global.t('common.saveFailed'))
    }
    return next
  }

  // 文本/数字类控件在输入过程中会连续触发 v-model，合并为一次写回，避免重复落库与提示；
  // 开关/下拉等一次性变更立即写回。可用 options.debounce 显式覆盖。
  const debounceMs =
    options.debounce ?? (spec.type === 'number' || spec.type === 'string' ? 400 : 0)
  let timer = null
  let pending = null

  function flush() {
    if (timer == null) return
    clearTimeout(timer)
    timer = null
    const next = pending
    pending = null
    persist(next)
  }

  // 丢弃尚未写回的防抖变更（用于「恢复默认值」覆盖前，避免旧输入回写）
  function cancelPending() {
    if (timer != null) clearTimeout(timer)
    timer = null
    pending = null
  }

  function save(raw) {
    const next = decode(spec, raw)
    local.value = next
    if (debounceMs > 0) {
      pending = next
      if (timer == null) timer = setTimeout(flush, debounceMs)
    } else {
      persist(next)
    }
    return next
  }

  const model = computed({
    get: () => local.value,
    set: (v) => save(v)
  })

  const handle = { ref: local, cancel: cancelPending }
  entry.refs.add(handle)

  onMounted(load)
  onBeforeUnmount(() => {
    flush()
    entry.refs.delete(handle)
  })

  return model
}

/**
 * 将单个设置恢复为默认值：立即更新已挂载的 ref，并写回主进程。
 * 默认值取注册时的 spec（含页面传入的 normalize/default 覆盖）。
 */
export async function resetSetting(key) {
  const entry = registry.get(key)
  const spec = entry ? entry.spec : SETTINGS[key] || { type: 'string', default: '' }
  const next = decode(spec, spec.default)
  if (entry) {
    for (const h of entry.refs) {
      h.cancel()
      h.ref.value = next
    }
  }
  try {
    await window.api.setSetting(key, encode(spec, next))
  } catch {
    /* 写回失败时保留 UI 上的默认值 */
  }
  return next
}

/** 批量恢复默认值，完成后给出一次提示 */
export async function resetSettings(keys) {
  await Promise.all(keys.map(resetSetting))
  ElMessage.success(i18n.global.t('common.resetDone'))
}
