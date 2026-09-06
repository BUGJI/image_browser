<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElConfigProvider } from 'element-plus'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import SidebarTree from './SidebarTree.vue'
import GeneralPage from './pages/GeneralPage.vue'
import RootsPage from './pages/RootsPage.vue'
import FavoritesPage from './pages/FavoritesPage.vue'
import TagsPage from './pages/TagsPage.vue'
import AppearancePage from './pages/AppearancePage.vue'
import ThemePage from './pages/ThemePage.vue'
import SidebarPage from './pages/SidebarPage.vue'
import AnimationsPage from './pages/AnimationsPage.vue'
import AiSearchPage from './pages/AiSearchPage.vue'
import AboutPage from './pages/AboutPage.vue'
import TestPage from './pages/TestPage.vue'
import DevOptionsPage from './pages/DevOptionsPage.vue'
import ShortcutsPage from './pages/ShortcutsPage.vue'
import GridPage from './pages/GridPage.vue'
// PerformancePage 已隐藏备用：其选项并入 DevOptionsPage，需要时可重新接入
import NotificationHost from '../components/NotificationHost.vue'
import { useThemeStore } from '../stores/theme'
import { useLocaleStore } from '../stores/locale'
import { useAnimationsStore } from '../stores/animations'
import { useGifStore } from '../stores/gif'

const { t } = useI18n()
const localeStore = useLocaleStore()
// Element Plus 组件库文案随语言联动
const elementLocale = computed(() => (localeStore.locale === 'en-US' ? en : zhCn))

const themeStore = useThemeStore()
const animationsStore = useAnimationsStore()
const gifStore = useGifStore()
let offSettingsChanged = null

// 「测试」栏目是否显示（开发者选项控制，默认隐藏）
const showTest = ref(false)

// 窗口标题随语言联动
watch(
  () => localeStore.locale,
  () => {
    document.title = t('settings.windowTitle')
  },
  { immediate: true }
)

// 设置树结构：后续新增设置项在此扩展
const treeData = computed(() => {
  const nodes = [
    { id: 'general', label: t('settings.general'), icon: 'Setting' },
    { id: 'roots', label: t('settings.roots'), icon: 'FolderOpened' },
    {
      id: 'appearance',
      label: t('settings.appearance'),
      icon: 'Brush',
      children: [
        { id: 'titlebar', label: t('settings.titlebar') },
        { id: 'sidebar', label: t('settings.sidebar') },
        { id: 'theme', label: t('settings.theme') },
        { id: 'animations', label: t('settings.animations') },
        { id: 'card', label: t('settings.cardPage') }
      ]
    },
    { id: 'shortcuts', label: t('settings.shortcuts'), icon: 'Key' },
    {
      id: 'extensions',
      label: t('settings.extensions'),
      icon: 'MagicStick',
      children: [
        { id: 'favorites', label: t('settings.favorites') },
        { id: 'tags', label: t('settings.tags') },
        { id: 'ai-search', label: t('settings.aiSearch') }
      ]
    },
    { id: 'dev-options', label: t('settings.devOptions'), icon: 'Monitor' }
  ]
  if (showTest.value) {
    nodes.push({ id: 'test', label: t('settings.test'), icon: 'Aim' })
  }
  nodes.push({ id: 'about', label: t('settings.about'), icon: 'InfoFilled' })
  return nodes
})

const pageMap = {
  general: GeneralPage,
  roots: RootsPage,
  'ai-search': AiSearchPage,
  favorites: FavoritesPage,
  tags: TagsPage,
  titlebar: AppearancePage,
  sidebar: SidebarPage,
  theme: ThemePage,
  animations: AnimationsPage,
  test: TestPage,
  'dev-options': DevOptionsPage,
  card: GridPage,
  shortcuts: ShortcutsPage,
  about: AboutPage
}

const currentKey = ref('general')
const currentPage = computed(() => pageMap[currentKey.value] ?? GeneralPage)

function onNodeClick(data) {
  if (!data.children) {
    currentKey.value = data.id
  }
}

onMounted(async () => {
  // 跟随全局主题（主窗口悬浮栏切换后同步）；先加载动画开关（主题过渡依赖它）
  await animationsStore.load()
  themeStore.load()
  localeStore.load()
  await gifStore.load()
  showTest.value = (await window.api.getSetting('showTest', 'false')) === 'true'
  offSettingsChanged = window.api.onSettingsChanged((payload) => {
    themeStore.onSettingsChanged(payload)
    localeStore.onSettingsChanged(payload)
    animationsStore.onSettingsChanged(payload)
    gifStore.onSettingsChanged(payload)
    if (payload?.key === 'showTest') {
      showTest.value = payload.value === 'true'
    }
  })
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
})
</script>

<template>
  <el-config-provider :locale="elementLocale">
    <div class="settings-app">
      <SidebarTree :data="treeData" :current-key="currentKey" @node-click="onNodeClick" />
      <NotificationHost />

      <main class="settings-content">
        <component :is="currentPage" />
      </main>
    </div>
  </el-config-provider>
</template>

<style scoped>
.settings-app {
  height: 100vh;
  display: flex;
  overflow: hidden;
}

.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--app-bg);
  color: var(--app-text);
  padding: 28px 32px;
}
</style>

<style>
/* 设置窗口通用：数值输入框固定不收缩，避免被长文案挤压 */
.settings-app .el-input-number {
  width: 150px;
  min-width: 150px;
  flex: 0 0 auto;
}
.settings-app .dev-row .el-input-number,
.settings-app .perf-row .el-input-number {
  width: 150px;
  min-width: 150px;
}
</style>
