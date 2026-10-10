import { promises as fsp, createReadStream } from 'fs'
import { Readable } from 'stream'
import { getRoot } from '../roots'
import { getProvider, isRemoteRoot } from '../storage'
import { ensureRemoteThumb } from '../storage/cache-sync'
import { extName, isInsideRootReal } from '../storage/path-utils'
import { MIME_BY_EXT } from '../scan-constants.mjs'
import { openRootCache } from './connection'
import { resolveThumb } from './thumb-index'

/**
 * image:// 自定义协议处理（缩略图/原图读取 + 越界防护）。从 cache.js 拆出。
 */

/**
 * 注册 image:// 自定义协议（需在 app ready 前 registerSchemesAsPrivileged）。
 * URL: image://<rootId>/<encodedAbsPath>?size=orig|auto
 * - auto（默认）：有 webp 缩略图返回缩略图，否则回退原图
 * - orig：始终返回原图（灯箱用）
 * 返回体用 fs 流（不再依赖 net.fetch(file://)，兼容性更好）。
 */
export function registerImageProtocol({ protocol }) {
  protocol.handle('image', async (req) => {
    try {
      const url = new URL(req.url)
      const rootId = Number(url.hostname || url.host)
      const absPath = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!absPath) return new Response('bad request', { status: 400 })

      const size = url.searchParams.get('size')
      const root = Number.isFinite(rootId) && rootId > 0 ? getRoot(rootId) : undefined
      // 越界防护：仅允许访问已注册根目录内的文件，防止渲染层读取任意磁盘路径
      // （含符号链接解析，避免根目录内 symlink 指向外部被读取）
      if (!root || !(await isInsideRootReal(root.path, absPath))) {
        return new Response('forbidden', { status: 403 })
      }
      const provider = getProvider(root)
      let file = absPath
      let thumbServed = false
      let localSource = false // file 指向本地磁盘（缩略图缓存）时用 fs 读

      if (size !== 'orig' && root) {
        const cache = openRootCache(root, { create: false })
        if (cache) {
          // 走内存索引（命中跳过 DB 查询与磁盘探测），维护任务时会失效重查
          let thumbPath = resolveThumb(cache, root, absPath)
          // 远程根：本地无缩略图时按需从远程缓存目录拉取
          if (!thumbPath && isRemoteRoot(root)) {
            try {
              thumbPath = await ensureRemoteThumb(root, cache, absPath)
            } catch {
              thumbPath = null
            }
          }
          if (thumbPath) {
            file = thumbPath
            thumbServed = true
            localSource = true
          }
        }
      }

      const statAny = async () => {
        if (localSource) {
          try {
            const s = await fsp.stat(file)
            return { isFile: s.isFile(), size: s.size }
          } catch {
            return null
          }
        }
        return provider.stat(file)
      }

      // 命中缩略图但文件缺失（如被手动删除）时回退原图一次，避免 404 破图。
      let st = await statAny()
      if ((!st || !st.isFile) && thumbServed) {
        file = absPath
        thumbServed = false
        localSource = false
        st = await provider.stat(file)
      }
      if (!st || !st.isFile) return new Response('not found', { status: 404 })

      const mime = MIME_BY_EXT[extName(file)] || 'application/octet-stream'
      // 原图请求不缓存；缩略图请求（?size=thumb）若回退到原图（缩略图尚未生成）
      // 也不缓存，避免浏览器把缓存建立前的原图响应当作缩略图复用。
      const cacheControl =
        size === 'orig' || (size === 'thumb' && !thumbServed) ? 'no-cache' : 'public, max-age=86400'
      const headers = new Headers({
        'Content-Type': mime,
        // 渲染端 canvas 读取像素（复制/导出）需要跨域许可
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': cacheControl
      })

      // 本地文件（含本地缓存缩略图）支持 HTTP Range，供 <video> 拖动进度/按需取片。
      // 远程 Provider 的流不支持区间，退化为 200 整体流。
      const localFile = localSource || !isRemoteRoot(root)
      const rangeHeader = req.headers.get('range')
      let status = 200
      let contentLength = st.size
      let rangeStart = null
      let rangeEnd = null
      if (rangeHeader && localFile) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
        if (m) {
          let start = m[1] === '' ? null : Number(m[1])
          let end = m[2] === '' ? null : Number(m[2])
          if (start === null && end !== null) {
            start = Math.max(0, st.size - end)
            end = st.size - 1
          } else if (start !== null && end === null) {
            end = st.size - 1
          }
          if (start != null && end != null && start <= end && start < st.size) {
            end = Math.min(end, st.size - 1)
            status = 206
            contentLength = end - start + 1
            rangeStart = start
            rangeEnd = end
            headers.set('Content-Range', `bytes ${start}-${end}/${st.size}`)
          }
        }
      }
      headers.set('Content-Length', String(contentLength))
      if (localFile) headers.set('Accept-Ranges', 'bytes')
      // 媒体元数据探测可能发 HEAD：只回头，不创建文件流
      if (req.method === 'HEAD') return new Response(null, { status, headers })
      const stream =
        rangeStart != null
          ? createReadStream(file, { start: rangeStart, end: rangeEnd })
          : localFile
            ? createReadStream(file)
            : provider.createReadStream(file)
      const body = Readable.toWeb(stream)
      return new Response(body, { status, headers })
    } catch (err) {
      return new Response('error: ' + String(err?.message || err), { status: 500 })
    }
  })
}
