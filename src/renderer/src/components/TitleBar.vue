<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

// 注意：模板里不能直接写 window.api（Vue 编译后 _ctx.window 为 undefined），
// 这里在 setup 里取一次引用再暴露给模板。
const api = window.api

const isMaximized = ref(false)
let offMaximized = null

onMounted(() => {
  offMaximized = api.onMaximizedChange((max) => {
    isMaximized.value = max
  })
})

onBeforeUnmount(() => {
  offMaximized?.()
})
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-brand">
      <span class="titlebar-logo">🖼️</span>
      <span class="titlebar-title">Image Browser</span>
    </div>

    <div class="titlebar-controls">
      <button
        class="tb-btn"
        :title="t('titlebar.minimize')"
        :aria-label="t('titlebar.minimize')"
        @click="api.windowMinimize()"
      >
        <el-icon><Minus /></el-icon>
      </button>
      <button
        class="tb-btn"
        :title="isMaximized ? t('titlebar.restore') : t('titlebar.maximize')"
        :aria-label="isMaximized ? t('titlebar.restore') : t('titlebar.maximize')"
        @click="api.windowToggleMaximize()"
      >
        <el-icon>
          <CopyDocument v-if="isMaximized" />
          <FullScreen v-else />
        </el-icon>
      </button>
      <button
        class="tb-btn tb-btn-close"
        :title="t('titlebar.close')"
        :aria-label="t('titlebar.close')"
        @click="api.windowClose()"
      >
        <el-icon><Close /></el-icon>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--panel-border);
  /* 整条顶栏可拖拽移动窗口；按钮区域需 no-drag */
  -webkit-app-region: drag;
  user-select: none;
}

.titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 14px;
}

.titlebar-logo {
  font-size: 16px;
}

.titlebar-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-secondary);
}

.titlebar-controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.tb-btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  cursor: pointer;
  font-size: 14px;
}

.tb-btn:hover {
  background: var(--panel-hover);
  color: var(--app-text);
}

.tb-btn-close:hover {
  background: #e81123;
  color: #fff;
}
</style>
