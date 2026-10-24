/**
 * Pricing (R45, KTD18). One credit is about one US cent of provider spend, and generating something charges twice its
 * estimated cost. Players pay only to generate a piece of gear the asset repository doesn't have; wearing anything
 * already in it is free, for everyone. Refresh the estimates once live costs are measured.
 */

/** Estimated provider cost of each generation, in credits. */
export const GENERATION_COST = {
  /** One piece of gear for the asset repository (Tripo text- or image-to-model). */
  piece: 20,
} as const

export const MARKUP = 2

/** A generated piece of gear: twice its cost. */
export const PIECE_PRICE = Math.round(GENERATION_COST.piece * MARKUP)

/** The one free grant per account: enough to generate two pieces. */
export const FREE_GRANT = 2 * PIECE_PRICE

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
