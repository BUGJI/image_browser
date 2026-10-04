<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import TitleBar from './components/TitleBar.vue'
import SideBar from './components/SideBar.vue'
import NotificationHost from './components/NotificationHost.vue'
import Toolbar from './components/Toolbar.vue'
import RootView from './components/RootView.vue'
import CloseAskDialog from './components/CloseAskDialog.vue'
import { useRootsStore } from './stores/roots'
import { useThemeStore } from './stores/theme'
import { useNotificationsStore } from './stores/notifications'
import { useLocaleStore } from './stores/locale'
import { useAnimationsStore } from './stores/animations'
import { useGifStore } from './stores/gif'
import { useFavoritesStore } from './stores/favorites'
import { useTagsStore } from './stores/tags'
import { useSettings, asBool, asEnum, asNumber } from './utils/use-settings'
import { useImageSearch } from './utils/use-image-search'
import { useGlobalCacheProgress } from './utils/use-cache-progress'

const { t } = useI18n()
const localeStore = useLocaleStore()
// Element Plus 组件库文案随语言联动
const elementLocale = computed(() => (localeStore.locale === 'en-US' ? en : zhCn))

// 顶栏模式 / 缩放上限等窗口设置由下方 useSettings 统一声明
let offSettingsChanged = null
// 全局缓存维护进度通知（滞留于主窗口通知列表）
let offCacheProgress = null
// 启动更新检测推送（发现新版本时弹出忽略/查看通知）
let offUpdateAvailable = null

const UPDATE_RELEASES_URL = 'https://github.com/BUGJI/image_browser/releases'

function showUpdateNotify(p) {
  if (!p?.latestVersion) return
  notificationsStore.add({
    type: 'info',
    title: t('update.title', { version: p.latestVersion }),
    message: p.releaseNotes
      ? t('update.releaseNote', { notes: String(p.releaseNotes).slice(0, 500) })
      : t('update.msg', { version: p.latestVersion }),
    actions: [
      {
        label: t('update.view'),
        kind: 'primary',
        onClick: () => window.api?.openExternal(p.downloadUrl || UPDATE_RELEASES_URL)
      },
      { label: t('update.later'), kind: 'default' }
    ]
  })
}

// 瀑布流缩放：值越大 item 越小，一行容纳更多图片
const itemZoom = ref(1.5)
const ZOOM_STORAGE_KEY = 'waterfall-zoom'
const ZOOM_MIN = 0.5
// 浏览模式：瀑布流（保持原比例） / 矩形（等高卡片，超出部分裁切）
const BROWSE_MODE_KEY = 'browse-mode'
const browseMode = ref('waterfall') // 'waterfall' | 'rect'
function toggleBrowseMode() {
  browseMode.value = browseMode.value === 'waterfall' ? 'rect' : 'waterfall'
  try {
    localStorage.setItem(BROWSE_MODE_KEY, browseMode.value)
  } catch {
    /* ignore */
  }
}
// 缓存维护完成后自增，通知 WaterfallGrid 重新加载（缩略图就绪后改用缩略图）
const cacheRefreshTick = ref(0)

// 快速复制：开启后点击图片直接复制（类型见设置-常规），不进灯箱；开关本地记忆
const QUICK_COPY_KEY = 'quick-copy'
const quickCopyEnabled = ref(false)
function toggleQuickCopy() {
  quickCopyEnabled.value = !quickCopyEnabled.value
  try {
    localStorage.setItem(QUICK_COPY_KEY, quickCopyEnabled.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const rootsStore = useRootsStore()
const themeStore = useThemeStore()
const notificationsStore = useNotificationsStore()
const animationsStore = useAnimationsStore()
const gifStore = useGifStore()
const favoritesStore = useFavoritesStore()
const tagsStore = useTagsStore()

// 文件名搜索 + AI 搜索（实现见 utils/use-image-search.js）
const {
  searchInput,
  searchQuery,
  isSearching,
  aiSearchEnabled,
  aiSearchActive,
  aiResults,
  aiSearchBusy,
  applySearch,
  clearSearch
} = useImageSearch(rootsStore)

// 全局缓存维护进度 → 通知列表（实现见 utils/use-cache-progress.js）
const { onGlobalCacheProgress } = useGlobalCacheProgress({
  notificationsStore,
  rootsStore,
  onReady: () => cacheRefreshTick.value++
})

const favActive = ref(false) // 是否正在浏览“我的收藏”
const tagActive = ref(false) // 是否正在浏览某个标签

// ---------- 窗口设置：默认值 / 归一化 / 变更副作用集中声明 ----------
const {
  titlebar: useCustomTitlebar,
  quickCopyType,
  itemNameMode,
  itemExtMode,
  itemFavMode,
  itemTextMatchMode,
  showFavorites,
  favoritesEnabled,
  tagsEnabled,
  imagePreload,
  imageBufferLazy,
  imageTallCap,
  zoomMax,
  rememberZoom,
  load: loadSettings,
  handleChange: applySettingChange
} = useSettings({
  // 顶栏模式：custom = 自绘顶栏（frameless）；system = 系统默认顶栏
  titlebar: { default: 'custom', normalize: (v) => v === 'custom' },
  quickCopyType: { default: 'file', normalize: asEnum(['file', 'image'], 'file') },
  // 卡片文件名 / 格式角标 / 收藏按钮 / 图内文字角标的显示方式：none / hover / always
  itemNameMode: { default: 'hover', normalize: asEnum(['none', 'hover', 'always'], 'hover') },
  itemExtMode: { default: 'none', normalize: asEnum(['none', 'hover', 'always'], 'none') },
  itemFavMode: { default: 'none', normalize: asEnum(['none', 'hover', 'always'], 'none') },
  itemTextMatchMode: { default: 'none', normalize: asEnum(['none', 'hover', 'always'], 'none') },
  // 扩展功能总开关
  showFavorites: { default: false, normalize: asBool(false) },
  favoritesEnabled: {
    default: true,
    normalize: asBool(true),
    onChange: (v) => {
      if (!v) favActive.value = false
    }
  },
  tagsEnabled: {
    default: true,
    normalize: asBool(true),
    onChange: (v) => {
      if (!v) {
        tagActive.value = false
        tagsStore.leaveTag()
      }
    }
  },
  // 性能：滚动预载距离 + 缓冲区懒加载 + 卡片比例限制
  imagePreload: { default: 900, normalize: asNumber(900, 0) },
  imageBufferLazy: { default: true, normalize: asBool(true) },
  imageTallCap: { default: true, normalize: asBool(true) },
  zoomMax: {
    default: 2,
    // 与开发者选项的 ZOOM_MAX_MAX 保持一致：上限 8，避免历史超大值导致列宽过窄
    normalize: asNumber(2, 1, 8),
    onChange: (v) => {
      if (itemZoom.value > v) {
        itemZoom.value = v
        saveZoom()
      }
    }
  },
  rememberZoom: { default: false, normalize: asBool(false) }
})

// 「我的收藏」视图（仅当前根目录）
const favItems = computed(() =>
  favActive.value && favoritesStore.rootId === rootsStore.currentRootId ? favoritesStore.list : null
)

// 「标签」视图（仅当前根目录）：选中某标签后浏览其下图片
const activeTagInfo = computed(() => tagsStore.findTag(tagsStore.activeTagId))
const tagItems = computed(() =>
  tagActive.value && tagsStore.rootId === rootsStore.currentRootId && tagsStore.activeTagId != null
    ? tagsStore.tagItems
    : null
)

function enterFavorites() {
  const root = rootsStore.currentRoot
  if (!root) return
  favActive.value = true
  tagActive.value = false
  tagsStore.leaveTag()
  rootsStore.selectFolder(null)
  clearSearch()
  if (favoritesStore.rootId !== root.id) {
    favoritesStore.load(root)
  }
}

function enterTag(tag) {
  const root = rootsStore.currentRoot
  if (!root || !tag?.id) return
  favActive.value = false
  tagActive.value = true
  rootsStore.selectFolder(null)
  clearSearch()
  tagsStore.enterTag(root, { id: tag.id, name: tag.name })
}
// 选中普通文件夹 / 切换根目录时退出收藏、标签视图
watch(
  () => rootsStore.selectedFolder,
  (v) => {
    if (v) {
      favActive.value = false
      tagActive.value = false
      tagsStore.leaveTag()
    }
  }
)
watch(
  () => rootsStore.currentRootId,
  (rid) => {
    favActive.value = false
    tagActive.value = false
    tagsStore.leaveTag()
    const root = rootsStore.roots.find((r) => r.id === rid)
    favoritesStore.load(root)
  }
)
// 标签在别处（设置页/另一张图）被删除时，自动退出标签视图
watch([() => tagsStore.activeTagId, () => tagsStore.tags], ([id]) => {
  if (id != null && tagActive.value && !tagsStore.findTag(id)) {
    tagActive.value = false
    tagsStore.leaveTag()
  }
})

const rootDisplayName = computed(() => {
  const root = rootsStore.currentRoot
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = root.path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root.path
})

// 瀑布流外观参数（打包传给 RootView → WaterfallGrid）
const gridSettings = computed(() => ({
  zoom: itemZoom.value,
  refreshTick: cacheRefreshTick.value,
  quickCopy: quickCopyEnabled.value,
  quickCopyType: quickCopyType.value,
  nameMode: itemNameMode.value,
  extMode: itemExtMode.value,
  favMode: itemFavMode.value,
  textMatchMode: itemTextMatchMode.value,
  preload: imagePreload.value,
  bufferLazy: imageBufferLazy.value,
  capTall: imageTallCap.value,
  mode: browseMode.value
}))

// 空态文案：收藏/标签视图各自覆盖
const gridEmptyText = computed(() =>
  favActive.value
    ? t('app.favEmpty')
    : tagActive.value
      ? activeTagInfo.value?.name
        ? t('app.tagEmpty', { name: activeTagInfo.value.name })
        : t('app.tagEmptyGeneric')
      : ''
)

function openSettings() {
  window.api.openSettings()
}

function saveZoom() {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(itemZoom.value))
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  // AI 搜索正在开发中：主界面不再读取开关，固定关闭
  aiSearchEnabled.value = false

  // 窗口设置（顶栏 / 快速复制类型 / 卡片显示 / 扩展功能 / 性能 / 缩放上限 / 记忆缩放）
  await loadSettings()

  // 快速复制开关：本地记忆
  try {
    quickCopyEnabled.value = localStorage.getItem(QUICK_COPY_KEY) === '1'
  } catch {
    /* ignore */
  }

  // 浏览模式：本地记忆（瀑布流 / 矩形）
  try {
    browseMode.value = localStorage.getItem(BROWSE_MODE_KEY) === 'rect' ? 'rect' : 'waterfall'
  } catch {
    /* ignore */
  }

  // 记忆缩放：开启时恢复上次缩放值；关闭时每次启动默认 1.5
  if (rememberZoom.value) {
    try {
      const saved = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY))
      if (Number.isFinite(saved)) {
        itemZoom.value = Math.min(zoomMax.value, Math.max(ZOOM_MIN, saved))
      }
    } catch {
      /* ignore */
    }
  } else {
    itemZoom.value = 1.5
  }

  // 全局主题：初始化 + 同步其他窗口的修改（先加载动画开关，主题过渡依赖它）
  await animationsStore.load()
  themeStore.load()
  localeStore.load()
  await gifStore.load()
  offSettingsChanged = window.api.onSettingsChanged(({ key, value }) => {
    // AI 搜索开发中：忽略外部改动，保持关闭
    if (key === 'aiSearchEnabled') {
      aiSearchEnabled.value = false
      aiSearchActive.value = false
    }
    // 其余窗口设置由 useSettings 统一归一化并触发副作用
    applySettingChange(key, value)
    themeStore.onSettingsChanged({ key, value })
    localeStore.onSettingsChanged({ key, value })
    animationsStore.onSettingsChanged({ key, value })
    gifStore.onSettingsChanged({ key, value })
  })

  await rootsStore.refresh()

  // 缓存维护进度：主窗口也接收（通知滞留在全局通知列表）
  offCacheProgress = window.api.onCacheProgress(onGlobalCacheProgress)

  // 启动检测更新：主进程发现新版本时用「忽略/查看」通知提示
  offUpdateAvailable = window.api.onUpdateAvailable((p) => showUpdateNotify(p))
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
  offCacheProgress?.()
  offUpdateAvailable?.()
})
</script>

<template>
  <!-- zIndex 基准 6000：确保 message 等弹层高于灯箱遮罩（z-index 5000） -->
  <el-config-provider :locale="elementLocale" :z-index="6000">
    <div class="app-layout">
      <TitleBar v-if="useCustomTitlebar" />
      <NotificationHost />
      <CloseAskDialog />

      <div class="app-body">
        <SideBar
          :show-favorites="showFavorites && favoritesEnabled"
          :tags-enabled="tagsEnabled"
          :fav-active="favActive"
          :tag-active="tagActive"
          :active-tag-id="tagsStore.activeTagId"
          @show-favorites="enterFavorites"
          @select-tag="enterTag"
        />

        <main class="app-content">
          <!-- 悬浮栏：快速复制 + 搜索 + AI + 缩放滑块 + 通知中心 + 主题切换 -->
          <Toolbar
            :quick-copy-enabled="quickCopyEnabled"
            :quick-copy-type="quickCopyType"
            :search-input="searchInput"
            :search-disabled="!rootsStore.currentRoot"
            :ai-search-enabled="aiSearchEnabled"
            :ai-search-active="aiSearchActive"
            :ai-search-busy="aiSearchBusy"
            :item-zoom="itemZoom"
            :zoom-min="ZOOM_MIN"
            :zoom-max="zoomMax"
            :browse-mode="browseMode"
            @toggle-quick-copy="toggleQuickCopy"
            @update:search-input="searchInput = $event"
            @search="applySearch"
            @clear-search="clearSearch"
            @update:ai-search-active="aiSearchActive = $event"
            @update:item-zoom="itemZoom = $event"
            @save-zoom="saveZoom"
            @toggle-browse-mode="toggleBrowseMode"
          />

          <!-- 已选择根目录 -->
          <RootView
            v-if="rootsStore.currentRoot"
            :root-id="rootsStore.currentRoot.id"
            :root-name="rootDisplayName"
            :root-path="rootsStore.currentRoot.path"
            :selected-folder="rootsStore.selectedFolder"
            :is-searching="isSearching"
            :search-query="searchQuery"
            :ai-results="aiResults"
            :fav-active="favActive"
            :tag-active="tagActive"
            :fav-items="favItems"
            :tag-items="tagItems"
            :favorites-count="favoritesStore.list.length"
            :active-tag-name="activeTagInfo?.name || ''"
            :empty-text="gridEmptyText"
            :settings="gridSettings"
          />

          <!-- 未注册任何根目录 -->
          <div v-else class="center-empty">
            <el-empty :description="t('app.noRoots')">
              <el-button type="primary" @click="openSettings">{{
                t('app.goToSettings')
              }}</el-button>
              <p class="center-empty-tip">{{ t('app.setupTip') }}</p>
            </el-empty>
          </div>
        </main>
      </div>
    </div>
  </el-config-provider>
</template>

<style scoped>
.app-layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.app-content {
  position: relative;
  flex: 1;
  min-width: 0;
  background: var(--app-bg);
  color: var(--app-text);
  /* 只保留瀑布流内部单一滚动条，避免外层再出现滚动条（工具栏绝对定位不受影响） */
  overflow: hidden;
}
</style>
