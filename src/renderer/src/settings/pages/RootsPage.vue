<script setup>
import { ref, onMounted, onBeforeUnmount, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  Plus,
  Edit,
  Delete,
  FolderOpened,
  ArrowUp,
  ArrowDown,
  Refresh
} from '@element-plus/icons-vue'
import { rootDisplayName as displayName } from '../../utils/roots'
import { formatBytes, formatCount, formatDateTime } from '../../utils/format'
import { useCacheMaintenance } from '../../utils/use-cache-maintenance'

/**
 * 根目录管理：注册 / 编辑 / 删除 / 排序，并展示各根目录的缓存概况。
 * 每行提供一键「更新缓存」（增量加速）；其余维护模式在「浏览与性能」。
 */
const { t } = useI18n()

const roots = ref([])
const loading = ref(false)

const dialogVisible = ref(false)
const editingId = ref(null) // null = 新增
const saving = ref(false)

const form = reactive({
  type: 'local',
  path: '',
  alias: '',
  url: '',
  username: '',
  password: '',
  writable: true
})
const testing = ref(false)
const isRemoteForm = computed(() => form.type !== 'local')

// ---------- 缓存概况 ----------
const stats = ref([])
const statsLoading = ref(false)
const statMap = computed(() => new Map(stats.value.map((s) => [s.rootId, s])))

function statOf(rootId) {
  return (
    statMap.value.get(rootId) || {
      hasCache: false,
      total: 0,
      cached: 0,
      srcBytes: 0,
      thumbBytes: 0,
      folderCount: 0,
      lastTaskAt: null
    }
  )
}

function cachePct(s) {
  return s.total ? Math.round((s.cached / s.total) * 100) : 0
}

const totalMedia = computed(() => stats.value.reduce((a, s) => a + s.total, 0))
const totalCached = computed(() => stats.value.reduce((a, s) => a + s.cached, 0))
const totalSrcBytes = computed(() => stats.value.reduce((a, s) => a + s.srcBytes, 0))
const totalThumbBytes = computed(() => stats.value.reduce((a, s) => a + s.thumbBytes, 0))
const coveragePct = computed(() =>
  totalMedia.value ? Math.round((totalCached.value / totalMedia.value) * 100) : 0
)

async function loadStats() {
  statsLoading.value = true
  try {
    stats.value = (await window.api.cacheStats()) || []
  } catch {
    stats.value = []
  } finally {
    statsLoading.value = false
  }
}

// ---------- 一键更新缓存（增量加速） ----------
const {
  busy: cacheBusy,
  runningRootId: cacheRunningRootId,
  start: startCache,
  attach: attachCacheProgress,
  detach: detachCacheProgress
} = useCacheMaintenance()

function updateCache(root) {
  // 完成后刷新概况（缓存占用/覆盖率会变化）
  startCache(root, 'update', { onDone: loadStats })
}

async function loadRoots() {
  loading.value = true
  try {
    roots.value = await window.api.rootsList()
  } finally {
    loading.value = false
  }
}

function openAdd() {
  editingId.value = null
  form.type = 'local'
  form.path = ''
  form.alias = ''
  form.url = ''
  form.username = ''
  form.password = ''
  form.writable = true
  dialogVisible.value = true
}

function openEdit(root) {
  editingId.value = root.id
  form.type = root.type || 'local'
  form.path = form.type === 'local' ? root.path : ''
  form.alias = root.alias || ''
  form.url = form.type === 'local' ? '' : root.path
  form.username = root.config?.username || ''
  form.password = ''
  form.writable = root.writable == null ? true : !!root.writable
  dialogVisible.value = true
}

async function browsePath() {
  const dir = await window.api.selectDirectory()
  if (dir) form.path = dir
}

async function testConnection() {
  const path = isRemoteForm.value ? form.url.trim() : form.path.trim()
  if (!path) {
    ElMessage.warning(t('roots.needPath'))
    return
  }
  testing.value = true
  try {
    const res = await window.api.rootsTest({
      type: form.type,
      path,
      config: isRemoteForm.value ? { username: form.username.trim() } : null,
      secret: form.password
    })
    if (res?.ok) ElMessage.success(t('roots.testOk'))
    else ElMessage.error(t('roots.testFail', { message: res?.message || '' }))
  } catch (err) {
    ElMessage.error(t('roots.testFail', { message: String(err?.message ?? err) }))
  } finally {
    testing.value = false
  }
}

async function save() {
  const path = (isRemoteForm.value ? form.url : form.path).trim()
  if (!path) {
    ElMessage.warning(t('roots.needPath'))
    return
  }
  const opts = { type: form.type, writable: form.writable }
  if (isRemoteForm.value) opts.config = { url: path, username: form.username.trim() }
  // 留空表示不修改（编辑时）；新增时空则无密钥
  if (form.password) opts.secret = form.password

  saving.value = true
  try {
    if (editingId.value == null) {
      await window.api.rootsAdd(path, form.alias.trim(), opts)
      ElMessage.success(t('roots.added'))
    } else {
      await window.api.rootsUpdate(editingId.value, path, form.alias.trim(), opts)
      ElMessage.success(t('roots.updated'))
    }
    dialogVisible.value = false
    await loadRoots()
    loadStats()
  } catch (err) {
    ElMessage.error(String(err?.message ?? err))
  } finally {
    saving.value = false
  }
}

function typeLabel(type) {
  if (type === 'webdav') return 'WebDAV'
  if (type === 'smb') return 'SMB'
  return t('roots.typeLocal')
}

async function remove(root) {
  try {
    await ElMessageBox.confirm(
      t('roots.deleteConfirm', { name: displayName(root) }),
      t('roots.deleteRootTitle'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    await window.api.rootsRemove(root.id)
    ElMessage.success(t('roots.deleted'))
    await loadRoots()
    loadStats()
  } catch {
    // 用户取消
  }
}

// 上下移动排序：先在本地交换，再持久化到主进程
async function moveRoot(index, delta) {
  const target = index + delta
  if (target < 0 || target >= roots.value.length) return
  const list = [...roots.value]
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
  roots.value = list
  try {
    await window.api.rootsReorder(list.map((r) => r.id))
    ElMessage.success(t('roots.reordered'))
  } catch {
    await loadRoots() // 失败回滚为服务器顺序
    ElMessage.error(t('common.saveFailed'))
  }
}

onMounted(() => {
  loadRoots()
  loadStats()
  attachCacheProgress()
})

onBeforeUnmount(() => {
  detachCacheProgress()
})
</script>

<template>
  <div class="page page--wide">
    <div class="page-head">
      <div>
        <h2>{{ t('settings.roots') }}</h2>
        <p class="page-desc">{{ t('roots.pageDesc') }}</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openAdd">{{ t('roots.addRoot') }}</el-button>
    </div>

    <!-- 缓存概况 -->
    <div class="stats-head">
      <span class="stats-title">{{ t('roots.statsTitle') }}</span>
      <el-button link :icon="Refresh" :loading="statsLoading" @click="loadStats">
        {{ t('roots.statRefresh') }}
      </el-button>
    </div>
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">{{ t('roots.statRoots') }}</div>
        <div class="stat-value">{{ formatCount(roots.length) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ t('roots.statMedia') }}</div>
        <div class="stat-value">{{ formatCount(totalMedia) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ t('roots.statCoverage') }}</div>
        <div class="stat-value">{{ coveragePct }}%</div>
        <el-progress
          :percentage="coveragePct"
          :show-text="false"
          :stroke-width="6"
          class="stat-progress"
        />
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ t('roots.statCacheSize') }}</div>
        <div class="stat-value">{{ formatBytes(totalThumbBytes) }}</div>
        <div class="stat-sub">
          {{ t('roots.statSrcSize', { size: formatBytes(totalSrcBytes) }) }}
        </div>
      </div>
    </div>

    <el-table v-loading="loading" :data="roots" :empty-text="t('roots.emptyTable')">
      <el-table-column :label="t('roots.name')" min-width="140">
        <template #default="{ row }">
          <span class="name-cell">
            <el-icon :size="15" class="name-icon"><FolderOpened /></el-icon>
            {{ displayName(row) }}
            <el-tag v-if="row.type && row.type !== 'local'" size="small" type="info" effect="plain">
              {{ typeLabel(row.type) }}
            </el-tag>
            <el-tag v-if="row.writable === 0" size="small" type="warning" effect="plain">
              {{ t('roots.readOnlyTag') }}
            </el-tag>
          </span>
        </template>
      </el-table-column>
      <el-table-column :label="t('roots.path')" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{ row.path }}</template>
      </el-table-column>
      <el-table-column :label="t('roots.colMedia')" width="96" align="right">
        <template #default="{ row }">
          <span v-if="statOf(row.id).hasCache">{{ formatCount(statOf(row.id).total) }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('roots.colCacheState')" width="150">
        <template #default="{ row }">
          <div v-if="statOf(row.id).hasCache" class="cache-state">
            <span class="cache-state-text">
              {{ formatCount(statOf(row.id).cached) }} / {{ formatCount(statOf(row.id).total) }}
            </span>
            <el-progress
              :percentage="cachePct(statOf(row.id))"
              :show-text="false"
              :stroke-width="5"
            />
          </div>
          <el-tag v-else size="small" type="info" effect="plain">
            {{ t('roots.statNoCache') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('roots.colCacheSize')" width="120" align="right">
        <template #default="{ row }">
          <el-tooltip
            v-if="statOf(row.id).hasCache"
            :content="t('roots.statSrcSize', { size: formatBytes(statOf(row.id).srcBytes) })"
            placement="top"
          >
            <span>{{ formatBytes(statOf(row.id).thumbBytes) }}</span>
          </el-tooltip>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('roots.colLastTask')" width="170" show-overflow-tooltip>
        <template #default="{ row }">
          <span :class="{ muted: !statOf(row.id).lastTaskAt }">
            {{ formatDateTime(statOf(row.id).lastTaskAt, t('roots.neverMaintained')) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column :label="t('roots.order')" width="76" align="center">
        <template #default="{ $index }">
          <div class="order-cell">
            <el-button
              link
              :icon="ArrowUp"
              :disabled="$index === 0 || loading"
              :title="t('roots.moveUp')"
              @click="moveRoot($index, -1)"
            />
            <el-button
              link
              :icon="ArrowDown"
              :disabled="$index === roots.length - 1 || loading"
              :title="t('roots.moveDown')"
              @click="moveRoot($index, 1)"
            />
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="t('roots.actions')" width="190" align="center">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            :icon="Refresh"
            :loading="cacheRunningRootId === row.id"
            :disabled="cacheBusy"
            @click="updateCache(row)"
          >
            {{ t('roots.updateCacheNow') }}
          </el-button>
          <el-button link type="primary" :icon="Edit" @click="openEdit(row)">{{
            t('common.edit')
          }}</el-button>
          <el-button link type="danger" :icon="Delete" @click="remove(row)">{{
            t('common.delete')
          }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 添加 / 编辑 弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      width="min(600px, 90vw)"
      :title="editingId == null ? t('roots.addDialogTitle') : t('roots.editDialogTitle')"
    >
      <el-form label-width="auto">
        <template v-if="!isRemoteForm">
          <el-form-item :label="t('roots.pathLabel')" required>
            <div class="path-input">
              <el-input v-model="form.path" :placeholder="t('roots.pathPlaceholder')" />
              <el-button @click="browsePath">{{ t('roots.browse') }}</el-button>
            </div>
            <p class="form-tip">{{ t('roots.pathTip') }}</p>
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item :label="t('roots.pathLabelRemote')" required>
            <el-input v-model="form.url" :placeholder="t('roots.webdavPlaceholder')" />
          </el-form-item>
          <el-form-item :label="t('roots.username')">
            <el-input v-model="form.username" :placeholder="t('roots.usernamePlaceholder')" />
          </el-form-item>
          <el-form-item :label="t('roots.password')">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              :placeholder="
                editingId != null ? t('roots.passwordKeep') : t('roots.passwordPlaceholder')
              "
            />
          </el-form-item>
        </template>

        <el-form-item :label="t('roots.writable')">
          <el-switch v-model="form.writable" />
          <span class="form-tip inline">{{ t('roots.writableTip') }}</span>
        </el-form-item>

        <el-form-item :label="t('roots.alias')">
          <el-input v-model="form.alias" :placeholder="t('roots.aliasPlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="isRemoteForm" :loading="testing" @click="testConnection">
          {{ t('roots.testConnection') }}
        </el-button>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 缓存概况 */
.stats-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.stats-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  padding: 14px 16px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: var(--panel-bg);
}

.stat-label {
  font-size: 12px;
  color: var(--app-text-secondary);
}

.stat-value {
  margin-top: 4px;
  font-size: 22px;
  font-weight: 600;
  color: var(--app-text);
  line-height: 1.2;
}

.stat-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--app-text-secondary);
}

.stat-progress {
  margin-top: 8px;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.name-icon {
  color: #f0a020;
}

.cache-state {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cache-state-text {
  font-size: 12px;
  color: var(--app-text-secondary);
}

.muted {
  color: var(--app-text-secondary);
}

.order-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.path-input {
  display: flex;
  gap: 8px;
  width: 100%;
}

.form-tip {
  margin: 6px 0 0;
  color: var(--app-text-secondary);
  font-size: 12px;
}

.form-tip.inline {
  margin: 0 0 0 10px;
}
</style>
