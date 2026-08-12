<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'

const { t } = useI18n()
// 主题启动方式：dark = 默认暗色；light = 默认亮色；last = 上次状态
const themeStartup = ref('last')

onMounted(async () => {
  const ts = await window.api.getSetting('themeStartup', 'last')
  themeStartup.value = ['dark', 'light', 'last'].includes(ts) ? ts : 'last'
})

async function onThemeStartupChange(v) {
  try {
    await window.api.setSetting('themeStartup', v)
    ElMessage.success(t('common.saved'))
  } catch {
    ElMessage.error(t('common.saveFailed'))
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.theme') }}</h2>
    <p class="page-desc">{{ t('theme.pageDesc') }}</p>

    <el-card class="theme-card" shadow="never">
      <template #header>{{ t('appearance.themeSetting') }}</template>
      <div class="theme-row">
        <div class="theme-label">
          <div class="theme-name">{{ t('appearance.themeSetting') }}</div>
          <div class="theme-desc">{{ t('appearance.themeSettingDesc') }}</div>
        </div>
        <el-radio-group v-model="themeStartup" @change="onThemeStartupChange">
          <el-radio value="dark">{{ t('appearance.themeDefaultDark') }}</el-radio>
          <el-radio value="light">{{ t('appearance.themeDefaultLight') }}</el-radio>
          <el-radio value="last">{{ t('appearance.themeLastState') }}</el-radio>
        </el-radio-group>
      </div>
    </el-card>
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

.theme-card {
  max-width: 640px;
}

.theme-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.theme-name {
  font-size: 14px;
  font-weight: 600;
}

.theme-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
