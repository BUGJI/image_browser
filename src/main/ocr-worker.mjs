/**
 * ocr-worker.mjs —— OCR 重型任务 Worker 线程（可选依赖）
 *
 * 用 @repeato/ocr（PaddleOCR + ONNX Runtime）识别图片内文字，
 * 把 OCR 推理从 Electron 主进程移到 worker 线程，避免阻塞主进程事件循环。
 *
 * @repeato/ocr（及其内部 sharp / onnxruntime-node）是可选的：
 * - 依赖未安装时，本 worker 仍可被创建，但 recognize() 会抛错，
 *   主进程 catch 后按「该批次失败」处理并向用户提示「未安装 OCR 依赖」。
 * - 模型较重（detection + recognition 两个 ONNX 模型约 ~10MB），
 *   采用懒加载：首次 recognize 时才 Ocr.create()，整批复用同一实例。
 *
 * 消息协议（parentPort）：
 *   in   { type: 'ocr', jobs: [{ id, absPath, name }] }
 *   out  { type: 'ocr-done', id, name, text, count }
 *   out  { type: 'ocr-fail', id, name }
 *   out  { type: 'ocr-done-all', total }
 *   in   { type: 'abort' }    —— 设置中止标志，下一轮循环抛出
 *   out  { type: 'error', message }
 *   in   { type: 'release' }  —— 释放 ONNX Runtime 会话后再退出（主进程最后发送）
 */

import { parentPort } from 'node:worker_threads'
import { registerHooks, createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

// 运行时 addon（onnxruntime-node + sharp）解压在 userData，而 @repeato/ocr 随应用打包。
// @repeato/ocr 内部用动态 import("onnxruntime-node")（ESM 解析，NODE_PATH 无效），
// 这里用同步 resolve 钩子把运行时依赖重定向到 addon 目录。
const ADDON_NODE_MODULES = process.env.OCR_ADDON_NODE_MODULES || ''
if (ADDON_NODE_MODULES) {
  try {
    const addonRequire = createRequire(pathToFileURL(join(ADDON_NODE_MODULES, 'noop.js')).href)
    const RUNTIME_PKGS = ['onnxruntime-node', 'onnxruntime-common', 'sharp']
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const isRuntime =
          RUNTIME_PKGS.some((p) => specifier === p || specifier.startsWith(p + '/')) ||
          specifier.startsWith('@img/')
        if (isRuntime) {
          try {
            return {
              url: pathToFileURL(addonRequire.resolve(specifier)).href,
              shortCircuit: true
            }
          } catch {
            /* 回退到默认解析 */
          }
        }
        return nextResolve(specifier, context)
      }
    })
  } catch (err) {
    console.error('[ocr] register runtime hook failed:', err)
  }
}

let aborted = false
let ocrPromise = null
let releaseAll = null

/** 懒加载 Ocr 单例（首次调用时才创建模型会话，整批复用） */
async function getOcr() {
  if (!ocrPromise) {
    ocrPromise = (async () => {
      let mod = {}
      try {
        mod = await import('@repeato/ocr')
      } catch (err) {
        // 这里要抛出一个可识别的错误，主进程据此判定「依赖未安装」
        throw new Error('OCR_UNINSTALLED', { cause: err })
      }
      const Ocr = mod.default || mod
      const OcrModule =
        (mod && mod.create ? { create: mod.create, releaseAll: mod.releaseAll } : Ocr) || Ocr
      releaseAll = typeof OcrModule.releaseAll === 'function' ? OcrModule.releaseAll : null
      return OcrModule.create()
    })()
  }
  return ocrPromise
}

async function releaseOcrSessions() {
  if (releaseAll) {
    try {
      await releaseAll()
    } catch {
      /* ignore */
    }
  }
}

/**
 * 识别单张图片中的文字。
 * @returns {{ text: string, count: number }}
 */
async function recognize(absPath) {
  const ocr = await getOcr()
  const res = await ocr.detect(absPath)
  const lines = (res && Array.isArray(res.texts) ? res.texts : []).filter(
    (l) => l && typeof l.text === 'string' && l.text.trim()
  )
  const text = lines.map((l) => l.text.trim()).join('\n')
  return { text, count: lines.length }
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    try {
      if (msg.type === 'ocr') {
        const { jobs } = msg
        for (const job of jobs) {
          if (aborted) throw new Error('ocr aborted')
          try {
            const { text, count } = await recognize(job.absPath)
            parentPort.postMessage({ type: 'ocr-done', id: job.id, name: job.name, text, count })
          } catch (err) {
            const isUninstalled = String(err?.message) === 'OCR_UNINSTALLED'
            parentPort.postMessage({
              type: 'ocr-fail',
              id: job.id,
              name: job.name,
              uninstalled: isUninstalled || false
            })
          }
        }
        parentPort.postMessage({ type: 'ocr-done-all', total: jobs.length })
      } else if (msg.type === 'abort') {
        aborted = true
      } else if (msg.type === 'release') {
        await releaseOcrSessions()
      }
    } catch (err) {
      parentPort.postMessage({ type: 'error', message: String(err?.message || err) })
    }
  })
}
