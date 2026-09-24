<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, FolderOpened, Delete } from '@element-plus/icons-vue'
import { useIndexMaintenance } from '../../utils/use-index-maintenance'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'
import MaintainTools from '../MaintainTools.vue'

const { t } = useI18n()

// OCR 图内文字搜索（PaddleOCR）
const enabled = useSetting('ocrEnabled')
// (@repeato/ocr 内置模型 + 运行时组件) 是否可用
const available = ref(false)
const running = ref(false)

// 运行时组件状态（onnxruntime + sharp，按需下载）
const addon = ref({
  installed: false,
  supported: true,
  platform: '',
  installing: false,
  sizeBytes: 0
})
const addonBusy = ref(false)
const addonPhase = ref('')
const addonProgress = ref(0)
let _addonLastReceived = 0

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

// 文字索引维护工具（通用流程见 utils/use-index-maintenance）
const { maintainBusy, maintainRootId, maintainRoots, maintainIndex } = useIndexMaintenance({
  actions: OCR_MAINTAIN_ACTIONS,
  api: {
    index: (rootId, mode) => window.api.ocrIndex(rootId, mode),
    abort: () => window.api.ocrAbort(),
    onProgress: (cb) => window.api.onOcrProgress(cb)
  },
  canRun: () => available.value,
  noRootWarn: t('ocrSearch.selectRootFirst'),
  disabledWarn: t('ocrSearch.runtimeRequired'),
  phase: 'ocr',
  phaseMessage: (p) =>
    t('ocrSearch.recognizing', { done: p.done, total: p.total, current: p.current || '' }),
  summary: (s) => {
    const parts = []
    if (s.count) parts.push(t('ocrSearch.statsCount', { n: s.count }))
    if (s.removed) parts.push(t('ocrSearch.statsRemoved', { n: s.removed }))
    if (s.failed) parts.push(t('ocrSearch.statsFailed', { n: s.failed }))
    return parts.length ? parts.join(t('common.separator')) : ''
  },
  doneMessage: t('ocrSearch.indexDone'),
  startFailed: (error) => t('ocrSearch.startFailed', { error }),
  onDone: () => refreshStatus()
})

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

// ---------------------------------------------------------------- 运行时组件管理

function onAddonProgress(p) {
  if (!p) return
  if (p.phase === 'download') {
    addonPhase.value = 'download'
    const total = Number(p.total) || 0
    if (total > 0) {
      addonProgress.value = Math.min(100, Math.round((p.received / total) * 100))
      _addonLastReceived = p.received
    } else if (p.received > 0) {
      // 无 content-length：用递增伪进度
      _addonLastReceived = p.received
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

onMounted(async () => {
  await refreshStatus()
  offAddonProgress = window.api.onOcrAddonProgress(onAddonProgress)
})

onBeforeUnmount(() => {
  offAddonProgress?.()
})
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.ocrSearch') }}</h2>
    <p class="page-desc">{{ t('ocrSearch.pageDesc') }}</p>

    <SettingCard>
      <SettingRow :name="t('ocrSearch.enableMaster')" :desc="t('ocrSearch.masterDesc')">
        <el-switch v-model="enabled" />
      </SettingRow>
    </SettingCard>

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
    <MaintainTools
      v-model="maintainRootId"
      :title="t('ocrSearch.maintainTools')"
      :desc="t('ocrSearch.maintainDesc')"
      :running-text="t('ocrSearch.taskRunning')"
      :roots="maintainRoots"
      :busy="maintainBusy"
      :modes="OCR_MAINTAIN_ACTIONS"
      :disabled="!available"
      :placeholder="t('ocrSearch.selectMaintainRoot')"
      :dir-name="t('ocrSearch.maintainDir')"
      :dir-desc="t('ocrSearch.maintainDirDesc')"
      @run="maintainIndex"
    />

    <el-alert type="info" :closable="false" class="tip">
      <p>{{ t('ocrSearch.usageTip') }}</p>
    </el-alert>
  </div>
</template>

<style scoped>
.ocr-card {
  margin-bottom: 24px;
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
</style>
