import { basename } from 'path'
import { getProvider } from './storage/index.js'
import { baseName, joinPath } from './storage/path-utils.js'

/**
 * 目录树扫描：只收集文件夹（不读文件）
 * - 迭代式遍历（避免超深目录递归爆栈）
 * - 支持进度回调 onProgress({ scanned }) 与中止 shouldAbort()
 * - 通过 StorageProvider 访问目录，兼容本地与远程根
 */

// 跳过的系统/隐藏目录（NAS 常见垃圾目录）
const SKIP_DIRS = new Set(['@eaDir', '#recycle', '.seekMeta', '.seekTrash', '.thumbnails', '.git', 'node_modules'])

function isSkipDir(name) {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

export class ScanAbortedError extends Error {
  constructor() {
    super('scan aborted')
    this.name = 'ScanAbortedError'
  }
}

/**
 * 扫描根目录，返回完整文件夹树 { name, path, children }
 * @param {string} rootPath
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=Infinity] 最大深度
 * @param {(info: {scanned: number}) => void} [opts.onProgress] 每处理一批目录回调
 * @param {() => boolean} [opts.shouldAbort] 返回 true 时抛出 ScanAbortedError
 */
export async function scanDirTree(rootPath, { maxDepth = Infinity, onProgress, shouldAbort, provider } = {}) {
  const pv = provider || getProvider('local')
  let scanned = 0
  const root = { name: baseName(rootPath) || basename(rootPath) || rootPath, path: rootPath, children: [] }
  const stack = [{ dir: rootPath, node: root, depth: 0 }]

  while (stack.length) {
    if (shouldAbort?.()) throw new ScanAbortedError()

    const { dir, node, depth } = stack.pop()
    let entries
    try {
      entries = await pv.list(dir)
    } catch {
      continue // 无权限/不存在则跳过
    }

    for (const entry of entries) {
      if (!entry.isDir) continue // 只收集文件夹
      if (isSkipDir(entry.name)) continue
      scanned++
      const child = { name: entry.name, path: joinPath(dir, entry.name), children: [] }
      node.children.push(child)
      if (depth + 1 < maxDepth) {
        stack.push({ dir: child.path, node: child, depth: depth + 1 })
      }
    }

    node.children.sort((a, b) => a.name.localeCompare(b.name, 'zh'))

    // 每处理 25 个目录汇报一次进度
    if (onProgress && scanned % 25 === 0) onProgress({ scanned })
  }

  onProgress?.({ scanned })
  return root
}
