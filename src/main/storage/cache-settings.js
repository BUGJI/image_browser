import { join } from 'path'
import { app } from 'electron'
import { getSetting, setSetting } from '../settings'

/**
 * 远程内容本地缓存的设置项。
 *
 * - localCacheDir：本地缓存根目录（default: userData/remote-cache）
 * - localCacheMaxBytes：本地缓存上限（字节，0 = 不限）；仅约束远程内容的
 *   缩略图与原图缓存，LRU 淘汰，cache.db 不计入配额。
 * - remoteCacheConflict：本地/远程缓存冲突策略
 *   ask(默认) | newer | remote | local
 */

export const CONFLICT_POLICIES = Object.freeze(['ask', 'newer', 'remote', 'local'])

export function getLocalCacheDir() {
  return getSetting('localCacheDir', '') || join(app.getPath('userData'), 'remote-cache')
}

export function getLocalCacheMaxBytes() {
  const n = Number(getSetting('localCacheMaxBytes', '0'))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export function getRemoteCacheConflict() {
  const v = getSetting('remoteCacheConflict', 'ask')
  return CONFLICT_POLICIES.includes(v) ? v : 'ask'
}

export function setLocalCacheDir(dir) {
  setSetting('localCacheDir', dir || '')
}

export function setLocalCacheMaxBytes(bytes) {
  const n = Number(bytes)
  setSetting('localCacheMaxBytes', Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : '0')
}

export function setRemoteCacheConflict(policy) {
  setSetting('remoteCacheConflict', CONFLICT_POLICIES.includes(policy) ? policy : 'ask')
}
