<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import NotificationPanel from './NotificationPanel.vue'
import { useThemeStore } from '../stores/theme'

/**
 * 悬浮工具栏：快速复制 + 搜索 + AI 开关 + 缩放 + 浏览模式 + 通知中心 + 主题切换。
 * 所有可变状态由 App 持有，这里通过 props 读、通过事件写回（双向用 update:*）。
 */
const props = defineProps({
  quickCopyEnabled: { type: Boolean, default: false },
  // 快速复制类型：file = 复制原文件；image = 复制图片
  quickCopyType: { type: String, default: 'file' },
  searchInput: { type: String, default: '' },
  // 无根目录时禁用搜索
  searchDisabled: { type: Boolean, default: false },
  aiSearchEnabled: { type: Boolean, default: false },
  aiSearchActive: { type: Boolean, default: false },
  aiSearchBusy: { type: Boolean, default: false },
  itemZoom: { type: Number, default: 1.5 },
  zoomMin: { type: Number, default: 0.5 },
  zoomMax: { type: Number, default: 2 },
  // 浏览模式：waterfall = 瀑布流；rect = 矩形
  browseMode: { type: String, default: 'waterfall' }
})

const emit = defineEmits([
  'toggle-quick-copy',
  'update:searchInput',
  'search',
  'clear-search',
  'update:aiSearchActive',
  'update:itemZoom',
  'save-zoom',
  'toggle-browse-mode'
])

const { t } = useI18n()
const themeStore = useThemeStore()

const quickCopyLabel = computed(() =>
  t(props.quickCopyType === 'file' ? 'lightbox.copyFileAction' : 'lightbox.copyImageAction')
)
const browseModeTip = computed(() =>
  t('app.browseModeTip', {
    mode: t(props.browseMode === 'rect' ? 'app.browseModeRect' : 'app.browseModeWaterfall')
  })
)
</script>

<template>
  <div class="floating-toolbar">
    <!-- 快速复制开关：开启后点击图片直接复制，不进灯箱 -->
    <el-tooltip
      :content="t('app.quickCopyTip', { type: quickCopyLabel })"
      placement="bottom"
      :show-after="150"
    >
      <div
        class="quick-copy-toggle"
        :class="{ 'quick-copy-on': quickCopyEnabled }"
        @click="emit('toggle-quick-copy')"
      >
        <span class="quick-copy-label">{{ t('app.quickCopy') }}</span>
        <el-switch :model-value="quickCopyEnabled" size="small" class="quick-copy-switch" />
      </div>
    </el-tooltip>

    <!-- 图片搜索（回车触发，支持 * ? 通配符） -->
    <div class="toolbar-search">
      <el-input
        :model-value="searchInput"
        :placeholder="t('app.searchImages')"
        :disabled="searchDisabled"
        clearable
        size="small"
        class="search-input"
        @update:model-value="emit('update:searchInput', $event)"
        @keyup.enter="emit('search')"
        @clear="emit('clear-search')"
      >
        <template #prefix>
          <el-icon :size="14"><Search /></el-icon>
        </template>
      </el-input>
    </div>

    <!-- AI 搜索开关（设置中启用后显示） -->
    <div v-if="aiSearchEnabled" class="ai-search-toggle">
      <el-icon v-if="aiSearchBusy" class="is-loading ai-search-loading" :size="14">
        <Loading />
      </el-icon>
      <el-switch
        :model-value="aiSearchActive"
        size="small"
        :aria-label="t('app.aiSearchToggle')"
        @update:model-value="emit('update:aiSearchActive', $event)"
      />
      <span class="ai-search-label">{{ t('app.aiSearchToggle') }}</span>
    </div>

    <div class="zoom-control">
      <el-tooltip :content="t('app.zoomTip')" placement="bottom" :show-after="200">
        <span class="zoom-icon"
          ><el-icon :size="14"><Picture /></el-icon
        ></span>
      </el-tooltip>
      <el-slider
        :model-value="itemZoom"
        :min="zoomMin"
        :max="zoomMax"
        :step="0.1"
        :show-tooltip="false"
        class="zoom-slider"
        @update:model-value="emit('update:itemZoom', $event)"
        @change="emit('save-zoom')"
      />
    </div>

    <!-- 浏览模式切换：瀑布流 / 矩形（矩形模式卡片等高、超出裁切） -->
    <el-tooltip :content="browseModeTip" placement="bottom" :show-after="200">
      <button
        class="toolbar-btn"
        :title="browseModeTip"
        :aria-label="browseModeTip"
        @click="emit('toggle-browse-mode')"
      >
        <el-icon :size="16">
          <Grid v-if="browseMode === 'rect'" />
          <Menu v-else />
        </el-icon>
      </button>
    </el-tooltip>

    <!-- 通知中心 -->
    <NotificationPanel />

    <!-- 主题切换 -->
    <el-tooltip :content="t('app.themeToggleTip')" placement="bottom" :show-after="200">
      <button
        class="toolbar-btn"
        :title="t('app.themeToggleTitle')"
        :aria-label="t('app.themeToggleTitle')"
        @click="themeStore.toggle()"
      >
        <el-icon :size="16">
          <Sunny v-if="themeStore.mode === 'light'" />
          <Moon v-else />
        </el-icon>
      </button>
    </el-tooltip>
  </div>
</template>

<style scoped>
/* 悬浮栏：绝对定位悬浮在内容右上角，不占文档流空间 */
.floating-toolbar {
  position: absolute;
  top: 12px;
  right: 0;
  z-index: 20;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 0 20px 0 0;
  pointer-events: none;
}

/* 搜索框 */
.toolbar-search {
  pointer-events: auto;
}

.search-input {
  width: 200px;
}

.search-input :deep(.el-input__wrapper) {
  border-radius: 10px;
  min-height: 36px;
  height: 36px;
  background: var(--panel-bg);
  box-shadow: 0 0 0 1px var(--panel-border) inset;
}

.search-input :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}

.search-input :deep(.el-input__inner) {
  font-size: 12px;
}

/* 快速复制开关 */
.quick-copy-toggle {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: var(--panel-bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  user-select: none;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.quick-copy-toggle:hover {
  border-color: var(--el-color-primary);
}

.quick-copy-on {
  border-color: var(--el-color-primary);
}

.quick-copy-label {
  font-size: 12px;
  color: var(--app-text-secondary);
  white-space: nowrap;
}

.quick-copy-on .quick-copy-label {
  color: var(--el-color-primary);
}

.quick-copy-toggle :deep(.el-switch) {
  pointer-events: none;
}

.quick-copy-toggle :deep(.el-switch__core) {
  min-width: 26px;
  height: 14px;
}

.quick-copy-toggle :deep(.el-switch__core .el-switch__action) {
  width: 10px;
  height: 10px;
}

/* AI 搜索开关 */
.ai-search-toggle {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: var(--panel-bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.ai-search-label {
  font-size: 12px;
  color: var(--app-text-secondary);
  white-space: nowrap;
}

.ai-search-loading {
  color: var(--el-color-primary);
}

/* 缩放控件 */
.zoom-control {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: var(--panel-bg);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.zoom-icon {
  display: flex;
  align-items: center;
  color: var(--app-text-secondary);
  flex-shrink: 0;
}

.zoom-slider {
  width: 120px;
  margin: 0;
}

/* 窄窗口：收紧工具栏（隐藏文字标签、收窄搜索/缩放），避免溢出到标题区 */
@media (max-width: 1000px) {
  .quick-copy-label,
  .ai-search-label {
    display: none;
  }

  .quick-copy-toggle,
  .ai-search-toggle,
  .zoom-control {
    padding: 0 8px;
  }

  .search-input {
    width: 160px;
  }
}

@media (max-width: 760px) {
  .zoom-slider {
    width: 80px;
  }

  .search-input {
    width: 130px;
  }
}
</style>

<style>
/* 工具栏图标按钮：通知面板（子组件）也会用到，故为全局样式 */
.toolbar-btn {
  pointer-events: auto;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: var(--panel-bg);
  color: var(--app-text-secondary);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition:
    color 0.2s,
    border-color 0.2s;
}

.toolbar-btn:hover {
  color: var(--app-text);
  border-color: var(--el-color-primary);
}
</style>
