<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingCard from '../SettingCard.vue'
import SettingRow from '../SettingRow.vue'

const { t } = useI18n()
const titlebarMode = ref('custom')

onMounted(async () => {
  titlebarMode.value = await window.api.getSetting('titlebar', 'custom')
})

async function saveTitlebar() {
  const before = await window.api.getSetting('titlebar', 'custom')
  await window.api.setSetting('titlebar', titlebarMode.value)

  if (before === titlebarMode.value) {
    ElMessage({ type: 'info', message: t('appearance.noChange') })
    return
  }

  // 顶栏样式属于窗口级设置，需重启生效
  try {
    await ElMessageBox.confirm(t('appearance.restartConfirm'), t('appearance.restartTitle'), {
      confirmButtonText: t('appearance.restartNow'),
      cancelButtonText: t('appearance.restartLater'),
      type: 'warning'
    })
    window.api.appRelaunch()
  } catch {
    ElMessage({ type: 'success', message: t('appearance.savedRestartLater') })
  }
}
</script>

<template>
  <div class="page">
    <h2>{{ t('settings.titlebar') }}</h2>
    <p class="page-desc">{{ t('appearance.pageDesc') }}</p>

    <SettingCard>
      <SettingRow :name="t('settings.titlebar')">
        <el-radio-group v-model="titlebarMode">
          <el-radio value="custom">{{ t('appearance.customTitlebar') }}</el-radio>
          <el-radio value="system">{{ t('appearance.systemTitlebar') }}</el-radio>
        </el-radio-group>
      </SettingRow>

      <div class="actions">
        <el-button type="primary" @click="saveTitlebar">{{ t('common.save') }}</el-button>
      </div>
    </SettingCard>

    <el-alert type="info" :closable="false" class="tip">
      <p>{{ t('appearance.tip') }}</p>
    </el-alert>
  </div>
</template>

<style scoped>
.actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
