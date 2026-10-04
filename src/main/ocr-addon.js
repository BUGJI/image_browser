import { app, net, dialog, BrowserWindow } from 'electron'
import { promises as fsp, existsSync, createWriteStream, createReadStream } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import extract from 'extract-zip'
import { getSetting } from './settings'
import { broadcast } from './windows'

/**
 * OCR 运行时（onnxruntime-node + sharp）按需管理
 *
 * 基础安装包内置 @repeato/ocr（含 ~16MB 模型），但不含体积巨大的
 * ONNX Runtime 原生库与 sharp。用户在「设置 → 图内文字搜索 → 模型管理」里
 * 下载或导入运行时组件包（zip），解压到 userData/ocr-addon/node_modules。
 * OCR worker 启动时通过 NODE_PATH 指向该目录来解析原生依赖。
 *
 * 组件包来源：
 *   1. GitHub Releases 附件（默认，见 getAddonDownloadUrl）
 *   2. 本地离线 zip（用户手动选择）
 */

const REPO_OWNER = 'BUGJI'
const REPO_NAME = 'image_browser'
const ORT_VERSION = '1.22.0-rev'
const SHARP_VERSION = '0.34.5'
// Release tag：与 scripts/build-ocr-addon.mjs 生成的附件版本对应
const ADDON_TAG = `ocr-runtime-v${ORT_VERSION}_sharp-${SHARP_VERSION}`
const PLATFORM = `${process.platform}-${process.arch}`

let installing = false

export function isAddonSupported() {
  return process.platform === 'win32' && process.arch === 'x64'
}

export function getAddonDir() {
  return join(app.getPath('userData'), 'ocr-addon')
}

export function getAddonNodeModules() {
  return join(getAddonDir(), 'node_modules')
}

export function isAddonInstalled() {
  if (!isAddonSupported()) return false
  const nm = getAddonNodeModules()
  return existsSync(join(nm, 'onnxruntime-node')) && existsSync(join(nm, 'sharp'))
}

/** 默认下载地址：GitHub Releases 附件；可用设置 ocrAddonUrl 覆盖 */
export function getAddonDownloadUrl() {
  const custom = String(getSetting('ocrAddonUrl', '') || '').trim()
  if (custom) return custom
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${ADDON_TAG}/ocr-runtime-${PLATFORM}.zip`
}

async function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else {
        try {
          total += (await fsp.stat(p)).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total
}

export async function getAddonStatus() {
  const installed = isAddonInstalled()
  return {
    installed,
    supported: isAddonSupported(),
    platform: PLATFORM,
    installing,
    dir: getAddonDir(),
    downloadUrl: getAddonDownloadUrl(),
    sizeBytes: installed ? await dirSize(getAddonDir()) : 0
  }
}

function emit(phase, extra = {}) {
  broadcast('ocr:addon-progress', { phase, ...extra })
}

/** 下载到本地临时文件，带进度回调 */
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      reject(err)
    }
    let request
    try {
      request = net.request({ url, redirect: 'follow' })
    } catch (err) {
      return fail(err)
    }
    request.on('response', (response) => {
      const code = response.statusCode
      if (code !== 200) {
        fail(new Error(`下载失败：HTTP ${code}`))
        return
      }
      const total = Number(response.headers['content-length'] || 0) || 0
      let received = 0
      const file = createWriteStream(dest)
      file.on('error', fail)
      response.on('data', (chunk) => {
        received += chunk.length
        file.write(chunk)
        if (onProgress) onProgress({ received, total })
      })
      response.on('end', () => {
        file.end(() => {
          if (settled) return
          settled = true
          resolve()
        })
      })
      response.on('error', fail)
    })
    request.on('error', fail)
    request.end()
  })
}

/** 计算文件 SHA-256（十六进制小写） */
function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

const SHA256_RE = /^[a-f0-9]{64}$/i

/**
 * 获取组件包的期望 SHA-256：
 *  - 优先用设置 ocrAddonSha256 手动钉死的哈希；
 *  - 其次尝试下载同目录的 `<zip url>.sha256` 旁车文件（内容里取第一个 64 位十六进制串）；
 *  - 都没有（旧发布 / 离线 URL / 网络失败）返回 null，调用方按「无校验」降级处理。
 */
async function getExpectedSha256(zipUrl) {
  const pinned = String(getSetting('ocrAddonSha256', '') || '').trim()
  if (SHA256_RE.test(pinned)) return pinned.toLowerCase()
  try {
    const res = await fetch(`${zipUrl}.sha256`, { redirect: 'follow' })
    if (!res.ok) return null
    const m = SHA256_RE.exec(await res.text())
    return m ? m[0].toLowerCase() : null
  } catch {
    return null
  }
}

/** 读取本地 zip 同目录的 `.sha256` 旁车文件；不存在返回 null */
async function readLocalExpectedSha256(zipPath) {
  try {
    const m = SHA256_RE.exec(await fsp.readFile(`${zipPath}.sha256`, 'utf8'))
    return m ? m[0].toLowerCase() : null
  } catch {
    return null
  }
}

/** 校验文件哈希，不匹配时抛错 */
async function verifyFileHash(filePath, expected) {
  const actual = await sha256File(filePath)
  if (actual !== expected) {
    throw new Error(`组件包校验失败（SHA-256 不匹配）：期望 ${expected}，实际 ${actual}`)
  }
}

/** 解压 zip 到临时目录，校验结构后原子替换到 addon 目录 */
async function installFromZip(zipPath, onProgress) {
  const staging = join(app.getPath('temp'), `ocr-addon-stage-${Date.now()}`)
  await fsp.rm(staging, { recursive: true, force: true })
  await fsp.mkdir(staging, { recursive: true })
  try {
    onProgress?.({ phase: 'extract' })
    await extract(zipPath, { dir: staging })

    // 允许 zip 根为 node_modules/ 或直接是包目录；统一归一化出 node_modules
    let nmSrc = join(staging, 'node_modules')
    if (!existsSync(nmSrc)) {
      // 兼容「已解压后的 addon 目录」结构：staging/ocr-addon/node_modules
      const alt = join(staging, 'ocr-addon', 'node_modules')
      if (existsSync(alt)) nmSrc = alt
      else throw new Error('组件包结构无效：缺少 node_modules')
    }
    if (!existsSync(join(nmSrc, 'onnxruntime-node')) || !existsSync(join(nmSrc, 'sharp'))) {
      throw new Error('组件包内容不完整：缺少 onnxruntime-node 或 sharp')
    }

    onProgress?.({ phase: 'apply' })
    const target = getAddonDir()
    await fsp.rm(target, { recursive: true, force: true })
    await fsp.mkdir(target, { recursive: true })
    await fsp.cp(nmSrc, join(target, 'node_modules'), { recursive: true })
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

/** 从 GitHub Releases（或自定义 URL）下载并安装 */
export async function installAddonFromUrl(url, onProgress) {
  if (!isAddonSupported()) throw new Error(`当前平台暂不支持 OCR 组件：${PLATFORM}`)
  if (installing) throw new Error('已有安装任务在进行中')
  installing = true
  const tmp = join(app.getPath('temp'), `ocr-addon-${Date.now()}.zip`)
  try {
    onProgress?.({ phase: 'download', received: 0, total: 0 })
    await downloadFile(url, tmp, (p) => onProgress?.({ phase: 'download', ...p }))

    // 完整性校验：有期望哈希就必须匹配，否则删除临时文件并中止解压
    const expected = await getExpectedSha256(url)
    if (expected) {
      onProgress?.({ phase: 'verify' })
      await verifyFileHash(tmp, expected)
    } else {
      onProgress?.({ phase: 'verify-skipped' })
    }

    await installFromZip(tmp, onProgress)
    onProgress?.({ phase: 'done' })
  } finally {
    installing = false
    await fsp.rm(tmp, { force: true }).catch(() => {})
  }
}

/** 从本地离线 zip 安装 */
export async function installAddonFromFile(zipPath, onProgress) {
  if (installing) throw new Error('已有安装任务在进行中')
  installing = true
  try {
    const expected = await readLocalExpectedSha256(zipPath)
    if (expected) {
      onProgress?.({ phase: 'verify' })
      await verifyFileHash(zipPath, expected)
    } else {
      onProgress?.({ phase: 'verify-skipped' })
    }
    await installFromZip(zipPath, onProgress)
    onProgress?.({ phase: 'done' })
  } finally {
    installing = false
  }
}

/** 弹出文件选择框并安装所选 zip */
export async function pickAndInstallAddon(onProgress) {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null
  const result = await dialog.showOpenDialog(win, {
    title: '选择 OCR 运行时组件包',
    filters: [{ name: 'OCR 组件包 (*.zip)', extensions: ['zip'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths?.length) return { canceled: true }
  await installAddonFromFile(result.filePaths[0], onProgress)
  return { canceled: false, file: result.filePaths[0] }
}

/** 删除已安装的运行时组件 */
export async function removeAddon() {
  const target = getAddonDir()
  await fsp.rm(target, { recursive: true, force: true })
  return { removed: true }
}

export { emit as emitAddonProgress }
