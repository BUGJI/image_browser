<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, FolderOpened, Delete } from '@element-plus/icons-vue'
import { useNotificationsStore } from '../../stores/notifications'

const { t } = useI18n()

// OCR 图内文字搜索（PaddleOCR）
const enabled = ref(false)
// (@repeato/ocr 内置模型 + 运行时组件) 是否可用
const available = ref(false)
const running = ref(false)

// 运行时组件状态（onnxruntime + sharp，按需下载）
const addon = ref({ installed: false, supported: true, platform: '', installing: false, sizeBytes: 0 })
const addonBusy = ref(false)
const addonPhase = ref('')
const addonProgress = ref(0)
let addonLastReceived = 0

let offSettingsChanged = null
let offOcrProgress = null
let offAddonProgress = null

const OCR_MAINTAIN_ACTIONS = computed(() => [
  { label: t('ocrSearch.updateIndex'), mode: 'update' },
  { label: t('ocrSearch.rebuildIndex'), mode: 'rebuild' },
  { label: t('ocrSearch.cleanIndex'), mode: 'clean' }
])

const phaseText = computed(() => {
  const map = {
    download: t('ocrSearch.phaseDownload', { percent: addonProgress.value }),
    extract: t('ocrSearch.phaseExtract'),
    apply: t('ocrSearch.phaseApply')
  }
  return map[addonPhase.value] || ''
})

const notificationsStore = useNotificationsStore()
const maintainBusy = ref(false)
const maintainRootId = ref(null)
const maintainRoots = ref([])
let ocrNotifyId = null
let ocrRootId = null

function displayName(root) {
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = root.path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root.path
}

function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

async function loadMaintainRoots() {
  maintainRoots.value = await window.api.rootsList()
}

async function refreshStatus() {
  try {
    const st = await window.api.ocrCheck()
    available.value = !!st?.available
    running.value = !!st?.running
    if (st?.rootId != null) maintainRootId.value = st.rootId
  } catch {
    /* ignore */
  }
  try {
    const a = await window.api.ocrAddonStatus()
    if (a) addon.value = a
  } catch {
    /* ignore */
  }
}

function buttonType(mode) {
  if (mode === 'update') return 'primary'
  if (mode === 'rebuild') return 'warning'
  return 'danger'
}

// ---------------------------------------------------------------- 运行时组件管理

function onAddonProgress(p) {
  if (!p) return
  if (p.phase === 'download') {
    addonPhase.value = 'download'
    const total = Number(p.total) || 0
    if (total > 0) {
      addonProgress.value = Math.min(100, Math.round((p.received / total) * 100))
      addonLastReceived = p.received
    } else if (p.received > 0) {
      // 无 content-length：用递增伪进度
      addonLastReceived = p.received
      addonProgress.value = Math.min(95, (addonProgress.value || 0) + 1)
    }
  } else if (p.phase === 'extract') {
    addonPhase.value = 'extract'
    addonProgress.value = 100
  } else if (p.phase === 'apply') {
    addonPhase.value = 'apply'
    addonProgress.value = 100
  } else if (p.phase === 'done') {
    addonPhase.value = 'done'
    addonProgress.value = 100
  } else if (p.phase === 'error') {
    addonPhase.value = 'error'
  }
}

async function downloadAddon() {
  if (addonBusy.value) return
  addonBusy.value = true
  addonPhase.value = 'download'
  addonProgress.value = 0
  try {
    const r = await window.api.ocrAddonDownload()
    if (r?.ok) {
      ElMessage.success(t('ocrSearch.runtimeInstalled'))
    } else {
      ElMessage.error(t('ocrSearch.runtimeInstallFailed', { error: r?.error || '' }))
    }
  } catch (e) {
    ElMessage.error(t('ocrSearch.runtimeInstallFailed', { error: String(e?.message || e) }))
  } finally {
    addonBusy.value = false
    addonPhase.value = ''
    await refreshStatus()
  }
}

async function importAddon() {
  if (addonBusy.value) return
  addonBusy.value = true
  addonPhase.value = 'extract'
  addonProgress.value = 0
  try {
    const r = await window.api.ocrAddonImport()
    if (r?.canceled) {
      /* 用户取消 */
    } else if (r?.ok) {
      ElMessage.success(t('ocrSearch.runtimeInstalled'))
    } else {
      ElMessage.error(t('ocrSearch.runtimeInstallFailed', { error: r?.error || '' }))
    }
  } catch (e) {
    ElMessage.error(t('ocrSearch.runtimeInstallFailed', { error: String(e?.message || e) }))
  } finally {
    addonBusy.value = false
    addonPhase.value = ''
    await refreshStatus()
  }
}

async function removeAddon() {
  try {
    await ElMessageBox.confirm(t('ocrSearch.runtimeRemoveConfirm'), t('common.warning'), {
      type: 'warning'
    })
  } catch {
    return
  }
  addonBusy.value = true
  try {
    const r = await window.api.ocrAddonRemove()
    if (r?.ok) ElMessage.success(t('ocrSearch.runtimeRemoved'))
    else ElMessage.error(t('ocrSearch.runtimeRemoveFailed', { error: r?.error || '' }))
  } finally {
    addonBusy.value = false
    await refreshStatus()
  }
}

// ---------------------------------------------------------------- 索引维护

function maintainIndex(mode) {
  const item = OCR_MAINTAIN_ACTIONS.value.find((m) => m.mode === mode)
  const root = maintainRoots.value.find((r) => r.id === maintainRootId.value)
  if (!root) {
    ElMessage.warning(t('ocrSearch.selectRootFirst'))
    return
  }
  if (!available.value) {
    ElMessage.warning(t('ocrSearch.runtimeRequired'))
    return
  }

  maintainBusy.value = true
  ocrRootId = root.id
  ocrNotifyId = notificationsStore.add({
    type: 'progress',
    title: `${item.label} · ${displayName(root)}`,
    message: t('common.preparing'),
    cancellable: true,
    onCancel: () => window.api.ocrAbort()
  })

  window.api.ocrIndex(root.id, mode).catch((err) => {
    if (ocrNotifyId) {
      notificationsStore.finish(ocrNotifyId, 'aborted', {
        message: t('ocrSearch.startFailed', { error: String(err?.message || err) })
      })
    }
    maintainBusy.value = false
  })
}

function onOcrProgress(p) {
  if (p.rootId !== ocrRootId) return
  if (!ocrNotifyId) return

  if (p.error) {
    notificationsStore.finish(ocrNotifyId, 'aborted', { message: p.error })
    maintainBusy.value = false
    return
  }
  if (p.aborted) {
    notificationsStore.finish(ocrNotifyId, 'aborted', { message: t('notifications.aborted') })
    maintainBusy.value = false
    return
  }
  if (p.done === true) {
    const s = p.stats || {}
    const parts = []
    if (s.count) parts.push(t('ocrSearch.statsCount', { n: s.count }))
    if (s.removed) parts.push(t('ocrSearch.statsRemoved', { n: s.removed }))
    if (s.failed) parts.push(t('ocrSearch.statsFailed', { n: s.failed }))
    notificationsStore.finish(ocrNotifyId, 'done', {
      message: parts.length ? parts.join(t('common.separator')) : t('ocrSearch.indexDone')
    })
    maintainBusy.value = false
    refreshStatus()
    return
  }
  if (p.phase === 'ocr') {
    notificationsStore.update(ocrNotifyId, {
      message: t('ocrSearch.recognizing', { done: p.done, total: p.total, current: p.current || '' })
    })
    if (p.total) {
      notificationsStore.updateProgress(ocrNotifyId, Math.round((p.done / p.total) * 100))
    }
  }
}

onMounted(async () => {
  enabled.value = (await window.api.getSetting('ocrEnabled', 'false')) === 'true'
  await loadMaintainRoots()
  await refreshStatus()

  offSettingsChanged = window.api.onSettingsChanged(({ key, value }) => {
    if (key === 'ocrEnabled') enabled.value = value === 'true'
  })
  offOcrProgress = window.api.onOcrProgress(onOcrProgress)
  offAddonProgress = window.api.onOcrAddonProgress(onAddonProgress)
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
  offOcrProgress?.()
  offAddonProgress?.()
})

async function saveEnabled(v) {
  try {
    await window.api.setSetting('ocrEnabled', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.ocrSearch') }}</h2>
    <p class="page-desc">{{ t('ocrSearch.pageDesc') }}</p>

    <el-card class="ocr-card" shadow="never">
      <div class="master-row">
        <div class="master-label">
          <div class="master-name">{{ t('ocrSearch.enableMaster') }}</div>
          <div class="master-desc">{{ t('ocrSearch.masterDesc') }}</div>
        </div>
        <el-switch v-model="enabled" @change="saveEnabled" />
      </div>
    </el-card>

    <!-- 运行时组件管理（onnxruntime + sharp，按需下载） -->
    <el-card class="ocr-card" shadow="never">
      <template #header>
        <div class="maintain-head">
          <span>{{ t('ocrSearch.runtimeTitle') }}</span>
          <el-tag v-if="addon.installed" size="small" type="success" effect="plain">
            {{ t('ocrSearch.runtimeInstalledTag') }}
          </el-tag>
          <el-tag v-else-if="!addon.supported" size="small" type="info" effect="plain">
            {{ t('ocrSearch.runtimeUnsupportedTag') }}
          </el-tag>
          <el-tag v-else size="small" type="warning" effect="plain">
            {{ t('ocrSearch.runtimeMissingTag') }}
          </el-tag>
        </div>
      </template>
      <p class="maintain-desc">{{ t('ocrSearch.runtimeDesc') }}</p>

      <div class="addon-status">
        <span class="addon-status-text">
          <template v-if="addon.installed">
            {{ t('ocrSearch.runtimeInstalledInfo', { size: formatBytes(addon.sizeBytes) }) }}
          </template>
          <template v-else-if="!addon.supported">
            {{ t('ocrSearch.runtimeUnsupported', { platform: addon.platform }) }}
          </template>
          <template v-else>{{ t('ocrSearch.notInstalled') }}</template>
        </span>
      </div>

      <el-progress
        v-if="addonBusy"
        :percentage="addonProgress"
        :indeterminate="addonPhase === 'extract' || addonPhase === 'apply'"
        :status="addonPhase === 'error' ? 'exception' : undefined"
        class="addon-progress"
      />
      <p v-if="addonBusy" class="addon-phase">{{ phaseText }}</p>

      <div class="maintain-row addon-actions">
        <el-button
          v-if="!addon.installed"
          type="primary"
          plain
          :icon="Download"
          :loading="addonBusy"
          :disabled="!addon.supported || addonBusy"
          @click="downloadAddon"
        >
          {{ t('ocrSearch.runtimeDownload') }}
        </el-button>
        <el-button
          v-if="!addon.installed"
          plain
          :icon="FolderOpened"
          :disabled="!addon.supported || addonBusy"
          @click="importAddon"
        >
          {{ t('ocrSearch.runtimeImport') }}
        </el-button>
        <el-button
          v-if="addon.installed"
          type="danger"
          plain
          :icon="Delete"
          :loading="addonBusy"
          :disabled="addonBusy"
          @click="removeAddon"
        >
          {{ t('ocrSearch.runtimeRemove') }}
        </el-button>
      </div>
    </el-card>

    <!-- 文字索引维护工具 -->
    <el-card class="ocr-card" shadow="never">
      <template #header>
        <div class="maintain-head">
          <span>{{ t('ocrSearch.maintainTools') }}</span>
          <el-tag v-if="maintainBusy" size="small" type="primary" effect="plain">
            {{ t('ocrSearch.taskRunning') }}
          </el-tag>
        </div>
      </template>
      <p class="maintain-desc">{{ t('ocrSearch.maintainDesc') }}</p>

      <div class="maintain-row maintain-dir-row">
        <div class="maintain-dir-label">
          <div class="maintain-dir-name">{{ t('ocrSearch.maintainDir') }}</div>
          <div class="maintain-dir-desc">{{ t('ocrSearch.maintainDirDesc') }}</div>
        </div>
        <el-select
          v-model="maintainRootId"
          class="maintain-select"
          :placeholder="t('ocrSearch.selectMaintainRoot')"
          clearable
          :disabled="!available || maintainBusy"
        >
          <el-option
            v-for="root in maintainRoots"
            :key="root.id"
            :value="root.id"
            :label="displayName(root)"
          >
            <el-tooltip :content="root.path" placement="left" :show-after="300">
              <span>{{ displayName(root) }}</span>
            </el-tooltip>
          </el-option>
        </el-select>
      </div>

      <div class="maintain-row">
        <template v-for="item in OCR_MAINTAIN_ACTIONS" :key="item.mode">
          <el-button
            :type="buttonType(item.mode)"
            plain
            :disabled="!available || maintainBusy || maintainRootId == null"
            @click="maintainIndex(item.mode)"
          >
            {{ item.label }}
          </el-button>
        </template>
      </div>
    </el-card>

    <el-alert type="info" :closable="false" class="tip">
      <p>{{ t('ocrSearch.usageTip') }}</p>
    </el-alert>
  </div>
</template>

<style scoped>
.page h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.page-desc {
  color: #999;
  font-size: 13px;
  margin-bottom: 24px;
}

.ocr-card {
  max-width: 720px;
  margin-bottom: 24px;
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
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.tip {
  max-width: 720px;
}

.addon-status {
  margin-bottom: 12px;
  font-size: 13px;
}

.addon-status-text {
  color: var(--el-text-color-regular);
}

.addon-progress {
  margin: 8px 0 4px;
  max-width: 420px;
}

.addon-phase {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.addon-actions {
  margin-bottom: 10px;
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

.maintain-dir-row {
  margin-bottom: 14px;
}

.maintain-dir-label {
  min-width: 0;
  flex: 1;
}

.maintain-dir-name {
  font-size: 13px;
  font-weight: 600;
}

.maintain-dir-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.maintain-select {
  width: 280px;
  flex-shrink: 0;
}
</style>
