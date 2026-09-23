import { defineStore } from 'pinia'
import { ref, shallowRef, triggerRef } from 'vue'

/**
 * 图片收藏状态（按根目录）
 * absPaths 用于快速判断某张图是否已收藏（星标状态）；
 * list 为当前根目录的收藏图片（“我的收藏”视图直接渲染）。
 */
export const useFavoritesStore = defineStore('favorites', () => {
  const rootId = ref(null)
  const list = ref([])
  // shallowRef + 原地增删 + triggerRef：避免每次收藏都替换整个 Set 而导致所有卡片重渲染
  const absPaths = shallowRef(new Set())
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
      const set = absPaths.value
      if (set.has(item.absPath)) set.delete(item.absPath)
      else set.add(item.absPath)
      triggerRef(absPaths)
      return set.has(item.absPath)
    }
    const res = await window.api.favToggle(root.id, { absPath: item.absPath, name: item.name })
    const { added } = res || {}
    const set = absPaths.value
    if (added) {
      set.add(item.absPath)
      // 保持“我的收藏”视图实时更新
      list.value = [
        { rootId: root.id, absPath: item.absPath, name: item.name || '' },
        ...list.value
      ]
    } else {
      set.delete(item.absPath)
      list.value = list.value.filter((r) => r.absPath !== item.absPath)
    }
    triggerRef(absPaths)
    return added
  }

  return { rootId, list, absPaths, loaded, load, isFav, toggle }
})
