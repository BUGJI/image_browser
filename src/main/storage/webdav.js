import { createClient } from 'webdav'
import { ROOT_TYPE, StorageReadOnlyError } from './types.js'
import { relFromRoot } from './path-utils.js'
import { getRootSecret } from '../secrets'

/**
 * WebDAV Provider。
 *
 * 约定：`root.path` 即 WebDAV 库的基地址 URL（如 `https://host/dav/photos`），
 * 伪绝对路径 = 基地址 + '/' + 相对路径；客户端调用的 path 为 `/相对路径`。
 * 连接参数存于 root.config（url 同 path、username 等），密码存 root_secrets。
 */

/** 规范化地址：对空格/中文等做百分号编码，去掉尾部斜杠 */
function normalizeUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw).href.replace(/\/+$/, '')
  } catch {
    return raw.replace(/\/+$/, '')
  }
}

function makeClient({ url, username, password }) {
  return createClient(normalizeUrl(url), {
    username: username || '',
    password: password || ''
  })
}

/** 测试连接：尝试 stat 远程根；返回 { ok, message } */
export async function testWebdavConnection({ url, username, password }) {
  if (!url) return { ok: false, message: '缺少 WebDAV 地址' }
  try {
    const client = makeClient({ url, username, password })
    const st = await client.stat('/')
    if (!st) return { ok: false, message: '无法访问该地址' }
    return { ok: true, message: '连接成功' }
  } catch (err) {
    return { ok: false, message: String(err?.message || err) }
  }
}

export function createWebdavProvider(root) {
  const cfg = root.config || {}
  const base = root.path || cfg.url
  // 新增/编辑校验时密码尚未入库，用临时 __secret；否则读加密存储
  const password = root.__secret != null ? root.__secret : getRootSecret(root.id)
  const client = makeClient({
    url: base,
    username: cfg.username,
    password
  })
  const writable = root.writable == null ? true : !!Number(root.writable)

  const cp = (abs) => '/' + relFromRoot(base, abs).replace(/^\/+/, '')
  const ensureWritable = () => {
    if (!writable) throw new StorageReadOnlyError()
  }

  return {
    type: ROOT_TYPE.WEBDAV,
    writable,

    async stat(p) {
      try {
        const s = await client.stat(cp(p))
        return {
          isDir: s.type === 'directory',
          isFile: s.type === 'file',
          size: s.size || 0,
          mtimeMs: s.lastmod ? Date.parse(s.lastmod) || 0 : 0
        }
      } catch {
        return null
      }
    },

    async exists(p) {
      try {
        return await client.exists(cp(p))
      } catch {
        return false
      }
    },

    async list(dir) {
      const items = await client.getDirectoryContents(cp(dir))
      const arr = Array.isArray(items) ? items : items?.data || []
      return arr.map((i) => ({
        name:
          i.basename ||
          String(i.filename || '')
            .split('/')
            .filter(Boolean)
            .pop() ||
          '',
        isDir: i.type === 'directory',
        isFile: i.type === 'file',
        // 透传 size/lastmod，扫描时无需再对每个文件发一次 stat 请求
        size: typeof i.size === 'number' ? i.size : undefined,
        mtimeMs: i.lastmod ? Date.parse(i.lastmod) || 0 : undefined
      }))
    },

    async readFile(p) {
      const buf = await client.getFileContents(cp(p))
      return Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
    },

    createReadStream(p) {
      return client.createReadStream(cp(p))
    },

    async writeFile(p, data) {
      ensureWritable()
      await client.putFileContents(cp(p), data, { overwrite: true })
    },

    async mkdir(p, opts = {}) {
      ensureWritable()
      await client.createDirectory(cp(p), { recursive: opts.recursive !== false })
    },

    async remove(p, opts = {}) {
      ensureWritable()
      if (opts.recursive) {
        await client.deleteFile(cp(p))
      } else {
        await client.deleteFile(cp(p))
      }
    },

    async rename(from, to) {
      ensureWritable()
      await client.moveFile(cp(from), cp(to))
    }
  }
}
