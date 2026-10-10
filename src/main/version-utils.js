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

/**
 * 从 releases 列表中选出「语义版本号最大」的稳定版本 release。
 *
 * GitHub /releases 按 created_at 倒序返回，顺序 ≠ 版本大小：后补发一个旧版本线
 * 的 release（或改动旧 release 都会刷新 created_at）会排到列表首位，直接取首个会漏报新版本。
 * 因此必须对所有稳定 release 取版本号最大值。无稳定版本时返回 null。
 */
export function pickLatestStableVersion(releases) {
  let best = null
  let bestVersion = null
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!isStableVersionRelease(r)) continue
    const v = parseVersion(r.tag_name)
    if (!v) continue
    if (!bestVersion || compareVersions(v, bestVersion) > 0) {
      bestVersion = v
      best = r
    }
  }
  return best ? { version: bestVersion, release: best } : null
}
