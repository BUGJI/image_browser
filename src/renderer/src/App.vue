<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElConfigProvider, ElMessage } from 'element-plus'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import TitleBar from './components/TitleBar.vue'
import SideBar from './components/SideBar.vue'
import NotificationHost from './components/NotificationHost.vue'
import WaterfallGrid from './components/WaterfallGrid.vue'
import CloseAskDialog from './components/CloseAskDialog.vue'
import { Picture, Search, Loading, StarFilled, CollectionTag } from '@element-plus/icons-vue'
import { useRootsStore } from './stores/roots'
import { useThemeStore } from './stores/theme'
import { useNotificationsStore } from './stores/notifications'
import { useLocaleStore } from './stores/locale'
import { useAnimationsStore } from './stores/animations'
import { aiSearch } from './utils/ai-search'
import { useGifStore } from './stores/gif'
import { useFavoritesStore } from './stores/favorites'
import { useTagsStore } from './stores/tags'

const { t } = useI18n()
const localeStore = useLocaleStore()
// Element Plus 组件库文案随语言联动
const elementLocale = computed(() => (localeStore.locale === 'en-US' ? en : zhCn))

// 顶栏模式：custom = 自绘顶栏（frameless）；system = 系统默认顶栏
const useCustomTitlebar = ref(true)
let offSettingsChanged = null
// 全局缓存维护进度通知（滞留于主窗口通知列表）
let offCacheProgress = null
let cacheNotifyId = null
let cacheRootKey = null
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
const zoomMax = ref(2)
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

// 图片文件名搜索（回车生效，支持 * ? 通配符）
const searchInput = ref('')
const searchQuery = ref('')
const isSearching = computed(() => searchQuery.value.trim() !== '')

// 快速复制：开启后点击图片直接复制（类型见设置-常规），不进灯箱
const QUICK_COPY_KEY = 'quick-copy'
const quickCopyEnabled = ref(false)
const quickCopyType = ref('file') // 'file' | 'image'
const quickCopyLabel = computed(() =>
  t(quickCopyType.value === 'file' ? 'lightbox.copyFileAction' : 'lightbox.copyImageAction')
)

// 瀑布流卡片文件名显示方式：none / hover / always（设置 - 外观）
const itemNameMode = ref('hover')
// 卡片右上角格式角标显示方式：none / hover / always（默认不显示）
const itemExtMode = ref('none')
// 卡片左上角收藏按钮显示方式：none / hover / always（默认不显示）
const itemFavMode = ref('none')
// 卡片左下角「图内文字」角标显示方式：none / hover / always（默认不显示）
const itemTextMatchMode = ref('none')
// 性能（设置 - 性能）：滚动预载距离 + 缓冲区懒加载（可视区外的图接近视口再解码）
const imagePreload = ref(900)
const imageBufferLazy = ref(true)
// 卡片比例限制（设置-开发者选项-瀑布流）：默认开，卡片宽高比限制在 1:5 ~ 2:1
const imageTallCap = ref(true)
function toggleQuickCopy() {
  quickCopyEnabled.value = !quickCopyEnabled.value
  try {
    localStorage.setItem(QUICK_COPY_KEY, quickCopyEnabled.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// AI 搜索：设置中启用后，搜索框右侧显示开关；开关开启时回车走 AI 检索
const aiSearchEnabled = ref(false)
const aiSearchActive = ref(false)
// AI 搜索结果（非空数组时瀑布流优先渲染，覆盖普通搜索/文件夹列表）
const aiResults = ref(null)
const aiSearchBusy = ref(false)

// 主进程 ai:search 抛出的错误码 → 界面提示文案
const AI_ERROR_KEYS = {
  AI_NO_ROOT: 'app.aiNoRoot',
  AI_NO_KEY: 'app.aiNoKey',
  AI_NO_CACHE: 'app.aiNoCache',
  AI_NO_INDEX: 'app.aiNoIndex'
}

// 图内文字搜索：不再需要主界面开关。设置里启用后，搜索框回车时由主进程
// （images:list）自动把文件名命中与图内文字命中合并返回，这里无需感知。
async function applySearch() {
  const q = searchInput.value.trim()
  if (aiSearchActive.value) {
    await runAiSearch(q)
    return
  }
  searchQuery.value = q
  aiResults.value = null
}

// AI 检索：主进程向量化 query → 余弦相似度 → 返回与瀑布流一致的图片列表
async function runAiSearch(q) {
  if (!q || !rootsStore.currentRoot) {
    clearSearch()
    return
  }
  aiSearchBusy.value = true
  try {
    const results = await aiSearch(rootsStore.currentRoot.id, q)
    aiResults.value = results || []
    // 置为搜索态：显示瀑布流、隐藏文件夹横幅（grid 会优先渲染 aiResults）
    searchQuery.value = q
  } catch (e) {
    aiResults.value = null
    searchQuery.value = ''
    ElMessage.warning(t(AI_ERROR_KEYS[e?.code] || 'app.aiSearchFailed', { error: e?.message || '' }))
  } finally {
    aiSearchBusy.value = false
  }
}

function clearSearch() {
  searchInput.value = ''
  searchQuery.value = ''
  aiResults.value = null
}

// AI 搜索开关关闭时，清掉已展示的 AI 结果，回到文件夹浏览
watch(aiSearchActive, (v) => {
  if (!v && aiResults.value) {
    aiResults.value = null
    searchQuery.value = ''
  }
})

const rootsStore = useRootsStore()
const themeStore = useThemeStore()
const notificationsStore = useNotificationsStore()
const animationsStore = useAnimationsStore()
const gifStore = useGifStore()
const favoritesStore = useFavoritesStore()
const tagsStore = useTagsStore()

// 「我的收藏」视图（仅当前根目录）
const showFavorites = ref(false) // 设置 - 扩展功能-收藏夹：是否显示入口
const favoritesEnabled = ref(true) // 扩展功能总开关（收藏夹）
const tagsEnabled = ref(true) // 扩展功能总开关（标签）
const favActive = ref(false) // 是否正在浏览“我的收藏”
const favItems = computed(() =>
  favActive.value && favoritesStore.rootId === rootsStore.currentRootId ? favoritesStore.list : null
)

// 「标签」视图（仅当前根目录）：选中某标签后浏览其下图片
const tagActive = ref(false) // 是否正在浏览某个标签
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
watch(
  [() => tagsStore.activeTagId, () => tagsStore.tags],
  ([id]) => {
    if (id != null && tagActive.value && !tagsStore.findTag(id)) {
      tagActive.value = false
      tagsStore.leaveTag()
    }
  }
)

// 切换到文件夹 / 切换根目录时，退出 AI 结果视图
watch(
  () => [rootsStore.selectedFolder, rootsStore.currentRootId],
  () => {
    if (aiResults.value) {
      aiResults.value = null
      searchQuery.value = ''
      searchInput.value = ''
    }
  }
)

const rootDisplayName = computed(() => {
  const root = rootsStore.currentRoot
  if (!root) return ''
  if (root.alias && root.alias.trim()) return root.alias.trim()
  const parts = root.path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : root.path
})

// ---------- 通知历史面板 ----------
const TYPE_ICON = {
  info: 'InfoFilled',
  success: 'SuccessFilled',
  warning: 'WarningFilled',
  error: 'CircleCloseFilled',
  progress: 'VideoPlay'
}

const TYPE_COLOR = {
  info: '#409eff',
  success: '#67c23a',
  warning: '#e6a23c',
  error: '#f56c6c',
  progress: '#409eff'
}

const STATUS_TAG = computed(() => ({
  active: { label: t('notifications.active'), type: 'primary' },
  done: { label: t('notifications.done'), type: 'success' },
  aborted: { label: t('notifications.aborted'), type: 'warning' },
  dismissed: { label: t('notifications.dismissed'), type: 'info' }
}))

function statusTag(n) {
  return STATUS_TAG.value[n.status] || null
}

function fmtTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const pad = (x) => String(x).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  if (d.toDateString() === now.toDateString()) return hm
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

function openSettings() {
  window.api.openSettings()
}

// ---------- 全局缓存维护进度（主窗口通知列表滞留显示） ----------
function onGlobalCacheProgress(p) {
  // 新任务（rootId 变化）→ 创建通知
  if (cacheRootKey !== p.rootId) {
    cacheRootKey = p.rootId
    cacheNotifyId = notificationsStore.add({
      type: 'progress',
      title: t('app.cacheMaintenance'),
      message: t('common.preparing'),
      cancellable: true,
      onCancel: () => window.api.cacheAbort()
    })
  }
  if (!cacheNotifyId) return

  // 注意：thumb 进度事件里的 done 是数字（已处理张数），任务完成标志是 done === true
  const finished = p.done === true

  if (p.error) {
    notificationsStore.finish(cacheNotifyId, 'aborted', { message: p.error })
    cacheNotifyId = null
    cacheRootKey = null
    return
  }
  if (p.aborted) {
    notificationsStore.finish(cacheNotifyId, 'aborted', { message: t('notifications.aborted') })
    cacheNotifyId = null
    cacheRootKey = null
    return
  }
  if (finished) {
    const s = p.stats || {}
    const added = s.added ?? 0
    const updated = s.updated ?? 0
    const removed = s.removed ?? 0
    const parts = []
    if (added) parts.push(t('notifications.statsAdded', { n: added }))
    if (updated) parts.push(t('notifications.statsUpdated', { n: updated }))
    if (removed) parts.push(t('notifications.statsRemoved', { n: removed }))
    parts.push(t('notifications.statsThumbs', { n: s.thumbs ?? 0 }))
    if (s.failed) parts.push(t('notifications.statsFailed', { n: s.failed }))
    if (s.cleanedThumbs) parts.push(t('notifications.statsCleanedOrphans', { n: s.cleanedThumbs }))
    notificationsStore.finish(cacheNotifyId, 'done', {
      message: t('app.scanSummary', {
        n: added + updated + removed,
        parts: parts.join(t('common.separator'))
      })
    })
    cacheNotifyId = null
    cacheRootKey = null
    // 缓存就绪：当前根目录刷新瀑布流，改用缩略图
    if (p.rootId === rootsStore.currentRoot?.id) {
      cacheRefreshTick.value++
    }
    return
  }
  if (p.phase === 'scan') {
    notificationsStore.update(cacheNotifyId, { message: t('app.scanningFiles', { n: p.scanned }) })
  } else if (p.phase === 'thumb') {
    notificationsStore.updateProgress(cacheNotifyId, Math.round((p.done / p.total) * 100))
    notificationsStore.update(cacheNotifyId, {
      message: t('app.generatingThumbs', {
        done: p.done,
        total: p.total,
        current: p.current || ''
      })
    })
  }
}

function saveZoom() {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(itemZoom.value))
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  const mode = await window.api.getSetting('titlebar', 'custom')
  useCustomTitlebar.value = mode === 'custom'

  // AI 搜索正在开发中：主界面不再读取开关，固定关闭
  aiSearchEnabled.value = false

  // 快速复制：类型取自「设置 - 常规」，开关状态本地记忆
  const qcType = await window.api.getSetting('quickCopyType', 'file')
  quickCopyType.value = ['file', 'image'].includes(qcType) ? qcType : 'file'
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

  // 瀑布流文件名显示方式（设置 - 外观）
  const inm = await window.api.getSetting('itemNameMode', 'hover')
  itemNameMode.value = ['none', 'hover', 'always'].includes(inm) ? inm : 'hover'
  const iem = await window.api.getSetting('itemExtMode', 'none')
  itemExtMode.value = ['none', 'hover', 'always'].includes(iem) ? iem : 'none'
  const ifm = await window.api.getSetting('itemFavMode', 'none')
  itemFavMode.value = ['none', 'hover', 'always'].includes(ifm) ? ifm : 'none'
  const itm = await window.api.getSetting('itemTextMatchMode', 'none')
  itemTextMatchMode.value = ['none', 'hover', 'always'].includes(itm) ? itm : 'none'
  showFavorites.value = (await window.api.getSetting('showFavorites', 'false')) === 'true'
  favoritesEnabled.value = (await window.api.getSetting('favoritesEnabled', 'true')) !== 'false'
  tagsEnabled.value = (await window.api.getSetting('tagsEnabled', 'true')) !== 'false'

  // 性能（设置 - 性能）：滚动预载距离 + 缓冲区懒加载
  const pp = parseFloat(await window.api.getSetting('imagePreload', '900'))
  imagePreload.value = Number.isFinite(pp) && pp >= 0 ? pp : 900
  imageBufferLazy.value = (await window.api.getSetting('imageBufferLazy', 'true')) !== 'false'
  imageTallCap.value = (await window.api.getSetting('imageTallCap', 'true')) !== 'false'

  // 缩放滑块最大值（开发者选项可配置，默认 2）
  const zm = parseFloat(await window.api.getSetting('zoomMax', '2'))
  zoomMax.value = Number.isFinite(zm) ? Math.max(1, zm) : 2

  // 记忆缩放：开启时恢复上次缩放值；关闭时每次启动默认 1.5
  const rememberZoom = (await window.api.getSetting('rememberZoom', 'false')) === 'true'
  if (rememberZoom) {
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
    if (key === 'titlebar') {
      useCustomTitlebar.value = value === 'custom'
    }
    if (key === 'aiSearchEnabled') {
      // AI 搜索开发中：忽略外部改动，保持关闭
      aiSearchEnabled.value = false
      aiSearchActive.value = false
    }

    if (key === 'zoomMax') {
      const zm = parseFloat(value)
      if (Number.isFinite(zm)) {
        zoomMax.value = Math.max(1, zm)
        if (itemZoom.value > zoomMax.value) {
          itemZoom.value = zoomMax.value
          saveZoom()
        }
      }
    }
    if (key === 'quickCopyType') {
      quickCopyType.value = ['file', 'image'].includes(value) ? value : 'file'
    }
    if (key === 'itemNameMode') {
      itemNameMode.value = ['none', 'hover', 'always'].includes(value) ? value : 'hover'
    }
    if (key === 'itemExtMode') {
      itemExtMode.value = ['none', 'hover', 'always'].includes(value) ? value : 'none'
    }
    if (key === 'itemFavMode') {
      itemFavMode.value = ['none', 'hover', 'always'].includes(value) ? value : 'none'
    }
    if (key === 'itemTextMatchMode') {
      itemTextMatchMode.value = ['none', 'hover', 'always'].includes(value) ? value : 'none'
    }
    if (key === 'showFavorites') {
      showFavorites.value = value === 'true'
    }
    if (key === 'favoritesEnabled') {
      favoritesEnabled.value = value !== 'false'
      if (!favoritesEnabled.value) favActive.value = false
    }
    if (key === 'tagsEnabled') {
      tagsEnabled.value = value !== 'false'
      if (!tagsEnabled.value) {
        tagActive.value = false
        tagsStore.leaveTag()
      }
    }
    if (key === 'imagePreload') {
      const pp = parseFloat(value)
      if (Number.isFinite(pp) && pp >= 0) imagePreload.value = pp
    }
    if (key === 'imageBufferLazy') {
      imageBufferLazy.value = value !== 'false'
    }
    if (key === 'imageTallCap') {
      imageTallCap.value = value !== 'false'
    }
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
  <el-config-provider :locale="elementLocale">
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
                @click="toggleQuickCopy"
              >
                <span class="quick-copy-label">{{ t('app.quickCopy') }}</span>
                <el-switch
                  :model-value="quickCopyEnabled"
                  size="small"
                  class="quick-copy-switch"
                />
              </div>
            </el-tooltip>

            <!-- 图片搜索（回车触发，支持 * ? 通配符） -->
            <div class="toolbar-search">
              <el-input
                v-model="searchInput"
                :placeholder="t('app.searchImages')"
                :disabled="!rootsStore.currentRoot"
                clearable
                size="small"
                class="search-input"
                @keyup.enter="applySearch"
                @clear="clearSearch"
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
                v-model="aiSearchActive"
                size="small"
                :aria-label="t('app.aiSearchToggle')"
              />
              <span class="ai-search-label">{{ t('app.aiSearchToggle') }}</span>
            </div>

            <div class="zoom-control">
              <el-tooltip :content="t('app.zoomTip')" placement="bottom" :show-after="200">
                <span class="zoom-icon"><el-icon :size="14"><Picture /></el-icon></span>
              </el-tooltip>
              <el-slider
                v-model="itemZoom"
                :min="ZOOM_MIN"
                :max="zoomMax"
                :step="0.1"
                :show-tooltip="false"
                class="zoom-slider"
                @change="saveZoom"
              />
            </div>

            <!-- 浏览模式切换：瀑布流 / 矩形（矩形模式卡片等高、超出裁切） -->
            <el-tooltip
              :content="
                t('app.browseModeTip', {
                  mode: browseMode === 'rect' ? t('app.browseModeRect') : t('app.browseModeWaterfall')
                })
              "
              placement="bottom"
              :show-after="200"
            >
              <button
                class="toolbar-btn"
                :title="
                  t('app.browseModeTip', {
                    mode: browseMode === 'rect' ? t('app.browseModeRect') : t('app.browseModeWaterfall')
                  })
                "
                @click="toggleBrowseMode"
              >
                <el-icon :size="16">
                  <Grid v-if="browseMode === 'rect'" />
                  <Menu v-else />
                </el-icon>
              </button>
            </el-tooltip>

            <!-- 通知中心 -->
            <el-popover
              placement="bottom-end"
              :width="380"
              trigger="click"
              popper-class="notify-popper"
              @show="notificationsStore.markAllRead()"
            >
              <template #reference>
                <el-badge
                  :value="notificationsStore.unreadCount"
                  :hidden="notificationsStore.unreadCount === 0"
                  :max="99"
                  :offset="[-4, 6]"
                  class="notify-badge"
                >
                  <button class="toolbar-btn" :title="t('app.notifications')">
                    <el-icon :size="16"><Bell /></el-icon>
                  </button>
                </el-badge>
              </template>

              <div class="notify-panel">
                <div class="notify-panel-head">
                  <span class="notify-panel-title">{{ t('app.notifications') }}</span>
                  <el-button
                    v-if="notificationsStore.items.length"
                    link
                    type="primary"
                    size="small"
                    @click="notificationsStore.clearAll()"
                  >
                    {{ t('app.clearAll') }}
                  </el-button>
                </div>

                <div v-if="!notificationsStore.items.length" class="notify-panel-empty">
                  {{ t('app.noNotifications') }}
                </div>

                <div v-else class="notify-list">
                  <div
                    v-for="n in notificationsStore.items"
                    :key="n.id"
                    class="notify-item"
                    :class="{ 'notify-item-unread': !n.read }"
                  >
                    <el-icon
                      :size="15"
                      class="notify-item-icon"
                      :style="{ color: TYPE_COLOR[n.type] }"
                    >
                      <component :is="TYPE_ICON[n.type] || 'InfoFilled'" />
                    </el-icon>
                    <div class="notify-item-main">
                      <div class="notify-item-title">
                        {{ n.title }}
                        <el-tag
                          v-if="statusTag(n)"
                          size="small"
                          :type="statusTag(n).type"
                          class="notify-status-tag"
                        >
                          {{ statusTag(n).label }}
                        </el-tag>
                      </div>
                      <div v-if="n.message" class="notify-item-msg">{{ n.message }}</div>
                      <div class="notify-item-foot">
                        <span class="notify-item-time">{{ fmtTime(n.createdAt) }}</span>
                        <span v-if="n.actions.length" class="notify-item-actions">
                          <el-button
                            v-for="a in n.actions"
                            :key="a.label"
                            link
                            size="small"
                            :type="a.kind === 'primary' ? 'primary' : 'default'"
                            @click="a.onClick?.()"
                          >
                            {{ a.label }}
                          </el-button>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-popover>

            <!-- 主题切换 -->
            <el-tooltip :content="t('app.themeToggleTip')" placement="bottom" :show-after="200">
              <button class="toolbar-btn" :title="t('app.themeToggleTitle')" @click="themeStore.toggle()">
                <el-icon :size="16">
                  <Sunny v-if="themeStore.mode === 'light'" />
                  <Moon v-else />
                </el-icon>
              </button>
            </el-tooltip>
          </div>

          <!-- 已选择根目录 -->
          <div v-if="rootsStore.currentRoot" class="root-view">
            <div class="root-header">
              <div class="root-header-main">
                <h2 class="root-title">{{ rootDisplayName }}</h2>
                <p class="root-path">{{ rootsStore.currentRoot.path }}</p>
              </div>
            </div>
            <div class="root-body">
              <template v-if="rootsStore.selectedFolder && !isSearching && !favActive && !tagActive">
                <div class="folder-banner">
                  <el-icon :size="18" class="folder-banner-icon"><Folder /></el-icon>
                  <div class="folder-banner-text">
                    <h3 class="folder-banner-name">{{ rootsStore.selectedFolder.name }}</h3>
                    <p class="folder-banner-path">{{ rootsStore.selectedFolder.path }}</p>
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
                      {{ t('app.favBannerRoot', { name: rootDisplayName }) }} ·
                      {{ t('app.favCount', { n: favoritesStore.list.length }) }}
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
                    <h3 class="folder-banner-name">
                      {{ activeTagInfo?.name || '' }}
                    </h3>
                    <p class="folder-banner-path">
                      {{ t('app.favBannerRoot', { name: rootDisplayName }) }} ·
                      {{ t('app.favCount', { n: tagItems?.length ?? 0 }) }}
                    </p>
                  </div>
                </div>
              </template>
              <div
                v-if="rootsStore.selectedFolder || isSearching || favActive || tagActive"
                class="folder-body"
              >
                <WaterfallGrid
                  :root-id="rootsStore.currentRoot.id"
                  :folder-path="rootsStore.selectedFolder?.path || ''"
                  :zoom="itemZoom"
                  :refresh-tick="cacheRefreshTick"
                  :search-query="searchQuery"
                  :ai-results="aiResults"
                  :fav-items="favItems"
                  :tag-items="tagItems"
                  :empty-text="
                    favActive
                      ? t('app.favEmpty')
                      : tagActive
                        ? activeTagInfo?.name
                          ? t('app.tagEmpty', { name: activeTagInfo.name })
                          : t('app.tagEmptyGeneric')
                        : ''
                  "
                  :quick-copy="quickCopyEnabled"
                  :quick-copy-type="quickCopyType"
                  :name-mode="itemNameMode"
                  :ext-mode="itemExtMode"
                  :fav-mode="itemFavMode"
                  :text-match-mode="itemTextMatchMode"
                  :preload="imagePreload"
                  :buffer-lazy="imageBufferLazy"
                  :cap-tall="imageTallCap"
                  :mode="browseMode"
                />
              </div>
              <div v-else class="welcome">
                <el-empty :description="t('app.selectFolderToBrowse')">
                  <p class="welcome-tip">{{ t('app.rootColon', { name: rootDisplayName }) }}</p>
                </el-empty>
              </div>
            </div>
          </div>

          <!-- 未注册任何根目录 -->
          <div v-else class="welcome">
            <el-empty :description="t('app.noRoots')">
              <el-button type="primary" @click="openSettings">{{ t('app.goToSettings') }}</el-button>
              <p class="welcome-tip">{{ t('app.setupTip') }}</p>
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
  overflow: auto;
}

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
  transition: color 0.2s, border-color 0.2s;
}

.toolbar-btn:hover {
  color: var(--app-text);
  border-color: #409eff;
}

.notify-badge {
  pointer-events: auto;
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
  box-shadow: 0 0 0 1px #409eff inset;
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
  transition: border-color 0.2s, color 0.2s;
}

.quick-copy-toggle:hover {
  border-color: #409eff;
}

.quick-copy-on {
  border-color: #409eff;
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

.root-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.root-header {
  padding: 24px 28px 12px;
}

.root-header-main {
  max-width: calc(100% - 80px);
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
  color: #409eff;
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

<style>
/* 通知历史面板（popover 挂 body 下，需全局样式） */
.notify-popper {
  padding: 8px !important;
}

.notify-panel {
  display: flex;
  flex-direction: column;
  max-height: 420px;
}

.notify-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.notify-panel-title {
  font-weight: 600;
  font-size: 14px;
}

.notify-panel-empty {
  padding: 40px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.notify-list {
  overflow-y: auto;
  max-height: 360px;
  display: flex;
  flex-direction: column;
}

.notify-item {
  display: flex;
  gap: 8px;
  padding: 10px 6px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.notify-item-unread {
  background: var(--el-color-primary-light-9);
}

.notify-item-icon {
  margin-top: 2px;
  flex-shrink: 0;
}

.notify-item-main {
  flex: 1;
  min-width: 0;
}

.notify-item-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.notify-status-tag {
  height: 18px;
  line-height: 18px;
}

.notify-item-msg {
  margin-top: 3px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
  line-height: 1.5;
}

.notify-item-foot {
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notify-item-time {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
}

.notify-item-actions {
  display: flex;
  gap: 4px;
}
</style>
