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

/** 官方默认下载地址（不受设置覆盖），用于匹配内置已知哈希 */
function getDefaultAddonUrl() {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${ADDON_TAG}/ocr-runtime-${PLATFORM}.zip`
}

/** 默认下载地址：GitHub Releases 附件；可用设置 ocrAddonUrl 覆盖 */
export function getAddonDownloadUrl() {
  const custom = String(getSetting('ocrAddonUrl', '') || '').trim()
  if (custom) return custom
  return getDefaultAddonUrl()
}

// 内置已知哈希表（随应用版本发布）：覆盖官方默认下载地址指向的组件包。
// key 为平台，value 为小写 SHA-256。发布新组件包时在此登记，作为旁车 .sha256 之外的可信兜底。
// 为空表示「尚未登记」；此时依赖发布端上传的 <url>.sha256，或用户手动钉 ocrAddonSha256。
const KNOWN_ADDON_SHA256 = {
  // 'win32-x64': '<64 位十六进制 SHA-256>'
}

/** 是否允许在无任何可信哈希时仍安装（默认否，需用户在设置中显式开启） */
export function isUnsignedInstallAllowed() {
  return getSetting('ocrAddonAllowUnsigned', 'false') === 'true'
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
    let file = null
    const fail = (err) => {
      if (settled) return
      settled = true
      // 失败路径必须销毁写流，否则残留的文件句柄会锁住临时文件导致后续清理失败
      try {
        file?.destroy()
      } catch {
        /* ignore */
      }
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
      file = createWriteStream(dest)
      file.on('error', fail)
      response.on('data', (chunk) => {
        received += chunk.length
        file.write(chunk)
        if (onProgress) onProgress({ received, total })
      })
      response.on('end', () => {
        file.end(() => {
          if (settled) return
          // 有 content-length 时校验完整性，避免截断下载（哈希缺失时这是唯一防线）
          if (total > 0 && received !== total) {
            fail(new Error(`下载不完整：期望 ${total} 字节，实际 ${received}`))
            return
          }
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
 *  - 官方默认地址其次用内置已知哈希表（可信、离线可校验）；
 *  - 再次尝试下载同目录的 `<zip url>.sha256` 旁车文件（取第一个 64 位十六进制串）；
 *  - 都拿不到返回 null，调用方默认拒绝安装（除非用户显式允许无校验安装）。
 */
async function getExpectedSha256(zipUrl) {
  const pinned = String(getSetting('ocrAddonSha256', '') || '').trim()
  if (SHA256_RE.test(pinned)) return pinned.toLowerCase()
  const known = zipUrl === getDefaultAddonUrl() ? KNOWN_ADDON_SHA256[PLATFORM] : null
  if (known && SHA256_RE.test(known)) return known.toLowerCase()
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

/**
 * 解压 zip 到临时目录，校验结构后就位。
 * 就位采用「先备好同级完整副本 -> 删旧 -> rename」：把目录缺失空窗期压到 rename 一刻，
 * 避免「rm 后 cp 期间」目标目录不存在导致并发读取失败。
 */
/**
 * 完整性校验：有期望哈希则强制匹配；否则仅当用户显式允许时放行，默认中止安装。
 * 「无校验静默降级」会让被污染/中间人的组件包直接解压并 require 进主进程，故改为默认拒绝。
 */
async function verifyOrReject(pkgPath, expected, onProgress) {
  if (expected) {
    onProgress?.({ phase: 'verify' })
    await verifyFileHash(pkgPath, expected)
    return
  }
  if (isUnsignedInstallAllowed()) {
    onProgress?.({ phase: 'verify-skipped' })
    return
  }
  throw new Error(
    '组件包缺少可信的 SHA-256 校验值，已中止安装（安全默认）。' +
      '请改用带 .sha256 旁车文件的包、在设置中手动钉哈希，' +
      '或在设置中显式开启「允许无校验安装（不推荐）」。'
  )
}

async function installFromZip(zipPath, onProgress) {
  const staging = join(app.getPath('temp'), `ocr-addon-stage-${Date.now()}`)
  const target = getAddonDir()
  const staged = `${target}.new`
  await fsp.rm(staging, { recursive: true, force: true })
  await fsp.rm(staged, { recursive: true, force: true })
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
    await fsp.mkdir(staged, { recursive: true })
    await fsp.cp(nmSrc, join(staged, 'node_modules'), { recursive: true })
    await fsp.rm(target, { recursive: true, force: true })
    await fsp.rename(staged, target)
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
    await fsp.rm(staged, { recursive: true, force: true }).catch(() => {})
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

    // 完整性校验：有期望哈希就必须匹配，否则默认中止（除非用户显式允许无校验安装）
    const expected = await getExpectedSha256(url)
    await verifyOrReject(tmp, expected, onProgress)

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
    await verifyOrReject(zipPath, expected, onProgress)
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
