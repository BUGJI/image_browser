<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Edit, Delete, CollectionTag } from '@element-plus/icons-vue'
import { rootDisplayName as displayName } from '../../utils/roots'

const { t } = useI18n()

/**
 * 标签管理页：按根目录列出全部标签，支持新建 / 重命名 / 删除 / 合并。
 * 标签通常由用户在灯箱中打给图片时自动创建；这里用于整理标签体系。
 */

// 标签功能总开关（关闭后主界面标签入口与灯箱打标不可用，数据保留）
const tagsEnabled = ref(true)
const disabled = computed(() => !tagsEnabled.value)

// 灯箱右上角是否显示打标按钮
const tagsLightboxBtn = ref(true)

const roots = ref([])
const tagRootId = ref(null)
const tags = ref([])
const loading = ref(false)

// 表格多选（用于合并）
const selected = ref([])
const canMerge = computed(() => selected.value.length >= 2)

let offTagsChanged = null

async function onMasterChange(v) {
  try {
    await window.api.setSetting('tagsEnabled', v ? 'true' : 'false')
    if (v) ElMessage.success(t('tags.enabled'))
    else ElMessage.info(t('tags.disabled'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function saveToggle(key, value) {
  try {
    await window.api.setSetting(key, value ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function loadRoots() {
  roots.value = await window.api.rootsList()
  const current = tagRootId.value
  if (!roots.value.some((r) => r.id === current)) {
    tagRootId.value = roots.value[0]?.id ?? null
  }
}

async function loadTags() {
  if (tagRootId.value == null) {
    tags.value = []
    return
  }
  loading.value = true
  try {
    tags.value = (await window.api.tagsList(tagRootId.value)) || []
  } finally {
    loading.value = false
  }
}

watch(tagRootId, loadTags)

function onSelectionChange(rows) {
  selected.value = rows
}

// ---------- 新建 / 重命名 ----------
const addVisible = ref(false)
const addName = ref('')
const savingAdd = ref(false)

const renameVisible = ref(false)
const renameTagRow = ref(null)
const renameName = ref('')
const savingRename = ref(false)

function openAdd() {
  addName.value = ''
  addVisible.value = true
}

async function saveAdd() {
  const name = addName.value.trim()
  if (!name) {
    ElMessage.warning(t('tags.nameRequired'))
    return
  }
  savingAdd.value = true
  try {
    tags.value = (await window.api.tagsAdd(tagRootId.value, name)) || []
    addVisible.value = false
    ElMessage.success(t('tags.added'))
  } catch (err) {
    ElMessage.error(String(err?.message || t('common.saveFailed')))
  } finally {
    savingAdd.value = false
  }
}

function openRename(row) {
  renameTagRow.value = row
  renameName.value = row.name
  renameVisible.value = true
}

async function saveRename() {
  const name = renameName.value.trim()
  if (!name) {
    ElMessage.warning(t('tags.nameRequired'))
    return
  }
  if (name === renameTagRow.value.name) {
    renameVisible.value = false
    return
  }
  savingRename.value = true
  try {
    tags.value = (await window.api.tagsRename(tagRootId.value, renameTagRow.value.id, name)) || []
    renameVisible.value = false
    ElMessage.success(t('tags.renamed'))
  } catch (err) {
    ElMessage.error(String(err?.message || t('common.saveFailed')))
  } finally {
    savingRename.value = false
  }
}

// ---------- 删除 ----------
async function removeTag(row) {
  try {
    await ElMessageBox.confirm(
      t('tags.deleteConfirm', { name: row.name, count: row.count }),
      t('common.delete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    tags.value = (await window.api.tagsDelete(tagRootId.value, row.id)) || []
    ElMessage.success(t('tags.deleted'))
  } catch {
    // 用户取消
  }
}

// ---------- 合并 ----------
const mergeVisible = ref(false)
const mergeTargetId = ref(null)
const merging = ref(false)

function openMerge() {
  // 默认保留第一个选中的标签名
  mergeTargetId.value = selected.value[0].id
  mergeVisible.value = true
}

async function confirmMerge() {
  const fromIds = selected.value.map((r) => r.id).filter((id) => id !== mergeTargetId.value)
  if (!fromIds.length) return
  merging.value = true
  try {
    tags.value = (await window.api.tagsMerge(tagRootId.value, fromIds, mergeTargetId.value)) || []
    mergeVisible.value = false
    selected.value = []
    ElMessage.success(t('tags.merged'))
  } catch (err) {
    ElMessage.error(String(err?.message || t('common.saveFailed')))
  } finally {
    merging.value = false
  }
}

onMounted(async () => {
  tagsEnabled.value = (await window.api.getSetting('tagsEnabled', 'true')) !== 'false'
  tagsLightboxBtn.value = (await window.api.getSetting('tagsLightboxBtn', 'true')) !== 'false'
  await loadRoots()
  await loadTags()
  offTagsChanged = window.api.onTagsChanged(({ rootId }) => {
    if (rootId === tagRootId.value) loadTags()
  })
})

onBeforeUnmount(() => {
  offTagsChanged?.()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>{{ t('settings.tags') }}</h2>
        <p class="page-desc">{{ t('tags.pageDesc') }}</p>
      </div>
      <el-button type="primary" :icon="Plus" :disabled="disabled" @click="openAdd">
        {{ t('tags.addTag') }}
      </el-button>
    </div>

    <el-card class="master-card" shadow="never">
      <div class="master-row">
        <div class="master-label">
          <div class="master-name">{{ t('tags.enableMaster') }}</div>
          <div class="master-desc">{{ t('tags.masterDesc') }}</div>
        </div>
        <el-switch v-model="tagsEnabled" @change="onMasterChange" />
      </div>
    </el-card>

    <template v-if="tagsEnabled">
      <el-card class="master-card" shadow="never">
        <div class="master-row">
          <div class="master-label">
            <div class="master-name">{{ t('tags.lightboxBtn') }}</div>
            <div class="master-desc">{{ t('tags.lightboxBtnDesc') }}</div>
          </div>
          <el-switch v-model="tagsLightboxBtn" @change="(v) => saveToggle('tagsLightboxBtn', v)" />
        </div>
      </el-card>

      <div class="toolbar">
        <el-select
          v-model="tagRootId"
          class="root-select"
          :placeholder="t('tags.selectRoot')"
          clearable
        >
          <el-option
            v-for="root in roots"
            :key="root.id"
            :value="root.id"
            :label="displayName(root)"
          >
            <el-tooltip :content="root.path" placement="left" :show-after="300">
              <span>{{ displayName(root) }}</span>
            </el-tooltip>
          </el-option>
        </el-select>

        <el-button
          type="warning"
          plain
          :disabled="!canMerge"
          :title="canMerge ? '' : t('tags.mergeTip')"
          @click="openMerge"
        >
          {{ t('tags.merge') }}
        </el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="tags"
        :empty-text="t('tags.empty')"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="44" align="center" />
        <el-table-column :label="t('tags.name')" min-width="200">
          <template #default="{ row }">
            <span class="name-cell">
              <el-icon :size="15" class="name-icon"><CollectionTag /></el-icon>
              {{ row.name }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('tags.count')" width="140" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.count }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('roots.actions')" width="150" align="center">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Edit" @click="openRename(row)">{{
              t('common.edit')
            }}</el-button>
            <el-button link type="danger" :icon="Delete" @click="removeTag(row)">{{
              t('common.delete')
            }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>
    <el-empty v-else :description="t('tags.offTip')" :image-size="72" />

    <!-- 新建标签 -->
    <el-dialog v-model="addVisible" :title="t('tags.addDialogTitle')" width="420px">
      <el-input
        v-model="addName"
        :placeholder="t('tags.addPlaceholder')"
        maxlength="40"
        show-word-limit
        @keyup.enter="saveAdd"
      />
      <template #footer>
        <el-button @click="addVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="savingAdd" @click="saveAdd">{{
          t('common.save')
        }}</el-button>
      </template>
    </el-dialog>

    <!-- 重命名 -->
    <el-dialog v-model="renameVisible" :title="t('tags.renameDialogTitle')" width="420px">
      <el-input
        v-model="renameName"
        :placeholder="t('tags.addPlaceholder')"
        maxlength="40"
        show-word-limit
        @keyup.enter="saveRename"
      />
      <template #footer>
        <el-button @click="renameVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="savingRename" @click="saveRename">{{
          t('common.save')
        }}</el-button>
      </template>
    </el-dialog>

    <!-- 合并 -->
    <el-dialog v-model="mergeVisible" :title="t('tags.mergeDialogTitle')" width="440px">
      <div class="merge-form">
        <div class="merge-label">{{ t('tags.mergeTargetLabel') }}</div>
        <el-select v-model="mergeTargetId" class="merge-select">
          <el-option v-for="row in selected" :key="row.id" :value="row.id" :label="row.name" />
        </el-select>
        <p class="merge-tip">
          {{
            t('tags.mergeConfirmMsg', {
              n: selected.length - 1,
              target: (selected.find((r) => r.id === mergeTargetId) || {}).name || ''
            })
          }}
        </p>
      </div>
      <template #footer>
        <el-button @click="mergeVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="warning" :loading="merging" @click="confirmMerge">{{
          t('tags.merge')
        }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.page-desc {
  color: #999;
  font-size: 13px;
  margin: 0;
}

.master-card {
  max-width: 720px;
  margin-bottom: 20px;
}

.master-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.master-name {
  font-size: 14px;
  font-weight: 600;
}

.master-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  max-width: 540px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.root-select {
  width: 260px;
  flex-shrink: 0;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.name-icon {
  color: #409eff;
  flex-shrink: 0;
}

.merge-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.merge-label {
  font-size: 13px;
  color: var(--app-text-secondary);
}

.merge-select {
  width: 100%;
}

.merge-tip {
  margin: 0;
  color: var(--app-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

/* 去掉 Element Plus 默认 .el-table__empty-text 的 width:50% 限制，空态文案按内容完整显示 */
.page :deep(.el-table__empty-text) {
  width: auto;
}
</style>
