import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import AutoImport from 'unplugin-auto-import/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import * as ElementPlusIcons from '@element-plus/icons-vue'

// 图标按需自动引入：模板里用到的 <Search />、<StarFilled /> 等自动 import。
// Element Plus 图标在 @element-plus/icons-vue 中以组件名导出，这里按导出名精确匹配。
const EP_ICON_NAMES = new Set(Object.keys(ElementPlusIcons))
function ElementPlusIconResolver(name) {
  if (EP_ICON_NAMES.has(name)) return { name, from: '@element-plus/icons-vue' }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // OCR 走 worker 线程，@repeato/ocr 及其内部 sharp/onnxruntime 必须在运行时从
        // node_modules 加载（都是重型原生/模型依赖），不能打进 bundle，故强制外部化
        include: ['@repeato/ocr', 'sharp', 'onnxruntime-node', 'onnxruntime-web']
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.js'),
          'cache-worker': resolve('src/main/cache-worker.mjs'),
          'ocr-worker': resolve('src/main/ocr-worker.mjs')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          settings: resolve('src/renderer/settings.html')
        }
      }
    },
    plugins: [
      vue(),
      // 按需引入 Element Plus 组件 / v-loading 等指令 / 组件样式，
      // 并自动引入 ElMessage、ElMessageBox 等函数式组件（含样式）。
      AutoImport({ resolvers: [ElementPlusResolver()], dts: false }),
      Components({ resolvers: [ElementPlusResolver(), ElementPlusIconResolver], dts: false })
    ]
  }
})
