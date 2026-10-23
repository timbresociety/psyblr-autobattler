import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Db } from './db'
import type { EmailSender } from './email'

/**
 * Email magic-link sign-in (KTD5). Tokens and session IDs are stored only as hashes. Emails are normalised so
 * aliases count as one person, and durable counters cap sign-in links, new accounts and free grants.
 */

export class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export const LIMITS = {
  linksPerEmailPerHour: 5,
  linksPerIpPerHour: 20,
  accountsPerIpPerDay: 3,
  tokenMinutes: 15,
  sessionIdleDays: 30,
}

const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'trashmail.com', 'yopmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc'])

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  const [local, domain] = email.split('@')
  const gmail = domain === 'gmail.com' || domain === 'googlemail.com'
  const base = local.split('+')[0]
  return `${gmail ? base.replace(/\./g, '') : base}@${gmail ? 'gmail.com' : domain}`
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const hourBucket = (now: Date) => now.toISOString().slice(0, 13)
const dayBucket = (now: Date) => now.toISOString().slice(0, 10)

/** Increment a counter and return the new count. */
export async function bump(db: Db, key: string, bucket: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    'insert into counters (key, bucket, count) values ($1, $2, 1) on conflict (key, bucket) do update set count = counters.count + 1 returning count',
    [key, bucket],
  )
  return rows[0].count
}

export async function readCount(db: Db, key: string, bucket: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>('select count from counters where key = $1 and bucket = $2', [key, bucket])
  return rows[0]?.count ?? 0
}

export { dayBucket }

/** Sends a one-time sign-in link and returns it; only the dev server ever shows it to the player (devSignInLink). */
export async function startSignIn(db: Db, rawEmail: string, ip: string, sender: EmailSender | undefined, baseUrl: string, now = new Date()): Promise<string> {
  if (!sender) throw new AuthError('sign-in is not available right now', 503)
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email)) throw new AuthError('enter a valid email', 400)
  if (DISPOSABLE.has(email.split('@')[1])) throw new AuthError('disposable email addresses are not accepted', 400)
  const normalized = normalizeEmail(email)
  if ((await bump(db, `link-email:${normalized}`, hourBucket(now))) > LIMITS.linksPerEmailPerHour) throw new AuthError('too many sign-in links for this email; try again later', 429)
  if ((await bump(db, `link-ip:${ip}`, hourBucket(now))) > LIMITS.linksPerIpPerHour) throw new AuthError('too many sign-in attempts; try again later', 429)
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(now.getTime() + LIMITS.tokenMinutes * 60_000)
  await db.query('insert into login_tokens (token_hash, email, expires_at) values ($1, $2, $3)', [sha(token), email, expires.toISOString()])
  const link = `${baseUrl}/?signin=${token}`
  await sender.send(email, 'Your psyblr sign-in link', `Sign in to forge your hero: ${link}\nThe link works once and expires in ${LIMITS.tokenMinutes} minutes.`)
  return link
}

export interface SignedIn {
  sessionId: string
  accountId: string
  isNew: boolean
}

export async function verifySignIn(db: Db, token: string, ip: string, deviceId: string | undefined, now = new Date()): Promise<SignedIn> {
  // claim the token atomically: a reused or expired token updates nothing
  const { rows } = await db.query<{ email: string }>(
    'update login_tokens set used_at = $2 where token_hash = $1 and used_at is null and expires_at > $2 returning email',
    [sha(token), now.toISOString()],
  )
  if (!rows.length) throw new AuthError('this sign-in link is invalid or has expired', 401)
  const email = rows[0].email
  const normalized = normalizeEmail(email)
  let isNew = false
  let account = (await db.query<{ id: string }>('select id from accounts where email_normalized = $1', [normalized])).rows[0]
  if (!account) {
    if ((await bump(db, `accounts-ip:${ip}`, dayBucket(now))) > LIMITS.accountsPerIpPerDay) throw new AuthError('too many new accounts from this network today', 429)
    account = { id: randomUUID() }
    await db.query('insert into accounts (id, email, email_normalized, created_ip) values ($1, $2, $3, $4)', [account.id, email, normalized, ip])
    isNew = true
  }
  const sessionId = randomBytes(32).toString('hex')
  await db.query('insert into sessions (id_hash, account_id, device_id, last_seen_at) values ($1, $2, $3, $4)', [sha(sessionId), account.id, deviceId ?? null, now.toISOString()])
  return { sessionId, accountId: account.id, isNew }
}

export interface Session {
  accountId: string
  deviceId?: string
}

export async function getSession(db: Db, sessionId: string | undefined, now = new Date()): Promise<Session | undefined> {
  if (!sessionId || !/^[0-9a-f]{64}$/.test(sessionId)) return undefined
  const idle = new Date(now.getTime() - LIMITS.sessionIdleDays * 86_400_000)
  const { rows } = await db.query<{ account_id: string; device_id: string | null }>(
    'update sessions set last_seen_at = $2 where id_hash = $1 and last_seen_at > $3 returning account_id, device_id',
    [sha(sessionId), now.toISOString(), idle.toISOString()],
  )
  return rows[0] ? { accountId: rows[0].account_id, ...(rows[0].device_id ? { deviceId: rows[0].device_id } : {}) } : undefined
}

export async function logout(db: Db, sessionId: string): Promise<void> {
  await db.query('delete from sessions where id_hash = $1', [sha(sessionId)])
}

export async function accountEmail(db: Db, accountId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ email: string }>('select email from accounts where id = $1', [accountId])
  return rows[0]?.email
}
