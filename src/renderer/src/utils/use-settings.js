import { ref } from 'vue'

/** 布尔归一化：def=true 时「非 'false' 即 true」；def=false 时严格 'true' */
export const asBool = (def) => (raw) => (def ? raw !== 'false' : raw === 'true')

/** 枚举归一化：不在白名单内回退默认值 */
export const asEnum = (allowed, def) => (raw) => (allowed.includes(raw) ? raw : def)

/** 数值归一化：非法值回退默认；可选最小 / 最大值钳制 */
export const asNumber =
  (def, min = null, max = null) =>
  (raw) => {
    let n = parseFloat(raw)
    if (!Number.isFinite(n)) return def
    if (min != null) n = Math.max(min, n)
    if (max != null) n = Math.min(max, n)
    return n
  }

/**
 * 声明式窗口设置：把「默认值 + 归一化 + 变更副作用」集中在一处，
 * 消除读取（onMounted）与广播（onSettingsChanged）两处重复的解析逻辑。
 *
 * @param {Object} entries { [settingKey]: { default, normalize, onChange? } }
 * @returns 展开后的 refs（key 即 settingKey）+ load() / handleChange()
 * - load()              从主进程读取全部设置并归一化
 * - handleChange(key, value)  应用广播变更；命中时返回 true
 */
export function useSettings(entries) {
  const refs = {}
  for (const [key, cfg] of Object.entries(entries)) {
    refs[key] = ref(cfg.normalize(String(cfg.default)))
  }

  // 并行读取：条目较多时避免串行 IPC 往返拖慢启动
  async function load() {
    await Promise.all(
      Object.entries(entries).map(async ([key, cfg]) => {
        const raw = await window.api.getSetting(key, String(cfg.default))
        refs[key].value = cfg.normalize(raw)
      })
    )
  }

  function handleChange(key, value) {
    const cfg = entries[key]
    if (!cfg) return false
    refs[key].value = cfg.normalize(value)
    cfg.onChange?.(refs[key].value, value)
    return true
  }

  return { ...refs, load, handleChange }
}
