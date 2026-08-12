<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Promotion } from '@element-plus/icons-vue'

const { t } = useI18n()

const info = ref({
  node: '-',
  chrome: '-',
  electron: '-'
})

const checking = ref(false)

onMounted(() => {
  info.value = window.api.versions
})

// 检测更新：目前为桩实现，主进程始终返回「已是最新」
async function onCheckUpdate() {
  checking.value = true
  try {
    const res = await window.api.checkUpdate()
    if (res?.hasUpdate) {
      ElMessage.success(t('about.foundUpdate', { version: res.latestVersion }))
    } else {
      ElMessage.info(t('about.upToDate', { version: res?.latestVersion }))
    }
  } catch (err) {
    ElMessage.error(t('about.checkFailed', { error: String(err?.message || err) }))
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.about') }}</h2>
    <p class="page-desc">{{ t('about.pageDesc') }}</p>

    <el-card class="update-card" shadow="never">
      <div class="update-row">
        <div class="update-label">
          <div class="update-name">{{ t('about.checkUpdate') }}</div>
          <div class="update-desc">{{ t('about.updateDesc') }}</div>
        </div>
        <el-button type="primary" :icon="Promotion" :loading="checking" @click="onCheckUpdate">
          {{ checking ? t('about.checking') : t('about.checkUpdate') }}
        </el-button>
      </div>
    </el-card>

    <el-descriptions :column="1" border class="info-table">
      <el-descriptions-item :label="t('about.version')">1.0.0</el-descriptions-item>
      <el-descriptions-item label="Electron">{{ info.electron }}</el-descriptions-item>
      <el-descriptions-item label="Chromium">{{ info.chrome }}</el-descriptions-item>
      <el-descriptions-item :label="t('about.node')">{{ info.node }}</el-descriptions-item>
      <el-descriptions-item :label="t('about.author')">BUGJI</el-descriptions-item>
      <el-descriptions-item :label="t('about.stack')">Electron · Vue 3 · Pinia · Element Plus · node:sqlite</el-descriptions-item>
    </el-descriptions>
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

.update-card {
  max-width: 560px;
  margin-bottom: 24px;
}

.update-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.update-name {
  font-size: 14px;
  font-weight: 600;
}

.update-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.info-table {
  max-width: 560px;
}
</style>
