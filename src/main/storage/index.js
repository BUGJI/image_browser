import { ROOT_TYPE } from './types.js'
import { createLocalProvider } from './local.js'
import { isRemotePath } from './path-utils.js'

/**
 * Provider 注册表。
 *
 * - 本地根：按 writable 复用同一套无状态实现。
 * - 远程根：由各协议模块通过 registerProvider 注册工厂，按 rootId 建立/复用连接。
 */

/** @type {Map<string, (root: object) => import('./types.js').StorageProvider>} */
const remoteFactories = new Map()

const localWritable = createLocalProvider({ writable: true })
const localReadonly = createLocalProvider({ writable: false })

// 远程 Provider 实例缓存：按 root 的配置指纹复用连接（配置变更后自动重建）
const providerCache = new Map()

function providerKey(type, root) {
  return `${type}|${root?.id ?? ''}|${root?.path ?? ''}|${JSON.stringify(root?.config ?? null)}|${root?.writable ?? 1}`
}

/** 注册远程协议工厂：factory(root) -> provider */
export function registerProvider(type, factory) {
  remoteFactories.set(type, factory)
  // 重新注册后清空缓存，避免旧实例残留
  for (const key of [...providerCache.keys()]) {
    if (key.startsWith(type + '|')) providerCache.delete(key)
  }
}

/** 根配置变更/删除后调用，丢弃其 Provider 连接 */
export function invalidateProvider(rootId) {
  const id = String(rootId)
  for (const key of [...providerCache.keys()]) {
    const parts = key.split('|')
    if (parts[1] === id) providerCache.delete(key)
  }
}

/** 判断根是否为远程（显式 type 或伪 URL 路径） */
export function isRemoteRoot(root) {
  if (!root) return false
  if (root.type && root.type !== ROOT_TYPE.LOCAL) return true
  return isRemotePath(root.path)
}

/** 根的写入能力（缺省视为可写，兼容旧数据） */
export function isWritableRoot(root) {
  if (!root) return false
  return root.writable == null ? true : !!Number(root.writable)
}

/**
 * 获取某个根对应的 Provider。
 * @param {object|string} root 根记录，或类型字符串
 */
export function getProvider(root) {
  const type = typeof root === 'string' ? root : root?.type || ROOT_TYPE.LOCAL
  if (type === ROOT_TYPE.LOCAL) {
    return isWritableRoot(typeof root === 'string' ? { writable: 1 } : root) ? localWritable : localReadonly
  }
  const factory = remoteFactories.get(type)
  if (!factory) throw new Error(`未注册的存储类型: ${type}`)
  // 带临时密钥（新增/编辑校验）时不走缓存，避免把未落库的凭据缓存下来
  if (root && root.__secret != null) return factory(root)
  const key = providerKey(type, root)
  let provider = providerCache.get(key)
  if (!provider) {
    provider = factory(root)
    providerCache.set(key, provider)
  }
  return provider
}
