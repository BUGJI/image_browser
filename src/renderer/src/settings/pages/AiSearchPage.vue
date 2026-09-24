<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Connection } from '@element-plus/icons-vue'
import { useIndexMaintenance } from '../../utils/use-index-maintenance'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'
import MaintainTools from '../MaintainTools.vue'

const { t } = useI18n()

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_VISION_MODEL = 'gpt-4o-mini'
const DEFAULT_TOP_K = 20
const TOP_K_MIN = 1
const TOP_K_MAX = 100

// AI 搜索（OpenAI 兼容接口）。注意：功能尚在开发，总开关始终为关闭态。
const enabled = ref(false)
const baseUrl = useSetting('aiBaseUrl', {
  default: DEFAULT_BASE_URL,
  normalize: (v) => String(v ?? '').trim() || DEFAULT_BASE_URL
})
const apiKey = useSetting('aiApiKey', { default: '' })
const model = useSetting('aiModel', {
  default: DEFAULT_MODEL,
  normalize: (v) => String(v ?? '').trim() || DEFAULT_MODEL
})
const visionModel = useSetting('aiVisionModel', {
  default: DEFAULT_VISION_MODEL,
  normalize: (v) => String(v ?? '').trim() || DEFAULT_VISION_MODEL
})
const topK = useSetting('aiTopK', {
  default: DEFAULT_TOP_K,
  min: TOP_K_MIN,
  max: TOP_K_MAX,
  precision: 0
})

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

// 向量索引维护工具（通用流程见 utils/use-index-maintenance）
const AI_MAINTAIN_ACTIONS = computed(() => [
  { label: t('aiSearch.updateIndex'), mode: 'update' },
  { label: t('aiSearch.rebuildIndex'), mode: 'rebuild' },
  { label: t('aiSearch.cleanIndex'), mode: 'clean' }
])

const { maintainBusy, maintainRootId, maintainRoots, maintainIndex } = useIndexMaintenance({
  actions: AI_MAINTAIN_ACTIONS,
  api: {
    index: (rootId, mode) => window.api.aiIndex(rootId, mode),
    abort: () => window.api.aiAbort(),
    onProgress: (cb) => window.api.onAiProgress(cb)
  },
  canRun: () => enabled.value,
  noRootWarn: t('aiSearch.selectRootFirst'),
  disabledWarn: t('aiSearch.enableMasterFirst'),
  phase: 'embed',
  phaseMessage: (p) =>
    t('aiSearch.embedding', { done: p.done, total: p.total, current: p.current || '' }),
  summary: (s) => {
    const parts = []
    if (s.embedded) parts.push(t('aiSearch.statsEmbedded', { n: s.embedded }))
    if (s.removed) parts.push(t('aiSearch.statsRemoved', { n: s.removed }))
    if (s.failed) parts.push(t('aiSearch.statsFailed', { n: s.failed }))
    return parts.length ? parts.join(t('common.separator')) : ''
  },
  doneMessage: t('aiSearch.indexDone'),
  startFailed: (error) => t('aiSearch.startFailed', { error })
})
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.aiSearch') }}</h2>
    <p class="page-desc">{{ t('aiSearch.pageDesc') }}</p>

    <el-alert type="warning" :closable="false" class="tip">
      <p>{{ t('aiSearch.wip') }}</p>
    </el-alert>

    <SettingCard>
      <SettingRow :name="t('aiSearch.enableMaster')" :desc="t('aiSearch.masterDesc')">
        <el-switch v-model="enabled" disabled />
      </SettingRow>
    </SettingCard>

    <SettingCard
      :title="t('aiSearch.endpoint')"
      :reset-keys="['aiBaseUrl', 'aiApiKey', 'aiModel', 'aiVisionModel', 'aiTopK']"
    >
      <template #header>
        <el-button size="small" :icon="Connection" :loading="testingConn" @click="testConnection">
          {{ t('aiSearch.testConnection') }}
        </el-button>
      </template>

      <SettingRow :name="t('aiSearch.baseUrl')" :desc="t('aiSearch.baseUrlDesc')">
        <el-input
          v-model="baseUrl"
          :disabled="configDisabled"
          :placeholder="DEFAULT_BASE_URL"
          clearable
          class="ai-input"
        />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('aiSearch.apiKey')" :desc="t('aiSearch.apiKeyDesc')">
        <el-input
          v-model="apiKey"
          :disabled="configDisabled"
          type="password"
          show-password
          clearable
          class="ai-input"
        />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('aiSearch.model')" :desc="t('aiSearch.modelDesc')">
        <el-input
          v-model="model"
          :disabled="configDisabled"
          :placeholder="DEFAULT_MODEL"
          clearable
          class="ai-input"
        />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('aiSearch.visionModel')" :desc="t('aiSearch.visionModelDesc')">
        <el-input
          v-model="visionModel"
          :disabled="configDisabled"
          :placeholder="DEFAULT_VISION_MODEL"
          clearable
          class="ai-input"
        />
      </SettingRow>

      <el-divider />

      <SettingRow
        :name="t('aiSearch.resultCount')"
        :desc="t('aiSearch.resultCountDesc', { min: TOP_K_MIN, max: TOP_K_MAX })"
      >
        <el-input-number
          v-model="topK"
          :disabled="configDisabled"
          :min="TOP_K_MIN"
          :max="TOP_K_MAX"
          :step="1"
        />
      </SettingRow>
    </SettingCard>

    <!-- 向量索引维护工具（同设置-根目录） -->
    <MaintainTools
      v-model="maintainRootId"
      :title="t('aiSearch.maintainTools')"
      :desc="t('aiSearch.maintainDesc')"
      :running-text="t('aiSearch.taskRunning')"
      :roots="maintainRoots"
      :busy="maintainBusy"
      :modes="AI_MAINTAIN_ACTIONS"
      :disabled="configDisabled"
      :placeholder="t('aiSearch.selectMaintainRoot')"
      :dir-name="t('aiSearch.maintainDir')"
      :dir-desc="t('aiSearch.maintainDirDesc')"
      @run="maintainIndex"
    />

    <el-alert type="info" :closable="false" class="tip">
      <p>{{ t('aiSearch.usageTip') }}</p>
    </el-alert>
  </div>
</template>

<style scoped>
.ai-input {
  width: 260px;
  flex-shrink: 0;
}
</style>
