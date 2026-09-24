<script setup>
import { RefreshLeft } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { resetSettings } from '../utils/settings'

const props = defineProps({
  // 要恢复默认值的设置键列表
  keys: { type: Array, required: true },
  // 自定义确认文案（可选）
  confirm: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
})

const { t } = useI18n()

async function onReset() {
  try {
    await ElMessageBox.confirm(
      props.confirm || t('common.resetConfirm'),
      t('common.resetDefaults'),
      {
        confirmButtonText: t('common.resetDefaults'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
  } catch {
    return
  }
  await resetSettings(props.keys)
}
</script>

<template>
  <el-button link size="small" :icon="RefreshLeft" :disabled="disabled" @click="onReset">
    {{ t('common.resetDefaults') }}
  </el-button>
</template>
