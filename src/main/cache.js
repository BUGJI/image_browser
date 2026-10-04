/**
 * 根目录独立缓存引擎（对外入口）
 *
 * 每个注册根目录内建立：
 *   <root>/.image_browser_cache/
 *     ├── cache.db        —— 独立 SQLite：files 表（图片索引 + 尺寸）+ meta 表
 *     └── image_cache/    —— webp 缩略图，镜像源目录结构：
 *                            image_cache/<相对目录>/<文件名>.<原扩展名>.webp
 *
 * 重型任务（递归扫描、图片解码、缩放、webp 编码）全部运行在
 * Worker 线程（cache-worker.mjs），主进程只做 DB 读写与调度，
 * 避免扫描/建缓存时 UI 卡死。
 *
 * 四种维护模式：
 *   update  增量：扫描新增/变更/删除，为新图生成缩略图
 *   rebuild 全量：清空缓存目录与索引，重新扫描 + 全部生成缩略图
 *   clean   清理：移除索引中已不存在的记录，删除无引用的缩略图文件
 *   scan-cache  扫描缓存文件夹里已生成的缩略图，计入索引（复用已处理结果）
 *
 * 实现已按职责拆分到 ./cache/ 下的子模块，本文件仅做对外聚合导出：
 *   cache/config.js       缓存配置
 *   cache/connection.js   根缓存连接（openRootCache / closeRootCache）
 *   cache/thumb-index.js  协议层缩略图内存索引
 *   cache/workers.js      worker 池 / 文件夹 SHA / 调度辅助
 *   cache/image-size.js   图片尺寸探测
 *   cache/cli-thumb.js    外部转换器缩略图
 *   cache/search.js       搜索与匹配
 *   cache/tasks.js        维护任务、列表 / 搜索、IPC
 *   cache/protocol.js     image:// 协议
 */

export { getCacheConfig } from './cache/config'
export { closeRootCache, openRootCache } from './cache/connection'
export { rebuildFolderShas } from './cache/workers'
export {
  getCacheStats,
  handleImagesList,
  listFolderQuick,
  registerCacheIpc,
  runCacheTask
} from './cache/tasks'
export { registerImageProtocol } from './cache/protocol'
