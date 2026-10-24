import { describe, expect, it } from 'vitest'
import { emptyFormation, MAX_PER_SIDE, SPACING } from './formation.js'
import { demoLoadout } from './loadout.js'
import { byRank, defaultLineup, factionLineup, hasFactions, lineupName, matchup } from './presets.js'

const roster = demoLoadout()
const faction = (heroes: number[]) => new Set(heroes.map((h) => roster[h].faction))
const heroesOf = (f: ReturnType<typeof emptyFormation>, side: 0 | 1) => f[side].map((p) => p.hero)

describe('staging matchups (U16)', () => {
  it('the demo roster is two factions of ten', () => {
    expect(hasFactions(roster)).toBe(true)
    expect(factionLineup(roster, 'mogul')).toHaveLength(10)
    expect(factionLineup(roster, 'leader')).toHaveLength(10)
  })

  it('auto-deploy defaults to your side the moguls and the enemy the world leaders, never a mirror', () => {
    for (const yourSide of [0, 1] as const) {
      const mine = defaultLineup(roster, yourSide, yourSide, 10)
      const theirs = defaultLineup(roster, (1 - yourSide) as 0 | 1, yourSide, 10)
      expect(faction(mine)).toEqual(new Set(['mogul']))
      expect(faction(theirs)).toEqual(new Set(['leader']))
      expect(mine.filter((h) => theirs.includes(h))).toEqual([])
    }
    expect(defaultLineup(roster, 0, 0, 4)).toHaveLength(4)
  })

  it('a roster with no factions (only forged heroes) cycles the loadout as before', () => {
    const forged = roster.slice(0, 3).map((e) => ({ ...e, faction: undefined }))
    expect(defaultLineup(forged, 0, 0, 5)).toEqual([0, 1, 2, 0, 1])
    expect(defaultLineup([], 0, 0, 5)).toEqual([])
  })

  it('puts tanks and fighters in the front rank and the back line behind', () => {
    const ranked = byRank(roster, factionLineup(roster, 'mogul'))
    const roles = ranked.map((h) => roster[h].build.roleId)
    expect(roles.slice(0, 2)).toEqual(['tank', 'tank'])
    expect(roles.indexOf('marksman')).toBeGreaterThan(roles.lastIndexOf('fighter'))
  })

  it('"Moguls vs Leaders" and its swap fill both sides from the right factions, from either side', () => {
    for (const yourSide of [0, 1] as const) {
      const enemy = (1 - yourSide) as 0 | 1
      const f = matchup('factions', roster, yourSide, emptyFormation())
      expect(f[yourSide]).toHaveLength(MAX_PER_SIDE)
      expect(f[enemy]).toHaveLength(MAX_PER_SIDE)
      expect(faction(heroesOf(f, yourSide))).toEqual(new Set(['mogul']))
      expect(faction(heroesOf(f, enemy))).toEqual(new Set(['leader']))
      const swapped = matchup('factions-swapped', roster, yourSide, emptyFormation())
      expect(faction(heroesOf(swapped, yourSide))).toEqual(new Set(['leader']))
      expect(faction(heroesOf(swapped, enemy))).toEqual(new Set(['mogul']))
    }
  })

  it('mirror copies your lineup to the enemy, or the moguls on both sides when yours is empty', () => {
    const start = matchup('factions-swapped', roster, 0, emptyFormation())
    const mirrored = matchup('mirror', roster, 0, start)
    expect([...heroesOf(mirrored, 1)].sort()).toEqual([...heroesOf(start, 0)].sort())
    const fresh = matchup('mirror', roster, 1, emptyFormation())
    expect(faction(heroesOf(fresh, 0))).toEqual(new Set(['mogul']))
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

  it('names a lineup by its faction', () => {
    expect(lineupName(roster, factionLineup(roster, 'mogul'))).toBe('Moguls')
    expect(lineupName(roster, factionLineup(roster, 'leader'))).toBe('World leaders')
    expect(lineupName(roster, [0, 15])).toBe('Mixed')
    expect(lineupName(roster, [])).toBe('Empty')
  })
})
