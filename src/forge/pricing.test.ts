import { describe, expect, it } from 'vitest'
import { FREE_GRANT, GENERATION_COST, MARKUP, PACKS, PIECE_PRICE } from './pricing.js'

describe('pricing', () => {
  it('a generated piece costs twice its estimate, and the free grant covers two', () => {
    expect(PIECE_PRICE).toBe(Math.round(GENERATION_COST.piece * MARKUP))
    expect(FREE_GRANT).toBe(2 * PIECE_PRICE)
  })

  it('every pack buys at least a few pieces, and bigger packs cost less per credit', () => {
    for (const p of PACKS) expect(p.credits).toBeGreaterThanOrEqual(5 * PIECE_PRICE)
    const perCredit = PACKS.map((p) => p.amountCents / p.credits)
    expect([...perCredit].sort((a, b) => b - a)).toEqual(perCredit)
  })
})
