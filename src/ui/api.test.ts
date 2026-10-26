// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const OLD = 'a'.repeat(32)
const NEW = 'b'.repeat(32)

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('device IDs on the client', () => {
  it('a device the server forgot (its database was reset) gets a new ID and the upload goes through', async () => {
    localStorage.setItem('psyblr.deviceId', OLD)
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/device') return Response.json({ deviceId: NEW })
      const device = new Headers(init?.headers).get('x-device-id')
      return device === NEW ? Response.json({ url: '/dev-store/heroes/x.webp' }) : Response.json({ error: 'missing or invalid x-device-id' }, { status: 401 })
    })
    vi.stubGlobal('fetch', fetch)
    const { liveDeps } = await import('./api.js')
    const result = await liveDeps.uploadPhoto(new Blob([new Uint8Array([1])], { type: 'image/webp' }))
    expect(result).toEqual({ ok: true, url: '/dev-store/heroes/x.webp' })
    expect(localStorage.getItem('psyblr.deviceId')).toBe(NEW)
    expect(fetch.mock.calls.filter(([url]) => url === '/api/photos/upload')).toHaveLength(2)
  })

  it('an upload says why it failed instead of failing silently', async () => {
    localStorage.setItem('psyblr.deviceId', OLD)
    const answers = [413, 400, 429, 500]
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: answers.shift() })))
    const { liveDeps } = await import('./api.js')
    const reasons = []
    for (let i = 0; i < 4; i++) reasons.push(await liveDeps.uploadPhoto(new Blob([new Uint8Array([1])])))
    expect(reasons.map((r) => !r.ok && r.reason)).toEqual(['too-large', 'not-an-image', 'busy', 'server'])
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))))
    expect(await liveDeps.uploadPhoto(new Blob([new Uint8Array([1])]))).toEqual({ ok: false, reason: 'offline' })
  })
})
