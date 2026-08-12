<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search } from '@element-plus/icons-vue'

const { t } = useI18n()

const props = defineProps({
  data: { type: Array, required: true },
  currentKey: { type: String, default: '' }
})

const emit = defineEmits(['node-click'])

const treeRef = ref(null)
const searchText = ref('')

// 搜索过滤：节点自身命中，或子节点命中（保留祖先链）
const filteredData = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return props.data

  const filterNodes = (nodes) =>
    nodes
      .map((node) => {
        const labelHit = node.label.toLowerCase().includes(q)
        const children = node.children ? filterNodes(node.children) : []
        if (labelHit || children.length > 0) {
          return { ...node, children: children.length > 0 ? children : node.children }
        }
        return null
      })
      .filter(Boolean)

  return filterNodes(props.data)
})

// 当前选中节点同步到树组件
watch(
  () => props.currentKey,
  async (key) => {
    await nextTick()
    treeRef.value?.setCurrentKey(key)
  },
  { immediate: true }
)

function handleNodeClick(data) {
  emit('node-click', data)
}
</script>

<template>
  <aside class="settings-sidebar">
    <div class="search-box">
      <el-input
        v-model="searchText"
        :placeholder="t('settingsSidebar.search')"
        clearable
        :prefix-icon="Search"
        size="default"
      />
    </div>

    <el-tree
      ref="treeRef"
      class="settings-tree"
      :data="filteredData"
      node-key="id"
      :props="{ label: 'label', children: 'children' }"
      default-expand-all
      highlight-current
      @node-click="handleNodeClick"
    >
      <template #default="{ data }">
        <span class="tree-node">
          <el-icon v-if="data.icon" :size="15"><component :is="data.icon" /></el-icon>
          <span>{{ data.label }}</span>
        </span>
      </template>
    </el-tree>
  </aside>
</template>

<style scoped>
.settings-sidebar {
  width: 230px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border-right: 1px solid var(--panel-border);
  padding: 14px 10px;
}

.search-box {
  margin-bottom: 12px;
}

.settings-tree {
  flex: 1;
  overflow-y: auto;
  background: transparent;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
}

:deep(.el-tree-node__content) {
  height: 34px;
  border-radius: 6px;
}
</style>
