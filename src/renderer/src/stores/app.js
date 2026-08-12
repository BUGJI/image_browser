import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 示例 store：计数器 + 数据库版本
 * 用法：const appStore = useAppStore()
 */
export const useAppStore = defineStore('app', () => {
  const count = ref(0)
  const dbVersion = ref('')

  function increment() {
    count.value++
  }

  async function loadDbVersion() {
    // 走 preload 暴露的 window.api（见 src/preload/index.js）
    dbVersion.value = await window.api.getDbVersion()
  }

  return { count, dbVersion, increment, loadDbVersion }
})
