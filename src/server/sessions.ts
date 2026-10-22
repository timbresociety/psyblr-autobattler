import type { Env } from '../forge/providers/types'
import { isProduction } from '../forge/providers/router'
import { LIMITS } from './accounts'

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
