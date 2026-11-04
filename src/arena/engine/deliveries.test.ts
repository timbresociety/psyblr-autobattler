import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, SLOT_KIND } from '../../charter/build.js'
import { GEOMETRY_DEFAULTS } from '../../charter/geometry.js'
import { SIZES, type SizeClass } from '../../charter/sizes.js'
import { CATALOG } from '../../charter/templates/catalog.js'
import { ai, at, form, move, phys, push, resize, spell, ultimate } from '../../charter/templates/dsl.js'
import type { BuildSlot, Template } from '../../charter/types.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE, ticks } from './calibration.js'
import { COMBAT_RULES, chest, landing } from './deliveries.js'
import { land } from './testing.js'
import type { MatchEvent } from './events.js'
import { PI, atan2 } from './maths.js'
import { IDLE, capsule, createHero, emptyMatch, prepareHero, slotBit, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'
import { initHero } from './effects.js'
import { initialCoverHealth } from './cover.js'

const base = { id: 't', name: 'T', roles: ['mage' as const], tags: ['t'], cooldown: 5, ai: ai('poke', 1) }
const skill = (delivery: Template['delivery'], effects: Template['effects'] = [phys(100)]) => spell({ ...base, family: 'burst', delivery, effects })

/** Caster at the origin facing +z with `template` in active2; enemies at the given spots and sizes. */
function arena(template: Template, enemies: { x?: number; y?: number; z: number; size?: SizeClass }[]) {
  const m: MatchState = emptyMatch(1)
  const setups: HeroSetup[] = []
  const casterSetup = prepareHero(defaultBuild('mage'))
  setups.push({ ...casterSetup, kit: { ...casterSetup.kit, active2: template } })
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }))
  enemies.forEach((e, i) => {
    const setup = prepareHero({ ...defaultBuild('tank'), ...(e.size && e.size !== 'colossal' ? { sizeClass: e.size } : {}) })
    setups.push(setup)
    const hero = createHero(setup, i + 1, 1, { x: e.x ?? 0, y: e.y ?? 0, z: e.z })
    if (e.size) hero.size = e.size
    m.heroes.push(hero)
  })
  // aim from the chest straight at the first enemy's chest by default
  const aimAt = (x: number, y: number, z: number) => {
    const from = chest(m.heroes[0])
    m.heroes[0].yaw = atan2(x - from.x, z - from.z)
    m.heroes[0].pitch = atan2(y - from.y, Math.sqrt((x - from.x) ** 2 + (z - from.z) ** 2))
  }
  const events: MatchEvent[] = []
  const ctx = { match: m, setups, events }
  // these tests are about where a cast lands, so it lands on the tick it's pressed; timing.test.ts covers the wind-up
  const fire = (slot: BuildSlot = 'active2') => land(ctx, 0, slot)
  const run = (n: number) => {
    for (let i = 0; i < n; i++) events.push(...tick(m, setups, [], COMBAT_RULES))
  }
  // cast inside a tick, as play does: a knockback starts in act and takes its first step in the same tick's after()
  const strike = (slot: BuildSlot = 'active2') => events.push(...tick(m, setups, [{ ...IDLE, buttons: slotBit(slot) }], COMBAT_RULES))
  const hits = () => events.filter((e) => e.type === 'hit').map((e) => (e as Extract<MatchEvent, { type: 'hit' }>).target)
  return { m, setups, ctx, events, fire, strike, run, hits, aimAt }
}

describe('casting low (owner, 2026-11-04)', () => {
  it('a shot or a spell fires from a crouch or prone and leaves the hero there; a blow stands it up first', () => {
    for (const stance of ['crouch', 'prone'] as const) {
      const shot = arena(skill({ kind: 'projectile', range: 10, speed: 30, projectileRadius: 0.3 }), [{ z: 6 }])
      shot.m.heroes[0].stance = stance
      shot.fire()
      expect(shot.m.heroes[0].stance).toBe(stance)
      const blow = arena(skill({ kind: 'melee', range: 3, arcDegrees: 90 }), [{ z: 1.5 }])
      blow.m.heroes[0].stance = stance
      blow.fire()
      expect(blow.m.heroes[0].stance).toBe('stand')
    }
  })
})

describe('a dash or leap carries the hero there over time (2026-11-04)', () => {
  it('a leap arcs across several ticks and lands its crater only when it arrives', () => {
    const a = arena(skill({ kind: 'leap', range: 9, radius: 3 }, [move(9), phys(100)]), [{ z: 10 }])
    a.m.heroes[0].yaw = 0
    a.m.heroes[0].pitch = 0
    a.fire()
    const h = a.m.heroes[0]
    expect(h.travel).toBeDefined()
    expect(h.position.z).toBeLessThan(1)
    let top = 0
    let ticksTaken = 0
    for (; ticksTaken < 120 && h.travel; ticksTaken++) {
      if (!h.travel.arrived) expect(a.hits()).toEqual([])
      a.run(1)
      top = Math.max(top, h.position.y)
    }
    const T = ENGINE.move.travel.leap
    expect(ticksTaken).toBeGreaterThanOrEqual(ticks(T.base + T.per * 9) - 1)
    expect(top).toBeGreaterThan(2)
    expect(h.position.z).toBeCloseTo(9, 0)
    expect(a.hits()).toEqual([1])
  })

  it('a dash takes a few ticks rather than one, and a blink still lands at once', () => {
    const d = arena(skill({ kind: 'dash', range: 9 }, [move(9)]), [{ x: 20, z: 0 }])
    d.m.heroes[0].yaw = 0
    d.fire()
    d.run(1)
    expect(d.m.heroes[0].position.z).toBeLessThan(5)
    d.run(10)
    expect(d.m.heroes[0].position.z).toBeCloseTo(9, 0)
    const b = arena(skill({ kind: 'blink', range: 9 }, [move(9)]), [{ x: 20, z: 0 }])
    b.m.heroes[0].yaw = 0
    b.fire()
    expect(b.m.heroes[0].position.z).toBeCloseTo(9, 0)
  })
})

describe('3D deliveries (U4)', () => {
  it('a projectile at 20 m hits after its travel time, not instantly', () => {
    const a = arena(skill(at.proj(30, undefined, 30)), [{ z: 20 }])
    a.fire()
    expect(a.hits()).toEqual([])
    a.run(30)
    expect(a.hits()).toEqual([])
    a.run(20)
    expect(a.hits()).toEqual([1])
  })

  it('a projectile fast enough to cross a capsule between ticks still hits it', () => {
    const a = arena(skill(at.proj(60, undefined, 900)), [{ z: 22 }])
    a.fire()
    a.run(5)
    expect(a.hits()).toEqual([1])
  })

  it('a shot that passes a medium hero by a hair hits a huge one', () => {
    // off to the side by the shot's radius plus a hitbox between the medium one and the huge one
    const x = GEOMETRY_DEFAULTS.projectileRadius + ENGINE.capsule.radius + SIZES.huge.hitRadius / 2
    const miss = arena(skill(at.proj(30)), [{ x, z: 15 }])
    miss.m.heroes[0].yaw = 0
    miss.fire()
    miss.run(60)
    expect(miss.hits()).toEqual([])
    const hit = arena(skill(at.proj(30)), [{ x, z: 15, size: 'huge' }])
    hit.m.heroes[0].yaw = 0
    hit.fire()
    hit.run(60)
    expect(hit.hits()).toEqual([1])
  })

  it('a beam hits every enemy within its width along its length, and none beyond its range', () => {
    const a = arena(skill(at.beam(12, 1)), [{ z: 4 }, { x: 0.6, z: 9 }, { z: 14 }, { x: 3, z: 6 }])
    a.m.heroes[0].yaw = 0
    a.fire()
    expect(a.hits().sort()).toEqual([1, 2])
  })

  it('a 30-degree cone hits a hero 10 degrees off-axis and misses one 20 degrees off', () => {
    const r = 6
    const deg = (d: number) => (d * PI) / 180
    const a = arena(skill(at.cone(10, 3, 30)), [
      { x: r * Math.sin(deg(10)), z: r * Math.cos(deg(10)) },
      { x: -r * Math.sin(deg(20)), z: r * Math.cos(deg(20)) },
    ])
    a.m.heroes[0].yaw = 0
    a.fire()
    expect(a.hits()).toEqual([1])
  })

  it('a zone of radius 4 hits a capsule edge 3.9 m from its centre and misses one at 4.1 m', () => {
    const r = ENGINE.capsule.radius
    const centreZ = 10
    const a = arena(skill(at.zone(10, 4)), [{ x: 3.9 + r, z: centreZ }, { x: -(4.1 + r), z: centreZ }])
    a.m.heroes[0].yaw = 0
    const from = chest(a.m.heroes[0])
    a.m.heroes[0].pitch = atan2(-from.y + capsule(a.m.heroes[1]).height * ENGINE.chest, 10)
    const { at: centre } = landing(a.ctx, a.m.heroes[0], a.setups[0].kit.active2)
    a.m.heroes[1].position.y = a.m.heroes[2].position.y = centre.y - capsule(a.m.heroes[1]).height * ENGINE.chest
    a.m.heroes[1].position.z = a.m.heroes[2].position.z = centre.z
    a.fire()
    expect(a.hits()).toEqual([1])
  })

  it('an airborne hero is hit by an upward shot and missed by a ground-disc zone', () => {
    const shot = arena(skill(at.proj(30)), [{ z: 5, y: 6 }])
    shot.aimAt(0, 6 + 1, 5)
    shot.fire()
    shot.run(30)
    expect(shot.hits()).toEqual([1])
    const quake = arena(skill(at.zone(0, 7)), [{ z: 4, y: 6 }, { z: 4, x: 2 }])
    quake.fire()
    expect(quake.hits()).toEqual([2])
  })

  it('covers AE6: a resize to colossal swaps the capsule and reach for the duration, then restores', () => {
    const a = arena(ultimate({ ...base, id: 'u', delivery: at.self(), effects: [resize('colossal', 2), phys(1)] }), [{ z: 30 }])
    a.setups[0] = { ...a.setups[0], kit: { ...a.setups[0].kit, ultimate: a.setups[0].kit.active2 } }
    const before = capsule(a.m.heroes[0]).radius
    a.fire('ultimate')
    expect(capsule(a.m.heroes[0]).radius).toBeCloseTo(ENGINE.capsule.radius + SIZES.colossal.hitRadius)
    expect(capsule(a.m.heroes[0]).radius).toBeGreaterThan(before)
    expect(a.events).toContainEqual({ type: 'form', hero: 0, phase: 'start', size: 'colossal' })
    a.run(2 * ENGINE.tickHz + 1)
    expect(capsule(a.m.heroes[0]).radius).toBeCloseTo(before)
    expect(a.events).toContainEqual({ type: 'form', hero: 0, phase: 'end', size: 'medium' })
  })

  it("a same-size form begins and ends at the hero's own class, and never touches its capsule", () => {
    const a = arena(ultimate({ ...base, id: 'u', delivery: at.self(), effects: [form(2), phys(1)] }), [{ z: 30 }])
    a.setups[0] = { ...a.setups[0], kit: { ...a.setups[0].kit, ultimate: a.setups[0].kit.active2 } }
    const before = capsule(a.m.heroes[0])
    a.fire('ultimate')
    expect(a.m.heroes[0].formUntil).toBeGreaterThan(0)
    expect(capsule(a.m.heroes[0])).toEqual(before)
    expect(a.events).toContainEqual({ type: 'form', hero: 0, phase: 'start', size: 'medium' })
    a.run(2 * ENGINE.tickHz + 1)
    expect(a.m.heroes[0].formUntil).toBe(0)
    expect(capsule(a.m.heroes[0])).toEqual(before)
    expect(a.events).toContainEqual({ type: 'form', hero: 0, phase: 'end', size: 'medium' })
  })

  it('a 6 m knockback moves the target 6 m in exactly its ticks, lands it, and a wall stops it', () => {
    const a = arena(skill(at.melee(3), [push(6), phys(10)]), [{ z: 2 }])
    const target = a.m.heroes[1]
    // cast inside a tick, as play does: the knockback starts in act and steps in the same tick's after()
    let at0 = { ...target.position }
    a.events.push(...tick(a.m, a.setups, [{ ...IDLE, buttons: slotBit('active2') }], COMBAT_RULES))
    let path = 0
    let steps = 0
    for (let i = 0; i < 30; i++) {
      const now = { ...target.position }
      if (now.x !== at0.x || now.y !== at0.y || now.z !== at0.z) {
        steps++
        if (target.knockback) path += Math.sqrt((now.x - at0.x) ** 2 + (now.y - at0.y) ** 2 + (now.z - at0.z) ** 2)
      }
      at0 = now
      if (!target.knockback && steps) break
      a.run(1)
    }
    expect(steps).toBe(ticks(ENGINE.knockbackTime))
    expect(target.knockback).toBeUndefined()
    // the launch lifted it, and a hero knocked off the ground lands again rather than flying on
    expect(target.position.y).toBe(0)
    expect(target.airborne).toBe(false)
    expect(target.position.z - 2).toBeGreaterThan(5)
    expect(path).toBeGreaterThan(4)
    const wall = arena(skill(at.melee(3), [push(6), phys(10)]), [{ z: ENGINE.arena.halfLength - 1 }])
    wall.m.heroes[0].position.z = ENGINE.arena.halfLength - 3
    wall.fire()
    wall.run(30)
    expect(wall.m.heroes[1].position.z).toBe(ENGINE.arena.halfLength)
  })

  it('a blow along the ground throws its target in an arc and lands it on the floor (§5)', () => {
    const a = arena(skill(at.melee(3), [push(6), phys(10)]), [{ z: 2 }])
    const target = a.m.heroes[1]
    a.strike()
    let peak = 0
    let flew = false
    for (let i = 0; i < 60 && !(flew && !target.knockback); i++) {
      flew ||= !!target.knockback
      a.run(1)
      peak = Math.max(peak, target.position.y)
    }
    expect(flew).toBe(true)
    expect(peak).toBeGreaterThan(0.8)
    expect(peak).toBeLessThanOrEqual(ENGINE.knock.hopMax)
    expect(target.position.y).toBe(0)
    expect(target.airborne).toBe(false)
    expect(target.position.z - 2).toBeCloseTo(6, 1)
  })

  it('a heavier body goes less far, a lighter one further (§5 mass)', () => {
    const pushed = (size: SizeClass) => {
      const a = arena(skill(at.melee(3), [push(6), phys(10)]), [{ z: 2, size }])
      a.strike()
      a.run(30)
      return a.m.heroes[1].position.z - 2
    }
    const medium = pushed('medium')
    expect(pushed('huge') / medium).toBeCloseTo(1 / (1.3 * Math.sqrt(1.3)), 1)
    expect(pushed('tiny')).toBeGreaterThan(medium * 1.3)
  })

  it('a hero knocked into a breakable piece slams it: the piece wears down and the flight stops, then breaks through (§6b)', () => {
    const a = arena(skill(at.melee(3), [push(6), phys(10)]), [{ z: 2 }])
    const pieces = [{ shape: { kind: 'block' as const, x: 0, z: 5.5, hx: 2, hz: 0.25 }, base: 0, top: 1.4, health: 300, look: 'barricade' as const }]
    a.m.cover = { pieces, health: initialCoverHealth(pieces) }
    a.fire()
    a.run(30)
    const slam = a.events.find((e) => e.type === 'slam') as Extract<MatchEvent, { type: 'slam' }>
    expect(slam).toMatchObject({ hero: 1, index: 0 })
    expect(slam.speed).toBeGreaterThan(10)
    expect(a.m.cover.health[0]).toBe(300 - ENGINE.knock.slamDamage)
    // stopped at the barricade, not through it
    expect(a.m.heroes[1].position.z).toBeLessThan(5.5)
    expect(a.m.heroes[1].knockback).toBeUndefined()
    // the next slam breaks it, and the hero flies on through the gap
    a.m.heroes[1].position = { x: 0, y: 0, z: 2 }
    for (const k of BUILD_SLOTS) a.m.heroes[0].cooldowns[k] = 0
    a.fire()
    a.run(30)
    expect(a.events).toContainEqual(expect.objectContaining({ type: 'cover-broken', index: 0 }))
    expect(a.m.heroes[1].position.z).toBeGreaterThan(6)
  })

  it('knocked off a ledge, a hero falls to the floor below instead of hanging in the air', () => {
    const a = arena(skill(at.melee(3), [push(6), phys(10)]), [{ z: 2, y: 3 }])
    const pieces = [{ shape: { kind: 'block' as const, x: 0, z: 0, hx: 4, hz: 3 }, base: 0, top: 3, look: 'grey' as const }]
    a.m.cover = { pieces, health: initialCoverHealth(pieces) }
    a.m.heroes[0].position = { x: 0, y: 3, z: 0 }
    a.fire()
    a.run(15)
    expect(a.m.heroes[1].position.z).toBeGreaterThan(3)
    a.run(60)
    expect(a.m.heroes[1].position.y).toBe(0)
    expect(a.m.heroes[1].airborne).toBe(false)
  })

  it('every impact event carries the geometry its hit check used', () => {
    const a = arena(skill(at.zone(8, 3.5)), [{ z: 8 }])
    a.m.heroes[0].yaw = 0
    a.fire()
    const impact = a.events.find((e) => e.type === 'impact') as Extract<MatchEvent, { type: 'impact' }>
    expect(impact.radius).toBe(3.5)
    expect(impact.range).toBe(8)
  })

  it('every catalogue template can be cast headless without errors', () => {
    for (const template of CATALOG) {
      const slot = (Object.keys(SLOT_KIND) as BuildSlot[]).find((k) => SLOT_KIND[k] === template.slot)!
      const a = arena(template, [{ z: 3 }, { x: 2, z: 6 }])
      a.setups[0] = { ...a.setups[0], kit: { ...a.setups[0].kit, [slot]: template } }
      initHero(a.m.heroes[0], a.setups[0])
      a.m.heroes[0].cooldowns.ultimate = 0
      a.m.heroes[0].yaw = 0
      if (slot !== 'passive') expect(() => a.fire(slot), template.id).not.toThrow()
      expect(() => a.run(90), template.id).not.toThrow()
    }
    expect(BUILD_SLOTS).toContain('movement')
  })
})
