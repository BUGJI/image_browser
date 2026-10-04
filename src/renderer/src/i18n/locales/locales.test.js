import { describe, expect, it } from 'vitest'
import en from './en-US'
import zh from './zh-CN'

/** 递归收集叶子键路径（如 common.save） */
function leafKeys(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafKeys(v, key))
    else out.push(key)
  }
  return out
}

describe('i18n 键对齐', () => {
  const zhKeys = new Set(leafKeys(zh))
  const enKeys = new Set(leafKeys(en))

  it('zh-CN 与 en-US 的键集合完全一致（无缺失 / 无多余）', () => {
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k))
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k))
    expect({ missingInEn, missingInZh }).toEqual({ missingInEn: [], missingInZh: [] })
  })
})
