import { describe, expect, it } from 'vitest'
import { ROLE_IDS } from '../../charter/roles.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE } from './calibration.js'
import { initialCoverHealth, surfaceAt, type CoverPiece, type MapLine } from './cover.js'
import type { MatchEvent } from './events.js'
import { capsule, createHero, emptyMatch, MOVES, prepareHero, type Command, type HeroSetup, type MatchState } from './state.js'
import { keepOut } from './locomotion.js'
import { tick } from './tick.js'
import { tickWorld } from './world.js'

/**
 * Traversal (GAME.md §7): the baseline every hero has, measured in the engine, and the moves the map is built on:
 * ramps, mantling onto ledges, landing a big fall, ziplines and rails.
 */

const M = ENGINE.move
const ticksOf = (seconds: number) => Math.round(seconds * ENGINE.tickHz)
const go = (moveX: number, moveZ: number, moves = 0): Command => ({ moveX, moveZ, moves, aimYaw: 0, aimPitch: 0, buttons: 0 })

function solo(opts: { moveSpeed?: number; y?: number; pieces?: CoverPiece[]; lines?: MapLine[]; size?: HeroSetup['build']['sizeClass'] } = {}) {
  const base = prepareHero({ ...defaultBuild('fighter'), ...(opts.size ? { sizeClass: opts.size } : {}) })
  const setup = opts.moveSpeed ? { ...base, sheet: { ...base.sheet, moveSpeed: opts.moveSpeed } } : base
  const m: MatchState = emptyMatch(1)
  if (opts.pieces) m.cover = { pieces: opts.pieces, health: initialCoverHealth(opts.pieces) }
  if (opts.lines) m.lines = opts.lines
  const h = createHero(setup, 0, 0, { x: 0, y: opts.y ?? 0, z: 0 })
  m.heroes.push(h)
  const events: MatchEvent[] = []
  const step = (c: Command | undefined, n = 1) => {
    for (let i = 0; i < n; i++) events.push(...tick(m, [setup], [c]))
  }
  const moves = () => events.flatMap((e) => (e.type === 'move' ? [e.move] : []))
  return { m, h, step, events, moves }
}

const block = (x: number, z: number, hx: number, hz: number, top: number, extra: Partial<CoverPiece> = {}): CoverPiece => ({ shape: { kind: 'block', x, z, hx, hz }, base: 0, top, look: 'grey', ...extra })

describe('the baseline every hero has (§7, measured)', () => {
  it('rolls the way it steers, not the way it aims; with no key held, ahead (owner, 2026-11-03)', () => {
    // aim along +z (aimYaw 0), steer right (-x): the roll goes right
    const s = solo()
    s.step(go(-1, 0, MOVES.dodge))
    s.step(go(-1, 0), ticksOf(M.roll.time) - 2)
    expect(s.moves()).toContain('roll')
    expect(s.h.position.x).toBeLessThan(-M.roll.distance * 0.6)
    expect(Math.abs(s.h.position.z)).toBeLessThan(0.3)
    const still = solo()
    still.step(go(0, 0, MOVES.dodge))
    still.step(go(0, 0), ticksOf(M.roll.time) - 2)
    expect(still.h.position.z).toBeGreaterThan(M.roll.distance * 0.6)
  })

  it('the field jogs about 6.5 m/s and a 6.5 m/s jog sprints at 8', () => {
    const jogs = ROLE_IDS.map((r) => prepareHero(defaultBuild(r)).sheet.moveSpeed)
    const mean = jogs.reduce((a, b) => a + b, 0) / jogs.length
    expect(mean).toBeGreaterThan(6.2)
    expect(mean).toBeLessThan(7)
    const { h, step } = solo({ moveSpeed: 6.5 })
    step(go(0, 1), 30)
    expect(h.velocity.z).toBeCloseTo(6.5, 3)
    // Shift pressed dashes; held on, it sprints
    step(go(0, 1, MOVES.dash), 60)
    expect(h.velocity.z).toBeGreaterThan(7.9)
    expect(h.velocity.z).toBeLessThan(8.1)
  })

  it('jumps big (§5), a second jump higher still, and a dash bursts about 3.5 m', () => {
    const { h, step } = solo()
    step(go(0, 0, MOVES.jump))
    let top = 0
    for (let i = 0; i < 40; i++) {
      step(go(0, 0, MOVES.jump))
      top = Math.max(top, h.position.y)
    }
    expect(top).toBeGreaterThan(M.jump - 0.15)
    // the second press at the top of the first adds the air jump: the total reach the map's bands are spaced by
    const again = solo()
    again.step(go(0, 0, MOVES.jump))
    again.step(go(0, 0))
    while (again.h.velocity.y > 0) again.step(go(0, 0))
    again.step(go(0, 0, MOVES.jump))
    top = 0
    for (let i = 0; i < 40; i++) {
      again.step(go(0, 0))
      top = Math.max(top, again.h.position.y)
    }
    expect(top).toBeGreaterThan(M.jump + M.airJump - 0.3)
    const dash = solo()
    dash.step(go(0, 1, MOVES.dash))
    dash.step(go(0, 0), Math.round(M.dash.time * ENGINE.tickHz))
    expect(dash.h.position.z).toBeGreaterThan(3.2)
    expect(dash.h.position.z).toBeLessThan(3.9)
  })

  it('size and mass scale the jump: a tiny body jumps higher than a huge one', () => {
    const peak = (size: 'tiny' | 'huge') => {
      const s = solo({ size })
      s.step(go(0, 0, MOVES.jump))
      let top = 0
      for (let i = 0; i < 60; i++) {
        s.step(go(0, 0))
        top = Math.max(top, s.h.position.y)
      }
      return top
    }
    expect(peak('tiny')).toBeGreaterThan(peak('huge') + 1)
  })

  it('no fall damage from any ordinary height', () => {
    const { h, step } = solo({ y: 20 })
    const hp = h.hp
    step(go(0, 0), 120)
    expect(h.airborne).toBe(false)
    expect(h.hp).toBe(hp)
  })
})

describe('ramps (§8 card ramps and stairs)', () => {
  // a 22° ramp rising toward +z from the ground to a 4 m deck
  const ramp = block(0, 6, 2, 5, 4, { slope: { rise: 'z+', low: 0 }, look: 'ramp' })
  const deck = block(0, 15, 4, 4, 4)

  it('its surface runs from its low end to its top', () => {
    expect(surfaceAt(ramp, 0, 1)).toBeCloseTo(0)
    expect(surfaceAt(ramp, 0, 6)).toBeCloseTo(2)
    expect(surfaceAt(ramp, 0, 11)).toBeCloseTo(4)
  })

  it('a hero walks up it onto the deck, and back down without ever leaving the ground', () => {
    const { h, step } = solo({ pieces: [ramp, deck] })
    let flew = false
    for (let i = 0; i < 180 && h.position.z < 13; i++) {
      step(go(0, 1))
      flew ||= h.airborne
    }
    expect(h.position.z).toBeGreaterThan(12)
    expect(h.position.y).toBeCloseTo(4)
    for (let i = 0; i < 150; i++) {
      step(go(0, -1))
      if (h.position.z > 1.5 && h.position.z < 10.5) flew ||= h.airborne
    }
    expect(h.position.y).toBe(0)
    expect(flew).toBe(false)
  })

  it('its high side is a wall from the ground', () => {
    const { h, step } = solo({ pieces: [ramp] })
    h.position = { x: 5, y: 0, z: 10 }
    step(go(-1, 0), 90)
    expect(h.position.x).toBeGreaterThan(2)
    expect(h.position.y).toBe(0)
  })

  it('a shot along the ramp just above it flies clear; one into its high end stops', () => {
    // a hero on the ramp's low end shooting up along it isn't blocked by the empty wedge above the slope
    const m = solo({ pieces: [ramp] }).m
    const pieces = m.cover!.pieces
    const health = m.cover!.health
    return import('./cover.js').then(({ clearLine }) => {
      expect(clearLine(pieces, health, { x: 0, y: 1.4, z: 1.5 }, { x: 0, y: 5.4, z: 11.5 })).toBe(true)
      expect(clearLine(pieces, health, { x: 0, y: 1.4, z: -4 }, { x: 0, y: 1.4, z: 11 })).toBe(false)
    })
  })

  it('a body put down under its slope beside a wall (a blink, a throw) stands on the slope, not in the wall', () => {
    const wall = block(-3.5, 6, 1.5, 5, 4)
    const { h, m } = solo({ pieces: [ramp, wall] })
    // its centre over the ramp's edge, its body clear of the wall: no push out of the ramp's side into the wall
    h.position = { x: -1.4, y: 0, z: 6 }
    keepOut(h, m)
    expect(h.position.x).toBeCloseTo(-1.4)
    expect(h.position.y).toBeCloseTo(2)
  })

  it('a knock-up that carries a hero up the ramp lands it on the slope, not back at the height it left', () => {
    const { h, m } = solo({ pieces: [ramp] })
    h.position = { x: 0, y: 0.6, z: 2.5 }
    h.launch = { from: m.tick, until: m.tick + 30, height: 1.5, base: 0.6, push: { x: 0, z: 0.1 } }
    let lowest = Infinity
    for (let i = 0; i < 40; i++) {
      m.tick++
      tickWorld({ match: m, setups: [], events: [] } as unknown as Parameters<typeof tickWorld>[0])
      if (!h.launch) lowest = Math.min(lowest, h.position.y - surfaceAt(ramp, h.position.x, h.position.z))
    }
    expect(h.position.z).toBeGreaterThan(5)
    expect(lowest).toBeGreaterThan(-1e-6)
    expect(h.airborne).toBe(false)
  })
})

describe('ceilings (§8)', () => {
  it('a jump under a deck bumps its head and comes down, without being pushed aside', () => {
    const deck = block(0, 0, 4, 4, 3, { base: 2.6 })
    const { h, step } = solo({ pieces: [deck] })
    step(go(0, 0, MOVES.jump))
    let top = 0
    for (let i = 0; i < 60; i++) {
      step(go(0, 0))
      top = Math.max(top, h.position.y + capsule(h).height)
    }
    expect(top).toBeLessThanOrEqual(2.6 + 1e-6)
    expect(h.position.x).toBeCloseTo(0)
    expect(h.position.z).toBeCloseTo(0)
    expect(h.airborne).toBe(false)
  })

  it('a body risen into a deck beside a wall (a knock-up, a throw) is pushed down under it, not out through the wall', () => {
    const deck = block(0, 0, 4, 4, 4.5, { base: 4 })
    const wall = block(-5.5, 0, 1.5, 4, 4.5)
    const { h, m } = solo({ pieces: [deck, wall] })
    h.position = { x: -3.6, y: 3.2, z: 0.5 }
    keepOut(h, m)
    expect(h.position.x).toBeCloseTo(-3.6)
    expect(h.position.z).toBeCloseTo(0.5)
    expect(h.position.y + capsule(h).height).toBeLessThanOrEqual(4 + 1e-6)
  })

  it('a knock-up under a thin roof never comes out on top of it, however high it would have thrown', () => {
    const roof = block(0, 0, 4, 4, 2.6, { base: 2.2 })
    const { h, m } = solo({ pieces: [roof] })
    h.launch = { from: m.tick, until: m.tick + 40, height: 4, base: 0 }
    let top = 0
    for (let i = 0; i < 45; i++) {
      m.tick++
      tickWorld({ match: m, setups: [], events: [] } as unknown as Parameters<typeof tickWorld>[0])
      top = Math.max(top, h.position.y + capsule(h).height)
    }
    expect(top).toBeLessThanOrEqual(2.2 + 1e-6)
    expect(h.position.y).toBe(0)
  })

  it('a body inside a wall leaves by the nearest face that is not inside another', () => {
    // nearest is the left face, but the wall beside it fills that side
    const a = block(0, 0, 2, 4, 3)
    const b = block(-3.5, 0, 1.5, 4, 3)
    const { h, m } = solo({ pieces: [a, b] })
    h.position = { x: -1.6, y: 0, z: 1 }
    keepOut(h, m)
    expect(h.position.x).toBeGreaterThan(-5)
    expect(Math.abs(h.position.x) > 2 || Math.abs(h.position.z) > 4).toBe(true)
    expect(h.position.x).not.toBeLessThan(-2)
  })
})

describe('a press that comes a moment early waits for its moment (owner playtest, 2026-11-03)', () => {
  it('a roll pressed as a climb ends rolls the moment the hero stands on top', () => {
    const { m, h, step, moves } = solo({ pieces: [block(0, 4, 3, 2, 1.3)] })
    m.human = 0
    for (let i = 0; i < 120 && !h.mantle; i++) step(go(0, 1))
    step(go(0, 1), h.mantle!.until - m.tick - 4)
    // Z while still climbing: nothing yet, then the roll as soon as the hero is up
    step(go(1, 0, MOVES.dodge))
    expect(h.mantle).toBeDefined()
    expect(moves()).not.toContain('roll')
    step(go(1, 0), 6)
    expect(moves()).toContain('roll')
    expect(h.roll).toBeDefined()
  })

  it('a jump pressed just before landing jumps on landing; pressed high in the air, it is gone by then', () => {
    const fall = (early: boolean) => {
      const s = solo()
      s.m.human = 0
      s.step(go(0, 1, MOVES.jump))
      s.step(go(0, 1), 12)
      s.step(go(0, 1, MOVES.jump))
      // out of jumps: the next press waits — from near the floor it lands in time, from the top of the arc it doesn't
      for (let i = 0; i < 200 && !(early ? s.h.velocity.y < 0 : s.h.velocity.y < 0 && s.h.position.y < 0.6); i++) s.step(go(0, 1))
      s.step(go(0, 1, MOVES.jump))
      for (let i = 0; i < 200 && s.h.airborne; i++) s.step(go(0, 1))
      s.step(go(0, 1), 3)
      return s.moves().filter((x) => x === 'jump').length
    }
    expect(fall(false)).toBe(2)
    expect(fall(true)).toBe(1)
  })

  it('a jump a moment after walking off an edge is still the ground jump (coyote time); later, the air jump', () => {
    // a step shorter than a ledge hang's drop, so the walk off it falls
    const late = (seconds: number, human = true) => {
      const s = solo({ y: 1.5, pieces: [block(0, 0, 2, 2, 1.5)] })
      if (human) s.m.human = 0
      s.step(go(0, 0), 3)
      for (let i = 0; i < 120 && !s.h.airborne; i++) s.step(go(0, 1))
      s.step(go(0, 1), ticksOf(seconds) - 1)
      s.step(go(0, 1, MOVES.jump))
      return { moves: s.moves(), stamina: s.h.stamina }
    }
    expect(late(M.coyote).moves).toContain('jump')
    expect(late(M.coyote).stamina).toBe(M.stamina.max)
    expect(late(M.coyote + 0.1).moves).toContain('air-jump')
    // a person's grace, like the buffer: the AI jumps on the tick it means
    expect(late(M.coyote, false).moves).toContain('air-jump')
  })

  it('a roll a player makes off an edge ends there and falls, rather than rolling on through the air', () => {
    const { m, h, step, moves } = solo({ y: 2, pieces: [block(0, 0, 2, 2, 2)] })
    m.human = 0
    step(go(0, 0), 3)
    step(go(0, 1, MOVES.dodge))
    expect(moves()).toContain('roll')
    for (let i = 0; i < 40 && !h.airborne; i++) step(go(0, 1))
    expect(h.airborne).toBe(true)
    expect(h.roll).toBeUndefined()
  })

  it('the AI gets no such grace: it presses on the tick it means', () => {
    const { h, step, moves } = solo({ pieces: [block(0, 4, 3, 2, 1.3)] })
    for (let i = 0; i < 120 && !h.mantle; i++) step(go(0, 1))
    step(go(1, 0, MOVES.dodge))
    step(go(1, 0), 40)
    expect(moves()).not.toContain('roll')
  })
})

describe('mantle (§7)', () => {
  it('walking into a ledge up to 1.4 m high pulls the hero up onto it', () => {
    const { h, step, moves } = solo({ pieces: [block(0, 4, 3, 2, 1.3)] })
    for (let i = 0; i < 120 && !h.mantle; i++) step(go(0, 1))
    step(go(0, 0), 40)
    expect(moves()).toContain('mantle')
    expect(h.position.y).toBeCloseTo(1.3)
    expect(h.position.z).toBeGreaterThan(2)
  })

  it('a ledge out of reach from the ground is caught at the top of a jump', () => {
    const top = M.jump + 1
    const { h, step, moves } = solo({ pieces: [block(0, 3, 3, 1.5, top)] })
    step(go(0, 1), 30)
    expect(moves()).not.toContain('mantle')
    step(go(0, 1, MOVES.jump))
    for (let i = 0; i < 90 && !h.mantle; i++) step(go(0, 1))
    step(go(0, 0), 40)
    expect(moves()).toContain('mantle')
    expect(h.position.y).toBeCloseTo(top)
  })

  it('no mantle where there is no room to stand on top', () => {
    const ledge = block(0, 4, 3, 2, 1.3)
    const ceiling = block(0, 4.5, 3, 2.5, 3.5, { base: 1.6 })
    const { h, step, moves } = solo({ pieces: [ledge, ceiling] })
    step(go(0, 1), 120)
    expect(moves()).not.toContain('mantle')
    expect(h.position.y).toBe(0)
  })

  it('no mantle up through a deck overhead: a hero in a tunnel walking into a step at its mouth stays under the roof', () => {
    const ledge = block(0, 4, 3, 2, 1.3)
    const roof = block(0, 0, 3, 2, 2.6, { base: 2.2 })
    const { h, step, moves } = solo({ pieces: [ledge, roof] })
    step(go(0, 1), 120)
    expect(moves()).not.toContain('mantle')
    expect(h.position.y).toBe(0)
  })
})

describe('ledge hang (§7, owner 2026-11-04)', () => {
  // a 4 m deck, 6 m square, the hero standing on it in the middle
  const deck = (opts: { human?: boolean; top?: number } = {}) => {
    const s = solo({ y: opts.top ?? 4, pieces: [block(0, 0, 3, 3, opts.top ?? 4)] })
    if (opts.human !== false) s.m.human = 0
    s.step(go(0, 0), 3)
    return s
  }
  const walkOff = (s: ReturnType<typeof deck>, moves = 0) => {
    for (let i = 0; i < 120 && !s.h.hang && !s.h.airborne; i++) s.step(go(0, 1, moves))
  }

  it('walking off a sheer edge, a played hero catches it and hangs, hands on the top, facing the drop', () => {
    const s = deck()
    walkOff(s)
    expect(s.moves()).toContain('hang')
    expect(s.h.hang).toBeDefined()
    expect(s.h.hang!.y).toBe(4)
    expect(s.h.hang!.nz).toBeCloseTo(1, 1)
    expect(s.h.hang!.z).toBeCloseTo(3, 0)
    expect(s.h.position.y).toBeCloseTo(4 - capsule(s.h).height * M.hang.below, 5)
    // it stays there while nothing is pressed
    s.step(go(0, 0), 60)
    expect(s.h.hang).toBeDefined()
  })

  it('a sprint goes over the edge, and the AI never hangs', () => {
    const sprint = deck()
    walkOff(sprint, MOVES.dash)
    sprint.step(go(0, 1, MOVES.dash), 10)
    expect(sprint.h.hang).toBeUndefined()
    const ai = deck({ human: false })
    walkOff(ai)
    ai.step(go(0, 1), 10)
    expect(ai.h.hang).toBeUndefined()
    expect(ai.moves()).not.toContain('hang')
  })

  it('a drop shorter than a hang is just a step down', () => {
    const s = deck({ top: 1.5 })
    walkOff(s)
    expect(s.h.hang).toBeUndefined()
  })

  it('jump climbs up onto the top; so does steering into the wall', () => {
    for (const how of [go(0, 0, MOVES.jump), go(0, -1)]) {
      const s = deck()
      walkOff(s)
      s.step(go(0, 0), ticksOf(0.3))
      s.step(how)
      expect(s.moves()).toContain('climb')
      s.step(go(0, 0), ticksOf(M.hang.climb) + 2)
      expect(s.h.hang).toBeUndefined()
      expect(s.h.airborne).toBe(false)
      expect(s.h.position.y).toBe(4)
      expect(s.h.position.z).toBeLessThan(3)
    }
  })

  it('crouch lets go and it falls, and it does not catch the same edge again on the way down', () => {
    const s = deck()
    walkOff(s)
    s.step(go(0, 0, MOVES.crouch))
    expect(s.moves()).toContain('let-go')
    for (let i = 0; i < 200 && s.h.airborne; i++) s.step(go(0, 0))
    expect(s.h.position.y).toBe(0)
    expect(s.moves().filter((x) => x === 'hang').length).toBe(1)
  })

  it('a stick still held from the walk off steers nothing until it is let go once', () => {
    const s = deck()
    walkOff(s)
    // the camera swings round to the wall: the held stick would now be into it, and along it
    s.step(go(0, -1), ticksOf(0.5))
    s.step(go(1, 0), 30)
    expect(s.h.hang).toBeDefined()
    expect(s.moves()).not.toContain('climb')
    expect(Math.abs(s.h.hang!.x - 0)).toBeLessThan(0.01)
    s.step(go(0, 0))
    s.step(go(0, -1), ticksOf(0.1))
    expect(s.moves()).toContain('climb')
  })

  it('jump while steering away leaps off the wall with the ground jump, the second jump still in hand', () => {
    const s = deck()
    walkOff(s)
    s.step(go(0, 0))
    s.step(go(0, 1, MOVES.jump))
    expect(s.h.hang).toBeUndefined()
    expect(s.h.velocity.y).toBeGreaterThan(5)
    expect(s.h.velocity.z).toBeGreaterThan(3)
    expect(s.h.airJumps).toBe(0)
  })

  it('it shimmies along the edge and stops where the edge ends', () => {
    const s = deck()
    walkOff(s)
    s.step(go(0, 0))
    const x0 = s.h.position.x
    s.step(go(1, 0), 30)
    expect(Math.abs(s.h.position.x - x0)).toBeGreaterThan(0.5)
    s.step(go(1, 0), 600)
    expect(s.h.hang).toBeDefined()
    expect(Math.abs(s.h.hang!.x)).toBeLessThanOrEqual(3)
  })

  it('nothing is cast from a hang', () => {
    const s = deck()
    walkOff(s)
    s.step({ ...go(0, 0), buttons: 1 })
    s.step(go(0, 0), 30)
    expect(s.h.action).toBeUndefined()
  })
})

describe("a played hero's jump is the player's to steer (owner, 2026-11-04)", () => {
  const played = (opts: Parameters<typeof solo>[0] = {}) => {
    const s = solo(opts)
    s.m.human = 0
    s.step(go(0, 0), 3)
    return s
  }
  const peak = (s: ReturnType<typeof solo>, held: number) => {
    let top = s.h.position.y
    for (let i = 0; i < 200 && (s.h.airborne || i < 2); i++) {
      s.step(go(0, 0, i < held ? MOVES.jump : 0))
      top = Math.max(top, s.h.position.y)
    }
    return top
  }

  it('let go early, the jump is cut short; held, it rises its full height; the AI always jumps full', () => {
    expect(peak(played(), 1)).toBeLessThan(M.jump * 0.5)
    expect(peak(played(), 60)).toBeCloseTo(M.jump, 0)
    expect(peak(solo(), 1)).toBeCloseTo(M.jump, 0)
  })

  it('steered in the air it goes the new way, and let go of, it stops drifting on', () => {
    const steered = played()
    steered.step(go(0, 0, MOVES.jump))
    steered.step(go(1, 0), 30)
    expect(steered.h.position.x).toBeGreaterThan(2)
    const runs = (letGo: boolean) => {
      const s = played()
      s.step(go(0, 1), 30)
      s.step(go(0, 1, MOVES.jump))
      for (let i = 0; i < 200 && s.h.airborne; i++) s.step(letGo ? go(0, 0) : go(0, 1))
      return s.h.position.z
    }
    expect(runs(true)).toBeLessThan(runs(false) - 2)
  })

  it('a sprint jumps further than a jog', () => {
    const across = (moves: number) => {
      const s = played()
      s.step(go(0, 1, moves), 40)
      const from = s.h.position.z
      s.step(go(0, 1, moves | MOVES.jump))
      for (let i = 0; i < 200 && s.h.airborne; i++) s.step(go(0, 1, moves))
      return s.h.position.z - from
    }
    expect(across(MOVES.dash)).toBeGreaterThan(across(0) * 1.15)
  })

  it('a jump that falls short of a wall\'s top catches its edge and hangs; one that clears it climbs on', () => {
    const at = (held: number) => {
      const s = played({ pieces: [block(0, 3, 3, 1.5, 4.5)] })
      s.step(go(0, 1), 20)
      s.step(go(0, 1, MOVES.jump), held)
      for (let i = 0; i < 120 && !s.h.hang && !s.h.mantle; i++) s.step(go(0, 1))
      return s
    }
    const short = at(9)
    expect(short.h.hang).toBeDefined()
    expect(short.h.hang!.y).toBe(4.5)
    expect(at(60).moves()).toContain('mantle')
  })

  it('a double jump over flat ground just lands: no roll, no heavy landing', () => {
    const s = played()
    s.step(go(0, 1), 20)
    s.step(go(0, 1, MOVES.jump), 25)
    s.step(go(0, 1), 1)
    s.step(go(0, 1, MOVES.jump), 25)
    for (let i = 0; i < 200 && s.h.airborne; i++) s.step(go(0, 1))
    expect(s.moves()).toContain('air-jump')
    expect(s.moves()).toContain('land')
    expect(s.moves().some((m) => m === 'land-roll' || m === 'land-heavy')).toBe(false)
  })
})

describe('slide and dive (owner, 2026-11-04)', () => {
  it('a slide ends crouched, and a dive at a run lies prone where it ends', () => {
    for (const [press, stance, move] of [[MOVES.crouch, 'crouch', 'slide'], [MOVES.prone, 'prone', 'dive']] as const) {
      const s = solo()
      s.m.human = 0
      s.step(go(0, 1), 40)
      s.step(go(0, 1, press))
      s.step(go(0, 1), 60)
      expect(s.moves()).toContain(move)
      expect(s.h.slide).toBeUndefined()
      expect(s.h.stance).toBe(stance)
    }
  })
})

describe('landing a big fall (§7)', () => {
  const drop = (moves: number, moveZ: number) => {
    const s = solo({ y: 14 })
    s.h.airborne = true
    s.h.velocity = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 120 && !s.events.some((e) => e.type === 'move' && e.move.startsWith('land')); i++) s.step(go(0, moveZ, moves))
    return s
  }

  it('steering, it rolls on and keeps its speed', () => {
    const { h, moves } = drop(0, 1)
    expect(moves()).toContain('land-roll')
    expect(h.velocity.z).toBeGreaterThan(5)
  })

  it('not steering, it lands heavily and stops; an ordinary jump just lands', () => {
    const { h, moves } = drop(0, 0)
    expect(moves()).toContain('land-heavy')
    expect(h.velocity.z).toBe(0)
    const hop = solo()
    hop.step(go(0, 0, MOVES.jump))
    hop.step(go(0, 0), 90)
    expect(hop.moves()).toContain('land')
    expect(hop.moves()).not.toContain('land-heavy')
  })
})

describe('ziplines and rails (§7)', () => {
  const zip: MapLine = { kind: 'zip', a: { x: 0, y: 8, z: 0 }, b: { x: 0, y: 6, z: 30 } }

  it('a hero whose hands pass the line catches it and rides it fast the way it was going, then lets go at the end', () => {
    const { h, step, moves } = solo({ lines: [zip] })
    h.position = { x: 0, y: 8 - capsule(h).height - M.zip.hang - 0.3, z: 3 }
    h.airborne = true
    h.velocity = { x: 0, y: 2, z: 4 }
    step(go(0, 1), 3)
    expect(moves()).toContain('zip-on')
    expect(h.zip?.dir).toBe(1)
    const z0 = h.position.z
    step(go(0, 1), 30)
    // half a second at zip speed
    expect(h.position.z - z0).toBeCloseTo(M.zip.speed * 0.5 * (30 / Math.sqrt(30 * 30 + 4)), 0)
    step(go(0, 1), 120)
    expect(moves()).toContain('zip-off')
    expect(h.zip).toBeUndefined()
    expect(h.position.z).toBeGreaterThan(29)
  })

  it('a jump lets go with a jump', () => {
    const { h, step, moves } = solo({ lines: [zip] })
    h.position = { x: 0, y: 8 - capsule(h).height - M.zip.hang, z: 3 }
    h.airborne = true
    h.velocity = { x: 0, y: 0, z: 4 }
    step(go(0, 1), 10)
    expect(h.zip).toBeDefined()
    step(go(0, 1, MOVES.jump))
    expect(h.zip).toBeUndefined()
    expect(moves()).toContain('zip-off')
    expect(h.velocity.y).toBeGreaterThan(10)
  })

  it('a rail is landed on from above and ridden standing', () => {
    const rail: MapLine = { kind: 'rail', a: { x: 0, y: 3, z: 0 }, b: { x: 0, y: 3, z: 30 } }
    const { h, step } = solo({ lines: [rail], y: 4 })
    h.position.z = 5
    h.airborne = true
    h.velocity = { x: 0, y: 0, z: 2 }
    step(go(0, 1), 20)
    expect(h.zip?.hang).toBe(false)
    expect(h.position.y).toBeCloseTo(3, 1)
  })
})
