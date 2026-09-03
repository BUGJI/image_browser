import { app } from 'electron'

const REPO_OWNER = 'BUGJI'
const REPO_NAME = 'image_browser'
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`

/**
 * 更新检测模块
 *
 * 通过 GitHub Releases 检测最新版本（方案 A：仅提示，不自动下载安装）。
 * 对比 app 当前版本与 GitHub 最新 release 的 tag 版本号，返回是否有新版本。
 *
 * 返回结构约定：
 *   {
 *     hasUpdate: boolean,      // 是否存在新版本
 *     latestVersion: string,   // 服务器上的最新版本号（无更新时为当前版本）
 *     releaseNotes?: string,   // 可选：更新说明
 *     downloadUrl?: string,    // 可选：下载地址
 *     checkedAt: string        // 检查时间 ISO 字符串
 *   }
 */
export async function checkForUpdates() {
  const current = app.getVersion()
  const checkedAt = new Date().toISOString()

  try {
    const res = await fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${REPO_OWNER}-${REPO_NAME}`
      }
    })

    // 404：还没有任何 release；其他错误统一视为检测失败，返回「已是最新」
    if (!res.ok) {
      return { hasUpdate: false, latestVersion: current, checkedAt }
    }

    const data = await res.json()
    const latest = parseVersion(data.tag_name)
    if (!latest) {
      return { hasUpdate: false, latestVersion: current, checkedAt }
    }

    const hasUpdate = compareVersions(latest, current) > 0

    return {
      hasUpdate,
      latestVersion: hasUpdate ? latest : current,
      releaseNotes: hasUpdate ? data.body || undefined : undefined,
      downloadUrl: hasUpdate ? data.html_url : undefined,
      checkedAt
    }
  } catch (_err) {
    // 网络失败 / 请求异常：静默降级为「已是最新」
    return { hasUpdate: false, latestVersion: current, checkedAt }
  }
}

/** 去掉 tag 前缀 v/V 等非数字内容，返回 x.y.z */
function parseVersion(tag) {
  if (typeof tag !== 'string') return null
  const match = tag.match(/(\d+(?:\.\d+){0,2})/)
  return match ? match[1] : null
}

/** 逐段数字比较，a > b 返回 1，a < b 返回 -1，相等返回 0 */
function compareVersions(a, b) {
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
