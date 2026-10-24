import { STAGE_ORDER, STAGE_TABLE } from './stages.js'
import type { StageId } from './types.js'

/**
 * Forge pricing (R45, KTD18). One credit is about one US cent of provider spend. The hero is priced as one blended
 * number, twice the estimated cost of every generation a full forge makes, with the optional form weighted by how
 * often players take it. Each paid stage charges twice its own cost on confirm, so a forge that takes the form pays
 * a little more than HERO_PRICE and one that skips it a little less.
 * Refresh the estimates once live costs are measured.
 */

/** Estimated provider cost of each generation, in credits. */
export const GENERATION_COST = {
  conceptSheets: 8,
  archivalMesh: 30,
  arenaMesh: 20,
  rig: 8,
  retargetBatch: 4,
  effectImages: 6,
  passiveImages: 3,
  formConcept: 6,
  formMesh: 20,
} as const

/** Retarget calls per rig in a typical forge, and how often players add a form. */
export const TYPICAL = { retargetBatches: 4, formTakeUp: 0.4 } as const

export const MARKUP = 2

const c = GENERATION_COST
/** Provider cost of each paid stage. The motion stage rigs and retargets both the archival and the arena hero. */
export const STAGE_COST: Partial<Record<StageId, number>> = {
  concept: c.conceptSheets,
  mesh: c.archivalMesh,
  motion: c.arenaMesh + 2 * c.rig + 2 * TYPICAL.retargetBatches * c.retargetBatch,
  active1: c.effectImages,
  active2: c.effectImages,
  ultimate: c.effectImages + c.passiveImages,
  form: c.formConcept + c.formMesh,
}

/** The blended hero price: twice the expected cost of a full forge (R45). */
export const HERO_PRICE = Math.round(
  MARKUP * Object.entries(STAGE_COST).reduce((sum, [stage, cost]) => sum + (stage === 'form' ? cost! * TYPICAL.formTakeUp : cost!), 0),
)

/** Each paid stage charges twice its own cost (the 100% markup), charged on confirm. */
export const STAGE_PRICES: Partial<Record<StageId, number>> = Object.fromEntries(Object.entries(STAGE_COST).map(([stage, cost]) => [stage, Math.round(cost! * MARKUP)]))

export function stagePrice(stage: StageId): number {
  return STAGE_TABLE[stage].paid ? (STAGE_PRICES[stage] ?? 0) : 0
}

/** Enough credits to forge one complete hero, form included, using every capped retry (R3). */
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
