import { Worker } from 'node:worker_threads'
import { join } from 'path'
import os from 'os'

/**
 * 缓存 Worker 池与任务调度辅助（缩略图 worker / 文件夹 SHA worker）。
 * 从 cache.js 拆出。
 */

// worker 池：单个 worker 处理满该数后重启一次（清堆，防巨型 GC）
export const WORKER_RESTART_JOBS = 200

// 兜底超时：worker 异常卡死时终止，避免维护任务永久挂起
const SHAS_TIMEOUT = 600000

/**
 * 重算并写入 folders 表 + 整根汇总 SHA（meta）。
 *
 * - src_sha：该目录「直接子文件（name+size+mtime） + 直接子目录名」排序后哈希；
 *            源侧增删改（含仅增删子目录）都会变化。
 * - cache_sha：该目录「直接子缩略图（相对路径 + 文件大小）」排序后哈希；
 *              用于判断缩略图缓存本体是否一致。
 * - meta.root_src_sha / root_cache_sha：所有目录 (rel_path, 对应 sha) 排序汇总。
 *
 * 说明：整表读取 + 逐目录哈希在图片量大时会长时间占用线程，故整段计算放在
 * shas-worker 线程执行，主进程只 await 结果，避免阻塞事件循环（UI 卡死）。
 * 哈希语义见 shas-worker.mjs，需与旧实现保持跨端可比较。
 *
 * @param {{ cacheDir: string, thumbDir: string }} cache openRootCache 返回的连接
 * @returns {Promise<number>} 目录数
 */
export function rebuildFolderShas(cache) {
  return runShasWorker(join(cache.cacheDir, 'cache.db'), cache.thumbDir)
}

function runShasWorker(dbPath, thumbDir) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'shas-worker.js'), {
      resourceLimits: {
        maxOldGenerationSizeMb: 1024,
        maxYoungGenerationSizeMb: 128,
        stackSizeMb: 8
      }
    })
    let settled = false
    let timer = null
    const cleanup = () => {
      clearTimeout(timer)
      worker.removeListener('message', onMsg)
      worker.removeListener('error', onErr)
    }
    const finish = (err, count) => {
      if (settled) return
      settled = true
      cleanup()
      worker.terminate().catch(() => {})
      if (err) reject(err)
      else resolve(count)
    }
    const onMsg = (m) => {
      if (m?.type === 'shas-done') finish(null, m.count)
      else if (m?.type === 'error') finish(new Error(m.message))
    }
    const onErr = (err) => finish(err)
    timer = setTimeout(() => finish(new Error('文件夹 SHA 重建超时')), SHAS_TIMEOUT)
    worker.on('message', onMsg)
    worker.on('error', onErr)
    worker.postMessage({ type: 'rebuild-shas', dbPath, thumbDir })
  })
}

export function spawnCacheWorker() {
  const worker = new Worker(join(__dirname, 'cache-worker.js'), {
    resourceLimits: {
      // 大图解码需要一定堆，但上限越高、GC 单次停顿越长（pngjs/jpeg-js 会申请几十~几百 MB 大 Buffer）。
      // 2048 是折中：容得下绝大多数图，又不会像 4096 那样拖出十几秒的 Stop-The-World。
      maxOldGenerationSizeMb: 2048,
      maxYoungGenerationSizeMb: 256,
      stackSizeMb: 8
    }
  })
  worker.on('error', (err) => {
    console.error('[cache] worker error:', err)
  })
  return worker
}

/**
 * 缩略图生成并发度：
 * 默认 = 按「内存」与「核数」共同限制（每种解码都会临时占几十~几百 MB，
 * 核多但内存小照样会抖动；一般按 ~4GB/worker 估，兼顾速度与不换页）。
 * 开发者可传 cacheThumbWorkers 手动指定（0/空 = 自动，>0 最多取到核数）。
 */
export function pickThumbWorkerCount(override) {
  let cores = 4
  try {
    cores =
      typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
  } catch {
    /* fallback */
  }
  let memGB = 16
  try {
    memGB = os.totalmem() / 1073741824
  } catch {
    /* fallback */
  }
  const byMem = Math.max(1, Math.floor(memGB / 4) || 1)
  const auto = Math.max(1, Math.min(cores - 1 || 1, byMem, 6))
  const o = Number(override)
  if (Number.isInteger(o) && o > 0) return Math.min(o, Math.max(1, cores))
  return auto
}

/**
 * 同一时刻所有 worker「在解」图像的预估总像素上限（百万像素）。
 * 解码内存 ∝ 像素（RGBA 4B/px），并发的超大图会互相挤压内存导致解码退化（实测可达百倍）；
 * 预算也随内存自适应：内存越小，同时解码的量越少。
 */
export function maxInflightMP() {
  let memGB = 16
  try {
    memGB = os.totalmem() / 1073741824
  } catch {
    /* fallback */
  }
  return Math.min(512, Math.max(32, Math.floor((memGB - 2) * 20)))
}

// 预估像素 ≥ 该值视为“重图”（单飞，不进小图批次）
export const HEAVY_MP = 20

/**
 * 缩略图任务队列构造。
 * cacheSequential = true：保持扫描顺序（同一目录连续读取，机械硬盘友好）；
 * = false：按目录打散后轮流取（跨文件夹交错，某目录出现重图/卡顿时，
 *   其它目录的任务仍在推进，视觉上不易感觉卡在某个文件夹）。
 */
export function buildThumbQueue(jobs, sequential) {
  if (sequential || jobs.length < 2) return jobs.slice()
  const buckets = new Map() // 目录 -> jobs（保持内部原有顺序）
  for (const job of jobs) {
    const dir = (job.relPath || '').replace(/[\\/]+[^\\/]*$/, '') || '/'
    let arr = buckets.get(dir)
    if (!arr) buckets.set(dir, (arr = []))
    arr.push(job)
  }
  const lists = [...buckets.values()]
  // 用游标代替 Array.shift()：shift 每次移位 O(k)，大量同目录任务会退化成 O(n²)
  const cursors = new Array(lists.length).fill(0)
  const out = []
  let taken = true
  while (taken) {
    taken = false
    for (let i = 0; i < lists.length; i++) {
      if (cursors[i] < lists[i].length) {
        out.push(lists[i][cursors[i]++])
        taken = true
      }
    }
  }
  return out
}
