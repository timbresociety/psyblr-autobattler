import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { SCHEMA_SQL, type Db } from './db'
import { AuthError, getSession, logout, normalizeEmail, startSignIn, verifySignIn } from './accounts'
import { fakeEmailSender, pickEmailSender } from './email'
import { readSessionCookie, sessionCookie } from './sessions'

let db: Db
let mail: ReturnType<typeof fakeEmailSender>
const BASE = 'https://psyblr.test'
const tokenFrom = (text: string) => /signin=([\w-]+)/.exec(text)![1]

beforeEach(async () => {
  const pg = new PGlite()
  await pg.exec(SCHEMA_SQL)
  db = pg as unknown as Db
  mail = fakeEmailSender()
})

async function signIn(email: string, ip = '1.1.1.1', now = new Date()) {
  await startSignIn(db, email, ip, mail, BASE, now)
  return verifySignIn(db, tokenFrom(mail.outbox.at(-1)!.text), ip, 'd'.repeat(32), now)
}

describe('accounts and sessions (U7)', () => {
  it('starting sign-in sends one link', async () => {
    await startSignIn(db, 'Jen@Example.com', '1.1.1.1', mail, BASE)
    expect(mail.outbox).toHaveLength(1)
    expect(mail.outbox[0].text).toMatch(/https:\/\/psyblr\.test\/\?signin=/)
  })

  it('a valid token creates a session once; reuse is rejected', async () => {
    await startSignIn(db, 'a@example.com', '1.1.1.1', mail, BASE)
    const token = tokenFrom(mail.outbox[0].text)
    const first = await verifySignIn(db, token, '1.1.1.1', undefined)
    expect(first.isNew).toBe(true)
    await expect(verifySignIn(db, token, '1.1.1.1', undefined)).rejects.toMatchObject({ status: 401 })
  })

  it('an expired token is rejected', async () => {
    const t0 = new Date('2026-10-22T10:00:00Z')
    await startSignIn(db, 'a@example.com', '1.1.1.1', mail, BASE, t0)
    const later = new Date('2026-10-22T10:20:00Z')
    await expect(verifySignIn(db, tokenFrom(mail.outbox[0].text), '1.1.1.1', undefined, later)).rejects.toBeInstanceOf(AuthError)
  })

  it('a fourth new account from one IP in a day is refused', async () => {
    for (const e of ['a@x.com', 'b@x.com', 'c@x.com']) await signIn(e, '9.9.9.9')
    await expect(signIn('d@x.com', '9.9.9.9')).rejects.toMatchObject({ status: 429 })
  })

  it('a sixth sign-in link for one email within an hour is refused without sending', async () => {
    for (let i = 0; i < 5; i++) await startSignIn(db, 'spam@example.com', `2.2.2.${i}`, mail, BASE)
    await expect(startSignIn(db, 'spam@example.com', '2.2.2.9', mail, BASE)).rejects.toMatchObject({ status: 429 })
    expect(mail.outbox).toHaveLength(5)
  })

  it('Gmail aliases normalise to one person', () => {
    expect(normalizeEmail('A.B+promo@Gmail.com')).toBe(normalizeEmail('ab@googlemail.com'))
    expect(normalizeEmail('a.b+x@work.com')).toBe('a.b@work.com')
  })

  it('aliases share one account', async () => {
    const one = await signIn('a.b+x@gmail.com', '3.3.3.3')
    const two = await signIn('ab@gmail.com', '3.3.3.4')
    expect(two.accountId).toBe(one.accountId)
    expect(two.isNew).toBe(false)
  })

  it('a disposable-email domain is refused', async () => {
    await expect(startSignIn(db, 'x@mailinator.com', '1.1.1.1', mail, BASE)).rejects.toMatchObject({ status: 400 })
  })

  it('a session authenticates; a tampered one does not; logout and 30 idle days end it', async () => {
    const t0 = new Date('2026-10-01T00:00:00Z')
    const s = await signIn('s@example.com', '4.4.4.4', t0)
    expect(await getSession(db, s.sessionId, t0)).toMatchObject({ accountId: s.accountId, deviceId: 'd'.repeat(32) })
    expect(await getSession(db, s.sessionId.replace(/.$/, s.sessionId.endsWith('0') ? '1' : '0'), t0)).toBeUndefined()
    expect(await getSession(db, s.sessionId, new Date('2026-11-05T00:00:00Z'))).toBeUndefined()
    const s2 = await signIn('s@example.com', '4.4.4.4')
    await logout(db, s2.sessionId)
    expect(await getSession(db, s2.sessionId)).toBeUndefined()
  })

  it('in production without an email key, sign-in is unavailable and no link is produced', async () => {
    const sender = pickEmailSender({ VERCEL_ENV: 'production' })
    expect(sender).toBeUndefined()
    await expect(startSignIn(db, 'a@example.com', '1.1.1.1', sender, BASE)).rejects.toMatchObject({ status: 503 })
  })

  it('the session cookie is HttpOnly, and Secure in production', () => {
    expect(sessionCookie('abc', {})).toMatch(/HttpOnly; SameSite=Lax/)
    expect(sessionCookie('abc', {})).not.toMatch(/Secure/)
    expect(sessionCookie('abc', { VERCEL_ENV: 'production' })).toMatch(/; Secure$/)
    expect(readSessionCookie(new Request('https://x', { headers: { cookie: 'a=1; psyblr_session=xyz' } }))).toBe('xyz')
  })
})
