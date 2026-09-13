import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { promises as fsp } from 'fs'
import { dirname, join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { getProvider, isRemoteRoot } from './index'
import { CACHE_DIR_NAME, resolveCacheDir } from './cache-location'
import { getRemoteCacheConflict } from './cache-settings'
import { joinPath, relFromRoot } from './path-utils'

/**
 * 远程缓存同步：
 *
 * 1. ensureRemoteCache(root)：选中/浏览远程根时，若远程存在 `.image_browser_cache/cache.db`
 *    则下载到本地工作库（先比对 root_cache_sha，一致则不覆盖）。
 * 2. ensureRemoteThumb(root, cache, absPath)：按需从远程缓存目录拉取单个缩略图到本地。
 *
 * 本地工作库始终位于 resolveCacheDir(root)（userData）；远程库为持久副本。
 * cache.js 通过 setCacheCloser 注入关闭函数，避免循环依赖。
 */

let closeCacheFn = null
export function setCacheCloser(fn) {
  closeCacheFn = fn
}

const syncInFlight = new Map()

function readMeta(dbPath, keys) {
  try {
    const db = new DatabaseSync(dbPath)
    try {
      const has = db
        .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='meta'")
        .get()
      if (!has) return null
      const out = {}
      for (const k of keys) {
        const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(k)
        out[k] = row ? row.value : null
      }
      return out
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** 远程缓存目录 / cache.db 的伪绝对路径 */
function remoteCachePaths(root) {
  const dir = joinPath(root.path, CACHE_DIR_NAME)
  return { dir, db: joinPath(dir, 'cache.db') }
}

/**
 * 确保本地工作库与远程缓存一致。返回 { remote, pulled?, equal?, policy? }。
 */
export async function ensureRemoteCache(root) {
  if (!isRemoteRoot(root)) return { remote: false }
  const id = root.id
  if (syncInFlight.has(id)) return syncInFlight.get(id)

  const task = doEnsureRemoteCache(root).finally(() => syncInFlight.delete(id))
  syncInFlight.set(id, task)
  return task
}

async function doEnsureRemoteCache(root) {
  const provider = getProvider(root)
  const { db: remoteDb } = remoteCachePaths(root)
  const localDir = resolveCacheDir(root)
  const localDb = join(localDir, 'cache.db')

  let remoteStat = null
  try {
    remoteStat = await provider.stat(remoteDb)
  } catch {
    remoteStat = null
  }
  if (!remoteStat || !remoteStat.isFile) return { remote: false }

  let buf
  try {
    buf = await provider.readFile(remoteDb)
  } catch {
    return { remote: false }
  }
  if (!buf || !buf.length) return { remote: false }

  mkdirSync(localDir, { recursive: true })
  const tmpDb = join(localDir, 'remote.cache.download.db')
  writeFileSync(tmpDb, buf)

  const remoteMeta = readMeta(tmpDb, ['root_cache_sha', 'last_task_at'])
  const localMeta = existsSync(localDb)
    ? readMeta(localDb, ['root_cache_sha', 'last_task_at'])
    : null

  // 一致：无需覆盖
  if (
    localMeta &&
    remoteMeta?.root_cache_sha &&
    localMeta.root_cache_sha === remoteMeta.root_cache_sha
  ) {
    rmSync(tmpDb, { force: true })
    return { remote: true, equal: true }
  }

  const policy = !localMeta ? 'remote' : getRemoteCacheConflict()
  let useRemote
  if (policy === 'remote') useRemote = true
  else if (policy === 'local') useRemote = false
  else {
    // newer / ask（ask 暂以“较新者”兜底，UI 弹窗后续接入）
    const rAt = remoteMeta?.last_task_at || ''
    const lAt = localMeta?.last_task_at || ''
    useRemote = !localMeta || rAt > lAt
  }

  if (useRemote) {
    // 覆盖前关闭可能打开的本地连接
    closeCacheFn?.(root.path)
    try {
      renameSync(tmpDb, localDb)
    } catch {
      // Windows 上目标被占用时退化为复制
      await fsp.copyFile(tmpDb, localDb)
      rmSync(tmpDb, { force: true })
    }
    return { remote: true, pulled: true, policy }
  }

  rmSync(tmpDb, { force: true })
  return { remote: true, pulled: false, policy }
}

/**
 * 按需拉取单个缩略图到本地。命中本地文件直接返回；远程无此缩略图返回 null。
 * @returns {Promise<string|null>} 本地缩略图绝对路径
 */
export async function ensureRemoteThumb(root, cache, absPath) {
  if (!isRemoteRoot(root)) return null
  const rel = relFromRoot(root.path, absPath)
  if (!rel) return null
  let row = null
  try {
    row = cache.db.prepare('SELECT thumb FROM files WHERE rel_path = ?').get(rel)
  } catch {
    row = null
  }
  const thumbRel = row?.thumb
  if (!thumbRel) return null

  const localThumb = join(cache.thumbDir, thumbRel)
  if (existsSync(localThumb)) return localThumb

  const provider = getProvider(root)
  const remoteThumb = joinPath(root.path, CACHE_DIR_NAME, thumbRel)
  let st = null
  try {
    st = await provider.stat(remoteThumb)
  } catch {
    st = null
  }
  if (!st || !st.isFile) return null

  try {
    await fsp.mkdir(dirname(localThumb), { recursive: true })
    const buf = await provider.readFile(remoteThumb)
    await fsp.writeFile(localThumb, buf)
    return localThumb
  } catch {
    return null
  }
}
