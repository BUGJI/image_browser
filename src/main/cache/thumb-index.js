import { existsSync } from 'fs'
import { join } from 'path'
import { prep as prepCache } from '../cache-db-utils.mjs'
import { relFromRoot } from '../storage/path-utils'

/**
 * 协议层缩略图路径内存索引（避免每张图请求都同步查 DB + 磁盘探测）。
 * 值：缩略图绝对路径，或 null（负缓存：该图无缩略图，需回退原图）。
 * 每个 root 独立 Map，带容量上限（删除最旧插入项）；维护任务开始时整体失效。
 */
const thumbIndexByRoot = new Map()
const THUMB_INDEX_MAX = 30000

/**
 * 解析缩略图路径，结果缓存于内存（含 null 负缓存）。
 * 返回：缩略图绝对路径，或 null（无缩略图，协议回退原图）。
 */
export function resolveThumb(cache, root, absPath) {
  let index = thumbIndexByRoot.get(root.path)
  if (!index) {
    index = new Map()
    thumbIndexByRoot.set(root.path, index)
  }
  if (index.has(absPath)) return index.get(absPath)

  let thumb = null
  const row = prepCache(cache.db, 'SELECT thumb FROM files WHERE abs_path = ?').get(absPath)
  if (row?.thumb) {
    const p = join(cache.thumbDir, row.thumb)
    if (existsSync(p)) thumb = p
  }
  // 兼容/推导：镜像路径 image_cache/<rel_path>.webp
  if (!thumb) {
    const rel = relFromRoot(root.path, absPath)
    const p = join(cache.thumbDir, rel + '.webp')
    if (existsSync(p)) thumb = p
  }

  // 容量上限：超出时淘汰最旧插入的条目（Map 迭代序 = 插入序）
  if (index.size >= THUMB_INDEX_MAX && !index.has(absPath)) {
    index.delete(index.keys().next().value)
  }
  index.set(absPath, thumb)
  return thumb
}

/**
 * 批量预热某个根目录的缩略图索引（选目录/搜索返回列表时调用）。
 * 直接把本次查询到的 rows（含 DB 里的 thumb 相对路径）一次性填进内存 Map，
 * 让后续 image:// 请求直接命中，不再逐张做 SQL + 磁盘探测。
 * row.thumb 为 null 的行不写负缓存（保留 resolveThumb 的镜像路径兜底能力）。
 */
export function primeThumbIndex(cache, root, rows) {
  let index = thumbIndexByRoot.get(root.path)
  if (!index) {
    index = new Map()
    thumbIndexByRoot.set(root.path, index)
  }
  for (const r of rows) {
    if (index.size >= THUMB_INDEX_MAX) return
    if (index.has(r.abs_path)) continue
    if (r.thumb) {
      index.set(r.abs_path, join(cache.thumbDir, r.thumb))
    }
  }
}

/** 维护任务会增删缩略图，任务开始/结束时清空索引强制重查 */
export function invalidateThumbIndex(rootPath) {
  thumbIndexByRoot.delete(rootPath)
}
