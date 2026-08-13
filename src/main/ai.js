import { promises as fsp } from 'fs'
import { existsSync } from 'fs'
import { join, extname } from 'path'
import { getRoot } from './roots'
import { getSetting } from './settings'
import { openRootCache } from './cache'
import { broadcast } from './windows'
import { ScanAbortedError } from './fs-scan.mjs'

/**
 * AI 语义搜索（OpenAI 兼容接口）
 *
 * 流程：
 *   1. 向量索引维护（ai:index）：对根目录缓存中的每张图片，
 *      先用视觉模型生成一句话描述，再用向量模型把描述转为向量，
 *      存进该根目录 .image_browser_cache/cache.db 的 ai_embeddings 表。
 *   2. 语义搜索（ai:search）：把自然语言 query 用向量模型转成向量，
 *      与 ai_embeddings 中所有向量做余弦相似度，返回 Top-K 图片。
 *
 * 三种维护模式：
 *   update  增量：为新增/变更（mtime 不同）的图片补建向量，移除已删除的
 *   rebuild 全量：清空 ai_embeddings，重新为全部图片建向量
 *   clean   清理：仅移除源文件已不存在的失效向量
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_EMBED_MODEL = 'text-embedding-3-small'
const DEFAULT_VISION_MODEL = 'gpt-4o-mini'
const DEFAULT_TOP_K = 20
const CONCURRENCY = 3

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

const CAPTION_PROMPT = '用一句简洁的话描述这张图片的内容，包含主要物体、场景与动作。'

function getAiConfig() {
  const baseUrl = (getSetting('aiBaseUrl', '') || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const apiKey = getSetting('aiApiKey', '')
  const model = getSetting('aiModel', '') || DEFAULT_EMBED_MODEL
  const visionModel = getSetting('aiVisionModel', '') || DEFAULT_VISION_MODEL
  const topK = Number(getSetting('aiTopK', String(DEFAULT_TOP_K)))
  return {
    baseUrl,
    apiKey,
    model,
    visionModel,
    topK: Number.isFinite(topK) && topK > 0 ? Math.floor(topK) : DEFAULT_TOP_K
  }
}

function authHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

async function embedText(cfg, text, signal) {
  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ model: cfg.model, input: text }),
    signal
  })
  if (!res.ok) throw new Error(`Embeddings API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const emb = data?.data?.[0]?.embedding
  if (!Array.isArray(emb)) throw new Error('Embeddings API 未返回向量')
  return emb
}

async function imageToDataUrl(filePath) {
  const buf = await fsp.readFile(filePath)
  const mime = MIME_BY_EXT[extname(filePath).toLowerCase()] || 'application/octet-stream'
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function captionImage(cfg, imagePath, signal) {
  const dataUrl = await imageToDataUrl(imagePath)
  return captionFromDataUrl(cfg, dataUrl, signal)
}

async function captionFromDataUrl(cfg, dataUrl, signal) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({
      model: cfg.visionModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: CAPTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      max_tokens: 100
    }),
    signal
  })
  if (!res.ok) throw new Error(`Chat API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const caption = data?.choices?.[0]?.message?.content
  if (!caption) throw new Error('Chat API 未返回描述')
  return caption.trim()
}

function candidatePath(cache, f) {
  if (f.thumb) {
    const p = join(cache.thumbDir, f.thumb)
    if (existsSync(p)) return p
  }
  return f.abs_path
}

function ensureAiTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_embeddings (
      abs_path   TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      folder     TEXT NOT NULL,
      caption    TEXT NOT NULL,
      vector     TEXT NOT NULL,
      dims       INTEGER NOT NULL,
      model      TEXT NOT NULL,
      src_mtime  INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
}

function cosine(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function mapLimit(items, limit, fn) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function metaSet(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}

/**
 * 执行向量索引维护任务
 * @param {{id:number, path:string, alias?:string}} root
 * @param {'update'|'rebuild'|'clean'} mode
 * @param {(p: object) => void} opts.onProgress
 * @param {() => boolean} opts.shouldAbort
 */
export async function runAiIndexTask(root, mode, { onProgress = () => {}, shouldAbort } = {}) {
  const cfg = getAiConfig()
  if (!cfg.apiKey) throw new Error('请先配置 API 密钥')

  const cache = openRootCache(root.path, { create: true })
  const { db } = cache
  ensureAiTable(db)

  const stats = { mode, embedded: 0, removed: 0, failed: 0 }
  const nowMs = Date.now()
  const files = db.prepare('SELECT abs_path, name, folder, thumb, mtime FROM files').all()
  const fileSet = new Set(files.map((f) => f.abs_path))

  const delStmt = db.prepare('DELETE FROM ai_embeddings WHERE abs_path = ?')

  if (mode === 'clean') {
    const rows = db.prepare('SELECT abs_path FROM ai_embeddings').all()
    for (const r of rows) {
      if (shouldAbort?.()) throw new ScanAbortedError()
      if (!fileSet.has(r.abs_path)) {
        delStmt.run(r.abs_path)
        stats.removed++
      }
    }
    metaSet(db, 'ai_last_task', mode)
    metaSet(db, 'ai_last_task_at', new Date().toISOString())
    onProgress({ phase: 'done' })
    return stats
  }

  if (mode === 'rebuild') {
    db.exec('DELETE FROM ai_embeddings')
  }

  const existing = db.prepare('SELECT abs_path, src_mtime FROM ai_embeddings').all()
  const existingMap = new Map(existing.map((r) => [r.abs_path, r.src_mtime]))

  const need = []
  for (const f of files) {
    const prev = existingMap.get(f.abs_path)
    if (prev === undefined || prev !== f.mtime) need.push(f)
  }

  for (const [abs] of existingMap) {
    if (!fileSet.has(abs)) {
      delStmt.run(abs)
      stats.removed++
    }
  }

  const upsertStmt = db.prepare(
    `INSERT INTO ai_embeddings (abs_path, name, folder, caption, vector, dims, model, src_mtime, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(abs_path) DO UPDATE SET
       name=excluded.name, folder=excluded.folder, caption=excluded.caption,
       vector=excluded.vector, dims=excluded.dims, model=excluded.model,
       src_mtime=excluded.src_mtime, updated_at=excluded.updated_at`
  )

  const total = need.length
  let done = 0
  const taskAc = new AbortController()
  const abortCheck = setInterval(() => {
    if (shouldAbort?.()) taskAc.abort()
  }, 200)

  try {
    await mapLimit(need, CONCURRENCY, async (f) => {
      if (taskAc.signal.aborted || shouldAbort?.()) throw new ScanAbortedError()
      try {
        const imgPath = candidatePath(cache, f)
        const caption = await captionImage(cfg, imgPath, taskAc.signal)
        const vector = await embedText(cfg, caption, taskAc.signal)
        upsertStmt.run(
          f.abs_path, f.name, f.folder, caption, JSON.stringify(vector), vector.length,
          cfg.model, f.mtime, nowMs, nowMs
        )
        stats.embedded++
      } catch (err) {
        if (err instanceof ScanAbortedError) throw err
        if (taskAc.signal.aborted) throw new ScanAbortedError()
        stats.failed++
      } finally {
        done++
        onProgress({ phase: 'embed', done, total, current: f.name })
      }
    })
  } finally {
    clearInterval(abortCheck)
  }

  metaSet(db, 'ai_last_task', mode)
  metaSet(db, 'ai_last_task_at', new Date().toISOString())
  onProgress({ phase: 'done' })
  console.log('[ai] index task finished, stats =', JSON.stringify(stats))
  return stats
}

/**
 * AI 语义搜索：query 向量化后与当前根目录的向量索引做余弦相似度，返回 Top-K。
 * 返回结构与 images:list 一致（供瀑布流直接渲染）。
 */
export async function handleAiSearch(rootId, query) {
  const root = getRoot(rootId)
  if (!root) {
    const err = new Error('未选择根目录')
    err.code = 'AI_NO_ROOT'
    throw err
  }
  const cfg = getAiConfig()
  if (!cfg.apiKey) {
    const err = new Error('请先配置 API 密钥')
    err.code = 'AI_NO_KEY'
    throw err
  }

  const cache = openRootCache(root.path, { create: false })
  if (!cache) {
    const err = new Error('该根目录尚未建立缓存')
    err.code = 'AI_NO_CACHE'
    throw err
  }
  ensureAiTable(cache.db)

  const rows = cache.db.prepare('SELECT abs_path, vector FROM ai_embeddings').all()
  if (!rows.length) {
    const err = new Error('尚未建立向量索引')
    err.code = 'AI_NO_INDEX'
    throw err
  }

  const qv = await embedText(cfg, query)
  const scored = []
  for (const r of rows) {
    let vec
    try {
      vec = JSON.parse(r.vector)
    } catch {
      continue
    }
    if (!Array.isArray(vec) || vec.length !== qv.length) continue
    const sim = cosine(qv, vec)
    if (Number.isFinite(sim) && sim > 0) scored.push({ abs_path: r.abs_path, score: sim })
  }
  scored.sort((a, b) => b.score - a.score)

  const top = scored.slice(0, cfg.topK)
  const stmt = cache.db.prepare(
    'SELECT abs_path, name, folder, width, height, thumb FROM files WHERE abs_path = ?'
  )
  const results = []
  for (const t of top) {
    const f = stmt.get(t.abs_path)
    if (!f) continue
    results.push({
      absPath: f.abs_path,
      name: f.name,
      folder: f.folder || '',
      width: f.width,
      height: f.height,
      hasThumb: !!f.thumb,
      score: Number(t.score.toFixed(4))
    })
  }
  return results
}

// ---------------------------------------------------------------- IPC

let aiTaskController = null

export function registerAiIpc({ ipcMain }) {
  ipcMain.handle('ai:index', async (e, rootId, mode) => {
    const root = getRoot(rootId)
    if (!root) throw new Error('根目录不存在')
    if (!['update', 'rebuild', 'clean'].includes(mode)) {
      throw new Error('未知维护模式: ' + mode)
    }

    aiTaskController?.abort()
    const ac = new AbortController()
    aiTaskController = ac
    aiTaskController.rootId = rootId

    let lastEmit = 0
    const MIN_EMIT_INTERVAL = 120
    const send = (payload) => {
      const now = Date.now()
      const forced = payload.done === true || payload.aborted || payload.error
      if (!forced && now - lastEmit < MIN_EMIT_INTERVAL) return
      lastEmit = now
      broadcast('ai:progress', { rootId, rootPath: root.path, ...payload })
    }

    runAiIndexTask(root, mode, {
      onProgress: (p) => send(p),
      shouldAbort: () => ac.signal.aborted
    })
      .then((stats) => {
        console.log('[ai] task promise resolved, sending done, stats =', JSON.stringify(stats))
        send({ done: true, stats })
      })
      .catch((err) => {
        if (ac.signal.aborted || err instanceof ScanAbortedError) {
          send({ aborted: true })
        } else {
          console.error('[ai] task failed:', err)
          send({ error: String(err?.message || err) })
        }
      })

    return { started: true }
  })

  ipcMain.handle('ai:abort', () => {
    aiTaskController?.abort()
    return true
  })

  ipcMain.handle('ai:status', () => {
    const root = getRoot(aiTaskController?.rootId)
    return {
      running: !!aiTaskController && !aiTaskController.signal.aborted,
      rootId: aiTaskController?.rootId
    }
  })

  ipcMain.handle('ai:search', async (_e, rootId, query) => {
    const q = (query || '').trim()
    if (!q) return []
    return handleAiSearch(rootId, q)
  })

  // --- AI 流程测试（设置-测试）---
  // 图片 → 文字：视觉模型生成描述，返回提示词、模型、图片与结果
  ipcMain.handle('ai:test-caption', async (_e, dataUrl) => {
    if (!dataUrl || !dataUrl.startsWith('data:')) throw new Error('无效的图片数据')
    const cfg = getAiConfig()
    if (!cfg.apiKey) {
      const err = new Error('请先配置 API 密钥')
      err.code = 'AI_NO_KEY'
      throw err
    }
    const caption = await captionFromDataUrl(cfg, dataUrl)
    return { prompt: CAPTION_PROMPT, model: cfg.visionModel, caption }
  })

  // 文字 → 向量：向量模型嵌入文本，返回提示词、模型、维度与向量
  ipcMain.handle('ai:test-embed', async (_e, text) => {
    const t = (text || '').trim()
    if (!t) throw new Error('请输入要向量化的文本')
    const cfg = getAiConfig()
    if (!cfg.apiKey) {
      const err = new Error('请先配置 API 密钥')
      err.code = 'AI_NO_KEY'
      throw err
    }
    const vector = await embedText(cfg, t)
    return { prompt: t, model: cfg.model, vector, dims: vector.length }
  })

  // 测试连接：调用 /models 校验 baseUrl + API key 是否可用，并检查配置的模型是否存在
  ipcMain.handle('ai:test-connection', async () => {
    const cfg = getAiConfig()
    if (!cfg.apiKey) return { ok: false, message: '未配置 API 密钥，请先在下方填写' }
    let res
    try {
      res = await fetch(`${cfg.baseUrl}/models`, { headers: authHeaders(cfg.apiKey) })
    } catch (e) {
      return { ok: false, message: `无法连接：${String(e?.message || e)}` }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, message: `连接失败（HTTP ${res.status}）${body ? '：' + body.slice(0, 160) : ''}` }
    }
    let modelIds = []
    try {
      const data = await res.json()
      modelIds = (data?.data || []).map((m) => String(m.id))
    } catch {
      /* 接口未返回模型列表，忽略 */
    }
    if (!modelIds.length) return { ok: true, message: '连接成功（接口未返回模型列表）' }
    const missing = []
    if (!modelIds.includes(cfg.model)) missing.push(`向量模型 ${cfg.model}`)
    if (!modelIds.includes(cfg.visionModel)) missing.push(`视觉模型 ${cfg.visionModel}`)
    if (missing.length) {
      return { ok: true, message: `连接成功，但以下模型不在列表中：${missing.join('、')}` }
    }
    return { ok: true, message: '连接成功，已找到配置的模型' }
  })
}
