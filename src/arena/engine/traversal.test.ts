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
