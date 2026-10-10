import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isVideoName } from './image-url'
import { useFavoritesStore } from '../stores/favorites'
import { useTagsStore } from '../stores/tags'

/**
 * 灯箱交互：复制（原文件 / 图片）、收藏、标签编辑。从 Lightbox.vue 拆出。
 * 复制图片实现：img → canvas → PNG blob → navigator.clipboard；失败回退主进程剪贴板。
 *
 * @param {Object} deps
 * @param {() => Object|null} deps.getItem 当前图片项
 * @param {() => number} deps.getRootId 根目录 id
 * @param {import('vue').Ref} deps.videoRef 视频元素引用（复制视频当前帧）
 * @param {import('vue').Ref} deps.imgRef 图片元素引用（canvas 回退）
 */
export function useLightboxActions({ getItem, getRootId, videoRef, imgRef }) {
  const { t } = useI18n()
  const favoritesStore = useFavoritesStore()
  const tagsStore = useTagsStore()

  const copied = ref('') // '' | 'file' | 'image'
  let copiedTimer = 0

  async function flashCopied(type) {
    copied.value = type
    ElMessage.success(type === 'file' ? t('lightbox.copiedFile') : t('lightbox.copied'))
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = ''), 1500)
  }

  // 复制原文件：以「文件」形式放入剪贴板（可在文件管理器直接粘贴）
  async function copyFile() {
    const item = getItem()
    if (!item?.absPath) return
    try {
      if (window.api?.copyFile) {
        await window.api.copyFile(item.absPath)
      } else {
        // 浏览器调试回退：复制为图片
        return copyImage()
      }
      flashCopied('file')
    } catch (err) {
      ElMessage.error(t('lightbox.copyFailed', { error: String(err?.message || err) }))
    }
  }

  // 复制图片：解码为图像放入剪贴板（可粘贴到聊天/编辑器）；视频复制当前帧
  async function copyImage() {
    const item = getItem()
    if (!item) return
    try {
      if (isVideoName(item.name)) {
        const v = videoRef.value
        if (!v || !v.videoWidth) return
        const canvas = document.createElement('canvas')
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        canvas.getContext('2d').drawImage(v, 0, 0)
        await window.api?.copyImageDataUrl(canvas.toDataURL('image/png'))
        flashCopied('image')
        return
      }
      const img = imgRef.value
      if (!img || !img.naturalWidth) return
      // 优先走主进程直接读文件写剪贴板（自定义协议下 canvas 会污染，不可靠）
      if (window.api?.copyImagePath) {
        await window.api.copyImagePath(item.absPath)
      } else {
        // 回退：canvas → dataURL → 主进程剪贴板
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        await window.api?.copyImageDataUrl(canvas.toDataURL('image/png'))
      }
      flashCopied('image')
    } catch (err) {
      ElMessage.error(t('lightbox.copyFailed', { error: String(err?.message || err) }))
    }
  }

  // 工具栏「复制图片」按钮
  function onCopyImageClick() {
    copyImage()
  }

  // 收藏 / 取消收藏当前图片
  async function toggleFavCurrent() {
    const item = getItem()
    if (!item?.absPath) return
    try {
      const added = await favoritesStore.toggle(
        { id: getRootId() },
        { absPath: item.absPath, name: item.name }
      )
      ElMessage.success(added ? t('lightbox.favAdded') : t('lightbox.favRemoved'))
    } catch (err) {
      ElMessage.error(String(err?.message || t('common.operationFailed')))
    }
  }

  // ---------- 标签：给当前图片打/改标签（多选 + 可新建） ----------
  const tagPopOpen = ref(false)
  const tagBusy = ref(false)
  const selTagNames = ref([])
  const tagOptions = computed(() => tagsStore.tags)

  async function ensureTagsLoaded() {
    if (tagsStore.rootId === getRootId() && tagsStore.loaded) return
    await tagsStore.load({ id: getRootId() })
  }

  // 打开编辑面板时，读取该图片当前已打的标签
  async function onTagPopShow() {
    const item = getItem()
    if (!item?.absPath || !window.api?.tagsGet) {
      selTagNames.value = []
      return
    }
    tagBusy.value = true
    try {
      await ensureTagsLoaded()
      const list = (await window.api.tagsGet(getRootId(), item.absPath)) || []
      selTagNames.value = list.map((x) => x.name)
    } catch {
      selTagNames.value = []
    } finally {
      tagBusy.value = false
    }
  }

  // 多选结果变化即保存（整体覆盖；含新建标签）
  async function onTagNamesChange(names) {
    const item = getItem()
    if (!item?.absPath || !window.api?.tagsSet) return
    if (tagBusy.value) return
    try {
      await tagsStore.setImageTags(
        { id: getRootId() },
        { absPath: item.absPath, name: item.name || '' },
        names || []
      )
    } catch (err) {
      ElMessage.error(String(err?.message || t('common.operationFailed')))
    }
  }

  function dispose() {
    if (copiedTimer) clearTimeout(copiedTimer)
  }

  return {
    copied,
    copyFile,
    copyImage,
    onCopyImageClick,
    toggleFavCurrent,
    tagPopOpen,
    tagBusy,
    selTagNames,
    tagOptions,
    onTagPopShow,
    onTagNamesChange,
    dispose
  }
}
