import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { devApi } from './scripts/dev-api'

export default defineConfig({
  plugins: [react(), devApi()],
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**', 'docs/**', 'tools/**'],
    setupFiles: ['./vitest.setup.ts'],
    passWithNoTests: true,
    // balance tests run thousands of simulated fights
    testTimeout: 60_000,
  },
  server: {
    port: 3110,
    host: true,
  },
})
