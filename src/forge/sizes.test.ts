import { describe, expect, it } from 'vitest'
import { hydrateBuild } from '../charter/build'
import { getRole } from '../charter/roles'
import { deriveSheet } from '../charter/stats'
import { createBattle, simulate, step } from '../sim/engine'
import { defaultBuild } from '../sim/fixtures'
import { sizeCost } from './sizes'

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

  it('a huge build has more health and less speed than the same build at medium', () => {
    const role = getRole('fighter')
    const spread = role.defaultSpread
    const medium = deriveSheet(role, spread, 'medium').sheet
    const huge = deriveSheet(role, spread, 'huge').sheet
    expect(huge.maxHealth).toBeGreaterThan(medium.maxHealth)
    expect(huge.moveSpeed).toBeLessThan(medium.moveSpeed)
  })

  it('an area effect that misses a medium target hits a huge target at the same distance', () => {
    const mage = defaultBuild('mage')
    const caster = { ...mage, slots: { ...mage.slots, active1: { ...mage.slots.active1, templateId: 'mage-frost-nova' } } }
    const reach = (sizeClass?: 'huge') => {
      const battle = createBattle([{ build: caster }], [{ build: { ...defaultBuild('tank'), ...(sizeClass ? { sizeClass } : {}) } }], 1)
      const [me, foe] = battle.units
      me.position = { x: 0, y: 0 }
      foe.position = { x: 4.6, y: 0 }
      for (const u of [me, foe]) for (const s of Object.keys(u.cooldowns) as (keyof typeof u.cooldowns)[]) u.cooldowns[s] = 99
      me.cooldowns.active1 = 0
      me.hp = me.maxHp * 0.5
      foe.cooldowns.basic = 99
      const before = foe.slows.length
      step(battle)
      return foe.slows.length > before
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
