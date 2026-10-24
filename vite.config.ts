import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { devApi } from './scripts/dev-api'
import { mediapipeWasm } from './scripts/mediapipe-wasm'

export default defineConfig({
  plugins: [react(), devApi(), mediapipeWasm()],
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**', 'docs/**', 'tools/**', '.vercel/**', '.dev-store/**'],
    setupFiles: ['./vitest.setup.ts'],
    passWithNoTests: true,
    // balance tests run thousands of simulated fights
    testTimeout: 60_000,
  },
  server: {
    port: 3110,
    host: true,
    // the dev API's database and uploads (scripts/dev-api.ts) change constantly and are never source
    watch: { ignored: ['**/.dev-store/**'] },
  },
})
