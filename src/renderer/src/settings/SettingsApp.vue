<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Setting,
  FolderOpened,
  Brush,
  Key,
  MagicStick,
  Monitor,
  Aim,
  InfoFilled,
  Grid
} from '@element-plus/icons-vue'
import en from 'element-plus/es/locale/lang/en'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import SidebarTree from './SidebarTree.vue'
import NotificationHost from '../components/NotificationHost.vue'

// 设置页按需懒加载：避免设置窗口启动时一次性编译全部页面（含较重的测试/根目录/OCR 页）
const GeneralPage = defineAsyncComponent(() => import('./pages/GeneralPage.vue'))
const RootsPage = defineAsyncComponent(() => import('./pages/RootsPage.vue'))
const FavoritesPage = defineAsyncComponent(() => import('./pages/FavoritesPage.vue'))
const TagsPage = defineAsyncComponent(() => import('./pages/TagsPage.vue'))
const AppearancePage = defineAsyncComponent(() => import('./pages/AppearancePage.vue'))
const ThemePage = defineAsyncComponent(() => import('./pages/ThemePage.vue'))
const SidebarPage = defineAsyncComponent(() => import('./pages/SidebarPage.vue'))
const AnimationsPage = defineAsyncComponent(() => import('./pages/AnimationsPage.vue'))
const AiSearchPage = defineAsyncComponent(() => import('./pages/AiSearchPage.vue'))
const OcrSearchPage = defineAsyncComponent(() => import('./pages/OcrSearchPage.vue'))
const AboutPage = defineAsyncComponent(() => import('./pages/AboutPage.vue'))
const TestPage = defineAsyncComponent(() => import('./pages/TestPage.vue'))
const DevOptionsPage = defineAsyncComponent(() => import('./pages/DevOptionsPage.vue'))
const ShortcutsPage = defineAsyncComponent(() => import('./pages/ShortcutsPage.vue'))
const GridPage = defineAsyncComponent(() => import('./pages/GridPage.vue'))
const PerformancePage = defineAsyncComponent(() => import('./pages/PerformancePage.vue'))
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
// 隐藏功能是否显示（开发者选项控制，默认隐藏；如 AI 搜索）
const showHidden = ref(false)

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
    { id: 'general', label: t('settings.general'), icon: Setting },
    { id: 'roots', label: t('settings.roots'), icon: FolderOpened },
    {
      id: 'appearance',
      label: t('settings.appearance'),
      icon: Brush,
      children: [
        { id: 'titlebar', label: t('settings.titlebar') },
        { id: 'sidebar', label: t('settings.sidebar') },
        { id: 'theme', label: t('settings.theme') },
        { id: 'animations', label: t('settings.animations') }
      ]
    },
    {
      id: 'browse',
      label: t('settings.browse'),
      icon: Grid,
      children: [
        { id: 'card', label: t('settings.cardPage') },
        { id: 'performance', label: t('settings.performance') }
      ]
    },
    { id: 'shortcuts', label: t('settings.shortcuts'), icon: Key },
    {
      id: 'extensions',
      label: t('settings.extensions'),
      icon: MagicStick,
      children: [
        { id: 'favorites', label: t('settings.favorites') },
        { id: 'tags', label: t('settings.tags') },
        // AI 搜索默认隐藏：平时不显示，搜索命中时以「隐藏」标签临时出现
        { id: 'ai-search', label: t('settings.aiSearch'), hidden: !showHidden.value },
        { id: 'ocr-search', label: t('settings.ocrSearch') }
      ]
    },
    { id: 'dev-options', label: t('settings.devOptions'), icon: Monitor },
    // 测试栏目默认隐藏，同上：仅搜索命中时出现
    { id: 'test', label: t('settings.test'), icon: Aim, hidden: !showTest.value },
    { id: 'about', label: t('settings.about'), icon: InfoFilled }
  ]
  return nodes
})

const pageMap = {
  general: GeneralPage,
  roots: RootsPage,
  'ai-search': AiSearchPage,
  'ocr-search': OcrSearchPage,
  favorites: FavoritesPage,
  tags: TagsPage,
  titlebar: AppearancePage,
  sidebar: SidebarPage,
  theme: ThemePage,
  animations: AnimationsPage,
  test: TestPage,
  'dev-options': DevOptionsPage,
  card: GridPage,
  performance: PerformancePage,
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
  showHidden.value = (await window.api.getSetting('showHidden', 'false')) === 'true'
  offSettingsChanged = window.api.onSettingsChanged((payload) => {
    themeStore.onSettingsChanged(payload)
    localeStore.onSettingsChanged(payload)
    animationsStore.onSettingsChanged(payload)
    gifStore.onSettingsChanged(payload)
    if (payload?.key === 'showTest') {
      showTest.value = payload.value === 'true'
    }
    if (payload?.key === 'showHidden') {
      showHidden.value = payload.value === 'true'
      // 关闭隐藏功能时，若正停在已隐藏的栏目上，退回常规页
      if (!showHidden.value && currentKey.value === 'ai-search') {
        currentKey.value = 'general'
      }
    }
  })
})

onBeforeUnmount(() => {
  offSettingsChanged?.()
})
</script>

<template>
  <!-- zIndex 基准与主窗口一致（见 App.vue），确保弹层高于通知/灯箱 -->
  <el-config-provider :locale="elementLocale" :z-index="6000">
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
/* 内容列：宽屏居中并限制可读行宽；含宽表格的页面用 .page--wide 放宽。
   各页不再各自声明 max-width（此前的 720px 已由此统一接管）。 */
.settings-app .settings-content .page {
  max-width: 720px;
  margin-inline: auto;
}

.settings-app .settings-content .page.page--wide {
  max-width: 1160px;
}

/* 设置页通用布局：页面标题/描述、分隔线间距、控件宽度统一在此定义，
   各页不再重复声明。选择器带上 .settings-content 以提高优先级。 */
.settings-app .settings-content .page h2 {
  margin: 0 0 6px;
  font-size: 20px;
}

.settings-app .settings-content .page-desc {
  margin: 0 0 24px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.settings-app .settings-content .page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

/* page-head 内的描述不再重复占底部间距 */
.settings-app .settings-content .page-head .page-desc {
  margin-bottom: 0;
}

.settings-app .settings-content .el-divider--horizontal {
  margin: 14px 0;
}

/* 数值输入框固定不收缩，避免被长文案挤压 */
.settings-app .el-input-number {
  width: 150px;
  min-width: 150px;
  flex: 0 0 auto;
}

/* 下拉选择框统一宽度 */
.settings-app .setting-select {
  width: 180px;
  flex-shrink: 0;
}
</style>
