/**
 * scripts/fetch-image-compressor.mjs —— 下载外部转换器 image_compressor.exe（不入库）
 *
 * 该二进制改由上游仓库 BUGJI/image_compresser_rust 的 Release 附件分发，
 * 避免 2.7MB blobs 常驻本仓库、且每次更新都会让仓库体积单调增长。
 * 下载后强制校验 SHA-256，不匹配则删除并报错，确保拿到的是审计过的那一份。
 *
 * Windows 打包前会调用本脚本（见 package.json build:win* 与 release.yml）。
 *
 * 用法：node scripts/fetch-image-compressor.mjs [--force]
 */

import { promises as fsp, createReadStream, createWriteStream, existsSync } from 'fs'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// 固定到上游已审计的 release 与哈希（与 THIRD_PARTY_NOTICES.md 保持一致）
const VERSION = 'v1.0.0'
const URL = `https://github.com/BUGJI/image_compresser_rust/releases/download/${VERSION}/image_compresser.exe`
const SHA256 = '9b2987d17c202a88d12af7c532e466668c56ddc527c2ce9eb6d7dcfa45308655'
const DEST = join(ROOT, 'image_compressor.exe')

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function main() {
  const force = process.argv.includes('--force')

  if (!force && existsSync(DEST)) {
    const existing = await sha256File(DEST)
    if (existing === SHA256) {
      console.log(`image_compressor.exe 已存在且哈希匹配（${VERSION}），跳过下载`)
      return
    }
    console.warn('已存在但哈希不匹配，重新下载…')
  }

  console.log(`下载 ${VERSION}: ${URL}`)
  const res = await fetch(URL, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(DEST))

  const actual = await sha256File(DEST)
  if (actual !== SHA256) {
    await fsp.rm(DEST, { force: true })
    throw new Error(`SHA-256 校验失败：期望 ${SHA256}，实际 ${actual}`)
  }
  console.log(`✓ image_compressor.exe (${VERSION}) SHA-256 ${actual}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
