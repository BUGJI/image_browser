import { app } from 'electron'
import { getSetting } from './settings'
import { compareVersions, isStableVersionRelease, parseVersion } from './version-utils'

const REPO_OWNER = 'BUGJI'
const REPO_NAME = 'image_browser'
// 用 releases 列表而非 /releases/latest：latest 取「创建时间最新」的 release，
// 而 OCR 运行时组件（tag 形如 ocr-runtime-v1.22.0-rev_sharp-0.34.5）也会出现在列表里，
// 一旦重新发布就会顶掉真正的版本，导致误报。改为拉列表后自行筛选版本 tag。
const RELEASES_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`

// 当前生效版本：设置-测试 中的覆盖版本非空且合法时用它，否则用 package 版本。
// 覆盖版本便于联调更新检测链路（无需真的改 package.json）。
export function getEffectiveVersion() {
  const override = String(getSetting('overrideVersion', '') || '').trim()
  if (/^\d+(?:\.\d+){1,2}$/.test(override)) return override
  return app.getVersion()
}

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
  const current = getEffectiveVersion()
  const checkedAt = new Date().toISOString()

  // 网络请求加超时，避免连接假死时检测永久挂起
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const res = await fetch(RELEASES_URL, {
      signal: ac.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${REPO_OWNER}-${REPO_NAME}`
      }
    })

    // 404：还没有任何 release；其他错误统一视为检测失败，返回「已是最新」
    if (!res.ok) {
      return { hasUpdate: false, latestVersion: current, checkedAt }
    }

    const list = await res.json()
    const data = Array.isArray(list) ? list.find(isStableVersionRelease) : null
    const latest = data ? parseVersion(data.tag_name) : null
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
    // 网络失败 / 请求异常 / 超时：静默降级为「已是最新」
    return { hasUpdate: false, latestVersion: current, checkedAt }
  } finally {
    clearTimeout(timer)
  }
}
