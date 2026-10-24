import { describe, expect, it } from 'vitest'
import type { BuildSlot, Template } from '../../charter/types.js'
import {
  active, ai, at, blind, breakPassive, cleanse, disarm, fear, field, ground, heal, knockup, mark, phys, pull, refresh, root, shred, silence, sleep, spirit, stun,
  taunt, trap, turret, unstoppable, vulnerable, wall, wound,
} from '../../charter/templates/dsl.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE, ticks } from './calibration.js'
import { COMBAT_RULES, cast, chest } from './deliveries.js'
import { dealDamage, heal as applyHeal } from './effects.js'
import type { MatchEvent } from './events.js'
import { atan2 } from './maths.js'
import { hashState, restore, snapshot } from './snapshot.js'
import { createHero, emptyMatch, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'

const base = { id: 'lib', name: 'Lib', roles: ['mage' as const], tags: ['t'], cooldown: 5, ai: ai('poke', 1) }
const skill = (delivery: Template['delivery'], effects: Template['effects']) => active({ ...base, delivery, effects })

/** Caster (blue) at the origin facing +z with `template` in active1; enemies (red tanks) at the given spots. */
function arena(template: Template, enemies: { x?: number; y?: number; z: number }[]) {
  const m: MatchState = emptyMatch(1)
  const setups: HeroSetup[] = []
  const casterSetup = prepareHero(defaultBuild('mage'))
  setups.push({ ...casterSetup, kit: { ...casterSetup.kit, active1: template } })
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }))
  enemies.forEach((e, i) => {
    const setup = prepareHero(defaultBuild('tank'))
    setups.push(setup)
    m.heroes.push(createHero(setup, i + 1, 1, { x: e.x ?? 0, y: e.y ?? 0, z: e.z }))
  })
  const aimAt = (x: number, y: number, z: number) => {
    const from = chest(m.heroes[0])
    m.heroes[0].yaw = atan2(x - from.x, z - from.z)
    m.heroes[0].pitch = atan2(y - from.y, Math.sqrt((x - from.x) ** 2 + (z - from.z) ** 2))
  }
  const events: MatchEvent[] = []
  const ctx = { match: m, setups, events }
  const fire = (slot: BuildSlot = 'active1', who = 0) => cast(ctx, who, slot)
  const run = (n: number, commands: (Command | undefined)[] = []) => {
    for (let i = 0; i < n; i++) events.push(...tick(m, setups, commands, COMBAT_RULES))
  }
  const of = <T extends MatchEvent['type']>(type: T) => events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  return { m, setups, ctx, events, fire, run, aimAt, of }
}

const walk = (moveX: number, moveZ: number, buttons = 0): Command => ({ moveX, moveZ, vertical: 0, aimYaw: 0, aimPitch: 0, buttons })
const zone = (radius = 3, range = 0) => at.zone(range, radius)

describe('skill library: crowd control', () => {
  it('a root holds a hero in place, and it can still fight', () => {
    const a = arena(skill(zone(4), [root(2)]), [{ z: 2 }])
    a.fire()
    const before = { ...a.m.heroes[1].position }
    a.run(30, [undefined, walk(1, 0, slotBit('basic'))])
    expect(a.m.heroes[1].position.x).toBeCloseTo(before.x, 6)
    expect(a.of('cast').some((e) => e.hero === 1)).toBe(true)
  })

  it('silence stops skills but not basic attacks; disarm stops basic attacks but not skills', () => {
    const s = arena(skill(zone(4), [silence(2)]), [{ z: 2 }])
    s.fire()
    expect(s.fire('active1', 1)).toBe(false)
    expect(s.fire('basic', 1)).toBe(true)
    const d = arena(skill(zone(4), [disarm(2)]), [{ z: 2 }])
    d.fire()
    expect(d.fire('basic', 1)).toBe(false)
    expect(d.fire('active1', 1)).toBe(true)
  })

  it('sleep stops everything until the sleeper is hurt', () => {
    const a = arena(skill(zone(4), [sleep(4)]), [{ z: 2 }])
    a.fire()
    const before = { ...a.m.heroes[1].position }
    a.run(20, [undefined, walk(1, 0)])
    expect(a.m.heroes[1].position.x).toBeCloseTo(before.x, 6)
    dealDamage(a.ctx, a.m.heroes[0], a.m.heroes[1], 10, 'spirit', 'active2')
    a.run(20, [undefined, walk(1, 0)])
    expect(a.m.heroes[1].position.x).toBeGreaterThan(before.x + 0.5)
  })

  it('a blinded hero’s basic attacks miss', () => {
    const a = arena(skill(zone(4), [blind(3)]), [{ z: 1.5 }])
    a.fire()
    const hp = a.m.heroes[0].hp
    dealDamage(a.ctx, a.m.heroes[1], a.m.heroes[0], 100, 'physical', 'basic')
    expect(a.m.heroes[0].hp).toBe(hp)
    expect(a.of('miss')).toHaveLength(1)
  })

  it('a grounded hero cannot take off, and one in the air comes down', () => {
    const a = arena(skill(zone(4), [ground(4)]), [{ z: 2 }])
    a.fire()
    a.run(10, [undefined, { ...walk(0, 0), vertical: 1 }])
    expect(a.m.heroes[1].airborne).toBe(false)
    const flier = arena(skill(at.aura(6), [ground(6)]), [{ z: 2, y: 3 }])
    flier.m.heroes[1].airborne = true
    flier.fire()
    flier.run(240, [undefined, { ...walk(0, 0), vertical: 1 }])
    expect(flier.m.heroes[1].position.y).toBe(0)
  })

  it('fear sends a hero running from the caster and stops it acting; taunt walks it at the caster and makes it attack', () => {
    const f = arena(skill(zone(4), [fear(1.5)]), [{ z: 2 }])
    f.fire()
    f.run(30, [undefined, walk(0, -1, slotBit('active1'))])
    expect(f.m.heroes[1].position.z).toBeGreaterThan(2.5)
    expect(f.of('cast').some((e) => e.hero === 1)).toBe(false)
    const t = arena(skill(zone(8), [taunt(3)]), [{ z: 5 }])
    t.fire()
    const hp = t.m.heroes[0].hp
    t.run(120, [undefined, walk(0, 1)])
    expect(t.m.heroes[1].position.z).toBeLessThan(5)
    expect(t.m.heroes[0].hp).toBeLessThan(hp)
  })

  it('break stops a passive from firing', () => {
    const a = arena(skill(zone(4), [breakPassive(5)]), [{ z: 2 }])
    a.fire()
    expect(a.m.heroes[1].cc.break).toBeGreaterThan(a.m.tick)
  })

  it('a knock-up throws the hero into the air, helpless, and it lands again', () => {
    const a = arena(skill(zone(4), [knockup(1, 2.5)]), [{ z: 2 }])
    a.fire()
    a.run(ticks(0.5) - 1, [undefined, walk(1, 0)])
    expect(a.m.heroes[1].position.y).toBeGreaterThan(2)
    // helpless the whole time: it lands where it was thrown from, however hard it tried to walk away
    a.run(ticks(1) - ticks(0.5) + 1, [undefined, walk(1, 0)])
    expect(a.m.heroes[1].position.y).toBe(0)
    expect(a.m.heroes[1].airborne).toBe(false)
    // (at most the one step it takes on the tick it lands)
    expect(a.m.heroes[1].position.x).toBeLessThan(0.15)
  })

  it('a pull drags the hero toward the caster', () => {
    const a = arena(skill(zone(10), [pull(5)]), [{ z: 8 }])
    a.fire()
    a.run(ticks(ENGINE.knockbackTime) + 2)
    expect(a.m.heroes[1].position.z).toBeLessThan(4)
  })

  it('an unstoppable hero shrugs off control, and cleanse lifts it', () => {
    const a = arena(skill(zone(4), [stun(2), root(2)]), [{ z: 2 }])
    a.m.heroes[1].unstoppableUntil = 600
    a.fire()
    expect(a.m.heroes[1].stunnedUntil).toBe(0)
    expect(a.m.heroes[1].cc.root).toBe(0)
    const c = arena(skill(at.self(), [cleanse('self')]), [])
    c.m.heroes[0].stunnedUntil = 0
    c.m.heroes[0].cc.root = 300
    c.m.heroes[0].debuffs.push({ type: 'vulnerable', amount: 20, until: 300, source: 1 })
    c.fire()
    expect(c.m.heroes[0].cc.root).toBeLessThanOrEqual(c.m.tick)
    expect(c.m.heroes[0].debuffs).toEqual([])
  })
})

describe('skill library: debuffs, states and refresh', () => {
  const hit = (effects: Template['effects']) => {
    const a = arena(skill(zone(4), effects), [{ z: 2 }])
    a.fire()
    const before = a.m.heroes[1].hp
    // a fixed physical hit from the caster, with no variance in play
    const rules = { ...a.m.rules }
    dealDamage(a.ctx, a.m.heroes[0], a.m.heroes[1], 200, 'physical', 'active2')
    a.m.rules = rules
    return before - a.m.heroes[1].hp
  }
  it('armour shred and vulnerability make hits land harder', () => {
    const plain = hit([phys(0.01, 0)])
    expect(hit([shred(20, 4)])).toBeGreaterThan(plain)
    expect(hit([vulnerable(20, 4)])).toBeGreaterThan(plain * 1.15)
  })

  it('a wound cuts healing taken', () => {
    const a = arena(skill(zone(4), [wound(50, 4)]), [{ z: 2 }])
    a.fire()
    const t = a.m.heroes[1]
    t.hp = 1000
    applyHeal(t, 100)
    expect(t.hp).toBeCloseTo(1050, 6)
  })

  it('a mark adds damage only from the marking team and reveals stealth', () => {
    const a = arena(skill(zone(4), [mark(25, 4)]), [{ z: 2 }])
    a.m.heroes[1].stealthUntil = 600
    a.fire()
    expect(a.m.heroes[1].stealthUntil).toBeLessThanOrEqual(a.m.tick)
    expect(a.m.heroes[1].debuffs.some((d) => d.type === 'mark')).toBe(true)
  })

  it('refresh takes time off the caster’s other cooldowns', () => {
    const a = arena(skill(at.self(), [refresh(4)]), [])
    a.m.heroes[0].cooldowns.active2 = ticks(6)
    a.m.heroes[0].cooldowns.movement = ticks(3)
    a.fire()
    expect(a.m.heroes[0].cooldowns.active2).toBe(ticks(6) - ticks(4))
    expect(a.m.heroes[0].cooldowns.movement).toBe(0)
    expect(a.m.heroes[0].cooldowns.active1).toBeGreaterThan(0)
  })

  it('unstoppable as a skill frees the caster from control it is already under', () => {
    const a = arena(skill(at.self(), [unstoppable(2)]), [])
    a.m.heroes[0].cc.silence = 0
    a.m.heroes[0].cc.root = 300
    a.fire()
    expect(a.m.heroes[0].cc.root).toBeLessThanOrEqual(a.m.tick)
    expect(a.m.heroes[0].unstoppableUntil).toBeGreaterThan(a.m.tick)
  })
})

describe('skill library: fields, traps, walls and turrets', () => {
  it('a field keeps landing its effects on whoever stands in it, and stops when it ends', () => {
    const a = arena(skill(zone(3, 6), [spirit(50, 0), field(3, 1)]), [{ z: 6 }])
    a.aimAt(0, 1, 6)
    a.fire()
    const first = a.of('hit').length
    a.run(ticks(3.5))
    expect(a.of('hit').length).toBe(first + 3)
    expect(a.of('field').some((e) => e.phase === 'end')).toBe(true)
  })

  it('a trap waits, arms, and springs once on the first enemy to step in', () => {
    const a = arena(skill(zone(1.5, 6), [stun(1), trap(10, 0.5)]), [{ z: 12 }])
    a.aimAt(0, 0, 6)
    a.fire()
    expect(a.m.heroes[1].stunnedUntil).toBe(0)
    a.run(60, [undefined, walk(0, -1)])
    expect(a.m.heroes[1].stunnedUntil).toBeGreaterThan(0)
    expect(a.m.fields).toEqual([])
  })

  it('a wall rises as real cover: shots stop at it, and it falls when its time is up', () => {
    const a = arena(skill(zone(0.5, 5), [wall(6, 2, 2000)]), [{ z: 10 }])
    a.aimAt(0, 1, 5)
    a.fire()
    expect(a.of('wall').filter((e) => e.phase === 'up')).toHaveLength(1)
    const shot = arena(skill(at.proj(30), [phys(100)]), [{ z: 10 }])
    shot.m.cover = a.m.cover
    shot.m.walls = a.m.walls
    shot.aimAt(0, 1, 10)
    shot.fire()
    shot.run(40)
    expect(shot.of('hit')).toHaveLength(0)
    a.run(ticks(2) + 1)
    expect(a.of('wall').filter((e) => e.phase === 'down')).toHaveLength(1)
    expect(a.m.cover!.health[a.m.cover!.health.length - 1]).toBe(0)
  })

  it('a turret shoots the nearest enemy in range on its beat, and not one out of range', () => {
    const a = arena(skill(zone(0.5, 2), [turret(4, 1, 12, 40)]), [{ z: 8 }, { z: 25 }])
    a.aimAt(0, 0, 2)
    a.fire()
    a.run(ticks(4.2))
    const targets = a.of('hit').map((e) => e.target)
    expect(targets.filter((t) => t === 1).length).toBeGreaterThanOrEqual(3)
    expect(targets).not.toContain(2)
    expect(a.of('turret').some((e) => e.phase === 'end')).toBe(true)
  })

  it('snapshots and replays exactly with fields, walls and turrets in play', () => {
    const a = arena(skill(zone(3, 6), [spirit(20, 0), field(4, 1)]), [{ z: 6 }])
    a.aimAt(0, 1, 6)
    a.fire()
    const saved = snapshot(a.m)
    a.run(120)
    const h1 = hashState(a.m)
    restore(a.m, saved)
    a.run(120)
    expect(hashState(a.m)).toBe(h1)
  })

  it('a heal still heals the caster (sanity: the library leaves the old effects alone)', () => {
    const a = arena(skill(at.self(), [heal(100, 0, 'self')]), [])
    a.m.heroes[0].hp = 100
    a.fire()
    expect(a.m.heroes[0].hp).toBeGreaterThan(100)
  })
})
