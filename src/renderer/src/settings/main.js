import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import SettingsApp from './SettingsApp.vue'
import '../assets/main.css'
import { ensureDevMock } from '../dev-mock'
import { i18n } from '../i18n'
import { useLocaleStore } from '../stores/locale'

// 浏览器调试：无 window.api 时注入 mock（Electron 内不生效）
ensureDevMock()

const app = createApp(SettingsApp)

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

const pinia = createPinia()
app.use(pinia)
app.use(i18n)
app.use(ElementPlus, { zIndex: 6000 })
app.mount('#settings-app')

// 挂载后恢复语言设置（el-config-provider 会响应式切换）
useLocaleStore(pinia).load()
