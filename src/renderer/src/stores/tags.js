import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 图片标签状态（按根目录独立）：
 * - tags      当前根目录的标签列表 [{ id, name, count }]（侧栏 / 灯箱选择器 / 设置页共用）
 * - activeTagId + tagItems  当前正在浏览的标签及其图片（“标签视图”直接渲染）
 */
export const useTagsStore = defineStore('tags', () => {
  const rootId = ref(null)
  const tags = ref([])
  const loaded = ref(false)
  const activeTagId = ref(null)
  const tagItems = ref([])

  const hasApi = () => !!window.api?.tagsList

  async function load(root) {
    const rid = root?.id ?? null
    rootId.value = rid
    if (!hasApi() || !rid) {
      tags.value = []
      tagItems.value = []
      loaded.value = true
      return
    }
    try {
      tags.value = (await window.api.tagsList(rid)) || []
    } catch {
      tags.value = []
    }
    loaded.value = true
  }

  /** 重新拉取当前根目录标签（跨窗口 tags:changed 后调用） */
  async function refresh() {
    if (!hasApi() || rootId.value == null) return
    try {
      tags.value = (await window.api.tagsList(rootId.value)) || []
    } catch {
      /* ignore */
    }
  }

  function findTag(id) {
    return tags.value.find((t) => t.id === id) || null
  }

  async function enterTag(root, tag) {
    if (root?.id !== rootId.value) await load(root)
    activeTagId.value = tag.id
    await reloadTagItems()
  }

  function leaveTag() {
    activeTagId.value = null
    tagItems.value = []
  }

  async function reloadTagItems() {
    if (!hasApi() || rootId.value == null || activeTagId.value == null) {
      tagItems.value = []
      return
    }
    try {
      tagItems.value = (await window.api.tagsImages(rootId.value, activeTagId.value)) || []
    } catch {
      tagItems.value = []
    }
  }

  /**
   * 保存一张图片的标签集合（整体覆盖）。
   * 同步内存态：标签计数列表、若正在浏览该标签所在视图则刷新其图片。
   */
  async function setImageTags(root, item, names) {
    if (!hasApi() || !root?.id || !item?.absPath) return tags.value
    const list =
      (await window.api.tagsSet(
        root.id,
        { absPath: item.absPath, name: item.name || '' },
        names || []
      )) || []
    if (root.id === rootId.value) {
      tags.value = list
      if (activeTagId.value != null) await reloadTagItems()
    }
    return list
  }

  return {
    rootId,
    tags,
    loaded,
    activeTagId,
    tagItems,
    load,
    refresh,
    findTag,
    enterTag,
    leaveTag,
    reloadTagItems,
    setImageTags
  }
})
