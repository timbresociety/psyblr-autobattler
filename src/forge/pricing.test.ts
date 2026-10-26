import { describe, expect, it } from 'vitest'
import { FREE_GRANT, HERO_PRICE, MARKUP, STAGE_COST, STAGE_PRICES, TYPICAL, stagePrice } from './pricing'
import { STAGE_ORDER, STAGE_TABLE } from './stages'

describe('blended forge pricing (R45, KTD18)', () => {
  it('a full forge charges about twice its estimated provider cost', () => {
    const cost = Object.entries(STAGE_COST).reduce((s, [stage, c]) => s + (stage === 'form' ? c! * TYPICAL.formTakeUp : c!), 0)
    expect(HERO_PRICE).toBe(Math.round(cost * MARKUP))
    const charged = Object.entries(STAGE_PRICES).reduce((s, [stage, p]) => s + (stage === 'form' ? p! * TYPICAL.formTakeUp : p!), 0)
    expect(Math.abs(charged - HERO_PRICE)).toBeLessThanOrEqual(STAGE_ORDER.length)
  })

  it('the motion stage pays for the arena hero as well as the archival one', () => {
    expect(STAGE_COST.motion!).toBeGreaterThan(STAGE_COST.mesh!)
  })

  it('the free grant still covers one full hero, form included, with every capped retry', () => {
    const worst = STAGE_ORDER.reduce((s, stage) => s + stagePrice(stage) * (1 + (STAGE_TABLE[stage].paid ? STAGE_TABLE[stage].retryCap : 0)), 0)
    expect(FREE_GRANT).toBe(worst)
    expect(stagePrice('form')).toBeGreaterThan(0)
  })
})
