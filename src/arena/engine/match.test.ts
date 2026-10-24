import { describe, expect, it } from 'vitest'
import { armyModifiers } from '../../charter/synergy.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { referenceArmy } from '../../sim/field.js'
import { chest } from './deliveries.js'
import { atan2, PI, TAU } from './maths.js'
import { GATE_PROFILE, createMatch, endCheck, healthShare, play, type Arena } from './match.js'
import { AIM_STEPS, type Command } from './state.js'
import { tick } from './tick.js'

/** A plain test commander: walk at the nearest enemy, aim at its chest and press everything. */
function brawl(arena: Arena): Command[] {
  const { match } = arena
  return match.heroes.map((h) => {
    const enemies = match.heroes.filter((e) => e.alive && e.team !== h.team)
    if (!h.alive || !enemies.length) return { moveX: 0, moveZ: 0, vertical: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }
    const target = enemies.reduce((a, b) => ((b.position.x - h.position.x) ** 2 + (b.position.z - h.position.z) ** 2 < (a.position.x - h.position.x) ** 2 + (a.position.z - h.position.z) ** 2 ? b : a))
    const from = chest(h)
    const to = chest(target)
    const dx = to.x - from.x
    const dz = to.z - from.z
    const flat = Math.sqrt(dx * dx + dz * dz) || 1
    const steps = (a: number) => Math.round(((a < 0 ? a + TAU : a) / TAU) * AIM_STEPS) % AIM_STEPS
    const close = flat < 3
    return { moveX: close ? 0 : dx / flat, moveZ: close ? 0 : dz / flat, vertical: 0, aimYaw: steps(atan2(dx, dz)), aimPitch: steps(atan2(to.y - from.y, flat)), buttons: 0b111111 }
  })
}

const team = (n: number, role: 'fighter' | 'tank' | 'mage' = 'fighter') => Array.from({ length: n }, (_, i) => ({ build: defaultBuild(role, `${role}-${i}`) }))

describe('match setup and rules (U5)', () => {
  it('covers AE5: a 1v10 match starts and runs to a result', () => {
    const r = play(createMatch(team(1, 'tank'), team(10), 3), brawl)
    expect(['wipe', 'time']).toContain(r.reason)
    expect(r.heroes).toHaveLength(11)
  })

  it('places the same hero three times as three independent heroes', () => {
    const build = defaultBuild('mage', 'Copy')
    const a = createMatch([{ build }, { build }, { build }], team(1), 1)
    expect(a.match.heroes.slice(0, 3).map((h) => h.id)).toEqual([0, 1, 2])
    a.match.heroes[0].hp = 1
    expect(a.match.heroes[1].hp).toBeGreaterThan(1)
  })

  it('covers AE3: at time out, 3 alive beat 2 alive even with less health left', () => {
    const a = createMatch(team(3), team(3), 1)
    a.match.heroes[3].alive = false
    a.match.heroes.slice(0, 3).forEach((h) => (h.hp = h.maxHp * 0.1))
    a.match.tick = a.timerTicks
    const events: never[] = []
    endCheck(a)!(a.match, a.setups, events)
    expect(a.match.winner).toBe(0)
    expect(a.match.endReason).toBe('time')
    expect(healthShare(a.match, 1)).toBeGreaterThan(healthShare(a.match, 0))
  })

  it('covers AE4: at time out with equal heroes alive, the larger health share wins, and an exact tie is a draw', () => {
    const a = createMatch(team(2), team(2), 1)
    a.match.heroes[0].hp *= 0.5
    a.match.tick = a.timerTicks
    endCheck(a)!(a.match, a.setups, [])
    expect(a.match.winner).toBe(1)
    const tie = createMatch(team(2), team(2), 1)
    tie.match.tick = tie.timerTicks
    endCheck(tie)!(tie.match, tie.setups, [])
    expect(tie.match.winner).toBe('draw')
  })

  it('a wipe ends the match before the timer', () => {
    const r = play(createMatch(team(1, 'mage'), team(3), 9), brawl)
    expect(r.reason).toBe('wipe')
    expect(r.seconds).toBeLessThan(300)
  })

  it('places staged heroes at their spots, kept on their own half', () => {
    const a = createMatch(team(2), team(1), 1, { formations: [[{ x: 3, y: 0, z: -8 }, { x: -2, y: 0, z: 5 }], [{ x: 1, y: 0, z: 12 }]] })
    expect(a.match.heroes[0].position).toEqual({ x: 3, y: 0, z: -8 })
    expect(a.match.heroes[1].position.z).toBeLessThan(0)
    expect(a.match.heroes[2].position).toEqual({ x: 1, y: 0, z: 12 })
  })

  it('under the gate profile, a stalemated duel ends by 60 s', () => {
    const a = createMatch(team(1, 'tank'), team(1, 'tank'), 1, { profile: GATE_PROFILE })
    const r = play(a, (x) => x.match.heroes.map(() => ({ moveX: 0, moveZ: 0, vertical: 0, aimYaw: 0, aimPitch: 0, buttons: 0 })))
    expect(r.seconds).toBeLessThanOrEqual(60)
    expect(r.reason).toBe('time')
  })

  it('covers AE8: the same rosters and seed with no human input give the same winner and survivors twice', () => {
    const army = () => armyModifiers(referenceArmy())
    const r1 = play(createMatch(army(), army(), 42), brawl)
    const r2 = play(createMatch(army(), army(), 42), brawl)
    expect(r2.winner).toBe(r1.winner)
    expect(r2.heroes.map((h) => [h.alive, h.hpFraction])).toEqual(r1.heroes.map((h) => [h.alive, h.hpFraction]))
  })

  it('a 10v10 headless match completes within the timer', () => {
    const army = armyModifiers(referenceArmy())
    const a = createMatch(army, army, 5)
    const r = play(a, brawl)
    expect(r.seconds).toBeLessThanOrEqual(300)
    expect(a.match.tick).toBeGreaterThan(0)
    expect(PI).toBeGreaterThan(3)
    tick(a.match, a.setups, [])
  })
})
