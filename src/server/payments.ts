import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { PACKS, type CreditPack } from '../forge/pricing.js'
import { isProduction } from '../forge/providers/router.js'
import { TIMEOUT_MS, type FetchLike } from '../forge/providers/live/http.js'
import type { Env } from '../forge/providers/types.js'
import { grantPurchase } from './credits.js'
import type { Db } from './db.js'

/**
 * Prepaid credits (KTD6). A purchase takes only a pack ID; credits are granted from the verified payment, never
 * from client input or mutable metadata. The fake completes instantly and exists only outside production.
 */
export interface PaymentsAdapter {
  id: string
  checkout(db: Db, pack: CreditPack, accountId: string, returnUrl: string): Promise<{ url: string }>
}

export function packById(id: unknown): CreditPack | undefined {
  return PACKS.find((p) => p.id === id)
}

export function fakePayments(): PaymentsAdapter {
  return {
    id: 'fake-payments',
    async checkout(db, pack, accountId, returnUrl) {
      const session = `fake_${randomUUID()}`
      await grantPurchase(db, accountId, pack.credits, `fake:${session}`)
      return { url: `${returnUrl}?purchase=complete` }
    },
  }
}

export function stripePayments(env: Env, fetchImpl: FetchLike = fetch): PaymentsAdapter {
  return {
    id: 'stripe',
    async checkout(_db, pack, accountId, returnUrl) {
      const price = env[pack.stripePriceEnv]
      if (!price) throw new Error(`missing ${pack.stripePriceEnv}`)
      const form = new URLSearchParams({
        mode: 'payment',
        'line_items[0][price]': price,
        'line_items[0][quantity]': '1',
        client_reference_id: accountId,
        success_url: `${returnUrl}?purchase=complete`,
        cancel_url: `${returnUrl}?purchase=cancelled`,
      })
      const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        method: 'POST',
        headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
      const json = (await res.json()) as { url?: string; error?: { message?: string } }
      if (!res.ok || !json.url) throw new Error(`checkout failed: ${json.error?.message ?? res.status}`)
      return { url: json.url }
    },
  }
}

/** Stripe when configured; the fake only outside production; undefined means purchases are unavailable. */
export function pickPayments(env: Env, fetchImpl?: FetchLike): PaymentsAdapter | undefined {
  if (env.STRIPE_SECRET_KEY) return stripePayments(env, fetchImpl)
  return isProduction(env) ? undefined : fakePayments()
}

/** Verify a Stripe-Signature header (t=..., v1=...) within a 5-minute tolerance. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > 300 || !parts.v1) return false
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(parts.v1)
  return a.length === b.length && timingSafeEqual(a, b)
}

interface StripeEvent {
  id: string
  type: string
  data: { object: { client_reference_id?: string; amount_total?: number; currency?: string; payment_status?: string } }
}

/** Grant credits for a completed checkout. The pack is matched by the verified amount and currency. */
export async function handleStripeEvent(db: Db, payload: string, signature: string | null, env: Env, nowSeconds?: number): Promise<{ granted: number }> {
  if (!verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET ?? '', nowSeconds)) throw Object.assign(new Error('bad signature'), { status: 400 })
  const event = JSON.parse(payload) as StripeEvent
  if (event.type !== 'checkout.session.completed') return { granted: 0 }
  const session = event.data.object
  if (session.payment_status && session.payment_status !== 'paid') return { granted: 0 }
  const pack = PACKS.find((p) => p.amountCents === session.amount_total && p.currency === session.currency)
  if (!pack || !session.client_reference_id) {
    // the player paid but we cannot tell for what: fail loudly so Stripe retries and the owner sees it
    console.error('stripe: paid checkout matched no credit pack', { event: event.id, amount: session.amount_total, currency: session.currency })
    throw Object.assign(new Error('paid checkout matched no credit pack'), { status: 500 })
  }
  const fresh = await grantPurchase(db, session.client_reference_id, pack.credits, `stripe:${event.id}`)
  return { granted: fresh ? pack.credits : 0 }
}
