import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultBuild } from '../sim/fixtures.js'
import { ROLES } from './roles.js'
import { TRAITS, TRAIT_TIERS, armyModifiers, armyTraits, heroMods, traitTier } from './traits.js'

const many = (role: Parameters<typeof defaultBuild>[0], n: number) => Array.from({ length: n }, (_, i) => defaultBuild(role, `${role}${i}`))

describe('role synergies', () => {
  it('every role is a trait whose tiers light at 2, 4 and 6 heroes', () => {
    for (const r of ROLES) expect(TRAITS[r.id].tiers).toHaveLength(TRAIT_TIERS.length)
    expect([1, 2, 3, 4, 5, 6, 10].map(traitTier)).toEqual([-1, 0, 0, 1, 1, 2, 2])
  })

  it('a lit trait strengthens its own role, and its higher tiers reach the rest of the side', () => {
    const army = [...many('tank', 4), ...many('mage', 2), defaultBuild('marksman', 'lone')]
    const traits = armyTraits(army)
    expect(traits.map((t) => [t.trait.name, t.count, t.tier])).toEqual([
      ['Bulwark', 4, 1],
      ['Arcana', 2, 0],
      ['Volley', 1, -1],
    ])
    expect(heroMods(army[0], traits).mul).toEqual({ armor: 0.4, magicResist: 0.4 })
    // a mage takes its own tier and the tanks' reach; the lone marksman only the reach
    expect(heroMods(army[4], traits).mul).toEqual({ armor: 0.1, magicResist: 0.1, spiritPower: 0.15 })
    expect(heroMods(army[6], traits).mul).toEqual({ armor: 0.1, magicResist: 0.1 })
  })

  it('past the top tier more of a role adds nothing, and the combat effects stack from different traits', () => {
    expect(heroMods(defaultBuild('tank'), armyTraits(many('tank', 10)))).toEqual(heroMods(defaultBuild('tank'), armyTraits(many('tank', 6))))
    const mods = armyModifiers([...many('assassin', 4), ...many('support', 2)])
    expect(mods[0].mods).toMatchObject({ lowHpBonus: 0.3, stealthStart: 1.5 })
    expect(mods[4].mods).toEqual({ healPower: 0.2 })
  })

  it('the balance gate measures heroes without traits, so unit balance never depends on an army', () => {
    const gate = readFileSync(new URL('../sim/gate.ts', import.meta.url), 'utf8')
    expect(gate).not.toMatch(/armyModifiers|charter\/traits|\bmods\b/)
  })
})
