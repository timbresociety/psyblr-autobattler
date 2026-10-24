import { describe, expect, it } from 'vitest'
import * as plugin from '../../scripts/dev-api.js'
import { DEV_STORE_DIR, DEV_STORE_PATH, devStoreActive, localDev } from './dev-store.js'

describe('dev store', () => {
  it('the dev server plugin serves the same folder and path the API writes to', () => {
    expect(plugin.DEV_STORE_DIR).toBe(DEV_STORE_DIR)
    expect(plugin.DEV_STORE_PATH).toBe(DEV_STORE_PATH)
  })

  it('is the local dev server only: never on Vercel, never in production, never with a Blob store', () => {
    expect(localDev({ FORGE_FAKE_PROVIDERS: '1' })).toBe(true)
    expect(devStoreActive({ FORGE_FAKE_PROVIDERS: '1' })).toBe(true)
    expect(devStoreActive({ FORGE_FAKE_PROVIDERS: '1', BLOB_READ_WRITE_TOKEN: 'x' })).toBe(false)
    expect(localDev({ FORGE_FAKE_PROVIDERS: '1', VERCEL: '1', VERCEL_ENV: 'preview' })).toBe(false)
    expect(localDev({ FORGE_FAKE_PROVIDERS: '1', NODE_ENV: 'production' })).toBe(false)
    expect(localDev({})).toBe(false)
  })
})
