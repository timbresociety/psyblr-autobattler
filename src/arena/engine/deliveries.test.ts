import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS } from '../../charter/build'
import { SIZES, type SizeClass } from '../../charter/sizes'
import { CATALOG } from '../../charter/templates/catalog'
import { ai, at, phys, push, resize, active, ultimate } from '../../charter/templates/dsl'
import type { BuildSlot, Template } from '../../charter/types'
import { defaultBuild } from '../../sim/fixtures'
import { ENGINE } from './calibration'
import { COMBAT_RULES, cast, chest, landing } from './deliveries'
import type { MatchEvent } from './events'
import { PI, atan2 } from './maths'
import { capsule, createHero, emptyMatch, prepareHero, type HeroSetup, type MatchState } from './state'
import { tick } from './tick'
import { initHero } from './effects'

const base = { id: 't', name: 'T', roles: ['mage' as const], tags: ['t'], cooldown: 5, ai: ai('poke', 1) }
const skill = (delivery: Template['delivery'], effects: Template['effects'] = [phys(100)]) => active({ ...base, delivery, effects })

/** Caster at the origin facing +z with `template` in active1; enemies at the given spots and sizes. */
function arena(template: Template, enemies: { x?: number; y?: number; z: number; size?: SizeClass }[]) {
  const m: MatchState = emptyMatch(1)
  const setups: HeroSetup[] = []
  const casterSetup = prepareHero(defaultBuild('mage'))
  setups.push({ ...casterSetup, kit: { ...casterSetup.kit, active1: template } })
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
  const fire = (slot: BuildSlot = 'active1') => cast(ctx, 0, slot)
  const run = (n: number) => {
    for (let i = 0; i < n; i++) events.push(...tick(m, setups, [], COMBAT_RULES))
  }
  const hits = () => events.filter((e) => e.type === 'hit').map((e) => (e as Extract<MatchEvent, { type: 'hit' }>).target)
  return { m, setups, ctx, events, fire, run, hits, aimAt }
}

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

  it('a shot 2 m wide misses a medium hero and hits a huge one', () => {
    const miss = arena(skill(at.proj(30)), [{ x: 2.2, z: 15 }])
    miss.m.heroes[0].yaw = 0
    miss.fire()
    miss.run(60)
    expect(miss.hits()).toEqual([])
    const hit = arena(skill(at.proj(30)), [{ x: 2.2, z: 15, size: 'huge' }])
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
    const { at: centre } = landing(a.ctx, a.m.heroes[0], a.setups[0].kit.active1)
    a.m.heroes[1].position.y = a.m.heroes[2].position.y = centre.y - capsule(a.m.heroes[1]).height * ENGINE.chest
    a.m.heroes[1].position.z = a.m.heroes[2].position.z = centre.z
    a.fire()
    expect(a.hits()).toEqual([1])
  })

  it('an airborne hero is hit by an upward shot and missed by a ground-disc zone', () => {
    const shot = arena(skill(at.proj(30)), [{ z: 8, y: 6 }])
    shot.aimAt(0, 6 + 1, 8)
    shot.fire()
    shot.run(30)
    expect(shot.hits()).toEqual([1])
    const quake = arena(skill(at.zone(0, 7)), [{ z: 4, y: 6 }, { z: 4, x: 2 }])
    quake.fire()
    expect(quake.hits()).toEqual([2])
  })

  it('covers AE6: a resize to colossal swaps the capsule and reach for the duration, then restores', () => {
    const a = arena(ultimate({ ...base, id: 'u', delivery: at.self(), effects: [resize('colossal', 2), phys(1)] }), [{ z: 30 }])
    a.setups[0] = { ...a.setups[0], kit: { ...a.setups[0].kit, ultimate: a.setups[0].kit.active1 } }
    const before = capsule(a.m.heroes[0]).radius
    a.fire('ultimate')
    expect(capsule(a.m.heroes[0]).radius).toBeCloseTo(ENGINE.capsule.radius + SIZES.colossal.hitRadius)
    expect(capsule(a.m.heroes[0]).radius).toBeGreaterThan(before)
    expect(a.events).toContainEqual({ type: 'resize', hero: 0, phase: 'start', size: 'colossal' })
    a.run(2 * ENGINE.tickHz + 1)
    expect(capsule(a.m.heroes[0]).radius).toBeCloseTo(before)
    expect(a.events).toContainEqual({ type: 'resize', hero: 0, phase: 'end', size: 'medium' })
  })

  it('a 6 m knockback moves the target 6 m over several ticks, and a wall stops it', () => {
    const a = arena(skill(at.melee(3), [push(6), phys(10)]), [{ z: 2 }])
    a.fire()
    const startZ = a.m.heroes[1].position.z
    a.run(1)
    expect(a.m.heroes[1].knockback).toBeDefined()
    a.run(30)
    const moved = Math.sqrt((a.m.heroes[1].position.z - startZ) ** 2 + a.m.heroes[1].position.y ** 2)
    expect(moved).toBeCloseTo(6, 4)
    const wall = arena(skill(at.melee(3), [push(6), phys(10)]), [{ z: ENGINE.arena.halfLength - 1 }])
    wall.m.heroes[0].position.z = ENGINE.arena.halfLength - 3
    wall.fire()
    wall.run(30)
    expect(wall.m.heroes[1].position.z).toBe(ENGINE.arena.halfLength)
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
      const slot: BuildSlot = template.slot === 'active' ? 'active1' : template.slot
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
