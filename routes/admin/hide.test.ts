import { afterEach, describe, expect, it } from 'vitest'
import { POST } from './hide.js'

const call = (secret?: string) =>
  POST(new Request('https://x.test/api/admin/hide', { method: 'POST', headers: secret === undefined ? {} : { 'x-admin-secret': secret }, body: '{"heroId":"h"}' }))

afterEach(() => {
  delete process.env.ADMIN_SECRET
})

describe('admin takedown auth', () => {
  it('is forbidden with a missing, wrong, or non-ASCII secret', async () => {
    process.env.ADMIN_SECRET = 'a-long-enough-admin-secret'
    expect((await call()).status).toBe(403)
    expect((await call('wrong-secret-of-other-length')).status).toBe(403)
    expect((await call('a-long-enough-admin-secreX')).status).toBe(403)
    expect((await call('é'.repeat(13))).status).toBe(403)
  })
  it('is forbidden when the configured secret is too short', async () => {
    process.env.ADMIN_SECRET = 'short'
    expect((await call('short')).status).toBe(403)
  })
})
