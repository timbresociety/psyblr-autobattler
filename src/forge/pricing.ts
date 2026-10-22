import { STAGE_ORDER, STAGE_TABLE } from './stages'
import type { StageId } from './types'

/**
 * Credit prices per paid stage (KTD6). One credit is about one US cent of provider spend, so prices track the
 * measured Tripo and image costs; tune them here once live costs are known.
 */
export const STAGE_PRICES: Partial<Record<StageId, number>> = {
  concept: 10,
  mesh: 60,
  motion: 50,
  active1: 15,
  active2: 15,
  ultimate: 20,
}

export function stagePrice(stage: StageId): number {
  return STAGE_TABLE[stage].paid ? (STAGE_PRICES[stage] ?? 0) : 0
}

/** Enough credits to forge one complete hero using every capped retry (R3). */
export const FREE_GRANT = STAGE_ORDER.reduce((sum, s) => sum + stagePrice(s) * (1 + (STAGE_TABLE[s].paid ? STAGE_TABLE[s].retryCap : 0)), 0)

/** A spend circuit breaker: the most free grants handed out per day across everyone. */
export const GLOBAL_DAILY_FREE_GRANTS = 500

export interface CreditPack {
  id: 'small' | 'medium' | 'large'
  credits: number
  /** Price in the smallest currency unit; the webhook matches on this, never on client input. */
  amountCents: number
  currency: 'usd'
  /** Environment variable holding the Stripe price ID. */
  stripePriceEnv: string
}

export const PACKS: CreditPack[] = [
  { id: 'small', credits: 300, amountCents: 399, currency: 'usd', stripePriceEnv: 'STRIPE_PRICE_SMALL' },
  { id: 'medium', credits: 1000, amountCents: 999, currency: 'usd', stripePriceEnv: 'STRIPE_PRICE_MEDIUM' },
  { id: 'large', credits: 3000, amountCents: 2499, currency: 'usd', stripePriceEnv: 'STRIPE_PRICE_LARGE' },
]
