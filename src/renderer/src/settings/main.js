import { createApp } from 'vue'
import { createPinia } from 'pinia'
// 深色主题变量（组件样式本身由 unplugin 按需注入）
import 'element-plus/theme-chalk/dark/css-vars.css'
import SettingsApp from './SettingsApp.vue'
import '../assets/main.css'
import { i18n } from '../i18n'
import { useLocaleStore } from '../stores/locale'

async function bootstrap() {
  // 浏览器调试：无 window.api 时注入 mock；仅在开发构建动态引入，生产包不含 dev-mock
  if (import.meta.env.DEV) {
    const { ensureDevMock } = await import('../dev-mock')
    ensureDevMock()
  }

  const app = createApp(SettingsApp)

  const pinia = createPinia()
  app.use(pinia)
  app.use(i18n)
  // Element Plus 组件/图标按需自动引入（见 electron.vite.config.mjs）
  app.mount('#settings-app')

  // 挂载后恢复语言设置（el-config-provider 会响应式切换）
  useLocaleStore(pinia).load()
}

bootstrap()
