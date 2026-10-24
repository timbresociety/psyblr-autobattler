import { describe, expect, it } from 'vitest'
import { DEMO_HEROES, demoBuild } from '../../arena/demo/roster.js'
import { ENGINE } from '../../arena/engine/calibration.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { heroStats } from './hero-stats.js'

describe("a hero card's numbers", () => {
  it('read the same setup a match builds: DPS is damage per hit times the basic attack rate', () => {
    for (const b of [defaultBuild('fighter'), defaultBuild('marksman'), defaultBuild('mage')]) {
      const s = heroStats(b)
      expect(s.perHit).toBeGreaterThan(0)
      expect(s.dps).toBeCloseTo(s.perHit * s.rate, 5)
    }
  })

  it('a shot reaches its range; a swing reaches its range plus the body and the size class', () => {
    const shot = heroStats(defaultBuild('marksman'))
    expect(shot.ranged).toBe(true)
    const swing = heroStats(defaultBuild('fighter'))
    expect(swing.ranged).toBe(false)
    const huge = heroStats({ ...defaultBuild('fighter'), sizeClass: 'huge' })
    expect(huge.reach).toBeGreaterThan(swing.reach)
    expect(swing.reach).toBeGreaterThan(ENGINE.capsule.radius)
  })

  it("resist becomes the damage it takes off, and a trait's numbers show on the card", () => {
    const tank = heroStats(defaultBuild('tank'))
    expect(tank.armorCut).toBe(Math.min(75, tank.armor))
    const bulwark = heroStats(defaultBuild('tank'), { mul: { armor: 0.4 } })
    expect(bulwark.armor).toBeCloseTo(tank.armor * 1.4, 5)
  })

  it('every starter hero has a card', () => {
    for (const h of DEMO_HEROES) expect(heroStats(demoBuild(h)).health).toBeGreaterThan(0)
  })
})
