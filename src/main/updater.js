import { app } from 'electron'

/**
 * 更新检测模块
 *
 * TODO: 接入真实更新源（electron-updater / 自建版本接口 / GitHub Releases 等）。
 * 目前为桩实现：始终返回「已是最新」，latestVersion 取当前打包版本。
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
export function checkForUpdates() {
  // TODO: 在这里发起真实请求并解析结果
  return {
    hasUpdate: false,
    latestVersion: app.getVersion(),
    checkedAt: new Date().toISOString()
  }
}
