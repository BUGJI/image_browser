/**
 * 存储层类型定义与常量。
 *
 * Provider 是「源文件访问」的统一抽象：本地根用 fs，远程根用各协议客户端。
 * 所有方法均以「绝对路径字符串」为操作对象：
 *   - 本地根：Windows 盘符路径 / POSIX 路径
 *   - 远程根：伪 URL，如 webdav://host/base/dir/a.jpg、smb://host/share/dir/a.jpg
 * 缓存目录（cache.db / 缩略图）始终位于本地磁盘，不经过 Provider。
 */

export const ROOT_TYPE = Object.freeze({
  LOCAL: 'local',
  WEBDAV: 'webdav',
  SMB: 'smb',
  FTP: 'ftp'
})

export const ROOT_TYPES = Object.freeze(Object.values(ROOT_TYPE))

/**
 * @typedef {Object} StatResult
 * @property {boolean} isDir
 * @property {boolean} isFile
 * @property {number} size
 * @property {number} mtimeMs
 */

/**
 * @typedef {Object} DirEntry
 * @property {string} name
 * @property {boolean} isDir
 * @property {boolean} isFile
 * @property {number} [size]    可用时提供，避免消费方再补一次 stat
 * @property {number} [mtimeMs] 可用时提供（远程 lastmod），缺失为 0
 */

/**
 * @typedef {Object} StorageProvider
 * @property {string} type
 * @property {(path: string) => Promise<StatResult|null>} stat
 * @property {(path: string) => Promise<boolean>} exists
 * @property {(dir: string) => Promise<DirEntry[]>} list
 * @property {(path: string) => Promise<Buffer>} readFile
 * @property {(path: string) => import('stream').Readable} createReadStream
 * @property {(path: string, data: Buffer|string) => Promise<void>} writeFile
 * @property {(path: string, opts?: object) => Promise<void>} mkdir
 * @property {(path: string, opts?: object) => Promise<void>} remove
 * @property {(from: string, to: string) => Promise<void>} rename
 * @property {boolean} writable
 */

export class StorageReadOnlyError extends Error {
  constructor(message = '该根目录为只读，禁止写入') {
    super(message)
    this.name = 'StorageReadOnlyError'
  }
}
