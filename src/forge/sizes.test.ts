import { describe, expect, it } from 'vitest'
import { hydrateBuild } from '../charter/build.js'
import { getRole } from '../charter/roles.js'
import { SIZES, sizeHealth } from '../charter/sizes.js'
import { deriveSheet } from '../charter/stats.js'
import { getTemplate } from '../charter/templates/catalog.js'
import { ENGINE } from '../arena/engine/calibration.js'
import { cast } from '../arena/engine/deliveries.js'
import type { MatchEvent } from '../arena/engine/events.js'
import { createMatch } from '../arena/engine/match.js'
import { simulate } from '../sim/engine.js'
import { defaultBuild } from '../sim/fixtures.js'
import { sizeCost } from './sizes.js'

describe('size classes (U2)', () => {
  it('an unknown size class is rejected by hydrateBuild; medium is the default', () => {
    const raw = JSON.parse(JSON.stringify(defaultBuild('mage')))
    expect(hydrateBuild(raw).ok && hydrateBuild(raw).build.sizeClass).toBeUndefined()
    raw.sizeClass = 'colossal'
    expect(hydrateBuild(raw).ok).toBe(false)
    raw.sizeClass = 'huge'
    const ok = hydrateBuild(raw)
    expect(ok.ok && ok.build.sizeClass).toBe('huge')
  })

  it('a huge build reaches further and moves slower, at the health its role pays for the size', () => {
    const role = getRole('fighter')
    const spread = role.defaultSpread
    const medium = deriveSheet(role, spread, 'medium').sheet
    const huge = deriveSheet(role, spread, 'huge').sheet
    expect(SIZES.huge.reachBonus).toBeGreaterThan(0)
    expect(huge.moveSpeed).toBeLessThan(medium.moveSpeed)
    expect(huge.maxHealth).toBeCloseTo(medium.maxHealth * sizeHealth('fighter', 'huge'), 1)
  })

  it('an area effect that misses a medium target hits a huge target at the same distance', () => {
    const mage = defaultBuild('mage')
    const caster = { ...mage, slots: { ...mage.slots, active1: { ...mage.slots.active1, templateId: 'mage-frost-nova' } } }
    const reach = (sizeClass?: 'huge') => {
      // the target stands in the gap between a medium hitbox and a huge one, just past the nova's edge
      const gap = (getTemplate('mage-frost-nova').delivery.radius ?? 0) + ENGINE.capsule.radius + SIZES.huge.hitRadius / 2
      const arena = createMatch([{ build: caster }], [{ build: { ...defaultBuild('tank'), ...(sizeClass ? { sizeClass } : {}) } }], 1, {
        formations: [[{ x: 0, y: 0, z: -gap / 2 }], [{ x: 0, y: 0, z: gap / 2 }]],
      })
      const events: MatchEvent[] = []
      cast({ match: arena.match, setups: arena.setups, events }, 0, 'active1')
      return arena.match.heroes[1].slows.length > 0
    }
    expect(reach()).toBe(false)
    expect(reach('huge')).toBe(true)
  })

  it('a large Mage stays a Mage and sizeCost reports deltas and a gate result (AE3)', () => {
    const cost = sizeCost(defaultBuild('mage'), 'large')
    expect(cost.healthDelta).toBeGreaterThan(0)
    expect(cost.speedDelta).toBeLessThan(0)
    expect(['ready', 'blocked']).toContain(cost.state)
    expect(typeof cost.winRate).toBe('number')
  })

  it('simulation stays deterministic with sizes', () => {
    const a = { ...defaultBuild('fighter'), sizeClass: 'huge' as const }
    expect(simulate([{ build: a }], [{ build: defaultBuild('assassin') }], 5)).toEqual(simulate([{ build: a }], [{ build: defaultBuild('assassin') }], 5))
  })
})
