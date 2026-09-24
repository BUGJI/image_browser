<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { Promotion } from '@element-plus/icons-vue'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'

const { t } = useI18n()

const info = ref({
  node: '-',
  chrome: '-',
  electron: '-'
})

const checking = ref(false)
const appVersion = ref('')

onMounted(async () => {
  info.value = window.api.versions
  try {
    appVersion.value = (await window.api.appVersion?.()) || ''
  } catch {
    /* 忽略 */
  }
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

    <SettingCard>
      <SettingRow :name="t('about.checkUpdate')" :desc="t('about.updateDesc')">
        <el-button type="primary" :icon="Promotion" :loading="checking" @click="onCheckUpdate">
          {{ checking ? t('about.checking') : t('about.checkUpdate') }}
        </el-button>
      </SettingRow>
    </SettingCard>

    <el-descriptions :column="1" border class="info-table">
      <el-descriptions-item :label="t('about.version')">{{
        appVersion || '-'
      }}</el-descriptions-item>
      <el-descriptions-item label="Electron">{{ info.electron }}</el-descriptions-item>
      <el-descriptions-item label="Chromium">{{ info.chrome }}</el-descriptions-item>
      <el-descriptions-item :label="t('about.node')">{{ info.node }}</el-descriptions-item>
      <el-descriptions-item :label="t('about.author')">BUGJI</el-descriptions-item>
      <el-descriptions-item :label="t('about.stack')"
        >Electron · Vue 3 · Pinia · Element Plus · node:sqlite</el-descriptions-item
      >
    </el-descriptions>
  </div>
</template>
