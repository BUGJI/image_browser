/**
 * shas-worker.mjs —— 文件夹 SHA 重建 Worker
 *
 * 「读取整张 files 表 + 逐目录哈希 + 回写 folders/meta」在 10w+ 图片时会读入
 * 全部行并做同步哈希，若放在主进程会阻塞事件循环、冻结窗口。此 Worker 打开
 * 独立的 cache.db 连接完成整段计算，主进程只 await 结果。
 *
 * 消息协议（parentPort）：
 *   in   { type: 'rebuild-shas', dbPath, thumbDir }
 *   out  { type: 'shas-done', count }
 *   out  { type: 'error', message }
 *
 * 哈希语义与旧主进程实现保持一致（root_src_sha / root_cache_sha 需跨端可比较）。
 */

import { parentPort } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { metaSet } from './cache-db-utils.mjs'

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

async function rebuildFolderShas(dbPath, thumbDir) {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA synchronous = NORMAL')
  try {
    return await computeAndWrite(db, thumbDir)
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}

async function computeAndWrite(db, thumbDir) {
  const rows = db.prepare('SELECT folder, name, size, mtime, thumb, thumb_size FROM files').all()
  const groupByFolder = new Map() // folder -> files[]
  const folderSet = new Set([''])
  for (const r of rows) {
    const f = r.folder || ''
    folderSet.add(f)
    let arr = groupByFolder.get(f)
    if (!arr) groupByFolder.set(f, (arr = []))
    arr.push(r)
  }

  // 由目录列表推导「直接子目录名」：parent -> Set(childName)
  const subdirs = new Map()
  for (const f of folderSet) {
    if (!f) continue
    const i = f.lastIndexOf('/')
    const parent = i >= 0 ? f.slice(0, i) : ''
    const child = i >= 0 ? f.slice(i + 1) : f
    let set = subdirs.get(parent)
    if (!set) subdirs.set(parent, (set = new Set()))
    set.add(child)
  }

  // 缩略图文件大小：优先用入库时记录的 thumb_size，仅对旧库缺失该字段的记录才 stat 并回填
  const thumbSize = new Map()
  const sizeBackfill = []
  for (const r of rows) {
    if (!r.thumb || thumbSize.has(r.thumb)) continue
    if (r.thumb_size != null) {
      thumbSize.set(r.thumb, r.thumb_size)
      continue
    }
    try {
      const st = await fsp.stat(join(thumbDir, r.thumb))
      thumbSize.set(r.thumb, st.size)
      sizeBackfill.push([st.size, r.thumb])
    } catch {
      thumbSize.set(r.thumb, -1)
    }
  }
  const backfillSizeStmt = db.prepare('UPDATE files SET thumb_size = ? WHERE thumb = ?')

  const upsert = db.prepare(
    `INSERT INTO folders (rel_path, src_sha, cache_sha, file_count, thumb_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(rel_path) DO UPDATE SET
       src_sha = excluded.src_sha,
       cache_sha = excluded.cache_sha,
       file_count = excluded.file_count,
       thumb_count = excluded.thumb_count,
       updated_at = excluded.updated_at`
  )
  const delFolder = db.prepare('DELETE FROM folders WHERE rel_path = ?')
  const known = new Set(
    db
      .prepare('SELECT rel_path FROM folders')
      .all()
      .map((r) => r.rel_path)
  )
  const nowMs = Date.now()

  const folderShas = []
  db.exec('BEGIN')
  try {
    for (const [size, thumb] of sizeBackfill) backfillSizeStmt.run(size, thumb)
    for (const folder of folderSet) {
      const files = groupByFolder.get(folder) || []
      const sub = [...(subdirs.get(folder) || [])]
      const srcLines = [
        ...files.map((r) => `F\u0000${r.name}\u0000${r.size}\u0000${r.mtime}`),
        ...sub.map((d) => `D\u0000${d}`)
      ].sort()
      const cacheLines = files
        .filter((r) => r.thumb && thumbSize.get(r.thumb) >= 0)
        .map((r) => `T\u0000${r.thumb}\u0000${thumbSize.get(r.thumb)}`)
        .sort()
      const srcSha = sha256(srcLines.join('\n'))
      const cacheSha = sha256(cacheLines.join('\n'))
      upsert.run(folder, srcSha, cacheSha, files.length, cacheLines.length, nowMs)
      known.delete(folder)
      folderShas.push({ rel: folder, srcSha, cacheSha })
    }
    for (const stale of known) delFolder.run(stale)
  } finally {
    db.exec('COMMIT')
  }

  const sorted = folderShas.sort((a, b) => a.rel.localeCompare(b.rel))
  metaSet(db, 'root_src_sha', sha256(sorted.map((f) => `${f.rel}\u0000${f.srcSha}`).join('\n')))
  metaSet(db, 'root_cache_sha', sha256(sorted.map((f) => `${f.rel}\u0000${f.cacheSha}`).join('\n')))
  metaSet(db, 'folder_count', folderShas.length)
  return folderShas.length
}

parentPort.on('message', async (msg) => {
  if (msg?.type !== 'rebuild-shas') return
  try {
    const count = await rebuildFolderShas(msg.dbPath, msg.thumbDir)
    parentPort.postMessage({ type: 'shas-done', count })
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: String(err?.message || err) })
  }
})
