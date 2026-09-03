<script setup>
import { ref, onMounted, reactive, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, FolderOpened, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { useNotificationsStore } from '../../stores/notifications'
import { useGifStore } from '../../stores/gif'

const { t } = useI18n()
const gifStore = useGifStore()
const roots = ref([])
const loading = ref(false)

const dialogVisible = ref(false)
const editingId = ref(null) // null = 新增
const saving = ref(false)

// 维护工具：选中的根目录
const maintainRootId = ref(null)
const maintainBusy = ref(false)

const notificationsStore = useNotificationsStore()
const MAINTAIN_MODES = computed(() => [
  { label: t('roots.updateCache'), mode: 'update' },
  { label: t('roots.rebuildCache'), mode: 'rebuild' },
  { label: t('roots.scanCache'), mode: 'scan-cache' },
  { label: t('roots.cleanCache'), mode: 'clean' }
])

let offCacheProgress = null
let cacheNotifyId = null
let cacheRootId = null

// 维护操作：接真实缓存引擎 + 进度通知
function buttonType(mode) {
  if (mode === 'update') return 'primary'
  if (mode === 'rebuild') return 'warning'
  if (mode === 'scan-cache') return 'info'
  return 'danger'
}

function maintain(mode) {
  const item = MAINTAIN_MODES.value.find((m) => m.mode === mode)
  const root = roots.value.find((r) => r.id === maintainRootId.value)
  if (!root) return

  maintainBusy.value = true
  cacheRootId = root.id
  cacheNotifyId = notificationsStore.add({
    type: 'progress',
    title: `${item.label} · ${displayName(root)}`,
    message: t('common.preparing'),
    cancellable: true,
    onCancel: () => window.api.cacheAbort()
  })

  window.api.cacheRun(root.id, mode).catch((err) => {
    if (cacheNotifyId) {
      notificationsStore.finish(cacheNotifyId, 'aborted', {
        message: t('roots.startFailed', { error: String(err?.message || err) })
      })
    }
    maintainBusy.value = false
  })
}

function onCacheProgress(p) {
  if (p.rootId !== cacheRootId) return
  if (!cacheNotifyId) return

  // thumb 进度事件的 done 是数字；任务完成标志是 done === true
  const finished = p.done === true

  if (p.error) {
    notificationsStore.finish(cacheNotifyId, 'aborted', { message: p.error })
    maintainBusy.value = false
    return
  }
  if (p.aborted) {
    notificationsStore.finish(cacheNotifyId, 'aborted', { message: t('notifications.aborted') })
    maintainBusy.value = false
    return
  }
  if (finished) {
    const s = p.stats || {}
    const added = s.added ?? 0
    const updated = s.updated ?? 0
    const removed = s.removed ?? 0
    const parts = []
    if (added) parts.push(t('notifications.statsAdded', { n: added }))
    if (updated) parts.push(t('notifications.statsUpdated', { n: updated }))
    if (removed) parts.push(t('notifications.statsRemoved', { n: removed }))
    parts.push(t('notifications.statsThumbs', { n: s.thumbs ?? 0 }))
    if (s.failed) parts.push(t('notifications.statsFailed', { n: s.failed }))
    if (s.cleanedThumbs) parts.push(t('notifications.statsCleanedOrphans', { n: s.cleanedThumbs }))
    notificationsStore.finish(cacheNotifyId, 'done', {
      message: t('app.scanSummary', {
        n: added + updated + removed,
        parts: parts.join(t('common.separator'))
      })
    })
    maintainBusy.value = false
    return
  }
  if (p.phase === 'scan') {
    notificationsStore.update(cacheNotifyId, { message: t('app.scanningFiles', { n: p.scanned }) })
  } else if (p.phase === 'thumb') {
    notificationsStore.updateProgress(cacheNotifyId, Math.round((p.done / p.total) * 100))
    notificationsStore.update(cacheNotifyId, {
      message: t('app.generatingThumbs', {
        done: p.done,
        total: p.total,
        current: p.current || ''
      })
    })
  }
}

onMounted(() => {
  offCacheProgress = window.api.onCacheProgress(onCacheProgress)
})

onBeforeUnmount(() => {
  offCacheProgress?.()
})

// ---------- 动图（GIF）设置 ----------
// 实时来源开关：realtime ↔ disk
const realtimeSource = computed({
  get: () => gifStore.thumbSource === 'realtime',
  set: (v) => setThumbSource(v ? 'realtime' : 'disk')
})

async function onPlayModeChange(v) {
  try {
    await gifStore.setPlayMode(v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function setThumbSource(v) {
  try {
    await gifStore.setThumbSource(v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

const form = reactive({
  path: '',
  alias: ''
})

function displayName(root) {
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = root.path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root.path
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
  form.path = ''
  form.alias = ''
  dialogVisible.value = true
}

function openEdit(root) {
  editingId.value = root.id
  form.path = root.path
  form.alias = root.alias || ''
  dialogVisible.value = true
}

async function browsePath() {
  const dir = await window.api.selectDirectory()
  if (dir) form.path = dir
}

async function save() {
  if (!form.path.trim()) {
    ElMessage.warning(t('roots.needPath'))
    return
  }
  saving.value = true
  try {
    if (editingId.value == null) {
      await window.api.rootsAdd(form.path.trim(), form.alias.trim())
      ElMessage.success(t('roots.added'))
    } else {
      await window.api.rootsUpdate(editingId.value, form.path.trim(), form.alias.trim())
      ElMessage.success(t('roots.updated'))
    }
    dialogVisible.value = false
    await loadRoots()
  } catch (err) {
    ElMessage.error(String(err?.message ?? err))
  } finally {
    saving.value = false
  }
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

onMounted(async () => {
  // 动图设置：先读库再显示（radio 默认 all、来源默认 disk）
  await gifStore.load()
  loadRoots()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>{{ t('settings.roots') }}</h2>
        <p class="page-desc">{{ t('roots.pageDesc') }}</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openAdd">{{ t('roots.addRoot') }}</el-button>
    </div>

    <el-table :data="roots" v-loading="loading" :empty-text="t('roots.emptyTable')">
      <el-table-column :label="t('roots.name')" min-width="140">
        <template #default="{ row }">
          <span class="name-cell">
            <el-icon :size="15" class="name-icon"><FolderOpened /></el-icon>
            {{ displayName(row) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column :label="t('roots.path')" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ row.path }}</template>
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
      <el-table-column :label="t('roots.actions')" width="130" align="center">
        <template #default="{ row }">
          <el-button link type="primary" :icon="Edit" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
          <el-button link type="danger" :icon="Delete" @click="remove(row)">{{ t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 维护工具 -->
    <el-card class="maintain-card" shadow="never">
      <template #header>
        <div class="maintain-head">
          <span>{{ t('roots.maintainTools') }}</span>
          <el-tag v-if="maintainBusy" size="small" type="primary" effect="plain">{{ t('roots.taskRunning') }}</el-tag>
        </div>
      </template>
      <p class="maintain-desc">{{ t('roots.maintainDesc') }}</p>
      <div class="maintain-row">
        <el-select
          v-model="maintainRootId"
          class="maintain-select"
          :placeholder="t('roots.selectMaintainRoot')"
          clearable
          :disabled="maintainBusy"
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

        <template v-for="item in MAINTAIN_MODES" :key="item.mode">
          <el-tooltip
            :disabled="maintainRootId != null"
            :content="t('roots.selectRootFirst')"
            placement="top"
          >
            <span>
              <el-button
                :type="buttonType(item.mode)"
                plain
                :disabled="maintainRootId == null || maintainBusy"
                :loading="maintainBusy"
                @click="maintain(item.mode)"
              >
                {{ item.label }}
              </el-button>
            </span>
          </el-tooltip>
        </template>
      </div>
    </el-card>

    <!-- 动图（GIF）设置 -->
    <el-card class="maintain-card" shadow="never">
      <template #header>
        <div class="maintain-head">
          <span>{{ t('roots.gifSectionTitle') }}</span>
        </div>
      </template>
      <p class="maintain-desc">{{ t('roots.gifSectionDesc') }}</p>

      <div class="gif-block">
        <div class="gif-label">{{ t('roots.gifPlayMode') }}</div>
        <el-radio-group v-model="gifStore.playMode" class="gif-radio-group" @change="onPlayModeChange">
          <div class="gif-radio-row">
            <el-radio value="all">{{ t('roots.gifAll') }}</el-radio>
            <span class="gif-radio-desc">{{ t('roots.gifAllDesc') }}</span>
          </div>
          <div class="gif-radio-row">
            <el-radio value="hover">{{ t('roots.gifHover') }}</el-radio>
            <span class="gif-radio-desc">{{ t('roots.gifHoverDesc') }}</span>
          </div>
          <div class="gif-radio-row">
            <el-radio value="none">{{ t('roots.gifNone') }}</el-radio>
            <span class="gif-radio-desc">{{ t('roots.gifNoneDesc') }}</span>
          </div>
        </el-radio-group>
      </div>

      <el-divider />

      <div class="gif-block">
        <div class="gif-label">
          <span>{{ t('roots.gifThumbSource') }}</span>
          <el-switch
            v-model="realtimeSource"
            class="gif-source-switch"
            :active-text="t('roots.gifSourceRealtime')"
            :inactive-text="t('roots.gifSourceDisk')"
          />
        </div>
        <p class="gif-source-desc">{{ t('roots.gifSourceDesc') }}</p>
      </div>
    </el-card>

    <!-- 添加 / 编辑 弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId == null ? t('roots.addDialogTitle') : t('roots.editDialogTitle')"
      width="520px"
    >
      <el-form label-width="80px">
        <el-form-item :label="t('roots.pathLabel')" required>
          <div class="path-input">
            <el-input v-model="form.path" :placeholder="t('roots.pathPlaceholder')" />
            <el-button @click="browsePath">{{ t('roots.browse') }}</el-button>
          </div>
          <p class="form-tip">{{ t('roots.pathTip') }}</p>
        </el-form-item>
        <el-form-item :label="t('roots.alias')">
          <el-input v-model="form.alias" :placeholder="t('roots.aliasPlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
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

.name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.name-icon {
  color: #f0a020;
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
  color: #aaa;
  font-size: 12px;
}

/* 维护工具 */
.maintain-card {
  margin-top: 20px;
}

.maintain-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.maintain-desc {
  margin: 0 0 12px;
  color: #999;
  font-size: 13px;
}

.maintain-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.maintain-select {
  width: 260px;
  flex-shrink: 0;
}

/* 动图（GIF）设置 */
.gif-block {
  max-width: 560px;
}

.gif-label {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text);
}

.gif-radio-group {
  display: block;
  margin-top: 10px;
}

.gif-radio-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.gif-radio-row .el-radio {
  white-space: nowrap;
  flex-shrink: 0;
  margin-right: 0;
}

.gif-radio-desc {
  color: #999;
  font-size: 12px;
  line-height: 20px;
  padding-top: 2px;
}

.gif-source-switch {
  margin-left: auto;
}

.gif-source-desc {
  margin: 8px 0 0;
  color: #999;
  font-size: 12px;
}
</style>
