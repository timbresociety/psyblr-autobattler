import { describe, expect, it } from 'vitest'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE, ticks } from './calibration.js'
import { dealDamage } from './effects.js'
import type { MatchEvent } from './events.js'
import { HOUSE_SPOTS, LEVEL } from './house.js'
import { EDGE, EDGE_CLOSED_SECONDS, VAULT, edgeAt, insideEdge, jackpotBonus } from './house-rules.js'
import { GATE_PROFILE, LIVE_PROFILE, PRACTICE_PROFILE, createMatch, matchRules, type Arena } from './match.js'
import { tick } from './tick.js'

const team = (n: number) => Array.from({ length: n }, (_, i) => ({ build: defaultBuild('fighter', `f-${i}`) }))
const house = (seed = 1, n = 2) => createMatch(team(n), team(n), seed, { map: 'house', profile: LIVE_PROFILE })

/** Run the live rules for `seconds` with everyone standing still, and return what happened. */
function stand(arena: Arena, seconds: number, each?: () => void): MatchEvent[] {
  const rules = matchRules(arena)
  const events: MatchEvent[] = []
  for (let i = 0; i < ticks(seconds) && arena.match.winner === undefined; i++) {
    each?.()
    events.push(...tick(arena.match, arena.setups, [], rules))
  }
  return events
}

const put = (arena: Arena, i: number, x: number, y: number, z: number) => Object.assign(arena.match.heroes[i].position, { x, y, z })

describe('the house edge (GAME.md §2)', () => {
  const vault = HOUSE_SPOTS.find((s) => s.name === 'House Vault')!

  it('opens over the whole house, then closes in steps onto a ring on its spot, which is inside it all the way', () => {
    for (const spot of HOUSE_SPOTS) {
      const start = edgeAt(spot, 0)
      expect(start.phase).toBe(0)
      // every corner of the arena and every floor, from the trenches to the chandelier
      for (const [x, z] of [[56, 42], [-56, -42], [0, 0]]) for (const y of Object.values(LEVEL)) expect(insideEdge(start, { x, y, z })).toBe(true)
      for (let s = 0; s <= EDGE_CLOSED_SECONDS + 30; s += 5) expect(insideEdge(edgeAt(spot, ticks(s)), { x: spot.x, y: spot.floor, z: spot.z })).toBe(true)
      const end = edgeAt(spot, ticks(EDGE_CLOSED_SECONDS))
      expect(end.r).toBeCloseTo(EDGE.steps[3].r)
      expect([end.x, end.z]).toEqual([spot.x, spot.z])
      expect(end.nextAt).toBeUndefined()
    }
  })

  it('moves smoothly while it closes and holds still between', () => {
    const a = edgeAt(vault, ticks(EDGE.steps[0].at))
    const mid = edgeAt(vault, ticks((EDGE.steps[0].at + EDGE.steps[0].until) / 2))
    const held = edgeAt(vault, ticks((EDGE.steps[0].until + EDGE.steps[1].at) / 2))
    expect(mid.closing).toBe(true)
    expect(mid.r).toBeCloseTo((a.r + held.r) / 2, 1)
    expect(held.closing).toBe(false)
    expect(held.nextAt).toBe(EDGE.steps[1].at)
  })

  it('pulls a fight across levels: closing on the vault, the balconies over it end up outside', () => {
    const late = edgeAt(vault, ticks(EDGE.steps[2].until))
    expect(insideEdge(late, { x: 0, y: LEVEL.low, z: 0 })).toBe(true)
    expect(insideEdge(late, { x: 0, y: LEVEL.up, z: 0 })).toBe(false)
  })

  it('hurts a hero left outside, health straight off twice a second, and leaves one inside alone', () => {
    const arena = house(HOUSE_SPOTS.indexOf(vault))
    expect(arena.match.house?.spot.name).toBe('House Vault')
    arena.match.tick = ticks(EDGE.steps[1].until)
    const out = arena.match.heroes[0]
    const inn = arena.match.heroes[2]
    // a shield bigger than a second of the edge does not keep it out
    out.shield = 500
    const events = stand(arena, 1, () => {
      put(arena, 0, 50, LEVEL.main, -40)
      put(arena, 2, 0, 0, 0)
    })
    const hurt = events.filter((e) => e.type === 'edge-hurt')
    expect(hurt.every((e) => e.type === 'edge-hurt' && e.hero === 0)).toBe(true)
    expect(hurt).toHaveLength(ENGINE.tickHz / EDGE.beat)
    // a second outside costs the step's share of health (a little comes back between beats from regeneration)
    expect(hurt.reduce((n, e) => n + (e.type === 'edge-hurt' ? e.amount : 0), 0)).toBeCloseTo(out.maxHp * EDGE.steps[1].dps, 3)
    expect(out.hp).toBeLessThan(out.maxHp * (1 - EDGE.steps[1].dps / 2))
    expect(inn.hp).toBe(inn.maxHp)
  })

  it('kills, and the last squad standing wins', () => {
    const arena = house(1, 1)
    arena.match.tick = ticks(EDGE_CLOSED_SECONDS)
    const spot = arena.match.house!.spot
    const events = stand(arena, 20, () => {
      put(arena, 0, spot.x, spot.floor, spot.z)
      put(arena, 1, 55, LEVEL.main, 40)
    })
    expect(events).toContainEqual({ type: 'death', hero: 1 })
    expect(arena.match.winner).toBe(0)
    expect(arena.match.endReason).toBe('wipe')
  })

  it('is the same edge for the same seed, plays only under the live rules, and replaces the damage ramp', () => {
    expect(house(4).match.house?.spot).toEqual(house(4).match.house?.spot)
    expect(new Set([0, 1, 2, 3, 4, 5].map((s) => house(s).match.house!.spot.x)).size).toBeGreaterThan(3)
    const live = house(1)
    expect(live.match.damageRamp).toBeUndefined()
    // the timer is only a safety net, a minute or more after the edge has closed
    expect(live.timerTicks).toBeGreaterThanOrEqual(ticks(EDGE_CLOSED_SECONDS + 60))
    for (const profile of [GATE_PROFILE, PRACTICE_PROFILE]) expect(createMatch(team(2), team(2), 1, { map: 'house', profile }).match.house).toBeUndefined()
    expect(createMatch(team(2), team(2), 1, { profile: LIVE_PROFILE }).match.house).toBeUndefined()
  })
})

describe('the vault jackpot (GAME.md §2)', () => {
  it(`stays shut for ${VAULT.opensAt} s, then a squad alone inside cracks it in ${VAULT.crack} s`, () => {
    const arena = house()
    const keep = () => {
      put(arena, 0, 1, 0, 1)
      for (const i of [2, 3]) put(arena, i, 50, LEVEL.main, 30)
    }
    let events = stand(arena, VAULT.opensAt - 1, keep)
    expect(arena.match.house!.vault.open).toBe(false)
    events = stand(arena, 1 + VAULT.crack - 0.2, keep)
    expect(events).toContainEqual({ type: 'vault', what: 'open' })
    expect(arena.match.house!.vault.holder).toBeUndefined()
    events = stand(arena, 0.3, keep)
    expect(events).toContainEqual({ type: 'vault', what: 'cracked', team: 0 })
    expect(arena.match.house!.vault.holder).toBe(0)
  })

  it('holds while both squads are inside, drains when empty, and is stolen in less time than it took to crack', () => {
    const arena = house()
    arena.match.tick = ticks(VAULT.opensAt)
    const vault = arena.match.house!.vault
    stand(arena, 3, () => put(arena, 2, 0, 0, 0))
    const filled = vault.meter
    expect(vault.by).toBe(1)
    stand(arena, 2, () => {
      put(arena, 2, 0, 0, 0)
      put(arena, 0, 2, 0, 2)
    })
    expect(vault.meter).toBe(filled)
    const away = () => put(arena, 0, -50, LEVEL.main, -30)
    stand(arena, 1, () => {
      away()
      put(arena, 2, 50, LEVEL.main, 30)
    })
    expect(vault.meter).toBeLessThan(filled)
    // red cracks it; blue takes it back in the steal time
    stand(arena, VAULT.crack + 0.5, () => {
      away()
      put(arena, 2, 0, 0, 0)
    })
    expect(vault.holder).toBe(1)
    const events = stand(arena, VAULT.steal + 0.2, () => {
      put(arena, 2, 50, LEVEL.main, 30)
      put(arena, 0, 0, 0, 0)
    })
    expect(events).toContainEqual({ type: 'vault', what: 'stolen', team: 0 })
    expect(vault.holder).toBe(0)
  })

  it(`its holders deal ${VAULT.buff * 100}% more damage`, () => {
    const arena = house()
    const ctx = { match: arena.match, setups: arena.setups, events: [] as MatchEvent[] }
    const [a, b] = [arena.match.heroes[0], arena.match.heroes[2]]
    const rng = { ...arena.match.rules }
    dealDamage(ctx, a, b, 100, 'physical', 'active2')
    const plain = b.maxHp - b.hp
    b.hp = b.maxHp
    arena.match.rules = { ...rng }
    arena.match.house!.vault.holder = 0
    expect(jackpotBonus(arena.match, a)).toBe(VAULT.buff)
    expect(jackpotBonus(arena.match, b)).toBe(0)
    dealDamage(ctx, a, b, 100, 'physical', 'active2')
    expect((b.maxHp - b.hp) / plain).toBeCloseTo(1 + VAULT.buff, 5)
  })
})
