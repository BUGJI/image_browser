import { computed, nextTick, watch } from 'vue'

/**
 * 侧栏目录树的展示层状态：搜索过滤、伪节点（收藏 / 标签）、展开键、选中态与点击处理。
 * 从 SideBar.vue 拆出（数据获取与展开持久化见 use-dir-tree.js）。
 *
 * @param {Object} deps 组件上下文与 useDirTree 的返回
 */
const FAV_KEY = '__favorites__'
const TAGS_KEY = '__tags__'
const tagNodeKey = (id) => `__tag__${id}`

export function useSidebarTree({
  rootsStore,
  tagsStore,
  props,
  emit,
  t,
  debouncedSearch,
  treeRef,
  allRoots,
  treeData,
  persistedExpanded,
  saveExpanded,
  expandPath
}) {
  // 搜索过滤：保留名称匹配的节点 + 其祖先链
  const filteredTree = computed(() => {
    const q = debouncedSearch.value.trim().toLowerCase()
    if (!q) return treeData.value
    const filter = (nodes) => {
      const result = []
      for (const node of nodes) {
        const nameMatch = node.name.toLowerCase().includes(q)
        const children = filter(node.children || [])
        if (nameMatch || children.length) {
          result.push({ ...node, children })
        }
      }
      return result
    }
    return filter(treeData.value)
  })

  // 树内第一个伪节点「我的收藏」（显示在根目录之上，搜索时隐藏）
  const favNode = computed(() =>
    props.showFavorites && rootsStore.currentRoot && !debouncedSearch.value.trim()
      ? { path: FAV_KEY, name: t('sidebar.favorites'), isFavorites: true, children: [] }
      : null
  )
  // 树内第二个伪节点「标签」（可展开列出当前根全部标签，搜索时隐藏；无标签或功能关闭时整体隐藏）
  const tagsNode = computed(() => {
    const root = rootsStore.currentRoot
    if (
      !root ||
      !props.tagsEnabled ||
      debouncedSearch.value.trim() ||
      !tagsStore.loaded ||
      !tagsStore.tags.length
    )
      return null
    return {
      path: TAGS_KEY,
      name: t('sidebar.tags'),
      isTagsGroup: true,
      children: tagsStore.tags.map((tag) => ({
        path: tagNodeKey(tag.id),
        name: tag.name,
        count: tag.count,
        isTag: true,
        tagId: tag.id,
        children: []
      }))
    }
  })
  const displayedTree = computed(() =>
    [favNode.value, tagsNode.value, ...filteredTree.value].filter(Boolean)
  )

  // 搜索时展开过滤后所有节点（含父链）；无搜索时：全部根模式自动展开当前根，单根模式用持久化展开
  const expandedKeys = computed(() => {
    if (debouncedSearch.value.trim()) {
      const keys = []
      const collect = (nodes) => {
        for (const node of nodes) {
          keys.push(node.path)
          collect(node.children || [])
        }
      }
      collect(filteredTree.value)
      return keys
    }
    if (allRoots.value) {
      const p = rootsStore.currentRoot?.path
      return p ? [p] : []
    }
    // 正在浏览某个标签时，自动展开「标签」组，方便看到高亮的当前项
    if (props.tagActive) return [TAGS_KEY, ...persistedExpanded.value]
    return persistedExpanded.value
  })

  // 展开/折叠时同步持久化（仅单根模式且非搜索状态记录，避免搜索/多根模式污染；伪节点不入持久化）
  function isPseudoNode(data) {
    return data.isFavorites || data.isTagsGroup || data.isTag
  }
  function handleNodeExpand(data) {
    if (allRoots.value || debouncedSearch.value.trim() || isPseudoNode(data)) return
    if (!persistedExpanded.value.includes(data.path)) {
      persistedExpanded.value = [...persistedExpanded.value, data.path]
      saveExpanded(persistedExpanded.value)
    }
  }
  function handleNodeCollapse(data) {
    if (allRoots.value || debouncedSearch.value.trim() || isPseudoNode(data)) return
    persistedExpanded.value = persistedExpanded.value.filter((p) => p !== data.path)
    saveExpanded(persistedExpanded.value)
  }

  // 当前选中文件夹（任意层级），树内高亮；收藏视图时高亮收藏节点；标签视图时高亮对应标签
  const selectedPath = computed(() => rootsStore.selectedFolder?.path || '')
  const currentNodeKey = computed(() => {
    if (props.tagActive && props.activeTagId != null) return tagNodeKey(props.activeTagId)
    if (props.favActive) return FAV_KEY
    return selectedPath.value
  })

  function handleNodeClick(data) {
    if (data.isFavorites) {
      emit('show-favorites')
      return
    }
    if (data.isTagsGroup) return
    if (data.isTag) {
      emit('select-tag', { id: data.tagId, name: data.name })
      return
    }
    if (data.isRoot) {
      // 全部根模式：点击顶层根 = 切到该根并浏览其整棵根目录
      if (data.rootId !== rootsStore.currentRootId) {
        rootsStore.setCurrent(data.rootId)
      }
      rootsStore.selectFolder({ name: data.name, path: data.path })
      expandPath(data.path)
      return
    }
    rootsStore.selectFolder({ name: data.name, path: data.path })
  }

  // 搜索词（防抖后）变化：数据过滤由 displayedTree 响应式完成（不重建整棵树），
  // 这里只把过滤后命中的节点展开，让结果可见。
  watch(debouncedSearch, () => {
    nextTick(() => {
      const tree = treeRef.value
      if (!tree) return
      for (const path of expandedKeys.value) {
        try {
          tree.getNode(path)?.expand()
        } catch {
          /* 节点可能尚未渲染，忽略 */
        }
      }
    })
  })

  // 切根/初始化时加载对应根目录的标签列表
  watch(
    () => rootsStore.currentRoot,
    (root) => {
      tagsStore.load(root)
    }
  )

  // 进入标签视图后自动展开「标签」组（default-expanded-keys 仅在重建时生效，此处手动展开）
  watch(
    () => props.tagActive,
    (on) => {
      if (!on) return
      nextTick(() => {
        try {
          treeRef.value?.getNode(TAGS_KEY)?.expand()
        } catch {
          /* ignore */
        }
      })
    }
  )

  return {
    FAV_KEY,
    TAGS_KEY,
    filteredTree,
    favNode,
    tagsNode,
    displayedTree,
    expandedKeys,
    handleNodeExpand,
    handleNodeCollapse,
    currentNodeKey,
    handleNodeClick
  }
}
