import { describe, expect, it } from 'vitest'
import { ATTITUDE, ATTITUDES, isAttitude, SWING_TIER } from './attitude.js'

describe('attitude sets', () => {
  it('knows its own ids and nothing else', () => {
    for (const id of ATTITUDES) expect(isAttitude(id)).toBe(true)
    for (const v of ['Brute', 'hero', '', undefined, 3]) expect(isAttitude(v)).toBe(false)
  })

  it('neutral changes nothing; every other set changes the rest and keeps a believable beat', () => {
    expect(ATTITUDE.neutral).toMatchObject({ tips: {}, arms: 0, knees: 0, swing: {}, cadence: 1, heavyLanding: false })
    for (const id of ATTITUDES.filter((a) => a !== 'neutral')) {
      const a = ATTITUDE[id]
      expect(Object.keys(a.tips).length + a.arms + a.knees, id).toBeGreaterThan(0)
      expect(a.cadence, id).toBeGreaterThan(0.7)
      expect(a.cadence, id).toBeLessThan(1.3)
    }
  })

  it('the walk takes all of a set\'s extra swing and the run least', () => {
    expect(SWING_TIER.walk).toBeGreaterThan(SWING_TIER.jog)
    expect(SWING_TIER.jog).toBeGreaterThan(SWING_TIER.run)
  })
})
