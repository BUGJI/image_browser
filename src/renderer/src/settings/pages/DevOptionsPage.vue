<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSetting } from '../../utils/settings'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'

const { t } = useI18n()

// 开发者选项总开关（关闭时下方所有项目禁用）
const devOptions = useSetting('devOptions', {
  message: (v) => (v ? t('devOptions.enabled') : t('devOptions.disabled')),
  messageType: (v) => (v ? 'success' : 'info')
})
const disabled = computed(() => !devOptions.value)

// 设置 - 测试 栏目显隐（默认隐藏）
const showTest = useSetting('showTest', { silent: true })
// 显示隐藏功能（默认关闭）：开启后显示 AI 搜索等隐藏栏目
const showHidden = useSetting('showHidden')

// 灯箱缩放限制
const lightboxZoomMin = useSetting('lightboxZoomMin', {
  message: t('devOptions.lightZoomSaved')
})
const lightboxZoomMax = useSetting('lightboxZoomMax', {
  message: t('devOptions.lightZoomSaved')
})
const lightboxZoomStep = useSetting('lightboxZoomStep', {
  message: t('devOptions.lightZoomSaved')
})

// 记录日志开关：写回设置的同时联动主进程日志开关
const loggingEnabled = useSetting('loggingEnabled', {
  onSaved: async (v) => {
    try {
      await window.api.loggingSet(v)
    } catch {
      /* 忽略：设置已保存 */
    }
    ElMessage.success(v ? t('devOptions.loggingOn') : t('devOptions.loggingOff'))
  }
})

// 每次点击：关闭再重新打开 DevTools
async function onRestartDevtools() {
  try {
    await window.api.restartDevtools()
    ElMessage.success(t('devOptions.devtoolsReopened'))
  } catch {
    ElMessage.error(t('common.operationFailed'))
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.devOptions') }}</h2>
    <p class="page-desc">{{ t('devOptions.pageDesc') }}</p>

    <SettingCard>
      <SettingRow :name="t('devOptions.enableMaster')" :desc="t('devOptions.masterDesc')">
        <el-switch v-model="devOptions" />
      </SettingRow>
    </SettingCard>

    <SettingCard :title="t('devOptions.tools')">
      <SettingRow :name="t('devOptions.devtools')" :desc="t('devOptions.devtoolsDesc')">
        <el-button :disabled="disabled" type="primary" plain @click="onRestartDevtools">
          {{ t('devOptions.reopen') }}
        </el-button>
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('devOptions.showTest')" :desc="t('devOptions.showTestDesc')">
        <el-switch v-model="showTest" :disabled="disabled" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('devOptions.showHidden')" :desc="t('devOptions.showHiddenDesc')">
        <el-switch v-model="showHidden" :disabled="disabled" />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('devOptions.logging')" :desc="t('devOptions.loggingDesc')">
        <el-switch v-model="loggingEnabled" :disabled="disabled" />
      </SettingRow>
    </SettingCard>

    <SettingCard
      :title="t('devOptions.lightZoomTitle')"
      :desc="t('devOptions.lightZoomDesc')"
      :reset-keys="['lightboxZoomMin', 'lightboxZoomMax', 'lightboxZoomStep']"
      :reset-disabled="disabled"
    >
      <SettingRow :name="t('devOptions.lightZoomMin')" :desc="t('devOptions.lightZoomMinDesc')">
        <el-input-number
          v-model="lightboxZoomMin"
          :min="0.1"
          :max="100"
          :step="0.1"
          :precision="1"
          :disabled="disabled"
          size="default"
        />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('devOptions.lightZoomMax')" :desc="t('devOptions.lightZoomMaxDesc')">
        <el-input-number
          v-model="lightboxZoomMax"
          :min="0.1"
          :max="100"
          :step="1"
          :precision="1"
          :disabled="disabled"
          size="default"
        />
      </SettingRow>

      <el-divider />

      <SettingRow :name="t('devOptions.lightZoomStep')" :desc="t('devOptions.lightZoomStepDesc')">
        <el-input-number
          v-model="lightboxZoomStep"
          :min="1.01"
          :max="2"
          :step="0.05"
          :precision="2"
          :disabled="disabled"
          size="default"
        />
      </SettingRow>
    </SettingCard>
  </div>
</template>
