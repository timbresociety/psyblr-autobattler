import { describe, expect, it } from 'vitest'
import { AIR, LANDING, MOVE_SECONDS, createAnimator, onEvents, settle, type AnimState } from './animation.js'
import { DT, ENGINE, ticks } from '../engine/calibration.js'
import { createHero, prepareHero, type HeroState } from '../engine/state.js'
import { defaultBuild } from '../../sim/fixtures.js'

/**
 * The animator's contract (combat and traversal pass, 2026-11-13): the body shows what the engine's state says, on
 * the engine's clock. Each test here is a fault the course showed before the pass (scripts/course.mjs).
 */
const fighter = (): HeroState => createHero(prepareHero(defaultBuild('fighter')), 0, 0, { x: 0, y: 0, z: 0 })
const G = ENGINE.move.gravity
const V0 = Math.sqrt(2 * G * ENGINE.move.jump)

/** A jump as the engine flies it, drawn `perTick` times a tick: every state shown, in order. */
function jumpShown(perTick: number, launch = V0): AnimState[] {
  const hero = fighter()
  const a = createAnimator()
  hero.airborne = true
  hero.velocity.y = launch
  onEvents(a, 0, [{ type: 'move', hero: 0, move: 'jump' }], 1)
  const shown: AnimState[] = []
  let y = 0
  for (let tick = 1; tick < 400; tick++) {
    for (let k = 1; k <= perTick; k++) shown.push({ ...settle(a, hero, 0, tick - 1 + k / perTick, 0, { tick, alpha: k / perTick }) })
    hero.velocity.y -= G * DT
    y += hero.velocity.y * DT
    if (y <= 0) break
  }
  return shown
}
const kinds = (shown: readonly AnimState[]) => shown.map((s) => (s.kind === 'air' ? `air:${s.phase}` : s.kind)).filter((k, i, all) => k !== all[i - 1])

describe('a jump shown by how fast the body rises', () => {
  it('goes take-off, rise, over the top, fall, with no timer', () => {
    expect(kinds(jumpShown(1))).toEqual(['jump', 'air:rise', 'air:apex', 'air:fall'])
  })

  it('shows the same phases at the same speeds at 30, 60 and 120 frames a second', () => {
    // 120 Hz draws each tick twice; 30 Hz draws every other tick: the take-off ends at the same share of the launch
    const at120 = jumpShown(2)
    const at60 = jumpShown(1)
    expect(kinds(at120)).toEqual(kinds(at60))
    expect(at120.filter((s) => s.kind === 'jump').length).toBe(2 * at60.filter((s) => s.kind === 'jump').length)
    expect(kinds(at60.filter((_, i) => i % 2 === 0))).toEqual(kinds(at60))
  })

  it('ends the take-off at the same point of a low jump as of a high one', () => {
    const last = (shown: AnimState[]) => shown.filter((s) => s.kind === 'jump').pop() as { t: number }
    // a colossal hero's jump leaves the ground slower: its take-off is shorter in time, the same in shape
    const low = jumpShown(1, Math.sqrt(2 * G * ENGINE.move.jump * ENGINE.move.jumpScale.colossal))
    expect(jumpShown(1).filter((s) => s.kind === 'jump').length).toBeGreaterThan(low.filter((s) => s.kind === 'jump').length)
    expect(last(low).t).toBeGreaterThan(0.6)
    expect(last(jumpShown(1)).t).toBeGreaterThan(0.6)
  })

  it('a head stopped by a ceiling goes over the top at once, not on with the take-off', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.airborne = true
    hero.velocity.y = V0
    onEvents(a, 0, [{ type: 'move', hero: 0, move: 'jump' }], 1)
    expect(settle(a, hero, 0, 1).kind).toBe('jump')
    hero.velocity.y = 0
    expect(settle(a, hero, 0, 2)).toMatchObject({ kind: 'air', phase: 'apex' })
  })

  it('a step off a ledge starts at the top and falls', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.airborne = true
    expect(settle(a, hero, 0.1, 5)).toMatchObject({ kind: 'air', phase: 'apex' })
    hero.velocity.y = -AIR.top - 1
    expect(settle(a, hero, 0.1, 20)).toMatchObject({ kind: 'air', phase: 'fall' })
  })
})

describe('a landing', () => {
  const landing = (speed: number) => {
    const hero = fighter()
    const a = createAnimator()
    onEvents(a, 0, [{ type: 'move', hero: 0, move: 'land', speed }], 100)
    return { hero, a }
  }

  it('taken at a run keeps the run, and sinks the hips over it', () => {
    const { hero, a } = landing(16)
    const sunk: number[] = []
    for (let tick = 100; tick < 100 + ticks(LANDING.down + LANDING.up) + 2; tick++) {
      expect(settle(a, hero, 0.11, tick).kind).toBe('run')
      sunk.push(a.squash)
    }
    expect(Math.max(...sunk)).toBeCloseTo(LANDING.squash * (16 / LANDING.full), 2)
    expect(sunk[sunk.length - 1]).toBe(0)
    // down quickly, back up slowly
    expect(sunk.indexOf(Math.max(...sunk))).toBeLessThan(sunk.length / 3)
  })

  it('taken standing plays whole, on the engine\'s clock, and sinks nothing more', () => {
    const { hero, a } = landing(6)
    const first = settle(a, hero, 0, 100) as { kind: string; t: number }
    const mid = settle(a, hero, 0, 100 + ticks(LANDING.still) / 2) as { kind: string; t: number }
    expect([first.kind, mid.kind]).toEqual(['land', 'land'])
    expect(first.t).toBe(0)
    expect(mid.t).toBeCloseTo(0.5, 1)
    expect(a.squash).toBe(0)
    expect(settle(a, hero, 0, 100 + ticks(LANDING.still)).kind).toBe('idle')
  })

  it('gives way to the run the moment the hero moves off, still sinking', () => {
    const { hero, a } = landing(16)
    expect(settle(a, hero, 0, 101).kind).toBe('land')
    expect(settle(a, hero, 0.11, 103).kind).toBe('run')
    expect(a.squash).toBeGreaterThan(0)
  })

  it('a harder one holds a standing hero longer', () => {
    const soft = landing(6)
    const hard = landing(LANDING.hardSpeed + 2)
    const at = 100 + ticks(LANDING.still) + 2
    expect(settle(soft.a, soft.hero, 0, at).kind).toBe('idle')
    expect(settle(hard.a, hard.hero, 0, at).kind).toBe('land')
  })
})

describe('a cast is the engine\'s action, never a memory of one', () => {
  const casting = () => {
    const hero = fighter()
    const a = createAnimator()
    hero.action = { slot: 'basic', started: 10, release: 20, ends: 32, released: false, melee: { step: 0 } }
    onEvents(a, 0, [{ type: 'cast', hero: 0, slot: 'basic', templateId: 'x', release: 20, ends: 32, melee: { step: 0 } }], 10)
    return { hero, a }
  }

  it('lands its contact frame on the release tick, then follows through at its own pace', () => {
    const { hero, a } = casting()
    expect(settle(a, hero, 0, 15)).toMatchObject({ kind: 'cast', prep: 0.5, since: 0 })
    hero.action!.released = true
    expect(settle(a, hero, 0, 20)).toMatchObject({ kind: 'cast', prep: 1, since: 0 })
    expect((settle(a, hero, 0, 26) as { since: number }).since).toBeCloseTo(6 * DT)
  })

  it('stops showing the moment the engine drops the action, event or no event', () => {
    const { hero, a } = casting()
    hero.action!.released = true
    expect(settle(a, hero, 0, 22).kind).toBe('cast')
    // a knockback in the recovery clears the action and sends no interrupt (effects.ts interrupt)
    hero.action = undefined
    hero.launch = { from: 23, until: 60, height: 3, base: 0, regain: true }
    expect(settle(a, hero, 0, 23).kind).toBe('launched')
    hero.launch = undefined
    hero.airborne = true
    hero.velocity.y = -10
    expect(settle(a, hero, 0, 24)).toMatchObject({ kind: 'air', phase: 'fall' })
  })

  it('gives the whole body to a roll', () => {
    const { hero, a } = casting()
    // the engine drops the action as the roll starts (locomotion.ts); the animator shows the roll either way
    hero.roll = { from: 14, until: 14 + ticks(ENGINE.move.roll.time), x: 0, z: 1 }
    hero.action = undefined
    onEvents(a, 0, [{ type: 'interrupt', hero: 0, slot: 'basic' }, { type: 'move', hero: 0, move: 'roll' }], 14)
    const shown = settle(a, hero, 0.1, 20) as { kind: string; t: number }
    expect(shown.kind).toBe('roll')
    expect(shown.t).toBeCloseTo((20 - 14) / ticks(ENGINE.move.roll.time), 2)
  })

  it('plays its follow-through on after the engine lets go, until the hero does anything else', () => {
    const { hero, a } = casting()
    hero.action!.released = true
    settle(a, hero, 0, 31)
    hero.action = undefined
    // still standing: the clip's tail (the view says how long it is) plays on
    expect(settle(a, hero, 0, 36, 0, { tick: 36, alpha: 1, tail: 0.8 })).toMatchObject({ kind: 'cast', tail: true })
    // it moves: the tail is cut
    expect(settle(a, hero, 0.1, 37, 0, { tick: 37, alpha: 1, tail: 0.8 }).kind).toBe('run')
  })

  it('a clip with no follow-through left ends with the engine', () => {
    const { hero, a } = casting()
    hero.action!.released = true
    settle(a, hero, 0, 31)
    hero.action = undefined
    expect(settle(a, hero, 0, 33, 0, { tick: 33, alpha: 1, tail: 0.1 }).kind).toBe('idle')
  })

  it('held back by a hit-stop, finishes the action the engine has already finished', () => {
    const { hero, a } = casting()
    hero.action = undefined
    // the engine is at tick 34, past the end; the clip's clock was held and reads 30: the recovery still plays
    expect(settle(a, hero, 0, 30, 0, { tick: 34, alpha: 1 }).kind).toBe('cast')
  })
})

describe('one clock', () => {
  it('a one-shot is as far through at a moment of the fight, however often it is drawn', () => {
    const shownAt = (draws: number) => {
      const hero = fighter()
      const a = createAnimator()
      hero.roll = { from: 50, until: 50 + ticks(ENGINE.move.roll.time), x: 0, z: 1 }
      onEvents(a, 0, [{ type: 'move', hero: 0, move: 'roll' }], 50)
      let last: AnimState = a.state
      // a paused or slowed match draws the same instant many times; nothing advances
      for (let k = 0; k < draws; k++) last = settle(a, hero, 0.1, 60, 1 / 30)
      return last as { t: number }
    }
    expect(shownAt(1).t).toBe(shownAt(40).t)
  })
})

describe('every state the full kit reaches shows something of its own', () => {
  it('a knockdown lies down, then gets up', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.down = { from: 10, until: 64 }
    hero.stunnedUntil = 64
    expect(settle(a, hero, 0, 12).kind).toBe('down')
    hero.down = undefined
    hero.stunnedUntil = 0
    onEvents(a, 0, [{ type: 'melee', hero: 0, what: 'get-up' }], 64)
    expect(settle(a, hero, 0, 66).kind).toBe('get_up')
    expect(settle(a, hero, 0, 64 + ticks(MOVE_SECONDS.get_up) + 1).kind).toBe('idle')
  })

  it('a wall run, a glide and a swing are shown while they last', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.airborne = true
    hero.wallRun = { from: 1, until: 60, dx: 0, dz: 1, nx: 1, nz: 0, piece: 0 }
    onEvents(a, 0, [{ type: 'move', hero: 0, move: 'wall-run' }], 1)
    expect(settle(a, hero, 0.1, 5).kind).toBe('wall_run')
    hero.wallRun = undefined
    hero.traverse = { how: 'glide', from: 60, until: 200, slot: 'movement' }
    expect(settle(a, hero, 0.1, 61).kind).toBe('glide')
    hero.traverse = { how: 'swing', from: 60, until: 200, slot: 'movement' }
    expect(settle(a, hero, 0.1, 62).kind).toBe('swing')
  })

  it('a mantle onto something low says so, and a climb from a hang is a climb', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.mantle = { from: 10, until: 40, x0: 0, y0: 0, z0: 0, x1: 0, y1: 1, z1: 0.8 }
    onEvents(a, 0, [{ type: 'move', hero: 0, move: 'mantle' }], 10)
    expect(settle(a, hero, 0, 25)).toMatchObject({ kind: 'mantle', low: true, t: 0.5 })
    hero.mantle = { from: 50, until: 95, x0: 0, y0: 0, z0: 0, x1: 0, y1: 2.2, z1: 0.8 }
    onEvents(a, 0, [{ type: 'move', hero: 0, move: 'climb' }], 50)
    const climb = settle(a, hero, 0, 60)
    expect(climb.kind).toBe('climb')
    expect('low' in climb).toBe(false)
  })

  it('a ground move that loses the floor falls at once', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.roll = { from: 10, until: 43, x: 0, z: 1 }
    onEvents(a, 0, [{ type: 'move', hero: 0, move: 'roll' }], 10)
    expect(settle(a, hero, 0.1, 12).kind).toBe('roll')
    hero.airborne = true
    expect(settle(a, hero, 0.1, 13)).toMatchObject({ kind: 'air', phase: 'apex' })
  })
})

describe('an air slam plays its blow, though the engine casts nothing for it', () => {
  it('winds the blow up through the plunge and lands it with the landing', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.airborne = true
    hero.slam = { from: 100 }
    hero.velocity.y = -32
    onEvents(a, 0, [{ type: 'melee', hero: 0, what: 'slam' }], 100)
    const plunging = settle(a, hero, 0, 104) as { kind: string; prep: number; air: boolean; melee: { kind: string } }
    expect(plunging).toMatchObject({ kind: 'cast', slot: 'basic', air: true, melee: { kind: 'slam' } })
    expect(plunging.prep).toBeGreaterThan(0.3)
    expect(plunging.prep).toBeLessThan(1)
    // it lands: the engine clears the slam, says so and holds the hero a moment
    hero.slam = undefined
    hero.airborne = false
    hero.velocity.y = 0
    hero.stunnedUntil = 112 + 12
    onEvents(a, 0, [{ type: 'melee', hero: 0, what: 'slam-land' }], 112)
    expect(settle(a, hero, 0, 112)).toMatchObject({ kind: 'cast', prep: 1, air: false, melee: { kind: 'slam' } })
    expect(settle(a, hero, 0, 118).kind).toBe('cast')
    hero.stunnedUntil = 0
    expect(settle(a, hero, 0, 112 + 60).kind).toBe('idle')
  })

  it('a plunge knocked out of the air shows what knocked it', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.airborne = true
    hero.slam = { from: 100 }
    onEvents(a, 0, [{ type: 'melee', hero: 0, what: 'slam' }], 100)
    hero.slam = undefined
    hero.launch = { from: 103, until: 140, height: 2, base: 0, regain: true }
    expect(settle(a, hero, 0, 103).kind).toBe('launched')
    hero.launch = undefined
    hero.velocity.y = -10
    expect(settle(a, hero, 0, 141)).toMatchObject({ kind: 'air', phase: 'fall' })
  })
})

describe('a blow caught on the guard', () => {
  it('jolts the guard, then the guard holds on', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.blocking = true
    expect(settle(a, hero, 0, 10).kind).toBe('block')
    onEvents(a, 0, [{ type: 'melee', hero: 0, what: 'blocked', by: 1 }], 12)
    expect(settle(a, hero, 0, 14).kind).toBe('block_hit')
    expect(settle(a, hero, 0, 12 + ticks(MOVE_SECONDS.block_hit) + 1).kind).toBe('block')
    // the guard dropped mid-jolt: nothing of it stays
    onEvents(a, 0, [{ type: 'melee', hero: 0, what: 'blocked', by: 1 }], 60)
    hero.blocking = false
    expect(settle(a, hero, 0, 62).kind).toBe('idle')
  })
})

describe('a cast held to charge', () => {
  it('draws its wind-up while the button is down, and goes on from there when let go', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.charging = { slot: 'active1', since: 100 }
    // idle until the pass: the aim was only taken as the shot left (kit check, 2026-11-13)
    const early = settle(a, hero, 0, 103)
    const late = settle(a, hero, 0, 100 + ENGINE.tickHz)
    expect(early).toMatchObject({ kind: 'cast', slot: 'active1', recover: 0 })
    expect(late.kind === 'cast' && early.kind === 'cast' && late.prep! > early.prep! && late.prep! < 1).toBe(true)
    // let go: the engine casts, and the cast is the same one, picked up where the charge held it
    hero.charging = undefined
    const at = 100 + ENGINE.tickHz + 1
    hero.action = { slot: 'active1', started: at, release: at + 6, ends: at + 20, released: false }
    onEvents(a, 0, [{ type: 'cast', hero: 0, slot: 'active1', templateId: 'x', release: at + 6, ends: at + 20 }, { type: 'charge', hero: 0, slot: 'active1', phase: 'release', power: 2 }], at)
    const fired = settle(a, hero, 0, at)
    expect(fired).toMatchObject({ kind: 'cast', slot: 'active1' })
    expect(fired.kind === 'cast' && late.kind === 'cast' && fired.seq === late.seq && fired.prep! >= late.prep!).toBe(true)
  })

  it('a charge cut off shows nothing of the cast', () => {
    const hero = fighter()
    const a = createAnimator()
    hero.charging = { slot: 'active2', since: 100 }
    expect(settle(a, hero, 0, 130).kind).toBe('cast')
    hero.charging = undefined
    expect(settle(a, hero, 0, 131).kind).toBe('idle')
  })
})

describe('a shot fired again while the last still shows', () => {
  const shoot = (a: ReturnType<typeof createAnimator>, hero: HeroState, at: number) => {
    hero.action = { slot: 'active1', started: at, release: at + 6, ends: at + 14, released: false }
    onEvents(a, 0, [{ type: 'cast', hero: 0, slot: 'active1', templateId: 'x', release: at + 6, ends: at + 14 }], at)
  }

  it('goes on from the aim it holds, and starts from the stance once it has been let go', () => {
    const hero = fighter()
    const a = createAnimator()
    shoot(a, hero, 100)
    const first = settle(a, hero, 0, 100)
    expect(first).toMatchObject({ kind: 'cast', prep: 0 })
    settle(a, hero, 0, 108)
    // a held trigger: the next shot's wind-up is the last of the draw, not all of it (the clip started over each shot)
    shoot(a, hero, 110)
    const again = settle(a, hero, 0, 110)
    expect(again.kind === 'cast' && again.prep! > 0.5 && again.prep! < 1).toBe(true)
    // let go and stood a while: the next shot is a fresh one
    hero.action = undefined
    for (let t = 125; t < 220; t += 5) settle(a, hero, 0, t)
    expect(a.state.kind).toBe('idle')
    shoot(a, hero, 220)
    expect(settle(a, hero, 0, 220)).toMatchObject({ kind: 'cast', prep: 0 })
  })

  it('a held beam keeps the pose it leaves from through every pulse', () => {
    const hero = fighter()
    const a = createAnimator()
    shoot(a, hero, 100)
    settle(a, hero, 0, 100)
    hero.beam = { since: 106, until: 140, from: { x: 0, y: 1, z: 0 }, end: { x: 0, y: 1, z: 9 } }
    expect(settle(a, hero, 0, 107)).toMatchObject({ kind: 'cast', prep: 1, recover: 0, since: 0 })
    shoot(a, hero, 114)
    expect(settle(a, hero, 0, 115)).toMatchObject({ kind: 'cast', prep: 1, recover: 0, since: 0 })
    // the beam let go: the shot follows through
    hero.beam = undefined
    const after = settle(a, hero, 0, 124)
    expect(after.kind === 'cast' && after.since! > 0).toBe(true)
  })
})
