import { describe, expect, it } from 'vitest'
import { duel, simulate } from './engine.js'
import { defaultBuild } from './fixtures.js'
import type { Build } from '../charter/build.js'

describe('combat engine', () => {
  it('the same seed and builds give identical results', () => {
    const a = duel(defaultBuild('fighter'), defaultBuild('mage'), 42)
    const b = duel(defaultBuild('fighter'), defaultBuild('mage'), 42)
    expect(a).toEqual(b)
  })

  it('different seeds can give different fights', () => {
    const results = new Set([1, 2, 3, 4, 5, 6].map((seed) => duel(defaultBuild('fighter'), defaultBuild('assassin'), seed).time))
    expect(results.size).toBeGreaterThan(1)
  })

  it('a strictly stronger copy wins a mirror duel more than half the time over 200 seeds', () => {
    const base = defaultBuild('fighter')
    let wins = 0
    for (let seed = 1; seed <= 200; seed++) {
      const result = simulate([{ build: base, damageBonus: 0.25 }], [{ build: base }], seed)
      if (result.winner === 0) wins++
    }
    expect(wins).toBeGreaterThan(100)
  })

  it('a 10v10 fight ends within the time cap with a winner or a draw', () => {
    const roles = ['tank', 'fighter', 'assassin', 'mage', 'marksman', 'support', 'tank', 'fighter', 'mage', 'support'] as const
    const team = (): { build: Build }[] => roles.map((r, i) => ({ build: defaultBuild(r, `${r}-${i}`) }))
    const result = simulate(team(), team(), 7)
    expect(result.time).toBeLessThanOrEqual(120)
    expect([0, 1, 'draw']).toContain(result.winner)
  })

  it('reports damage dealt per unit', () => {
    const result = duel(defaultBuild('marksman'), defaultBuild('tank'), 3)
    expect(result.units).toHaveLength(2)
    expect(result.units[0].damageDealt + result.units[1].damageDealt).toBeGreaterThan(0)
  })
})
