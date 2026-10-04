import { nextTick, ref, watch } from 'vue'
import { rootDisplayName as displayName } from './roots'

/**
 * 侧栏目录树的数据获取与展开状态持久化（不含模板/过滤/事件）。
 * 从 SideBar.vue 拆出。
 *
 * - 按根路径内存缓存（TTL 内不重复后台扫描），切换根目录先出缓存再刷新；
 * - 「全部根目录」模式：顶层列出所有已注册根，仅当前根加载完整子树；
 * - 展开状态按根目录持久化到 localStorage。
 */
const TREE_CACHE_TTL = 30000
const EXPANDED_STORAGE_KEY = 'dir-tree-expanded'

export function useDirTree(rootsStore, { getTree }) {
  // 目录树展示模式：false=仅当前根；true=顶层列出全部已注册根目录（隐藏底部下拉框）
  const allRoots = ref(false)
  const treeData = ref([])
  const scanning = ref(false)
  const treeKey = ref(0) // 模式切换/根目录变更时重建树，让 default-expanded-keys 生效
  let scanSeq = 0 // 丢弃过期扫描结果

  // 目录树缓存（按根路径）：切换根目录时先用缓存即时渲染，再按需后台刷新
  const treeCache = new Map() // rootPath -> { tree, at }

  const persistedExpanded = ref([])

  function loadExpanded() {
    const root = rootsStore.currentRoot
    if (!root) return []
    try {
      const data = JSON.parse(localStorage.getItem(EXPANDED_STORAGE_KEY) || '{}')
      return Array.isArray(data[root.id]) ? data[root.id] : []
    } catch {
      return []
    }
  }

  function saveExpanded(keys) {
    const root = rootsStore.currentRoot
    if (!root) return
    const data = JSON.parse(localStorage.getItem(EXPANDED_STORAGE_KEY) || '{}')
    data[root.id] = keys
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(data))
  }

  async function scanTree() {
    const root = rootsStore.currentRoot
    if (!root) {
      treeData.value = []
      return
    }
    const seq = ++scanSeq
    const cached = treeCache.get(root.path)

    if (cached) {
      // 命中缓存：立即渲染，避免白屏；TTL 内不再后台重扫
      treeData.value = cached.tree ? [cached.tree] : []
      persistedExpanded.value = loadExpanded()
      applyPersistedExpanded()
      if (Date.now() - cached.at < TREE_CACHE_TTL) {
        scanning.value = false
        return
      }
    } else {
      treeData.value = []
    }

    scanning.value = true
    try {
      const tree = await window.api.scanTree(root.path)
      if (seq !== scanSeq) {
        // 用户已切换目录，旧扫描结果作废
        return
      }
      treeCache.set(root.path, { tree, at: Date.now() })
      treeData.value = tree ? [tree] : []
      persistedExpanded.value = loadExpanded()
      applyPersistedExpanded()
    } catch (e) {
      console.warn('目录树扫描失败', e)
      if (!cached) treeData.value = []
    } finally {
      if (seq === scanSeq) scanning.value = false
    }
  }

  // “全部根目录”模式：顶层列出每个已注册根目录；
  // 仅当前根加载并展示其完整目录树（点击其它根即切换并重建，逻辑与普通模式一致）
  async function buildAllRoots() {
    scanning.value = true
    const seq = ++scanSeq
    const curId = rootsStore.currentRootId
    const rows = []
    for (const root of rootsStore.roots) {
      let children = []
      if (root.id === curId) {
        const cached = treeCache.get(root.path)
        if (cached) {
          children = cached.tree && cached.tree.children ? cached.tree.children : []
        } else {
          try {
            const tree = await window.api.scanTree(root.path)
            if (seq === scanSeq) {
              treeCache.set(root.path, { tree, at: Date.now() })
              children = tree && tree.children ? tree.children : []
            }
          } catch {
            children = []
          }
        }
      }
      rows.push({
        name: displayName(root),
        path: root.path,
        rootId: root.id,
        isRoot: true,
        children
      })
    }
    if (seq === scanSeq) {
      treeData.value = rows
      scanning.value = false
      const cur = rootsStore.currentRoot
      if (cur) expandPath(cur.path)
    }
  }

  // 展开指定路径节点（路径在树中即可命中）
  function expandPath(path) {
    nextTick(() => {
      try {
        getTree()?.getNode(path)?.expand()
      } catch {
        /* ignore */
      }
    })
  }

  // 扫描完成后恢复展开状态（等待新树渲染，再逐个展开持久化的路径）
  function applyPersistedExpanded() {
    nextTick(() => {
      const tree = getTree()
      if (!tree) return
      for (const path of persistedExpanded.value) {
        try {
          tree.getNode(path)?.expand()
        } catch {
          /* 节点可能已被过滤掉，忽略 */
        }
      }
    })
  }

  // 切换根目录：全部根模式重建顶层并自动展开当前根；普通模式按根重扫
  watch(
    () => rootsStore.currentRootId,
    () => {
      if (!allRoots.value) {
        scanTree()
      } else {
        buildAllRoots()
        treeKey.value++
        const p = rootsStore.currentRoot?.path
        if (p) expandPath(p)
      }
    },
    { immediate: true }
  )

  // 模式切换
  watch(allRoots, (on) => {
    treeKey.value++
    if (on) {
      buildAllRoots()
      const p = rootsStore.currentRoot?.path
      if (p) expandPath(p)
    } else {
      scanTree()
    }
  })

  // 根目录增删/改名（仅全部根模式需要重建顶层列表）
  watch(
    () => rootsStore.roots.map((r) => `${r.id}|${r.path}|${r.alias || ''}`).join('##'),
    () => {
      // 根目录增删/路径变更后缓存可能失效，整体清空
      treeCache.clear()
      if (allRoots.value) {
        buildAllRoots()
        treeKey.value++
      }
    }
  )

  return {
    allRoots,
    treeData,
    scanning,
    treeKey,
    persistedExpanded,
    loadExpanded,
    saveExpanded,
    applyPersistedExpanded,
    scanTree,
    buildAllRoots,
    expandPath
  }
}
