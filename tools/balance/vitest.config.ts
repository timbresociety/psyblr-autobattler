import { defineConfig } from 'vitest/config'

// The balance tuners: run on purpose, never in the normal suite (each one plays thousands of fights).
export default defineConfig({
  test: { include: ['tools/balance/**/*.test.ts'], testTimeout: 0, hookTimeout: 0 },
})
