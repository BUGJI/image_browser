<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { LOCALES } from '../../i18n'
import { useLocaleStore } from '../../stores/locale'

const { t } = useI18n()
const localeStore = useLocaleStore()

const dbVersion = ref('')
const dataLocation = computed(() => t('general.dataLocation'))

// 关闭软件行为：ask = 每次询问；tray = 最小化到托盘；quit = 关闭软件
const closeAction = ref('ask')
const CLOSE_OPTIONS = computed(() => [
  { value: 'ask', label: t('general.closeAsk'), desc: t('general.closeAskDesc') },
  { value: 'tray', label: t('general.closeTray'), desc: t('general.closeTrayDesc') },
  { value: 'quit', label: t('general.closeQuit'), desc: t('general.closeQuitDesc') }
])

const selectedLocale = ref(localeStore.locale)

// 记忆窗口大小 / 每次启动检测更新 / 记忆缩放
const rememberWindowSize = ref(false)
const checkUpdateOnStartup = ref(false)
const rememberZoom = ref(false)

// 快速复制默认类型：file = 复制原文件；image = 复制图片
const quickCopyType = ref('file')
const QUICK_COPY_OPTIONS = computed(() => [
  { value: 'file', label: t('general.quickCopyFile'), desc: t('general.quickCopyFileDesc') },
  { value: 'image', label: t('general.quickCopyImage'), desc: t('general.quickCopyImageDesc') }
])

// 同步外部加载/修改的语言（主进程持久化值可能在挂载后才恢复）
watch(
  () => localeStore.locale,
  (v) => {
    selectedLocale.value = v
  }
)

onMounted(async () => {
  try {
    dbVersion.value = await window.api.getDbVersion()
  } catch {
    dbVersion.value = '-'
  }

  const saved = await window.api.getSetting('closeAction', 'ask')
  closeAction.value = ['ask', 'tray', 'quit'].includes(saved) ? saved : 'ask'
  selectedLocale.value = localeStore.locale
  rememberWindowSize.value = (await window.api.getSetting('rememberWindowSize', 'false')) === 'true'
  checkUpdateOnStartup.value =
    (await window.api.getSetting('checkUpdateOnStartup', 'false')) === 'true'
  rememberZoom.value = (await window.api.getSetting('rememberZoom', 'false')) === 'true'
  const qc = await window.api.getSetting('quickCopyType', 'file')
  quickCopyType.value = ['file', 'image'].includes(qc) ? qc : 'file'
})

async function onCloseActionChange(v) {
  try {
    await window.api.setSetting('closeAction', v)
    const opt = CLOSE_OPTIONS.value.find((o) => o.value === v)
    ElMessage.success(t('general.savedCloseAction', { action: opt?.label || v }))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onLocaleChange(v) {
  try {
    await localeStore.setLocale(v)
    selectedLocale.value = v
    ElMessage.success(t('general.savedLanguage'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onRememberWindowSizeChange(v) {
  try {
    await window.api.setSetting('rememberWindowSize', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onCheckUpdateOnStartupChange(v) {
  try {
    await window.api.setSetting('checkUpdateOnStartup', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onRememberZoomChange(v) {
  try {
    await window.api.setSetting('rememberZoom', v ? 'true' : 'false')
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}

async function onQuickCopyTypeChange(v) {
  try {
    await window.api.setSetting('quickCopyType', v)
    const opt = QUICK_COPY_OPTIONS.value.find((o) => o.value === v)
    ElMessage.success(t('general.savedQuickCopyType', { type: opt?.label || v }))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.general') }}</h2>
    <p class="page-desc">{{ t('general.pageDesc') }}</p>

    <el-card class="behavior-card" shadow="never">
      <template #header>{{ t('general.closeBehavior') }}</template>
      <div class="behavior-row">
        <div class="behavior-label">
          <div class="behavior-name">{{ t('general.onClose') }}</div>
          <div class="behavior-desc">{{ t('general.onCloseDesc') }}</div>
        </div>
        <el-select v-model="closeAction" class="behavior-select" @change="onCloseActionChange">
          <el-option v-for="o in CLOSE_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
        </el-select>
      </div>
      <p class="behavior-tip">{{ CLOSE_OPTIONS.find((o) => o.value === closeAction)?.desc }}</p>
    </el-card>

    <el-card class="behavior-card" shadow="never">
      <template #header>{{ t('settings.language') }}</template>
      <div class="behavior-row">
        <div class="behavior-label">
          <div class="behavior-name">{{ t('settings.language') }}</div>
          <div class="behavior-desc">{{ t('general.languageDesc') }}</div>
        </div>
        <el-select v-model="selectedLocale" class="behavior-select" @change="onLocaleChange">
          <el-option v-for="l in LOCALES" :key="l.value" :value="l.value" :label="l.label" />
        </el-select>
      </div>
    </el-card>

    <el-card class="behavior-card" shadow="never">
      <template #header>{{ t('general.quickCopy') }}</template>
      <div class="behavior-row">
        <div class="behavior-label">
          <div class="behavior-name">{{ t('general.quickCopyDefault') }}</div>
          <div class="behavior-desc">{{ t('general.quickCopyDefaultDesc') }}</div>
        </div>
        <el-select v-model="quickCopyType" class="behavior-select" @change="onQuickCopyTypeChange">
          <el-option
            v-for="o in QUICK_COPY_OPTIONS"
            :key="o.value"
            :value="o.value"
            :label="o.label"
          />
        </el-select>
      </div>
      <p class="behavior-tip">
        {{ QUICK_COPY_OPTIONS.find((o) => o.value === quickCopyType)?.desc }}
      </p>
    </el-card>

    <el-card class="behavior-card" shadow="never">
      <template #header>{{ t('general.startupWindow') }}</template>
      <div class="behavior-row">
        <div class="behavior-label">
          <div class="behavior-name">{{ t('general.rememberWindowSize') }}</div>
          <div class="behavior-desc">{{ t('general.rememberWindowSizeDesc') }}</div>
        </div>
        <el-switch v-model="rememberWindowSize" @change="onRememberWindowSizeChange" />
      </div>

      <el-divider class="row-divider" />

      <div class="behavior-row">
        <div class="behavior-label">
          <div class="behavior-name">{{ t('general.checkUpdateOnStartup') }}</div>
          <div class="behavior-desc">{{ t('general.checkUpdateOnStartupDesc') }}</div>
        </div>
        <el-switch v-model="checkUpdateOnStartup" @change="onCheckUpdateOnStartupChange" />
      </div>

      <el-divider class="row-divider" />

      <div class="behavior-row">
        <div class="behavior-label">
          <div class="behavior-name">{{ t('general.rememberZoom') }}</div>
          <div class="behavior-desc">{{ t('general.rememberZoomDesc') }}</div>
        </div>
        <el-switch v-model="rememberZoom" @change="onRememberZoomChange" />
      </div>
    </el-card>

    <el-descriptions :column="1" border class="info-table">
      <el-descriptions-item :label="t('general.appNameLabel')">Image Browser</el-descriptions-item>
      <el-descriptions-item :label="t('general.sqliteVersion')">{{
        dbVersion || t('common.loading')
      }}</el-descriptions-item>
      <el-descriptions-item :label="t('general.dataLocationLabel')">{{
        dataLocation
      }}</el-descriptions-item>
    </el-descriptions>

    <el-alert type="info" :closable="false" class="tip">
      <p>{{ t('general.moreTip') }}</p>
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

.behavior-card {
  max-width: 720px;
  margin-bottom: 24px;
}

.behavior-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.behavior-label {
  min-width: 0;
}

.behavior-name {
  font-size: 14px;
  font-weight: 600;
}

.behavior-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.behavior-select {
  width: 180px;
  flex-shrink: 0;
}

.behavior-tip {
  margin: 12px 0 0;
  font-size: 12px;
  color: #909399;
}

.row-divider {
  margin: 14px 0;
}

.info-table {
  max-width: 720px;
  margin-bottom: 24px;
}

.tip {
  max-width: 720px;
}
</style>
