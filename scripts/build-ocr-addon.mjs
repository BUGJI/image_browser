/**
 * scripts/build-ocr-addon.mjs —— 生成 OCR 运行时组件包（供 GitHub Releases 附件）
 *
 * 基础安装包只内置 @repeato/ocr（含模型），不含体积巨大的 ONNX Runtime 与 sharp。
 * 本脚本在临时目录安装「目标平台」的 onnxruntime-node + sharp（含依赖闭包），
 * 裁剪掉其它平台二进制后打包为：
 *
 *   dist/ocr-runtime-<platform>/ocr-runtime-<platform>.zip
 *
 * 其中 zip 根为 node_modules/，与应用内「设置 → 图内文字搜索 → 运行时组件 →
 * 本地导入」及 GitHub Releases 下载解压逻辑一致。
 *
 * 用法：
 *   node scripts/build-ocr-addon.mjs [--platform win32-x64] [--out dist]
 *
 * 发布：把生成的 zip 作为 GitHub Release 附件上传，tag 必须与
 *   src/main/ocr-addon.js 中的 ADDON_TAG 一致（默认
 *   ocr-runtime-v<onnxruntime版本>_sharp-<sharp版本>），
 * 附件名 ocr-runtime-<platform>.zip。
 */

import { promises as fsp, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import os from 'os'
import AdmZip from 'adm-zip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const ORT_VERSION = '1.22.0-rev'
const SHARP_VERSION = '0.34.5'

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag, def) => {
    const i = args.indexOf(flag)
    return i >= 0 && args[i + 1] ? args[i + 1] : def
  }
  return {
    platform: get('--platform', `${process.platform}-${process.arch}`),
    out: get('--out', 'dist')
  }
}

const PLATFORM = parseArgs().platform
const OUT_DIR = join(ROOT, parseArgs().out)

if (PLATFORM !== 'win32-x64') {
  console.error(`当前仅支持 win32-x64，收到：${PLATFORM}`)
  process.exit(1)
}

async function main() {
  const staging = await fsp.mkdtemp(join(os.tmpdir(), 'ocr-addon-'))
  console.log('staging:', staging)

  // 最小 package.json，避免继承项目依赖
  await fsp.writeFile(
    join(staging, 'package.json'),
    JSON.stringify({ name: 'ocr-addon-staging', private: true, version: '1.0.0' }, null, 2)
  )

  // 安装运行时依赖闭包（仅目标平台 CPU/OS；忽略 build script，用预编译二进制）
  console.log('installing runtime deps...')
  execFileSync(
    'npm',
    [
      'install',
      `onnxruntime-node@${ORT_VERSION}`,
      `sharp@${SHARP_VERSION}`,
      '--os=win32',
      '--cpu=x64',
      '--ignore-scripts',
      '--no-package-lock',
      '--no-save',
      '--omit=dev'
    ],
    { cwd: staging, stdio: 'inherit', shell: process.platform === 'win32' }
  )

  const nm = join(staging, 'node_modules')
  if (!existsSync(join(nm, 'onnxruntime-node')) || !existsSync(join(nm, 'sharp'))) {
    throw new Error('依赖安装不完整：缺少 onnxruntime-node 或 sharp')
  }

  // 裁剪 onnxruntime-node：结构为 bin/<napi>/<os>/<arch>/，仅保留 win32/x64
  const ortBin = join(nm, 'onnxruntime-node', 'bin')
  for (const napi of await fsp.readdir(ortBin).catch(() => [])) {
    const napiDir = join(ortBin, napi)
    for (const osName of await fsp.readdir(napiDir).catch(() => [])) {
      const osDir = join(napiDir, osName)
      for (const arch of await fsp.readdir(osDir).catch(() => [])) {
        if (!(osName === 'win32' && arch === 'x64')) {
          await fsp.rm(join(osDir, arch), { recursive: true, force: true })
          console.log(`pruned onnxruntime-node ${napi}/${osName}/${arch}`)
        }
      }
      const remain = await fsp.readdir(osDir).catch(() => [])
      if (!remain.length) {
        await fsp.rm(osDir, { recursive: true, force: true })
        console.log(`pruned onnxruntime-node ${napi}/${osName}`)
      }
    }
  }

  // 裁剪 @img：仅移除其它平台的 sharp 平台包，保留 win32-x64 与 @img/colour 等运行期依赖
  const KEEP_IMG = new Set(['sharp-win32-x64', 'sharp-libvips-win32-x64', 'colour'])
  const imgDir = join(nm, '@img')
  for (const pkg of await fsp.readdir(imgDir).catch(() => [])) {
    if (!KEEP_IMG.has(pkg) && /^sharp/.test(pkg)) {
      await fsp.rm(join(imgDir, pkg), { recursive: true, force: true })
      console.log(`pruned @img/${pkg}`)
    }
  }

  // 打包 zip（根为 node_modules/）
  await fsp.mkdir(OUT_DIR, { recursive: true })
  const zipPath = join(OUT_DIR, `ocr-runtime-${PLATFORM}.zip`)
  console.log('zipping...')
  const zip = new AdmZip()
  zip.addLocalFolder(nm, 'node_modules')
  zip.writeZip(zipPath)

  const size = (await fsp.stat(zipPath)).size
  console.log(`\n✓ 已生成 ${zipPath} (${(size / 1048576).toFixed(1)} MB)`)
  console.log(`\n发布步骤：`)
  console.log(`  1. 创建 GitHub Release，tag: ocr-runtime-v${ORT_VERSION}_sharp-${SHARP_VERSION}`)
  console.log(`  2. 上传附件：ocr-runtime-${PLATFORM}.zip`)
  console.log(`  （tag 需与 src/main/ocr-addon.js 的 ADDON_TAG 一致）`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
