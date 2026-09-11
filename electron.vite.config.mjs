import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

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
    plugins: [vue()]
  }
})
