import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import './assets/main.css'
import { ensureDevMock } from './dev-mock'
import { i18n } from './i18n'
import { useLocaleStore } from './stores/locale'

// 浏览器调试：无 window.api 时注入 mock（Electron 内不生效）
ensureDevMock()

const app = createApp(App)

// 全局注册 Element Plus 图标组件（模板中可直接 <Minus /> <Close /> 等）
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

const pinia = createPinia()
app.use(pinia)
app.use(i18n)
// Element Plus 组件库文案由 App.vue 中的 el-config-provider 按当前语言动态提供
app.use(ElementPlus)
app.mount('#app')

// 挂载后恢复语言设置（el-config-provider 会响应式切换）
useLocaleStore(pinia).load()
