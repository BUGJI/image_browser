import { promises as fsp, createReadStream as fsCreateReadStream } from 'fs'
import { ROOT_TYPE, StorageReadOnlyError } from './types.js'

/**
 * 本地文件系统 Provider：直接包装 fs。
 * 与改造前行为保持一致，是本地根（含只读本地根）的默认实现。
 */

function ensureWritable(writable) {
  if (!writable) throw new StorageReadOnlyError()
}

/**
 * @param {{ writable?: boolean }} [opts]
 * @returns {import('./types.js').StorageProvider}
 */
export function createLocalProvider({ writable = true } = {}) {
  return {
    type: ROOT_TYPE.LOCAL,
    writable,

    async stat(p) {
      try {
        const st = await fsp.stat(p)
        return { isDir: st.isDirectory(), isFile: st.isFile(), size: st.size, mtimeMs: st.mtimeMs }
      } catch {
        return null
      }
    },

    async exists(p) {
      try {
        await fsp.access(p)
        return true
      } catch {
        return false
      }
    },

    async list(dir) {
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile() }))
    },

    async readFile(p) {
      return fsp.readFile(p)
    },

    createReadStream(p) {
      return fsCreateReadStream(p)
    },

    async writeFile(p, data) {
      ensureWritable(writable)
      return fsp.writeFile(p, data)
    },

    async mkdir(p, opts = {}) {
      ensureWritable(writable)
      return fsp.mkdir(p, { recursive: true, ...opts })
    },

    async remove(p, opts = {}) {
      ensureWritable(writable)
      return fsp.rm(p, { force: true, ...opts })
    },

    async rename(from, to) {
      ensureWritable(writable)
      return fsp.rename(from, to)
    }
  }
}
