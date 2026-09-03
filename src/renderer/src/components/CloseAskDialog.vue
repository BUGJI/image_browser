<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * 关闭询问框：主进程在「关闭行为 = 每次询问」时发送 window:ask-close，
 * 这里弹出对话框让用户选择「最小化到托盘 / 关闭软件」，可选记住选择。
 */

const { t } = useI18n()
const visible = ref(false)
const remember = ref(false)
let offAskClose = null

onMounted(() => {
  offAskClose = window.api.onAskClose(() => {
    remember.value = false
    visible.value = true
  })
})

onBeforeUnmount(() => {
  offAskClose?.()
})

function choose(action) {
  window.api.windowCloseResult({ action, remember: remember.value })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('closeAsk.title')"
    width="400px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    append-to-body
  >
    <div class="close-ask-body">
      <p class="close-ask-sub">{{ t('closeAsk.sub') }}</p>
      <el-checkbox v-model="remember" class="close-ask-remember">
        {{ t('closeAsk.remember') }}
      </el-checkbox>
    </div>
    <template #footer>
      <el-button @click="choose('tray')">{{ t('closeAsk.toTray') }}</el-button>
      <el-button type="danger" @click="choose('quit')">{{ t('closeAsk.quit') }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.close-ask-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.close-ask-sub {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.close-ask-remember {
  margin-top: 6px;
}
</style>
