<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, StarFilled, CollectionTag } from '@element-plus/icons-vue'
import WaterfallGrid from './WaterfallGrid.vue'

/**
 * 根目录浏览区：标题 + 文件夹/收藏/标签横幅 + 瀑布流。
 * 业务状态（当前视图、图片列表）由 App 传入；瀑布流外观参数打包在 settings。
 */
const { t } = useI18n()

const props = defineProps({
  rootId: { type: Number, required: true },
  rootName: { type: String, default: '' },
  rootPath: { type: String, default: '' },
  selectedFolder: { type: Object, default: null },
  isSearching: { type: Boolean, default: false },
  searchQuery: { type: String, default: '' },
  aiResults: { type: Array, default: null },
  favActive: { type: Boolean, default: false },
  tagActive: { type: Boolean, default: false },
  favItems: { type: Array, default: null },
  tagItems: { type: Array, default: null },
  favoritesCount: { type: Number, default: 0 },
  activeTagName: { type: String, default: '' },
  emptyText: { type: String, default: '' },
  // WaterfallGrid 外观参数（zoom/refreshTick/quickCopy*/nameMode/.../mode）
  settings: { type: Object, required: true }
})

// 顶部横幅：文件夹 / 收藏 / 标签三种视图共用同一套结构，仅图标、标题、副标题不同
const banner = computed(() => {
  if (props.favActive) {
    return {
      icon: StarFilled,
      iconClass: 'fav-banner-icon',
      name: t('app.myFavorites'),
      meta: `${t('app.favBannerRoot', { name: props.rootName })} · ${t('app.favCount', {
        n: props.favoritesCount
      })}`
    }
  }
  if (props.tagActive) {
    return {
      icon: CollectionTag,
      iconClass: 'tag-banner-icon',
      name: props.activeTagName,
      meta: `${t('app.favBannerRoot', { name: props.rootName })} · ${t('app.favCount', {
        n: props.tagItems?.length ?? 0
      })}`
    }
  }
  if (props.selectedFolder && !props.isSearching) {
    return {
      icon: Folder,
      iconClass: '',
      name: props.selectedFolder.name,
      meta: props.selectedFolder.path
    }
  }
  return null
})
</script>

<template>
  <div class="root-view">
    <div class="root-header">
      <div class="root-header-main">
        <h2 class="root-title">{{ rootName }}</h2>
        <p class="root-path">{{ rootPath }}</p>
      </div>
    </div>
    <div class="root-body">
      <div v-if="banner" class="folder-banner">
        <el-icon :size="18" class="folder-banner-icon" :class="banner.iconClass">
          <component :is="banner.icon" />
        </el-icon>
        <div class="folder-banner-text">
          <h3 class="folder-banner-name">{{ banner.name }}</h3>
          <p class="folder-banner-path">{{ banner.meta }}</p>
        </div>
      </div>
      <div v-if="selectedFolder || isSearching || favActive || tagActive" class="folder-body">
        <WaterfallGrid
          :root-id="rootId"
          :folder-path="selectedFolder?.path || ''"
          :search-query="searchQuery"
          :ai-results="aiResults"
          :fav-items="favItems"
          :tag-items="tagItems"
          :empty-text="emptyText"
          v-bind="settings"
        />
      </div>
      <div v-else class="center-empty">
        <el-empty :description="t('app.selectFolderToBrowse')">
          <p class="center-empty-tip">{{ t('app.rootColon', { name: rootName }) }}</p>
        </el-empty>
      </div>
    </div>
  </div>
</template>

<style scoped>
.root-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.root-header {
  /* 顶部留出悬浮工具栏的空间，避免标题被遮挡（高度见 --toolbar-reserve） */
  padding: var(--toolbar-reserve) var(--content-gutter) 12px;
}

.root-title {
  margin: 0 0 4px;
  font-size: 22px;
}

.root-path {
  margin: 0;
  color: var(--app-text-secondary);
  font-size: 13px;
  word-break: break-all;
}

.root-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 var(--content-gutter) 24px;
}

.folder-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  background: var(--panel-bg);
  margin-bottom: 12px;
}

.folder-banner-icon {
  color: var(--app-folder-color);
  flex-shrink: 0;
}

.tag-banner-icon {
  color: var(--el-color-primary);
}

.folder-banner-text {
  min-width: 0;
}

.folder-banner-name {
  margin: 0;
  font-size: 16px;
}

.folder-banner-path {
  margin: 2px 0 0;
  color: var(--app-text-secondary);
  font-size: 12px;
  word-break: break-all;
}

.folder-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
