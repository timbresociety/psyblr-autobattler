import { describe, expect, it } from 'vitest'
import { DIVERSITY_MIN, STACK_THRESHOLD, armyModifiers, describeSynergy } from './synergy'
import { defaultBuild } from '../sim/fixtures'
import type { RoleId } from './types'

const army = (roles: RoleId[]) => roles.map((r, i) => defaultBuild(r, `${r}-${i}`))

describe('army synergy (R16)', () => {
  it('an army of 10 Supports is allowed, and Supports above the threshold have weaker effects (AE6)', () => {
    const builds = army(Array(10).fill('support'))
    const mods = armyModifiers(builds)
    expect(mods).toHaveLength(10)
    for (const m of mods) expect(m.powerScale).toBeLessThan(1)
    const summary = describeSynergy(builds)
    expect(summary.penalties[0]).toMatchObject({ role: 'support', count: 10 })
  })

  it('a role at or under the threshold has no penalty', () => {
    const builds = army([...Array(STACK_THRESHOLD).fill('tank'), 'mage', 'support'])
    for (const m of armyModifiers(builds)) expect(m.powerScale).toBe(1)
  })

  it('more extra heroes of one role means a bigger penalty', () => {
    const four = armyModifiers(army(Array(STACK_THRESHOLD + 1).fill('mage')))[0].powerScale
    const eight = armyModifiers(army(Array(STACK_THRESHOLD + 5).fill('mage')))[0].powerScale
    expect(eight).toBeLessThan(four)
  })

  it('an army with enough distinct roles gets the team bonus; a mono-role army does not', () => {
    const mixed = army(['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support'].slice(0, DIVERSITY_MIN) as RoleId[])
    expect(armyModifiers(mixed)[0].damageBonus).toBeGreaterThan(0)
    expect(armyModifiers(army(Array(5).fill('fighter')))[0].damageBonus).toBe(0)
    expect(describeSynergy(mixed).teamBonus).toBeGreaterThan(0)
  })
})
