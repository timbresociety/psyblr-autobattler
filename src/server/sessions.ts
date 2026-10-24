import type { Env } from '../forge/providers/types.js'
import { isProduction } from '../forge/providers/router.js'
import { LIMITS, getSession, type Session } from './accounts.js'
import type { Db } from './db.js'

export const SESSION_COOKIE = 'psyblr_session'

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === SESSION_COOKIE) return value.join('=')
  }
  return undefined
}

/** HttpOnly, SameSite=Lax, Secure in production (KTD5). */
export function sessionCookie(sessionId: string, env: Env): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${LIMITS.sessionIdleDays * 86_400}${isProduction(env) ? '; Secure' : ''}`
}

export function clearedCookie(env: Env): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProduction(env) ? '; Secure' : ''}`
}

/** The signed-in account for a request, or a 401 error (KTD12: forge and credit routes need an account). */
export async function requireAccount(request: Request, db: Db): Promise<Session> {
  const session = await getSession(db, readSessionCookie(request))
  if (!session) throw Object.assign(new Error('sign in first'), { status: 401 })
  return session
}
