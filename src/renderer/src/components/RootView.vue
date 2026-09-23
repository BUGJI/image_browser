<script setup>
import { useI18n } from 'vue-i18n'
import WaterfallGrid from './WaterfallGrid.vue'

/**
 * 根目录浏览区：标题 + 文件夹/收藏/标签横幅 + 瀑布流。
 * 业务状态（当前视图、图片列表）由 App 传入；瀑布流外观参数打包在 settings。
 */
const { t } = useI18n()

defineProps({
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
      <template v-if="selectedFolder && !isSearching && !favActive && !tagActive">
        <div class="folder-banner">
          <el-icon :size="18" class="folder-banner-icon"><Folder /></el-icon>
          <div class="folder-banner-text">
            <h3 class="folder-banner-name">{{ selectedFolder.name }}</h3>
            <p class="folder-banner-path">{{ selectedFolder.path }}</p>
          </div>
        </div>
      </template>
      <template v-else-if="favActive">
        <div class="folder-banner">
          <el-icon :size="18" class="folder-banner-icon fav-banner-icon">
            <StarFilled />
          </el-icon>
          <div class="folder-banner-text">
            <h3 class="folder-banner-name">{{ t('app.myFavorites') }}</h3>
            <p class="folder-banner-path">
              {{ t('app.favBannerRoot', { name: rootName }) }} ·
              {{ t('app.favCount', { n: favoritesCount }) }}
            </p>
          </div>
        </div>
      </template>
      <template v-else-if="tagActive">
        <div class="folder-banner">
          <el-icon :size="18" class="folder-banner-icon tag-banner-icon">
            <CollectionTag />
          </el-icon>
          <div class="folder-banner-text">
            <h3 class="folder-banner-name">{{ activeTagName }}</h3>
            <p class="folder-banner-path">
              {{ t('app.favBannerRoot', { name: rootName }) }} ·
              {{ t('app.favCount', { n: tagItems?.length ?? 0 }) }}
            </p>
          </div>
        </div>
      </template>
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
      <div v-else class="welcome">
        <el-empty :description="t('app.selectFolderToBrowse')">
          <p class="welcome-tip">{{ t('app.rootColon', { name: rootName }) }}</p>
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
  /* 顶部留出悬浮工具栏的空间（工具栏 top:12px + 高 36px），避免标题被遮挡 */
  padding: 60px 28px 12px;
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
  padding: 0 28px 24px;
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
  color: #f7ba2a;
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

.welcome {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.welcome-tip {
  margin-top: 8px;
  color: var(--app-text-secondary);
  font-size: 13px;
}
</style>
