import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Pure-function unit tests only (no DOM/Electron). Alias mirrors tsconfig so
// `@/lib/...` imports resolve inside tests. Vitest naturally ignores
// node_modules/dist; we scope `include` to source test files explicitly.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/lib\/(.*)$/, replacement: path.resolve(__dirname, 'src/renderer/lib/$1') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'src/renderer/$1') },
      { find: /^@shared\/(.*)$/, replacement: path.resolve(__dirname, 'src/shared/$1') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
