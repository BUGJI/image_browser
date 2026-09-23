/**
 * 快捷键工具：在灯箱内把 KeyboardEvent 归一化为「Ctrl+Shift+C」形式的字符串，
 * 并做匹配。修改人机约定：修饰键顺序固定 Ctrl / Alt / Shift / Meta。
 */

export const SHORTCUTS_KEY = 'shortcuts'

export const DEFAULT_SHORTCUTS = {
  copyFile: 'Ctrl+C',
  copyImage: 'Ctrl+Shift+C'
}

// 不参与绑定的按键（系统或灯箱保留功能）
const IGNORED_KEYS = new Set([
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Tab',
  'Enter',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  ' ',
  'Spacebar',
  'ContextMenu',
  'Control',
  'Alt',
  'Shift',
  'Meta',
  'OS',
  'F1'
])

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS'])

function isFunctionKey(key) {
  return /^F([2-9]|1[0-9]|2[0-4])$/.test(key)
}

// 把事件转成规范化组合键字符串；无法用于绑定时返回 null
export function eventToCombo(e) {
  if (MODIFIER_KEYS.has(e.key)) return null
  if (!e.key || e.key === 'Unidentified') return null

  const hasMod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey
  let main = e.key
  if (main.length === 1) main = main.toUpperCase()
  if (IGNORED_KEYS.has(e.key)) return null
  const fkey = isFunctionKey(main)
  if (!fkey && main.length !== 1) return null
  // 普通按键必须带修饰键，功能键 F2+ 可单独使用
  if (!fkey && !hasMod) return null

  const parts = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(main)
  return parts.join('+')
}

export function parseCombo(combo) {
  const res = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
  for (const part of String(combo || '').split('+')) {
    const q = part.toLowerCase()
    if (q === 'ctrl') res.ctrl = true
    else if (q === 'alt') res.alt = true
    else if (q === 'shift') res.shift = true
    else if (q === 'meta') res.meta = true
    else res.key = q
  }
  return res
}

export function combosEqual(a, b) {
  const x = parseCombo(a)
  const y = parseCombo(b)
  return (
    x.ctrl === y.ctrl &&
    x.alt === y.alt &&
    x.shift === y.shift &&
    x.meta === y.meta &&
    x.key.toLowerCase() === y.key.toLowerCase()
  )
}

export function eventMatches(e, combo) {
  const got = eventToCombo(e)
  if (!got) return false
  return combosEqual(got, combo)
}

// 读取当前快捷键配置（与默认值合并）
export async function loadShortcuts() {
  let raw = {}
  try {
    raw = JSON.parse((await window.api?.getSetting(SHORTCUTS_KEY, '{}')) || '{}')
  } catch {
    raw = {}
  }
  return { ...DEFAULT_SHORTCUTS, ...raw }
}
