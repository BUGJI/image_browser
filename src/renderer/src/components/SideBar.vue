<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Setting, Folder, Search } from '@element-plus/icons-vue'
import { useRootsStore } from '../stores/roots'

const { t } = useI18n()
const rootsStore = useRootsStore()
let offRootsChanged = null

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

// 切换根目录 → 重新扫描
watch(() => rootsStore.currentRootId, scanTree, { immediate: true })

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

// 搜索时展开过滤后所有节点（含父链）；无搜索时用持久化的展开状态
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
  return persistedExpanded.value
})

// 展开/折叠时同步持久化（仅非搜索状态记录，避免搜索展开污染）
function handleNodeExpand(data) {
  if (searchText.value.trim()) return
  if (!persistedExpanded.value.includes(data.path)) {
    persistedExpanded.value = [...persistedExpanded.value, data.path]
    saveExpanded(persistedExpanded.value)
  }
}

function handleNodeCollapse(data) {
  if (searchText.value.trim()) return
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

// 当前选中文件夹（任意层级），树内高亮
const selectedPath = computed(() => rootsStore.selectedFolder?.path || '')

function handleNodeClick(data) {
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
  offRootsChanged = window.api.onRootsChanged(() => {
    rootsStore.refresh()
  })
})

onBeforeUnmount(() => {
  offRootsChanged?.()
})
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-content">
      <!-- 有根目录：顶部搜索框 + 目录树 -->
      <template v-if="rootsStore.currentRoot">
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
            :data="filteredTree"
            node-key="path"
            :props="{ label: 'name', children: 'children' }"
            :default-expanded-keys="expandedKeys"
            :current-node-key="selectedPath"
            :expand-on-click-node="false"
            highlight-current
            class="dir-tree"
            :empty-text="t('sidebar.noMatch')"
            @node-click="handleNodeClick"
            @node-expand="handleNodeExpand"
            @node-collapse="handleNodeCollapse"
          >
            <template #default="{ data }">
              <span class="tree-node">
                <el-icon :size="14" class="tree-node-icon"><Folder /></el-icon>
                <span class="tree-node-label" :title="data.path">{{ data.name }}</span>
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
        :disabled="rootsStore.currentRootId != null"
        :content="t('sidebar.noRootsTooltip')"
        placement="top"
      >
        <el-select
          v-model="currentId"
          class="root-select"
          :placeholder="rootsStore.roots.length ? t('sidebar.selectRoot') : t('sidebar.noRoots')"
          size="default"
          clearable
          @clear="rootsStore.setCurrent(null)"
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

.tree-node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
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
