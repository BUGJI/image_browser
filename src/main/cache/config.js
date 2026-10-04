import { getSetting } from '../settings'
import {
  DEFAULT_SCAN_BATCH,
  DEFAULT_THUMB_QUALITY,
  DEFAULT_THUMB_WIDTH
} from '../scan-constants.mjs'

/**
 * 缓存配置：从设置表读取缓存参数（开发者选项可调），带默认值。
 * 从 cache.js 拆出。
 */

// 默认值（可被开发者选项里的设置覆盖；缩略图/扫描批次的默认值见 scan-constants）
export const DEFAULT_THUMB_BATCH = 100
export const DEFAULT_THUMB_TIMEOUT = 120000 // 单段缩略图超时（ms）
export const DEFAULT_THUMB_SLOW_MS = 3000 // 超过此耗时的“重图”打 WARN（ms）

export function getCacheConfig() {
  const num = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  const int0 = (v, d) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 ? n : d
  }
  return {
    thumbWidth: num(getSetting('cacheThumbWidth', null), DEFAULT_THUMB_WIDTH),
    thumbQuality: Math.min(
      100,
      Math.max(1, num(getSetting('cacheThumbQuality', null), DEFAULT_THUMB_QUALITY))
    ),
    scanBatch: num(getSetting('cacheScanBatch', null), DEFAULT_SCAN_BATCH),
    thumbBatch: num(getSetting('cacheThumbBatch', null), DEFAULT_THUMB_BATCH),
    // 0 = 自动按核数；>0 = 手动指定并发缩略图 worker 数（最多不超过核数）
    thumbWorkers: int0(getSetting('cacheThumbWorkers', null), 0),
    // 单段（一个 worker 一批）超时上限
    thumbTimeout: num(getSetting('cacheThumbTimeout', null), DEFAULT_THUMB_TIMEOUT),
    // 单张解码+编码超过该毫秒数时打 [WARN]，方便定位重图
    thumbSlowMs: num(getSetting('cacheThumbSlowMs', null), DEFAULT_THUMB_SLOW_MS),
    // true = 按扫描顺序连续取任务（同目录连续读，机械硬盘友好）；
    // false = 跨目录打散轮流取任务（SSD/多目录更平滑）
    cacheSequential: getSetting('cacheSequential', 'true') !== 'false',
    // true = 用外部转换器 image_compressor.exe 生成缩略图（绕过应用内一切解码调度问题）
    cacheUseCli: getSetting('cacheUseCli', 'false') === 'true',
    // 外部转换器 exe 的绝对路径（留空则自动探测 dev 根目录/打包 extraResources）
    cacheCliExe: getSetting('cacheCliExe', '') || '',
    // GIF 首帧来源：realtime = 渲染进程实时取首帧、不写磁盘缓存（节省空间，消耗性能）
    gifRealtime: getSetting('gifThumbSource', 'disk') === 'realtime'
  }
}
