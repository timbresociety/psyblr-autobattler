import { describe, expect, it } from 'vitest'
import { emptyFormation, MAX_PER_SIDE, SPACING } from './formation.js'
import { starterLoadout } from './loadout.js'
import { byRank, defaultLineup, squadLineup, hasSquads, lineupName, matchup } from './presets.js'

const roster = starterLoadout()
const squad = (heroes: number[]) => new Set(heroes.map((h) => roster[h].squad))
const heroesOf = (f: ReturnType<typeof emptyFormation>, side: 0 | 1) => f[side].map((p) => p.hero)

describe('staging matchups (U16)', () => {
  it('the starters are two squads of ten', () => {
    expect(hasSquads(roster)).toBe(true)
    expect(squadLineup(roster, 'vanguard')).toHaveLength(10)
    expect(squadLineup(roster, 'outlaws')).toHaveLength(10)
  })

  it('auto-deploy defaults to your side the Vanguard and the enemy the Outlaws, never a mirror', () => {
    for (const yourSide of [0, 1] as const) {
      const mine = defaultLineup(roster, yourSide, yourSide, 10)
      const theirs = defaultLineup(roster, (1 - yourSide) as 0 | 1, yourSide, 10)
      expect(squad(mine)).toEqual(new Set(['vanguard']))
      expect(squad(theirs)).toEqual(new Set(['outlaws']))
      expect(mine.filter((h) => theirs.includes(h))).toEqual([])
    }
    expect(defaultLineup(roster, 0, 0, 4)).toHaveLength(4)
  })

  it('a roster with no squads (only forged heroes) cycles the loadout as before', () => {
    const forged = roster.slice(0, 3).map((e) => ({ ...e, squad: undefined }))
    expect(defaultLineup(forged, 0, 0, 5)).toEqual([0, 1, 2, 0, 1])
    expect(defaultLineup([], 0, 0, 5)).toEqual([])
  })

  it('puts tanks and fighters in the front rank and the back line behind', () => {
    const ranked = byRank(roster, squadLineup(roster, 'vanguard'))
    const roles = ranked.map((h) => roster[h].build.roleId)
    expect(roles.slice(0, 2)).toEqual(['tank', 'tank'])
    expect(roles.indexOf('marksman')).toBeGreaterThan(roles.lastIndexOf('fighter'))
  })

  it('"Vanguard vs Outlaws" and its swap fill both sides from the right squads, from either side', () => {
    for (const yourSide of [0, 1] as const) {
      const enemy = (1 - yourSide) as 0 | 1
      const f = matchup('squads', roster, yourSide, emptyFormation())
      expect(f[yourSide]).toHaveLength(MAX_PER_SIDE)
      expect(f[enemy]).toHaveLength(MAX_PER_SIDE)
      expect(squad(heroesOf(f, yourSide))).toEqual(new Set(['vanguard']))
      expect(squad(heroesOf(f, enemy))).toEqual(new Set(['outlaws']))
      const swapped = matchup('squads-swapped', roster, yourSide, emptyFormation())
      expect(squad(heroesOf(swapped, yourSide))).toEqual(new Set(['outlaws']))
      expect(squad(heroesOf(swapped, enemy))).toEqual(new Set(['vanguard']))
    }
  })

  it('mirror copies your lineup to the enemy, or the Vanguard on both sides when yours is empty', () => {
    const start = matchup('squads-swapped', roster, 0, emptyFormation())
    const mirrored = matchup('mirror', roster, 0, start)
    expect([...heroesOf(mirrored, 1)].sort()).toEqual([...heroesOf(start, 0)].sort())
    const fresh = matchup('mirror', roster, 1, emptyFormation())
    expect(squad(heroesOf(fresh, 0))).toEqual(new Set(['vanguard']))
    expect([...heroesOf(fresh, 0)].sort()).toEqual([...heroesOf(fresh, 1)].sort())
  })

  it('random draws ten different heroes a side, the sides apart, on their own halves with room between', () => {
    let seed = 7
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const f = matchup('random', roster, 0, emptyFormation(), rng)
    for (const side of [0, 1] as const) {
      const heroes = heroesOf(f, side)
      expect(heroes).toHaveLength(10)
      expect(new Set(heroes).size).toBe(10)
      expect(f[side].every((p) => (side === 0 ? p.z < 0 : p.z > 0))).toBe(true)
      for (const a of f[side]) for (const b of f[side]) if (a !== b) expect((a.x - b.x) ** 2 + (a.z - b.z) ** 2).toBeGreaterThanOrEqual(SPACING ** 2)
    }
    expect(heroesOf(f, 0).filter((h) => heroesOf(f, 1).includes(h))).toEqual([])
  })

  it('names a lineup by its squad', () => {
    expect(lineupName(roster, squadLineup(roster, 'vanguard'))).toBe('Vanguard')
    expect(lineupName(roster, squadLineup(roster, 'outlaws'))).toBe('Outlaws')
    expect(lineupName(roster, [0, 15])).toBe('Mixed')
    expect(lineupName(roster, [])).toBe('Empty')
  })
})
