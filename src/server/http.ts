import type { Db } from './db.js'
import { localDev } from './dev-store.js'
import { NotFoundError, OwnershipError, StoreInputError, isKnownDevice } from './store.js'
import { PhotoError } from './blob.js'
import { RateLimiter, requestKeys } from './rate-limit.js'

/** Shared helpers for the API routes. */

export function deviceId(request: Request): string | undefined {
  const id = request.headers.get('x-device-id') ?? ''
  return /^[0-9a-f]{32}$/.test(id) ? id : undefined
}

/** The device ID, only when the server issued it. Write routes use this. */
export async function knownDeviceId(request: Request, db: Db): Promise<string | undefined> {
  const id = deviceId(request)
  return id && (await isKnownDevice(db, id)) ? id : undefined
}

export async function readJson(request: Request, maxBytes = 50_000): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > maxBytes) throw new StoreInputError('request too large')
  try {
    return JSON.parse(text)
  } catch {
    throw new StoreInputError('invalid JSON')
  }
}

const writeLimiter = new RateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 })

export function overLimit(request: Request, limiter = writeLimiter): boolean {
  // every request to the local dev server comes from 127.0.0.1, so one person testing would trip a per-address limit
  if (localDev(process.env)) return false
  return !limiter.take(requestKeys(request))
}

/** Map store errors to HTTP responses; anything else is a 500. */
export function errorResponse(error: unknown): Response {
  if (error instanceof NotFoundError) return Response.json({ error: error.message }, { status: 404 })
  if (error instanceof OwnershipError) return Response.json({ error: error.message }, { status: 403 })
  if (error instanceof StoreInputError || error instanceof PhotoError) return Response.json({ error: error.message }, { status: 400 })
  const status = (error as { status?: unknown } | null)?.status
  if (error instanceof Error && typeof status === 'number' && status >= 400 && status < 600) return Response.json({ error: error.message }, { status })
  console.error(error)
  return Response.json({ error: 'server error' }, { status: 500 })
}

export const needDevice = () => Response.json({ error: 'missing or invalid x-device-id' }, { status: 401 })
export const tooMany = () => Response.json({ error: 'too many requests' }, { status: 429 })

/** The client IP as Vercel reports it (the first x-forwarded-for hop). */
export function clientIp(request: Request): string {
  return (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
}
