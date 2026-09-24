import { basename, dirname, isAbsolute, join, relative } from 'path'

/**
 * 路径工具：同时兼容本地文件系统路径与远程伪 URL 路径。
 *
 * 远程伪路径形如 `scheme://authority/path/segments`，统一使用 `/` 分隔；
 * 本地路径在 Windows 上使用 `\`。对外暴露的「相对根目录路径」一律用 `/`。
 */

const REMOTE_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/** 是否为远程伪 URL 路径 */
export function isRemotePath(p) {
  return typeof p === 'string' && REMOTE_RE.test(p)
}

/** 反斜杠统一为正斜杠（不影响 URL 语义） */
export function toSlash(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/')
}

/** 去掉尾部斜杠（保留根 `scheme://host` 的形态） */
export function trimTrailingSlash(p) {
  return String(p == null ? '' : p).replace(/\/+$/, '')
}

/**
 * 拼接路径：base + 若干段。兼容本地与远程。
 * 传入的段可含 `/`（远程）或 `\`（本地），会自动规范化。
 */
export function joinPath(base, ...parts) {
  const segs = parts
    .flat(Infinity)
    .filter((s) => s != null && s !== '')
    .flatMap((s) => String(s).split(/[\\/]+/))
    .filter(Boolean)
  if (isRemotePath(base)) {
    const b = trimTrailingSlash(base)
    return segs.length ? `${b}/${segs.join('/')}` : b
  }
  return segs.length ? join(base, ...segs) : base
}

/**
 * 取相对根目录的路径（`/` 分隔，根自身为 ''）。兼容本地与远程。
 */
export function relFromRoot(rootPath, target) {
  if (!isRemotePath(rootPath)) {
    return relative(rootPath, target)
      .split(/[\\/]+/)
      .join('/')
  }
  const root = trimTrailingSlash(rootPath)
  const t = trimTrailingSlash(String(target))
  if (t === root) return ''
  if (t.startsWith(root + '/')) return t.slice(root.length + 1)
  return ''
}

/**
 * 判断 target 是否位于 rootPath 之内（不含 rootPath 自身）。
 * 兼容本地与远程；用于协议/剪贴板等入口的越界防护。
 */
export function isInsideRoot(rootPath, target) {
  if (!rootPath || !target) return false
  const rel = relFromRoot(rootPath, target)
  if (!rel || rel.startsWith('..')) return false
  // Windows 跨盘符时 relative() 返回绝对路径而非 `..` 前缀
  if (isRemotePath(rootPath)) return true
  return !isAbsolute(rel)
}

/**
 * 由相对路径还原绝对路径。兼容本地与远程。
 */
export function absFromRel(rootPath, rel) {
  const r = String(rel == null ? '' : rel)
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/')
  if (isRemotePath(rootPath)) {
    const b = trimTrailingSlash(rootPath)
    return r ? `${b}/${r}` : b
  }
  return r ? join(rootPath, ...r.split('/')) : rootPath
}

/** 文件名（含扩展名） */
export function baseName(p) {
  if (isRemotePath(p)) {
    const parts = String(p).split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : ''
  }
  return basename(p)
}

/** 小写扩展名（含点），无扩展名返回 '' */
export function extName(p) {
  const b = baseName(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}

/** 上级目录 */
export function dirName(p) {
  if (isRemotePath(p)) {
    const trimmed = trimTrailingSlash(p)
    const i = trimmed.lastIndexOf('/')
    return i > 0 ? trimmed.slice(0, i) : trimmed
  }
  return dirname(p)
}
