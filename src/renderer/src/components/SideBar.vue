<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Setting, Folder, Search, StarFilled, CollectionTag } from '@element-plus/icons-vue'
import { useRootsStore } from '../stores/roots'
import { useTagsStore } from '../stores/tags'

const { t } = useI18n()
const rootsStore = useRootsStore()
const tagsStore = useTagsStore()
let offRootsChanged = null
let offTagsChanged = null

// 「我的收藏」入口：作为目录树内第一个伪节点，由 App 决定是否显示与高亮
// 「标签」：收藏下方第二个伪节点（可展开列出当前根的全部标签），点击标签浏览其图片
const props = defineProps({
  showFavorites: { type: Boolean, default: false },
  favActive: { type: Boolean, default: false },
  tagsEnabled: { type: Boolean, default: true },
  tagActive: { type: Boolean, default: false },
  activeTagId: { type: Number, default: null }
})
const emit = defineEmits(['show-favorites', 'select-tag'])
const FAV_KEY = '__favorites__'
const TAGS_KEY = '__tags__'
const tagNodeKey = (id) => `__tag__${id}`

// 目录树展示模式：false=仅当前根；true=顶层列出全部已注册根目录（隐藏底部下拉框）
const allRoots = ref(false)
let offSettingsChanged = null

// 目录树数据（只含文件夹，来自主进程扫描）
const treeData = ref([])
const scanning = ref(false)
const searchText = ref('')
const treeKey = ref(0) // 搜索词变化时重建树，让 default-expanded-keys 生效
let scanSeq = 0 // 丢弃过期扫描结果

// 展开状态持久化（每个根目录独立保存，localStorage）
const treeRef = ref(null)
const persistedExpanded = ref([])
const EXPANDED_STORAGE_KEY = 'dir-tree-expanded'

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

// 显示名：别名 > 目录名 > 完整路径
function displayName(root) {
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = root.path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root.path
}

async function scanTree() {
  const root = rootsStore.currentRoot
  treeData.value = []
  if (!root) return
  scanning.value = true
  const seq = ++scanSeq

  try {
    const tree = await window.api.scanTree(root.path)
    if (seq !== scanSeq) {
      // 用户已切换目录，旧扫描结果作废
      return
    }
    treeData.value = tree ? [tree] : []
    persistedExpanded.value = loadExpanded()
    applyPersistedExpanded()
  } catch (e) {
    console.warn('目录树扫描失败', e)
    treeData.value = []
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
      try {
        const tree = await window.api.scanTree(root.path)
        if (seq === scanSeq) children = tree && tree.children ? tree.children : []
      } catch {
        children = []
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
      treeRef.value?.getNode(path)?.expand()
    } catch {
      /* ignore */
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
    if (allRoots.value) {
      buildAllRoots()
      treeKey.value++
    }
  }
)

// 搜索过滤：保留名称匹配的节点 + 其祖先链
const filteredTree = computed(() => {
  const q = searchText.value.trim().toLowerCase()
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
  props.showFavorites && rootsStore.currentRoot && !searchText.value.trim()
    ? { path: FAV_KEY, name: t('sidebar.favorites'), isFavorites: true, children: [] }
    : null
)
// 树内第二个伪节点「标签」（可展开列出当前根全部标签，搜索时隐藏；无标签或功能关闭时整体隐藏）
const tagsNode = computed(() => {
  const root = rootsStore.currentRoot
  if (!root || !props.tagsEnabled || searchText.value.trim() || !tagsStore.loaded || !tagsStore.tags.length) return null
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
  if (searchText.value.trim()) {
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
  if (allRoots.value || searchText.value.trim() || isPseudoNode(data)) return
  if (!persistedExpanded.value.includes(data.path)) {
    persistedExpanded.value = [...persistedExpanded.value, data.path]
    saveExpanded(persistedExpanded.value)
  }
}

function handleNodeCollapse(data) {
  if (allRoots.value || searchText.value.trim() || isPseudoNode(data)) return
  persistedExpanded.value = persistedExpanded.value.filter((p) => p !== data.path)
  saveExpanded(persistedExpanded.value)
}

// 扫描完成后恢复展开状态（等待新树渲染，再逐个展开持久化的路径）
function applyPersistedExpanded() {
  nextTick(() => {
    const tree = treeRef.value
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

// 搜索词变化 → 重建树刷新展开状态
watch(searchText, () => {
  treeKey.value++
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

const currentId = computed({
  get: () => rootsStore.currentRootId,
  set: (id) => rootsStore.setCurrent(id)
})

function openSettings() {
  window.api.openSettings()
}

onMounted(async () => {
  await rootsStore.refresh()
  allRoots.value = (await window.api.getSetting('sidebarShowAllRoots', 'false')) === 'true'
  offRootsChanged = window.api.onRootsChanged(() => {
    rootsStore.refresh()
  })
  offTagsChanged = window.api.onTagsChanged(({ rootId }) => {
    // 仅当前根目录的标签需要刷新（其它窗口/根不影响本视图）
    if (rootId === rootsStore.currentRoot?.id) tagsStore.refresh()
  })
  offSettingsChanged = window.api.onSettingsChanged(({ key, value }) => {
    if (key === 'sidebarShowAllRoots') {
      allRoots.value = value === 'true'
    }
  })
})

onBeforeUnmount(() => {
  offRootsChanged?.()
  offTagsChanged?.()
  offSettingsChanged?.()
})
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-content">
      <!-- 有可浏览内容：我的收藏 + 搜索框 + 目录树（普通=当前根；全部根=所有根置顶） -->
      <template v-if="allRoots ? rootsStore.roots.length > 0 : !!rootsStore.currentRoot">
        <div class="dir-search">
          <el-input
            v-model="searchText"
            :placeholder="t('sidebar.filterFolders')"
            size="small"
            clearable
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>

        <div v-loading="scanning" class="dir-tree-wrap">
          <el-tree
            v-if="treeData.length"
            ref="treeRef"
            :key="treeKey"
            :data="displayedTree"
            node-key="path"
            :props="{ label: 'name', children: 'children' }"
            :default-expanded-keys="expandedKeys"
            :current-node-key="currentNodeKey"
            :expand-on-click-node="false"
            highlight-current
            class="dir-tree"
            :empty-text="t('sidebar.noMatch')"
            @node-click="handleNodeClick"
            @node-expand="handleNodeExpand"
            @node-collapse="handleNodeCollapse"
          >
            <template #default="{ data }">
              <span
                class="tree-node"
                :class="{
                  'tree-node-fav': data.isFavorites,
                  'tree-node-tags-group': data.isTagsGroup,
                  'tree-node-tag': data.isTag
                }"
              >
                <el-icon :size="14" class="tree-node-icon">
                  <StarFilled v-if="data.isFavorites" />
                  <CollectionTag v-else-if="data.isTagsGroup" />
                  <CollectionTag v-else-if="data.isTag" />
                  <Folder v-else />
                </el-icon>
                <span
                  class="tree-node-label"
                  :title="data.isFavorites || data.isTagsGroup || data.isTag ? '' : data.path"
                >
                  {{ data.name }}
                </span>
                <span v-if="data.isTag" class="tree-node-count">{{ data.count }}</span>
              </span>
            </template>
          </el-tree>
          <el-empty
            v-else-if="!scanning"
            :image-size="48"
            :description="t('sidebar.noSubfolders')"
          />
        </div>
      </template>

      <!-- 无根目录：提示 -->
      <div v-else class="dir-empty">
        <el-empty :image-size="48" :description="t('sidebar.noRootSelected')">
          <p class="dir-empty-tip">{{ t('sidebar.pickOrAddRoot') }}</p>
        </el-empty>
      </div>
    </div>

    <div class="sidebar-footer">
      <el-tooltip
        v-if="!allRoots"
        :disabled="rootsStore.currentRootId != null"
        :content="t('sidebar.noRootsTooltip')"
        placement="top"
      >
        <el-select
          v-model="currentId"
          class="root-select"
          :placeholder="rootsStore.roots.length ? t('sidebar.selectRoot') : t('sidebar.noRoots')"
          size="default"
        >
          <el-option
            v-for="root in rootsStore.roots"
            :key="root.id"
            :value="root.id"
            :label="displayName(root)"
          >
            <el-tooltip :content="root.path" placement="left" :show-after="300">
              <span class="root-option">
                <span class="root-option-name">{{ displayName(root) }}</span>
                <span class="root-option-path">{{ root.path }}</span>
              </span>
            </el-tooltip>
          </el-option>
        </el-select>
      </el-tooltip>

      <el-tooltip :content="t('sidebar.settings')" placement="right">
        <button class="sidebar-setting-btn" :title="t('sidebar.settings')" @click="openSettings">
          <el-icon :size="18"><Setting /></el-icon>
        </button>
      </el-tooltip>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border-right: 1px solid var(--panel-border);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.dir-search {
  padding-bottom: 8px;
}

.dir-tree-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.dir-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.dir-empty-tip {
  margin-top: 4px;
  color: var(--app-text-secondary);
  font-size: 12px;
}

/* 目录树节点 */
.dir-tree :deep(.el-tree-node__content) {
  height: 30px;
  border-radius: 6px;
}

.dir-tree :deep(.el-tree-node__content:hover) {
  background: var(--panel-hover);
}

.dir-tree :deep(.el-tree--highlight-current .el-tree-node.is-current > .el-tree-node__content) {
  background: #d9ecff;
}

html.dark .dir-tree :deep(.el-tree--highlight-current .el-tree-node.is-current > .el-tree-node__content) {
  background: #2c4a6e;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-right: 6px;
}

.tree-node-icon {
  color: #f7ba2a;
  flex-shrink: 0;
}

.tree-node-tags-group .tree-node-icon {
  color: #409eff;
}

.tree-node-tag .tree-node-icon {
  color: #9aa4b2;
}

.tree-node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.tree-node-count {
  flex-shrink: 0;
  margin-left: auto;
  padding: 0 5px;
  font-size: 11px;
  line-height: 16px;
  border-radius: 8px;
  color: var(--app-text-secondary);
  background: var(--panel-hover);
}

.sidebar-footer {
  padding: 10px;
  border-top: 1px solid var(--panel-border);
  display: flex;
  align-items: center;
  gap: 8px;
}

.root-select {
  flex: 1;
  min-width: 0;
}

.sidebar-setting-btn {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;
}

.sidebar-setting-btn:hover {
  background: var(--panel-hover);
  color: var(--app-text);
}

.root-option {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.root-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.root-option-path {
  font-size: 11px;
  color: #aaa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
