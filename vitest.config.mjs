import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,mjs}', 'scripts/**/*.test.mjs'],
    exclude: ['node_modules/**', 'out/**', 'dist/**']
  }
})
