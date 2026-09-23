import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default [
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'resources/**',
      'build/**',
      // 仓库内的临时调试脚本，不参与产品代码
      'locate-dir.mjs',
      'thumb-child.js',
      'worker-thumb-test.mjs',
      'scripts/gen_mock_imgs.py'
    ]
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module'
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      // eslint 10 新增：对 `let x = a; ... x = b` 这类「初始赋值未读取」报警。
      // 在本项目中误报较多且属风格问题，关闭。
      'no-useless-assignment': 'off',
      'no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    files: ['src/main/**/*.{js,mjs}', 'scripts/**/*.mjs', '*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    // preload 运行在渲染进程的隔离上下文，既有 Node 能力又能访问 window
    files: ['src/preload/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    }
  },
  {
    files: ['src/renderer/**/*.{js,vue}'],
    languageOptions: {
      globals: { ...globals.browser }
    },
    rules: {
      // 渲染层大量 API（ref/computed/ElMessage/图标组件等）由 unplugin-auto-import
      // 在构建期注入，ESLint 静态分析看不到，故关闭 no-undef 交给 Vue 编译器与构建兜底。
      'no-undef': 'off',
      'vue/multi-word-component-names': 'off'
    }
  },
  prettier
]
