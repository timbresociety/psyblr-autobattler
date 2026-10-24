import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE } from './calibration.js'
import { heroLocomotion } from './locomotion.js'
import { FORBIDDEN_MATHS, atan2, cos, sin } from './maths.js'
import { next } from './rng.js'
import { hashState, restore, snapshot } from './snapshot.js'
import { AIM_STEPS, createHero, emptyMatch, prepareHero, type Command, type MatchState } from './state.js'
import { pause, resume, tick } from './tick.js'

const build = (moveSpeed?: number) => {
  const setup = prepareHero(defaultBuild('fighter'))
  return moveSpeed ? { ...setup, sheet: { ...setup.sheet, moveSpeed } } : setup
}

function match(seed: number, count = 4) {
  const m = emptyMatch(seed)
  const setups = Array.from({ length: count }, () => build())
  setups.forEach((s, i) => m.heroes.push(createHero(s, i, (i % 2) as 0 | 1, { x: i * 2, y: 0, z: i % 2 ? 10 : -10 })))
  return { m, setups }
}

/** Seeded wandering commands, the same for the same seed. */
function wander(m: MatchState, seed: number): Command[] {
  const rng = { s: seed + m.tick }
  return m.heroes.map(() => ({ moveX: next(rng) * 2 - 1, moveZ: next(rng) * 2 - 1, vertical: (Math.floor(next(rng) * 3) - 1) as -1 | 0 | 1, aimYaw: Math.floor(next(rng) * AIM_STEPS), aimPitch: 0, buttons: 0 }))
}

const run = (m: MatchState, setups: ReturnType<typeof match>['setups'], n: number, seed: number) => {
  for (let i = 0; i < n; i++) tick(m, setups, wander(m, seed))
}

describe('engine maths (KTD1)', () => {
  it('sin, cos and atan2 track the platform functions closely', () => {
    for (let a = -20; a <= 20; a += 0.37) {
      expect(Math.abs(sin(a) - Math.sin(a))).toBeLessThan(1e-5)
      expect(Math.abs(cos(a) - Math.cos(a))).toBeLessThan(1e-5)
    }
    for (const [y, x] of [[1, 0], [0, -1], [-1, -1], [0.3, 2], [-5, 0.1]]) expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-4)
  })

  it('no engine or AI file uses a browser-dependent Math function or **', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
      })
    const root = join(__dirname, '..')
    const offenders = ['engine', 'ai'].flatMap((d) => {
      try {
        return files(join(root, d))
      } catch {
        return []
      }
    }).filter((p) => FORBIDDEN_MATHS.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the check catches hypot and the ** operator, and ignores doc comments', () => {
    expect(FORBIDDEN_MATHS.test('const d = Math.hypot(a, b)')).toBe(true)
    expect(FORBIDDEN_MATHS.test('const s = x ** 2')).toBe(true)
    expect(FORBIDDEN_MATHS.test('/** a doc comment */')).toBe(false)
    expect(FORBIDDEN_MATHS.test('Math.sqrt(x)')).toBe(false)
  })
})

describe('engine core (U3)', () => {
  it('a hero with move speed 6 covers 6 m on the ground in 60 ticks, and flies slower: the air is a burst, not travel', () => {
    const setup = build(6)
    const m = emptyMatch(1)
    m.heroes.push(createHero(setup, 0, 0, { x: 0, y: 0, z: 0 }))
    for (let i = 0; i < 60; i++) tick(m, [setup], [{ moveX: 0, moveZ: 1, vertical: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }])
    expect(m.heroes[0].position.z).toBeCloseTo(6, 6)
    const { flight, jumpReach } = heroLocomotion(m.heroes[0], setup)
    expect(flight).toBeLessThan(6)
    expect(heroLocomotion(m.heroes[0], build(8)).jumpReach).toBeGreaterThan(jumpReach)
  })

  it('a hero cannot leave the arena or pass the floor or the ceiling', () => {
    const setup = build(8)
    const m = emptyMatch(1)
    m.heroes.push(createHero(setup, 0, 0, { x: 0, y: 0, z: 0 }))
    for (let i = 0; i < 2000; i++) tick(m, [setup], [{ moveX: 1, moveZ: 1, vertical: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }])
    const p = m.heroes[0].position
    expect([p.x, p.y, p.z]).toEqual([ENGINE.arena.halfWidth, 0, ENGINE.arena.halfLength])
    // just under the ceiling with a full meter, climbing stops at it
    const high = createHero(setup, 1, 0, { x: 0, y: ENGINE.arena.ceiling - 0.2, z: 0 })
    m.heroes.push(high)
    for (let i = 0; i < 30; i++) tick(m, [setup, setup], [undefined, { moveX: 0, moveZ: 0, vertical: 1, aimYaw: 0, aimPitch: 0, buttons: 0 }])
    expect(high.position.y).toBe(ENGINE.arena.ceiling)
    for (let i = 0; i < 2000; i++) tick(m, [setup, setup], [undefined, { moveX: 0, moveZ: 0, vertical: -1, aimYaw: 0, aimPitch: 0, buttons: 0 }])
    expect(high.position.y).toBe(0)
    expect(high.airborne).toBe(false)
  })

  it('flying spends the flight meter: an empty meter glides down, and standing on the ground refills it', () => {
    const setup = build(6)
    const m = emptyMatch(1)
    const h = createHero(setup, 0, 0, { x: 0, y: 0, z: 0 })
    m.heroes.push(h)
    const up = { moveX: 0, moveZ: 1, vertical: 1 as const, aimYaw: 0, aimPitch: 0, buttons: 0 }
    tick(m, [setup], [up])
    expect(h.airborne).toBe(true)
    expect(h.flight).toBeLessThan(ENGINE.flight.max - ENGINE.flight.takeoff + 1)
    // holding "up" for longer than the meter lasts still brings the hero back down to land
    for (let i = 0; i < 60 * 30 && h.airborne; i++) tick(m, [setup], [up])
    expect(h.airborne).toBe(false)
    expect(h.flight).toBeLessThan(ENGINE.flight.takeoff)
    // it can't take off again until the meter has refilled enough
    tick(m, [setup], [up])
    expect(h.airborne).toBe(false)
    for (let i = 0; i < 60 * 5; i++) tick(m, [setup], [undefined])
    expect(h.flight).toBe(ENGINE.flight.max)
  })

  it('a flying hero holds altitude with no vertical input', () => {
    const setup = build()
    const m = emptyMatch(1)
    m.heroes.push(createHero(setup, 0, 0, { x: 0, y: 5, z: 0 }))
    for (let i = 0; i < 120; i++) tick(m, [setup], [{ moveX: 1, moveZ: 0, vertical: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }])
    expect(m.heroes[0].position.y).toBe(5)
  })

  it('snapshot, 300 ticks, restore, 300 ticks gives the same hash both times', () => {
    const { m, setups } = match(7)
    run(m, setups, 50, 7)
    const saved = snapshot(m)
    run(m, setups, 300, 7)
    const first = hashState(m)
    restore(m, saved)
    run(m, setups, 300, 7)
    expect(hashState(m)).toBe(first)
  })

  it('two engines with the same seed and commands match at every tick for 3,600 ticks', () => {
    const a = match(11)
    const b = match(11)
    for (let i = 0; i < 3600; i++) {
      tick(a.m, a.setups, wander(a.m, 3))
      tick(b.m, b.setups, wander(b.m, 3))
      if (i % 60 === 0) expect(hashState(a.m)).toBe(hashState(b.m))
    }
    expect(hashState(a.m)).toBe(hashState(b.m))
  })

  it('a stunned hero ignores its move command until the stun ends', () => {
    const setup = build(6)
    const m = emptyMatch(1)
    m.heroes.push(createHero(setup, 0, 0, { x: 0, y: 0, z: 0 }))
    m.heroes[0].stunnedUntil = 30
    const forward: Command = { moveX: 0, moveZ: 1, vertical: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }
    for (let i = 0; i < 29; i++) tick(m, [setup], [forward])
    expect(m.heroes[0].position.z).toBe(0)
    for (let i = 0; i < 10; i++) tick(m, [setup], [forward])
    expect(m.heroes[0].position.z).toBeGreaterThan(0)
  })

  it('covers AE9: pausing, then resuming, matches a run that never paused', () => {
    const a = match(5)
    const b = match(5)
    run(a.m, a.setups, 100, 9)
    run(b.m, b.setups, 100, 9)
    pause(a.m)
    for (let i = 0; i < 50; i++) expect(tick(a.m, a.setups, wander(a.m, 9))).toEqual([])
    expect(a.m.tick).toBe(100)
    resume(a.m)
    run(a.m, a.setups, 100, 9)
    run(b.m, b.setups, 100, 9)
    expect(hashState(a.m)).toBe(hashState(b.m))
  })
})
