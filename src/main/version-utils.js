/**
 * 版本号工具（纯函数，无 Electron 依赖，便于单测）。
 */

/** 稳定的应用版本 tag 形式：v / V + 1~3 段数字 */
export const RELEASE_TAG_RE = /^[vV]\d+(?:\.\d+){1,2}$/

/** 是否为稳定版本 release：非 draft / 非 prerelease，且 tag 恰为 v + 纯数字版本 */
export function isStableVersionRelease(release) {
  return Boolean(
    release &&
    !release.draft &&
    !release.prerelease &&
    RELEASE_TAG_RE.test(String(release.tag_name))
  )
}

/**
 * 从 tag 解析 x.y.z。
 * 必须严格匹配「v + 1~3 段数字」，避免把 ocr-runtime-v1.22.0-... 这类 tag
 * 中的数字误解析成应用版本；解析不出返回 null。
 */
export function parseVersion(tag) {
  if (typeof tag !== 'string') return null
  const m = /^\s*[vV](\d+(?:\.\d+){1,2})\s*$/.exec(tag)
  return m ? m[1] : null
}

/** 逐段数字比较，a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}
