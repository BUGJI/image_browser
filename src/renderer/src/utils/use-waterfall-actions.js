import { useFavoritesStore } from '../stores/favorites'

/**
 * 瀑布流卡片交互：收藏切换 / 快速复制（原文件或图片）。从 WaterfallGrid.vue 拆出。
 *
 * @param {Object} deps
 * @param {(key: string, params?: Object) => string} deps.t i18n 翻译函数
 * @param {() => number} deps.getRootId 当前根目录 id
 * @param {() => string} deps.getQuickCopyType 快速复制类型（'file' | 'image'）
 */
export function useWaterfallActions({ t, getRootId, getQuickCopyType }) {
  const favoritesStore = useFavoritesStore()

  async function toggleFav(item) {
    try {
      await favoritesStore.toggle({ id: getRootId() }, item)
    } catch (err) {
      ElMessage.error(String(err?.message || t('common.operationFailed')))
    }
  }

  // 浏览器调试回退：把点击到的 <img> 转成 dataURL 复制（dev-mock 环境）
  async function copyViaCanvas(e) {
    const img = e?.target?.closest?.('img')
    if (!img || !img.naturalWidth || !window.api?.copyImageDataUrl) {
      throw new Error('not supported')
    }
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d').drawImage(img, 0, 0)
    await window.api.copyImageDataUrl(canvas.toDataURL('image/png'))
  }

  async function copyItem(item, e) {
    try {
      const abs = item.absPath
      if (getQuickCopyType() === 'file') {
        if (window.api?.copyFile) {
          await window.api.copyFile(abs)
        } else {
          await copyViaCanvas(e)
        }
        ElMessage.success(t('lightbox.copiedFile'))
      } else {
        if (window.api?.copyImagePath) {
          await window.api.copyImagePath(abs)
        } else {
          await copyViaCanvas(e)
        }
        ElMessage.success(t('lightbox.copied'))
      }
    } catch (err) {
      ElMessage.error(t('lightbox.copyFailed', { error: String(err?.message || err) }))
    }
  }

  return { toggleFav, copyItem }
}
