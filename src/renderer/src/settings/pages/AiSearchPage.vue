<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Connection } from '@element-plus/icons-vue'
import { useNotificationsStore } from '../../stores/notifications'

const { t } = useI18n()

// AI 搜索（OpenAI 兼容接口）
const enabled = ref(false)
const baseUrl = ref('')
const apiKey = ref('')
const model = ref('')
const visionModel = ref('')
const topK = ref(20)

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_VISION_MODEL = 'gpt-4o-mini'
const DEFAULT_TOP_K = 20
const TOP_K_MIN = 1
const TOP_K_MAX = 100

let offSettingsChanged = null

// 主开关关闭时，接口配置项不可操作
const configDisabled = computed(() => !enabled.value)

// 测试连接
const testingConn = ref(false)

async function testConnection() {
  testingConn.value = true
  try {
    const r = await window.api.aiTestConnection()
    if (r?.ok) {
      ElMessage.success(r.message || t('aiSearch.testOk'))
    } else {
      ElMessage.error(r?.message || t('aiSearch.testFailed'))
    }
  } catch (e) {
    ElMessage.error(String(e?.message || e))
  } finally {
    testingConn.value = false
  }
}

// 向量索引维护工具
const maintainBusy = ref(false)
const maintainRootId = ref(null)
const maintainRoots = ref([])
const AI_MAINTAIN_ACTIONS = computed(() => [
  { label: t('aiSearch.updateIndex'), mode: 'update' },
  { label: t('aiSearch.rebuildIndex'), mode: 'rebuild' },
  { label: t('aiSearch.cleanIndex'), mode: 'clean' }
])

const notificationsStore = useNotificationsStore()
let offAiProgress = null
let aiNotifyId = null
let aiRootId = null

function buttonType(mode) {
  if (mode === 'update') return 'primary'
  if (mode === 'rebuild') return 'warning'
  return 'danger'
}

function displayName(root) {
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = root.path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root.path
}

async function loadMaintainRoots() {
  maintainRoots.value = await window.api.rootsList()
}

// 维护操作：接真实向量索引引擎 + 进度通知
function maintainIndex(mode) {
  const item = AI_MAINTAIN_ACTIONS.value.find((m) => m.mode === mode)
  const root = maintainRoots.value.find((r) => r.id === maintainRootId.value)
  if (!root) {
    ElMessage.warning(t('aiSearch.selectRootFirst'))
    return
  }
  if (!enabled.value) {
    ElMessage.warning(t('aiSearch.enableMasterFirst'))
    return
  }

  maintainBusy.value = true
  aiRootId = root.id
  aiNotifyId = notificationsStore.add({
    type: 'progress',
    title: `${item.label} · ${displayName(root)}`,
    message: t('common.preparing'),
    cancellable: true,
    onCancel: () => window.api.aiAbort()
  })

  window.api.aiIndex(root.id, mode).catch((err) => {
    if (aiNotifyId) {
      notificationsStore.finish(aiNotifyId, 'aborted', {
        message: t('aiSearch.startFailed', { error: String(err?.message || err) })
      })
    }
    maintainBusy.value = false
  })
}

function onAiProgress(p) {
  if (p.rootId !== aiRootId) return
  if (!aiNotifyId) return

  const finished = p.done === true

  if (p.error) {
    notificationsStore.finish(aiNotifyId, 'aborted', { message: p.error })
    maintainBusy.value = false
    return
  }
  if (p.aborted) {
    notificationsStore.finish(aiNotifyId, 'aborted', { message: t('notifications.aborted') })
    maintainBusy.value = false
    return
  }
  if (finished) {
    const s = p.stats || {}
    const parts = []
    if (s.embedded) parts.push(t('aiSearch.statsEmbedded', { n: s.embedded }))
    if (s.removed) parts.push(t('aiSearch.statsRemoved', { n: s.removed }))
    if (s.failed) parts.push(t('aiSearch.statsFailed', { n: s.failed }))
    notificationsStore.finish(aiNotifyId, 'done', {
      message: parts.length ? parts.join(t('common.separator')) : t('aiSearch.indexDone')
    })
    maintainBusy.value = false
    return
  }
  if (p.phase === 'embed') {
    notificationsStore.updateProgress(aiNotifyId, p.total ? Math.round((p.done / p.total) * 100) : 0)
    notificationsStore.update(aiNotifyId, {
      message: t('aiSearch.embedding', { done: p.done, total: p.total, current: p.current || '' })
    })
  }
}

onMounted(async () => {
  enabled.value = (await window.api.getSetting('aiSearchEnabled', 'false')) === 'true'
  baseUrl.value = (await window.api.getSetting('aiBaseUrl', '')) || DEFAULT_BASE_URL
  apiKey.value = await window.api.getSetting('aiApiKey', '')
  model.value = (await window.api.getSetting('aiModel', '')) || DEFAULT_MODEL
  visionModel.value = (await window.api.getSetting('aiVisionModel', '')) || DEFAULT_VISION_MODEL
  const tk = Number(await window.api.getSetting('aiTopK', String(DEFAULT_TOP_K)))
  topK.value = Number.isFinite(tk) ? tk : DEFAULT_TOP_K
  await loadMaintainRoots()

  // 主窗口或本窗口可能修改这些设置，保持同步
  offSettingsChanged = window.api.onSettingsChanged(({ key, value }) => {
    if (key === 'aiSearchEnabled') enabled.value = value === 'true'
    else if (key === 'aiBaseUrl') baseUrl.value = value || DEFAULT_BASE_URL
    else if (key === 'aiApiKey') apiKey.value = value
    else if (key === 'aiModel') model.value = value || DEFAULT_MODEL
    else if (key === 'aiVisionModel') visionModel.value = value || DEFAULT_VISION_MODEL
    else if (key === 'aiTopK') {
      const n = Number(value)
      if (Number.isFinite(n)) topK.value = n
    }
  })

  offAiProgress = window.api.onAiProgress(onAiProgress)
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
  offAiProgress?.()
})

async function onEnabledChange(v) {
  try {
    await window.api.setSetting('aiSearchEnabled', v ? 'true' : 'false')
    ElMessage.success(v ? t('aiSearch.enabled') : t('aiSearch.disabled'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function saveSetting(key, raw, fallback) {
  const v = (raw || '').trim() || fallback
  try {
    await window.api.setSetting(key, v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

function onBaseUrlChange() {
  baseUrl.value = (baseUrl.value || '').trim() || DEFAULT_BASE_URL
  saveSetting('aiBaseUrl', baseUrl.value, DEFAULT_BASE_URL)
}

function onApiKeyChange() {
  saveSetting('aiApiKey', apiKey.value, '')
}

function onModelChange() {
  model.value = (model.value || '').trim() || DEFAULT_MODEL
  saveSetting('aiModel', model.value, DEFAULT_MODEL)
}

function onVisionModelChange() {
  visionModel.value = (visionModel.value || '').trim() || DEFAULT_VISION_MODEL
  saveSetting('aiVisionModel', visionModel.value, DEFAULT_VISION_MODEL)
}

function onTopKChange() {
  const n = Math.round(Number(topK.value))
  const v = Number.isFinite(n) ? Math.min(TOP_K_MAX, Math.max(TOP_K_MIN, n)) : DEFAULT_TOP_K
  topK.value = v
  saveSetting('aiTopK', String(v), String(DEFAULT_TOP_K))
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.aiSearch') }}</h2>
    <p class="page-desc">{{ t('aiSearch.pageDesc') }}</p>

    <el-alert type="warning" :closable="false" class="tip">
      <p>{{ t('aiSearch.wip') }}</p>
    </el-alert>

    <el-card class="ai-card" shadow="never">
      <div class="master-row">
        <div class="master-label">
          <div class="master-name">{{ t('aiSearch.enableMaster') }}</div>
          <div class="master-desc">{{ t('aiSearch.masterDesc') }}</div>
        </div>
        <el-switch v-model="enabled" @change="onEnabledChange" />
      </div>
    </el-card>

    <el-card class="ai-card" shadow="never">
      <template #header>
        <div class="endpoint-head">
          <span>{{ t('aiSearch.endpoint') }}</span>
          <el-button
            size="small"
            :icon="Connection"
            :loading="testingConn"
            @click="testConnection"
          >
            {{ t('aiSearch.testConnection') }}
          </el-button>
        </div>
      </template>

      <div class="ai-row">
        <div class="ai-label">
          <div class="ai-name">{{ t('aiSearch.baseUrl') }}</div>
          <div class="ai-desc">{{ t('aiSearch.baseUrlDesc') }}</div>
        </div>
        <el-input
          v-model="baseUrl"
          :disabled="configDisabled"
          :placeholder="DEFAULT_BASE_URL"
          clearable
          class="ai-input"
          @change="onBaseUrlChange"
        />
      </div>

      <el-divider />

      <div class="ai-row">
        <div class="ai-label">
          <div class="ai-name">{{ t('aiSearch.apiKey') }}</div>
          <div class="ai-desc">{{ t('aiSearch.apiKeyDesc') }}</div>
        </div>
        <el-input
          v-model="apiKey"
          :disabled="configDisabled"
          type="password"
          show-password
          clearable
          class="ai-input"
          @change="onApiKeyChange"
        />
      </div>

      <el-divider />

      <div class="ai-row">
        <div class="ai-label">
          <div class="ai-name">{{ t('aiSearch.model') }}</div>
          <div class="ai-desc">{{ t('aiSearch.modelDesc') }}</div>
        </div>
        <el-input
          v-model="model"
          :disabled="configDisabled"
          :placeholder="DEFAULT_MODEL"
          clearable
          class="ai-input"
          @change="onModelChange"
        />
      </div>

      <el-divider />

      <div class="ai-row">
        <div class="ai-label">
          <div class="ai-name">{{ t('aiSearch.visionModel') }}</div>
          <div class="ai-desc">{{ t('aiSearch.visionModelDesc') }}</div>
        </div>
        <el-input
          v-model="visionModel"
          :disabled="configDisabled"
          :placeholder="DEFAULT_VISION_MODEL"
          clearable
          class="ai-input"
          @change="onVisionModelChange"
        />
      </div>

      <el-divider />

      <div class="ai-row">
        <div class="ai-label">
          <div class="ai-name">{{ t('aiSearch.resultCount') }}</div>
          <div class="ai-desc">{{ t('aiSearch.resultCountDesc', { min: TOP_K_MIN, max: TOP_K_MAX }) }}</div>
        </div>
        <el-input-number
          v-model="topK"
          :disabled="configDisabled"
          :min="TOP_K_MIN"
          :max="TOP_K_MAX"
          :step="1"
          class="ai-input"
          @change="onTopKChange"
        />
      </div>
    </el-card>

    <!-- 向量索引维护工具（同设置-根目录） -->
    <el-card class="ai-card" shadow="never">
      <template #header>
        <div class="maintain-head">
          <span>{{ t('aiSearch.maintainTools') }}</span>
          <el-tag v-if="maintainBusy" size="small" type="primary" effect="plain">
            {{ t('aiSearch.taskRunning') }}
          </el-tag>
        </div>
      </template>
      <p class="maintain-desc">{{ t('aiSearch.maintainDesc') }}</p>

      <div class="maintain-row maintain-dir-row">
        <div class="maintain-dir-label">
          <div class="maintain-dir-name">{{ t('aiSearch.maintainDir') }}</div>
          <div class="maintain-dir-desc">{{ t('aiSearch.maintainDirDesc') }}</div>
        </div>
        <el-select
          v-model="maintainRootId"
          class="maintain-select"
          :placeholder="t('aiSearch.selectMaintainRoot')"
          clearable
          :disabled="configDisabled || maintainBusy"
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
        <template v-for="item in AI_MAINTAIN_ACTIONS" :key="item.mode">
          <el-button
            :type="buttonType(item.mode)"
            plain
            :disabled="configDisabled || maintainBusy || maintainRootId == null"
            @click="maintainIndex(item.mode)"
          >
            {{ item.label }}
          </el-button>
        </template>
      </div>
    </el-card>

    <el-alert type="info" :closable="false" class="tip">
      <p>{{ t('aiSearch.usageTip') }}</p>
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

.ai-card {
  max-width: 640px;
  margin-bottom: 24px;
}

.master-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.wip-tip {
  margin-bottom: 14px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--el-color-warning-light-9, #fdf6ec);
  border: 1px solid var(--el-color-warning-light-7, #f5dab1);
  color: var(--el-color-warning-dark-2, #b88230);
  font-size: 12px;
  line-height: 1.5;
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

.ai-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.ai-label {
  min-width: 0;
}

.ai-name {
  font-size: 14px;
  font-weight: 600;
}

.ai-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ai-input {
  width: 260px;
  flex-shrink: 0;
}

.endpoint-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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

.tip {
  max-width: 640px;
}
</style>
