/**
 * Fixed-window rate limiter keyed by device ID and IP (U9, U10). In-memory, so each serverless instance
 * counts on its own; that caps abuse per instance. A shared counter (Postgres or a Vercel Firewall rule)
 * is the follow-up when traffic needs a global limit.
 */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>()

  constructor(private readonly options: { limit: number; windowMs: number }) {}

  /** Records one hit for every key; returns false when any key is over its limit. */
  take(keys: string[], now = Date.now()): boolean {
    let allowed = true
    for (const key of keys.filter(Boolean)) {
      const entry = this.hits.get(key)
      if (!entry || now - entry.start >= this.options.windowMs) {
        this.hits.set(key, { start: now, count: 1 })
        continue
      }
      entry.count++
      if (entry.count > this.options.limit) allowed = false
    }
    return allowed
  }
}

/** Device ID and client IP from a request, for rate-limit keys. */
export function requestKeys(request: Request): string[] {
  const device = request.headers.get('x-device-id') ?? ''
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  return [device && `device:${device.slice(0, 64)}`, ip && `ip:${ip}`].filter(Boolean)
}
