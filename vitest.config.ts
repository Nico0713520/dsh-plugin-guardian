import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Keep the entry smoke test self-contained; the real package is used
      // for types and the production build (see src/__stubs__/dsh-tools.ts).
      '@deepseek-ai/dsh-tools': fileURLToPath(new URL('./src/__stubs__/dsh-tools.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
