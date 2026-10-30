import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE } from './calibration.js'
import { initialCoverHealth, type CoverPiece } from './cover.js'
import { FORBIDDEN_MATHS, atan2, cos, sin } from './maths.js'
import { next } from './rng.js'
import { hashState, restore, snapshot } from './snapshot.js'
import { AIM_STEPS, capsule, createHero, emptyMatch, MOVES, prepareHero, type Command, type MatchState } from './state.js'
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
  return m.heroes.map(() => ({ moveX: next(rng) * 2 - 1, moveZ: next(rng) * 2 - 1, moves: Math.floor(next(rng) * 8), aimYaw: Math.floor(next(rng) * AIM_STEPS), aimPitch: 0, buttons: 0 }))
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
  const go = (moveX: number, moveZ: number, moves = 0): Command => ({ moveX, moveZ, moves, aimYaw: 0, aimPitch: 0, buttons: 0 })
  const solo = (moveSpeed?: number, y = 0) => {
    const setup = build(moveSpeed)
    const m = emptyMatch(1)
    const h = createHero(setup, 0, 0, { x: 0, y, z: 0 })
    m.heroes.push(h)
    return { setup, m, h, step: (c: Command | undefined, n = 1) => { for (let i = 0; i < n; i++) tick(m, [setup], [c]) } }
  }

  it('a hero with move speed 6 eases up to 6 m/s in a tenth of a second, and eases to a stop (phase 2)', () => {
    const { h, step } = solo(6)
    step(go(0, 1), 60)
    // a metre a second more each tick for the first six, then 6 m/s: 5.75 m in all
    expect(h.position.z).toBeCloseTo(5.75, 6)
    expect(h.velocity.z).toBeCloseTo(6)
    step(go(0, 0), 6)
    expect(h.velocity.z).toBeCloseTo(0)
  })

  it('a hero cannot leave the arena or pass the floor, and nobody flies', () => {
    const { h, step } = solo(8)
    step(go(1, 1), 2000)
    expect([h.position.x, h.position.y, h.position.z]).toEqual([ENGINE.arena.halfWidth, 0, ENGINE.arena.halfLength])
    // a hero up in the air comes down, whatever it's told
    const high = solo(6, 10)
    expect(high.h.airborne).toBe(true)
    high.step(go(0, 0, MOVES.jump), 120)
    expect(high.h.position.y).toBe(0)
    expect(high.h.airborne).toBe(false)
  })

  it('jumps, jumps once more in the air for a stamina pip, and lands (phase 2)', () => {
    const { h, step } = solo(6)
    const M = ENGINE.move
    step(go(0, 0, MOVES.jump))
    expect(h.airborne).toBe(true)
    // holding the button doesn't jump again; the top of the jump is its height
    let top = 0
    for (let i = 0; i < 20; i++) {
      step(go(0, 0, MOVES.jump))
      top = Math.max(top, h.position.y)
    }
    expect(top).toBeGreaterThan(M.jump - 0.15)
    expect(top).toBeLessThan(M.jump + 0.05)
    expect(h.stamina).toBeCloseTo(M.stamina.max)
    // a fresh press in the air jumps again and spends a pip; a third does nothing
    step(go(0, 0))
    const from = h.position.y
    step(go(0, 0, MOVES.jump))
    expect(h.airJumps).toBe(1)
    expect(h.stamina).toBeCloseTo(M.stamina.max - 1, 1)
    for (let i = 0; i < 20; i++) {
      step(go(0, 0))
      top = Math.max(top, h.position.y)
    }
    expect(top).toBeGreaterThan(from + M.airJump - 0.3)
    step(go(0, 0, MOVES.jump))
    expect(h.airJumps).toBe(1)
    for (let i = 0; i < 120 && h.airborne; i++) step(go(0, 0))
    expect(h.airborne).toBe(false)
    expect(h.position.y).toBe(0)
    expect(h.airJumps).toBe(0)
  })

  it('a dash bursts along the way it steers for a pip, and pips refill one at a time (phase 2)', () => {
    const { h, step } = solo(6)
    const M = ENGINE.move
    step(go(1, 0, MOVES.dash))
    expect(h.stamina).toBeCloseTo(M.stamina.max - 1, 1)
    step(go(1, 0), 30)
    // the dash covers its reach, and the run after it the rest of the half second
    expect(h.position.x).toBeGreaterThan(M.dash.speed * M.dash.time)
    expect(h.velocity.x).toBeCloseTo(6)
    // two more dashes empty the pips; a fourth press does nothing
    for (const _ of [1, 2]) {
      step(go(1, 0, MOVES.dash))
      step(go(1, 0), 15)
    }
    expect(h.stamina).toBeLessThan(1)
    const x = h.position.x
    step(go(1, 0, MOVES.dash))
    step(go(1, 0), 3)
    expect(h.position.x - x).toBeLessThan(6 * 4.1 / 60)
    // each pip takes its own refill time
    const before = h.stamina
    step(undefined, Math.round(M.stamina.regen * 60))
    expect(h.stamina).toBeCloseTo(before + 1, 1)
  })

  it('crouching at a run slides: fast at first, then slower, low to the ground, until let go (phase 2)', () => {
    const { h, step } = solo(6)
    const M = ENGINE.move
    const standing = capsule(h).height
    step(go(0, 1), 30)
    step(go(0, 1, MOVES.crouch))
    expect(h.slide).toBeDefined()
    expect(h.velocity.z).toBeCloseTo(6 * M.slide.boost, 1)
    expect(capsule(h).height).toBeCloseTo(standing * M.slide.height)
    step(go(0, 1, MOVES.crouch), 30)
    expect(h.velocity.z).toBeLessThan(6 * M.slide.boost)
    expect(h.velocity.z).toBeGreaterThan(6 * M.slide.end)
    step(go(0, 1))
    expect(h.slide).toBeUndefined()
    expect(capsule(h).height).toBeCloseTo(standing)
    // standing still, a crouch is only a crouch
    step(go(0, 0), 30)
    step(go(0, 0, MOVES.crouch))
    expect(h.slide).toBeUndefined()
  })

  it('lands on top of cover, and walks off its edge to fall to the ground (phase 2)', () => {
    const { m, h, step } = solo(6, 4)
    const block: CoverPiece = { shape: { kind: 'block', x: 0, z: 0, hx: 2, hz: 2 }, base: 0, top: 1.3, look: 'plinth' }
    m.cover = { pieces: [block], health: initialCoverHealth([block]) }
    step(go(0, 0), 60)
    expect(h.position.y).toBeCloseTo(1.3)
    expect(h.airborne).toBe(false)
    step(go(1, 0), 60)
    expect(h.position.x).toBeGreaterThan(2)
    expect(h.position.y).toBe(0)
    // and from the ground it's a wall: walking back into it stops at its side
    step(go(-1, 0), 120)
    expect(h.position.x).toBeGreaterThan(2)
    expect(h.position.y).toBe(0)
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
    const forward: Command = { moveX: 0, moveZ: 1, moves: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }
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
