import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { aiSearch } from './ai-search'

/**
 * 图片搜索编排：文件名搜索（回车生效，支持 * ?）+ AI 语义搜索开关与结果。
 * 从 App.vue 拆出；调用方传入 rootsStore 以读取当前根目录。
 */

// 主进程 ai:search 抛出的错误码 → 界面提示文案
const AI_ERROR_KEYS = {
  AI_NO_ROOT: 'app.aiNoRoot',
  AI_NO_KEY: 'app.aiNoKey',
  AI_NO_CACHE: 'app.aiNoCache',
  AI_NO_INDEX: 'app.aiNoIndex'
}

export function useImageSearch(rootsStore) {
  const { t } = useI18n()

  const searchInput = ref('')
  const searchQuery = ref('')
  const isSearching = computed(() => searchQuery.value.trim() !== '')

  const aiSearchEnabled = ref(false)
  const aiSearchActive = ref(false)
  const aiResults = ref(null)
  const aiSearchBusy = ref(false)

  async function applySearch() {
    const q = searchInput.value.trim()
    if (aiSearchActive.value) {
      await runAiSearch(q)
      return
    }
    searchQuery.value = q
    aiResults.value = null
  }

  // AI 检索：主进程向量化 query → 余弦相似度 → 返回与瀑布流一致的图片列表
  async function runAiSearch(q) {
    if (!q || !rootsStore.currentRoot) {
      clearSearch()
      return
    }
    aiSearchBusy.value = true
    try {
      const results = await aiSearch(rootsStore.currentRoot.id, q)
      aiResults.value = results || []
      // 置为搜索态：显示瀑布流、隐藏文件夹横幅（grid 会优先渲染 aiResults）
      searchQuery.value = q
    } catch (e) {
      aiResults.value = null
      searchQuery.value = ''
      ElMessage.warning(
        t(AI_ERROR_KEYS[e?.code] || 'app.aiSearchFailed', { error: e?.message || '' })
      )
    } finally {
      aiSearchBusy.value = false
    }
  }

  function clearSearch() {
    searchInput.value = ''
    searchQuery.value = ''
    aiResults.value = null
  }

  // AI 搜索开关关闭时，清掉已展示的 AI 结果，回到文件夹浏览
  watch(aiSearchActive, (v) => {
    if (!v && aiResults.value) {
      aiResults.value = null
      searchQuery.value = ''
    }
  })

  // 切换到文件夹 / 切换根目录时，退出 AI 结果视图
  watch(
    () => [rootsStore.selectedFolder, rootsStore.currentRootId],
    () => {
      if (aiResults.value) {
        aiResults.value = null
        searchQuery.value = ''
        searchInput.value = ''
      }
    }
  )

  return {
    searchInput,
    searchQuery,
    isSearching,
    aiSearchEnabled,
    aiSearchActive,
    aiResults,
    aiSearchBusy,
    applySearch,
    runAiSearch,
    clearSearch
  }
}
