import { computed, nextTick, ref, watch } from 'vue'

/**
 * 图片列表分页 / 无限滚动：大根目录首批只取一页，滚动接近底部再追加下一页。
 * 从 WaterfallGrid.vue 拆出；依赖调用方注入布局实例的回调。
 *
 * @param {object} props             组件 props（含 rootId/folderPath/searchQuery/aiResults/favItems/tagItems/preload）
 * @param {object} deps
 * @param {(list:Array)=>Array} deps.initItems          原始列表 → 渲染项映射
 * @param {(list:Array)=>void}  deps.setItems           整体替换
 * @param {(list:Array)=>void}  deps.appendItems        追加一页
 * @param {()=>void}            deps.applyInitialLayout 首屏立即布局
 * @param {import('vue').Ref<number>} deps.totalHeight   内容总高
 * @param {()=>HTMLElement|null} deps.getScrollEl        滚动容器
 */
export function usePagedImages(props, deps) {
  const { initItems, setItems, appendItems, applyInitialLayout, totalHeight, getScrollEl } = deps

  const PAGE_SIZE = 300
  const loading = ref(false)
  const error = ref('')
  const hasMore = ref(false)
  const loadingMore = ref(false)
  let loadedOffset = 0 // 已加载条数（下一页 offset）
  let loadToken = 0 // 请求代次：换目录/换搜索时作废在途请求

  const isSearching = computed(() => !!props.searchQuery && props.searchQuery.trim() !== '')

  /** 当前列表对应的 imagesList 前三个参数（搜索模式忽略 folderPath）。
   * 必须始终占满 searchQuery 位，否则后续 opts 会错位顶替成 searchQuery。 */
  function listArgs() {
    return isSearching.value
      ? [props.rootId, null, props.searchQuery]
      : [props.rootId, props.folderPath, null]
  }

  /** 拉取一页，兼容旧版纯数组返回 */
  async function fetchPage(offset) {
    const page = await window.api.imagesList(...listArgs(), { offset, limit: PAGE_SIZE })
    if (Array.isArray(page)) return { items: page, total: page.length }
    return { items: page?.items || [], total: page?.total ?? page?.items?.length ?? 0 }
  }

  async function load() {
    // 外部直接注入的列表（收藏 / 标签 / AI 结果）优先渲染，不拉取 imagesList
    const injected = [props.favItems, props.tagItems, props.aiResults].find((v) => Array.isArray(v))
    if (injected) {
      loadToken++
      hasMore.value = false
      loadingMore.value = false
      setItems(initItems(injected))
      totalHeight.value = 0
      await nextTick()
      applyInitialLayout()
      return
    }

    if (!isSearching.value && !props.folderPath) {
      loadToken++
      hasMore.value = false
      loadingMore.value = false
      setItems([])
      totalHeight.value = 0
      return
    }

    const token = ++loadToken
    loading.value = true
    error.value = ''
    hasMore.value = false
    loadingMore.value = false
    loadedOffset = 0
    try {
      const page = await fetchPage(0)
      if (token !== loadToken) return
      loadedOffset = page.items.length
      setItems(initItems(page.items))
      hasMore.value = loadedOffset < page.total
      await nextTick()
      applyInitialLayout()
    } catch (err) {
      if (token !== loadToken) return
      error.value = String(err?.message || err)
    } finally {
      if (token === loadToken) {
        loading.value = false
        maybeLoadMore()
      }
    }
  }

  /** 追加下一页（滚动接近底部时调用，失败保持现状待下次滚动重试） */
  async function loadMore() {
    if (loadingMore.value || !hasMore.value || loading.value) return
    const token = loadToken
    loadingMore.value = true
    try {
      const page = await fetchPage(loadedOffset)
      if (token !== loadToken) return
      if (!page.items.length) {
        hasMore.value = false
        return
      }
      appendItems(initItems(page.items))
      loadedOffset += page.items.length
      hasMore.value = loadedOffset < page.total
    } catch {
      /* 忽略：保留已加载内容 */
    } finally {
      if (token === loadToken) loadingMore.value = false
    }
  }

  /** 剩余可滚动高度不足一个预载距离时，提前拉下一页 */
  function maybeLoadMore() {
    if (!hasMore.value || loadingMore.value || loading.value) return
    const el = getScrollEl()
    if (!el) return
    if (totalHeight.value - el.scrollTop - el.clientHeight < props.preload) loadMore()
  }

  /** 作废在途分页请求（卸载 / 重置时调用） */
  function cancelPending() {
    loadToken++
  }

  watch(
    () => [
      props.rootId,
      props.folderPath,
      props.searchQuery,
      props.aiResults,
      props.favItems,
      props.tagItems
    ],
    load,
    { immediate: true }
  )

  return {
    loading,
    error,
    hasMore,
    loadingMore,
    isSearching,
    load,
    loadMore,
    maybeLoadMore,
    cancelPending
  }
}
