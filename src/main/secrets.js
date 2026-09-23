import { safeStorage } from 'electron'
import { getDb, prep } from './db'

/**
 * 根目录凭据存储：单独建表，优先用 Electron safeStorage 加密。
 * 密钥不可用（如部分 Linux 环境）时退化为 base64 并加前缀标注，避免明文。
 */

export function initSecretsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS root_secrets (
      root_id INTEGER PRIMARY KEY,
      secret  TEXT NOT NULL DEFAULT ''
    )
  `)
}

function encrypt(secret) {
  const s = secret == null ? '' : String(secret)
  if (!s) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(s).toString('base64')
    }
  } catch {
    /* fallthrough */
  }
  return 'plain:' + Buffer.from(s, 'utf8').toString('base64')
}

function decrypt(stored) {
  const s = stored == null ? '' : String(stored)
  if (!s) return ''
  try {
    if (s.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
    }
    if (s.startsWith('plain:')) {
      return Buffer.from(s.slice(6), 'base64').toString('utf8')
    }
  } catch {
    /* fallthrough */
  }
  return s // 兼容早期明文
}

export function setRootSecret(rootId, secret) {
  prep(
    `INSERT INTO root_secrets (root_id, secret) VALUES (?, ?)
     ON CONFLICT(root_id) DO UPDATE SET secret = excluded.secret`
  ).run(Number(rootId), encrypt(secret))
}

export function getRootSecret(rootId) {
  const row = prep('SELECT secret FROM root_secrets WHERE root_id = ?').get(Number(rootId))
  return row ? decrypt(row.secret) : ''
}

export function removeRootSecret(rootId) {
  prep('DELETE FROM root_secrets WHERE root_id = ?').run(Number(rootId))
}
