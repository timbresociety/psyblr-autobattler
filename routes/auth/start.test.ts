import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SCHEMA_SQL, useDevDb, type Db } from '../../src/server/db.js'
import { POST } from './start.js'

beforeAll(async () => {
  const pg = new PGlite()
  await pg.exec(SCHEMA_SQL)
  useDevDb(Promise.resolve(pg as unknown as Db))
})

afterEach(() => {
  delete process.env.FORGE_FAKE_PROVIDERS
})

const start = (email: string) =>
  POST(new Request('http://localhost:3110/api/auth/start', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' }, body: JSON.stringify({ email }) }))

describe('POST /api/auth/start', () => {
  it('on the dev server (fake providers), returns the sign-in link it would have emailed', async () => {
    process.env.FORGE_FAKE_PROVIDERS = '1'
    const body = (await (await start('dev@example.com')).json()) as { sent: boolean; devLink?: string }
    expect(body.sent).toBe(true)
    expect(body.devLink).toMatch(/^http:\/\/localhost:3110\/\?signin=[\w-]+$/)
  })

  it('anywhere else, only says it was sent', async () => {
    const body = (await (await start('other@example.com')).json()) as { sent: boolean; devLink?: string }
    expect(body).toEqual({ sent: true })
  })
})
