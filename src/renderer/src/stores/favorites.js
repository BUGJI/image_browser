import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 图片收藏状态（按根目录）
 * absPaths 用于快速判断某张图是否已收藏（星标状态）；
 * list 为当前根目录的收藏图片（“我的收藏”视图直接渲染）。
 */
export const useFavoritesStore = defineStore('favorites', () => {
  const rootId = ref(null)
  const list = ref([])
  const absPaths = ref(new Set())
  const loaded = ref(false)

  async function load(root) {
    const rid = root?.id ?? null
    rootId.value = rid
    if (!window.api?.favList) {
      list.value = []
      absPaths.value = new Set()
      loaded.value = true
      return
    }
    if (!rid) {
      list.value = []
      absPaths.value = new Set()
      loaded.value = true
      return
    }
    const rows = (await window.api.favList(rid)) || []
    list.value = rows
    absPaths.value = new Set(rows.map((r) => r.absPath))
    loaded.value = true
  }

  function isFav(absPath) {
    return !!absPath && absPaths.value.has(absPath)
  }

  /** 收藏/取消收藏（同时更新内存态） */
  async function toggle(root, item) {
    if (!root?.id || !item?.absPath) return false
    if (!window.api?.favToggle) {
      // 浏览器调试环境不支持，仅在内存模拟
      const next = new Set(absPaths.value)
      if (next.has(item.absPath)) next.delete(item.absPath)
      else next.add(item.absPath)
      absPaths.value = next
      return next.has(item.absPath)
    }
    const res = await window.api.favToggle(root.id, { absPath: item.absPath, name: item.name })
    const { added } = res || {}
    const next = new Set(absPaths.value)
    if (added) {
      next.add(item.absPath)
      // 保持“我的收藏”视图实时更新
      list.value = [{ rootId: root.id, absPath: item.absPath, name: item.name || '' }, ...list.value]
    } else {
      next.delete(item.absPath)
      list.value = list.value.filter((r) => r.absPath !== item.absPath)
    }
    absPaths.value = next
    return added
  }

  return { rootId, list, absPaths, loaded, load, isFav, toggle }
})
