import { describe, expect, it, vi } from 'vitest'
import { MAX_PHOTO_BYTES, PhotoError, detectImageType, devPut, pickPut, uploadPhoto } from './blob'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

describe('photo upload', () => {
  it('detects real image types from content bytes', () => {
    expect(detectImageType(png)).toBe('png')
    expect(detectImageType(jpeg)).toBe('jpeg')
    expect(detectImageType(webp)).toBe('webp')
    expect(detectImageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeUndefined()
  })

  it('rejects a non-image even when it claims to be one', async () => {
    const put = vi.fn()
    await expect(uploadPhoto(new TextEncoder().encode('#!/bin/sh'), { put })).rejects.toBeInstanceOf(PhotoError)
    expect(put).not.toHaveBeenCalled()
  })

  it('rejects an upload over the size limit', async () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1)
    big.set(png)
    await expect(uploadPhoto(big, { put: vi.fn() })).rejects.toBeInstanceOf(PhotoError)
  })

  it('stores a re-encoded image under a random server-made name', async () => {
    const put = vi.fn(async (path: string) => ({ url: `https://x.public.blob.vercel-storage.com/${path}` }))
    const a = await uploadPhoto(png, { put })
    const b = await uploadPhoto(png, { put })
    expect(a.url).not.toBe(b.url)
    expect(put.mock.calls[0][0]).toMatch(/^heroes\/[0-9a-f-]{36}\.webp$/)
  })

  it('keeps photos working on the local dev server: a data URL with fakes on and no Blob token, never in production', async () => {
    expect(pickPut({ FORGE_FAKE_PROVIDERS: '1' })).toBe(devPut)
    expect(pickPut({ FORGE_FAKE_PROVIDERS: '1', BLOB_READ_WRITE_TOKEN: 'set' })).toBeUndefined()
    expect(pickPut({ FORGE_FAKE_PROVIDERS: '1', VERCEL_ENV: 'production' })).toBeUndefined()
    expect(pickPut({})).toBeUndefined()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const { url } = await uploadPhoto(png, { put: devPut })
    expect(url).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
  })
})
