import { describe, expect, it } from 'vitest'
import { blobStoreId, isOwnPhotoUrl } from './photo-url.js'
import { RateLimiter, requestKeys } from './rate-limit.js'
import { deviceId, errorResponse, readJson } from './http.js'
import { NotFoundError, OwnershipError, StoreInputError } from './store.js'

const req = (headers: Record<string, string> = {}, body = '') => new Request('https://x.test/api', { method: 'POST', headers, body })

describe('photo URL allowlist', () => {
  const env = { BLOB_STORE_ID: 'MyStore1' }
  it('accepts only this store\'s uploaded hero photos', () => {
    expect(isOwnPhotoUrl('https://mystore1.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', env)).toBe(true)
    expect(isOwnPhotoUrl('https://otherstore.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', env)).toBe(false)
    expect(isOwnPhotoUrl('https://mystore1.public.blob.vercel-storage.com/evil.html', env)).toBe(false)
    expect(isOwnPhotoUrl('http://mystore1.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', env)).toBe(false)
    expect(isOwnPhotoUrl('not a url', env)).toBe(false)
  })
  it("accepts the dev store's own uploads only on the local dev server", () => {
    const url = '/dev-store/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp'
    expect(isOwnPhotoUrl(url, { FORGE_FAKE_PROVIDERS: '1' })).toBe(true)
    expect(isOwnPhotoUrl(url, {})).toBe(false)
    expect(isOwnPhotoUrl(url, { FORGE_FAKE_PROVIDERS: '1', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_AbC123_x' })).toBe(false)
    expect(isOwnPhotoUrl(url, { FORGE_FAKE_PROVIDERS: '1', VERCEL: '1', VERCEL_ENV: 'preview' })).toBe(false)
    expect(isOwnPhotoUrl(url, { FORGE_FAKE_PROVIDERS: '1', NODE_ENV: 'production' })).toBe(false)
    expect(isOwnPhotoUrl('/dev-store/heroes/../../../etc/passwd.webp', { FORGE_FAKE_PROVIDERS: '1' })).toBe(false)
  })
  it('reads the store ID from the read-write token when BLOB_STORE_ID is unset', () => {
    expect(blobStoreId({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_AbC123_secretpart' })).toBe('abc123')
    expect(blobStoreId({})).toBeUndefined()
    expect(isOwnPhotoUrl('https://teststore.public.blob.vercel-storage.com/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', {})).toBe(false)
  })
})

describe('rate limiter', () => {
  it('allows up to the limit per key inside a window, then refuses, then resets', () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000 })
    expect(limiter.take(['a'], 0)).toBe(true)
    expect(limiter.take(['a'], 10)).toBe(true)
    expect(limiter.take(['a'], 20)).toBe(false)
    expect(limiter.take(['b'], 20)).toBe(true)
    expect(limiter.take(['a'], 1500)).toBe(true)
  })
  it('keys by device and first forwarded IP', () => {
    expect(requestKeys(req({ 'x-device-id': 'd1', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toEqual(['device:d1', 'ip:1.2.3.4'])
  })
})

describe('http helpers', () => {
  it('accepts only 128-bit hex device IDs', () => {
    expect(deviceId(req({ 'x-device-id': 'a'.repeat(32) }))).toBe('a'.repeat(32))
    expect(deviceId(req({ 'x-device-id': 'not-a-device' }))).toBeUndefined()
    expect(deviceId(req())).toBeUndefined()
  })
  it('rejects oversize and malformed JSON bodies', async () => {
    await expect(readJson(req({}, 'x'.repeat(100)), 10)).rejects.toBeInstanceOf(StoreInputError)
    await expect(readJson(req({}, '{oops'))).rejects.toBeInstanceOf(StoreInputError)
    expect(await readJson(req({}, '{"a":1}'))).toEqual({ a: 1 })
  })
  it('maps store errors to HTTP status codes', () => {
    expect(errorResponse(new NotFoundError('x')).status).toBe(404)
    expect(errorResponse(new OwnershipError('x')).status).toBe(403)
    expect(errorResponse(new StoreInputError('x')).status).toBe(400)
  })
})
