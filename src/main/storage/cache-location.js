import { join } from 'path'
import { getLocalCacheDir } from './cache-settings'
import { isRemoteRoot, isWritableRoot } from './index'

/**
 * 解析某个根的缓存目录（cache.db + image_cache/）。
 *
 * - 本地可写根：`<root>/.image_browser_cache`（保持可移植、scan-cache 语义不变）
 * - 本地只读根 / 所有远程根：本地缓存目录 `localCacheDir/root-<id>`
 *
 * 注意：返回的始终是本地磁盘路径；远程根的缓存库也落在本地。
 */
export const CACHE_DIR_NAME = '.image_browser_cache'

export function resolveCacheDir(root) {
  if (root && !isRemoteRoot(root) && isWritableRoot(root)) {
    return join(root.path, CACHE_DIR_NAME)
  }
  const id = root && root.id != null ? root.id : 'unknown'
  return join(getLocalCacheDir(), `root-${id}`)
}

/** 缓存是否位于源根目录内（用于是否设置隐藏属性等本地行为） */
export function isInRootCache(root) {
  return !!root && !isRemoteRoot(root) && isWritableRoot(root)
}
