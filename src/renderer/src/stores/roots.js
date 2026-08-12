import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 根目录状态：列表 + 当前选中（持久化到主进程 settings 表）
 */
export const useRootsStore = defineStore('roots', () => {
  const roots = ref([])
  const currentRootId = ref(null)
  const loaded = ref(false)
  // 左侧目录树中选中的文件夹（任意层级）
  const selectedFolder = ref(null) // { name, path }

  const currentRoot = computed(
    () => roots.value.find((r) => r.id === currentRootId.value) || null
  )

  async function loadRoots() {
    roots.value = await window.api.rootsList()
  }

  async function loadCurrent() {
    currentRootId.value = await window.api.rootsGetCurrent()
  }

  async function setCurrent(id) {
    currentRootId.value = id
    selectedFolder.value = null // 切换根目录后重置选中文件夹
    await window.api.rootsSetCurrent(id)
  }

  function selectFolder(folder) {
    selectedFolder.value = folder
  }

  async function refresh() {
    await Promise.all([loadRoots(), loadCurrent()])
    loaded.value = true
  }

  return { roots, currentRootId, currentRoot, selectedFolder, loaded, loadRoots, loadCurrent, setCurrent, selectFolder, refresh }
})
