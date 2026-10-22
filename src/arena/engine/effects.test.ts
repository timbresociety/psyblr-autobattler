import { describe, expect, it } from 'vitest'
import type { Build } from '../../charter/build'
import { defaultBuild } from '../../sim/fixtures'
import { aiCommands } from '../ai/brain'
import { ENGINE, ticks } from './calibration'
import type { MatchEvent } from './events'
import { GATE_PROFILE, createMatch, matchRules, type Arena } from './match'
import { tick } from './tick'

const withSlot = (build: Build, slot: keyof Build['slots'], templateId: string): Build => ({ ...build, slots: { ...build.slots, [slot]: { ...build.slots[slot], templateId } } })

function fight(a: Build[], b: Build[], seed = 1) {
  const arena: Arena = createMatch(
    a.map((build) => ({ build })),
    b.map((build) => ({ build })),
    seed,
    // rule tests place heroes by hand, so they play on the open floor
    { profile: GATE_PROFILE, cover: false },
  )
  const rules = matchRules(arena)
  const events: MatchEvent[] = []
  const run = (n: number, until: () => boolean = () => false) => {
    for (let i = 0; i < n && !until(); i++) events.push(...tick(arena.match, arena.setups, aiCommands(arena), rules))
  }
  const quiet = (id: number) => Object.keys(arena.match.heroes[id].cooldowns).forEach((s) => (arena.match.heroes[id].cooldowns[s as keyof Build['slots']] = 9999))
  return { arena, m: arena.match, events, run, quiet }
}

describe('engine statuses and passives (U4)', () => {
  it('a healer shields the lowest-health ally', () => {
    const f = fight([withSlot(defaultBuild('support'), 'active1', 'support-barrier'), defaultBuild('fighter', 'f1'), defaultBuild('fighter', 'f2')], [defaultBuild('tank')])
    const [me, a, b] = f.m.heroes
    f.quiet(0)
    me.cooldowns.active1 = 0
    a.hp = a.maxHp * 0.9
    b.hp = b.maxHp * 0.3
    for (const h of [me, a, b]) h.position = { x: 0, y: 0, z: -12 }
    // Barrier is a shot: it lands on an enemy, and the shield goes to the ally who needs it most
    f.quiet(3)
    f.m.heroes[3].position = { x: 0, y: 0, z: -4 }
    f.run(600, () => a.shield > 0 || b.shield > 0)
    expect(b.shield).toBeGreaterThan(0)
    expect(a.shield).toBe(0)
  })

  it('a lowHealth passive fires once when health first drops below the line', () => {
    const f = fight([withSlot(defaultBuild('tank'), 'passive', 'tank-last-stand')], [defaultBuild('mage')])
    const me = f.m.heroes[0]
    me.hp = me.maxHp * (ENGINE.lowHealth - 0.05)
    f.run(3)
    expect(me.lowHealthFired).toBe(true)
    const reductions = () => me.buffs.filter((b) => b.stat === 'damageReduction').length
    expect(reductions()).toBe(1)
    f.run(30)
    expect(reductions()).toBeLessThanOrEqual(1)
  })

  it('a shield is gone once its time runs out', () => {
    const f = fight([defaultBuild('tank')], [defaultBuild('mage')])
    const me = f.m.heroes[0]
    me.shield = 200
    me.shieldUntil = f.m.tick + ticks(0.5)
    f.run(ticks(0.5) - 1)
    expect(me.shield).toBeGreaterThan(0)
    f.run(2)
    expect(me.shield).toBe(0)
  })

  it('a damage-over-time ticks until it expires, then stops', () => {
    const f = fight([defaultBuild('tank')], [defaultBuild('mage')])
    f.quiet(0)
    f.quiet(1)
    const me = f.m.heroes[0]
    me.dots.push({ perSecond: 120, type: 'spirit', until: f.m.tick + ticks(1), source: 1 })
    const before = me.hp
    f.run(ticks(1) + 2)
    expect(me.dots).toEqual([])
    const lost = before - me.hp
    expect(lost).toBeGreaterThan(0)
    const after = me.hp
    f.run(30)
    expect(me.hp).toBeGreaterThanOrEqual(after)
  })
})

describe('AI casts transformations (review #2)', () => {
  it('Titan Form is used in a duel, with one enemy in sight', () => {
    const f = fight([withSlot(defaultBuild('tank'), 'ultimate', 'tank-titan-form')], [defaultBuild('fighter')])
    const me = f.m.heroes[0]
    me.cooldowns.ultimate = 0
    f.run(60 * 30, () => f.events.some((e) => e.type === 'resize' && e.hero === 0 && e.phase === 'start'))
    expect(f.events.some((e) => e.type === 'resize' && e.hero === 0 && e.phase === 'start')).toBe(true)
  })
})
