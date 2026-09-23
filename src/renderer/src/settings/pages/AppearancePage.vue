<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

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
    await ElMessageBox.confirm(
      t('appearance.restartConfirm'),
      t('appearance.restartTitle'),
      {
        confirmButtonText: t('appearance.restartNow'),
        cancelButtonText: t('appearance.restartLater'),
        type: 'warning'
      }
    )
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

    <el-form label-width="120px" class="form">
      <el-form-item :label="t('settings.titlebar')">
        <el-radio-group v-model="titlebarMode">
          <el-radio value="custom">{{ t('appearance.customTitlebar') }}</el-radio>
          <el-radio value="system">{{ t('appearance.systemTitlebar') }}</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item>
        <el-button type="primary" @click="saveTitlebar">{{ t('common.save') }}</el-button>
      </el-form-item>
    </el-form>

    <el-alert type="info" :closable="false" class="tip">
      <p>{{ t('appearance.tip') }}</p>
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

.form {
  max-width: 720px;
}

.tip {
  max-width: 720px;
}
</style>
