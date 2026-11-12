import { describe, expect, it } from 'vitest'
import { ai, at, melee, movement, phys, ranged } from '../../charter/templates/dsl.js'
import type { Delivery, Effect, Template, TraverseKind } from '../../charter/types.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ticks } from './calibration.js'
import type { CoverPiece } from './cover.js'
import { COMBAT_RULES } from './deliveries.js'
import type { MatchEvent } from './events.js'
import { AIM_STEPS, MOVES, createHero, emptyMatch, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'

const E = slotBit('movement')
const LMB = slotBit('active1')

const fist = melee({ style: 'unarmed', id: 'fist', name: 'Fist', roles: ['fighter'], tags: ['t'], ai: ai('poke', 1), delivery: at.melee(2.5), effects: [phys(40)] })
const gun = ranged({ id: 'gun', name: 'Gun', roles: ['marksman'], tags: ['t'], ai: ai('poke', 1), delivery: at.proj(40, undefined, 60), effects: [phys(20)], ranged: { style: 'pistol', mode: 'single', rate: 3, magazine: 12, reload: 1 } })
const moveOf = (how: TraverseKind, distance: number, duration: number, extra: Effect[] = [], delivery: Delivery = at.self()): Template =>
  movement({ id: `e-${how}`, name: how, roles: ['fighter'], tags: ['t'], ai: ai('poke', 1), cooldown: 1, delivery, effects: [{ kind: 'traverse', how, distance, duration }, ...extra] })

/**
 * Hero 0 (a fighter) at the origin facing +z with `mine` on E; hero 1 (a tank) at `foe`, facing it; hero 2 (a support
 * on hero 1's side) at `third`. Hero 1 can carry `theirs` on E. The full kit is on.
 */
function lab({ mine, theirs, foe = { x: 0, y: 0, z: 8 }, third = { x: 6, y: 0, z: 8 }, cover }: { mine?: Template; theirs?: Template; foe?: { x: number; y: number; z: number }; third?: { x: number; y: number; z: number }; cover?: CoverPiece[] } = {}) {
  const m: MatchState = emptyMatch(4)
  m.fullKit = true
  if (cover) m.cover = { pieces: cover, health: cover.map((p) => p.health ?? -1) }
  const fighter = prepareHero(defaultBuild('fighter'))
  const tank = prepareHero(defaultBuild('tank'))
  const support = prepareHero(defaultBuild('support'))
  const setups: HeroSetup[] = [
    { ...fighter, kit: { ...fighter.kit, basic: fist, active1: gun, ...(mine ? { movement: mine } : {}) }, magazine: 12 },
    { ...tank, kit: { ...tank.kit, basic: fist, active1: gun, ...(theirs ? { movement: theirs } : {}) }, magazine: 12 },
    support,
  ]
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }), createHero(setups[1], 1, 1, foe), createHero(setups[2], 2, 1, third))
  m.heroes[1].yaw = Math.PI
  const events: MatchEvent[] = []
  const cmd = (buttons = 0, moveZ = 0, moveX = 0, { yaw = 0, pitch = 0, moves = 0 } = {}): Command => ({ moveX, moveZ, moves, aimYaw: Math.round((yaw / (2 * Math.PI)) * AIM_STEPS), aimPitch: Math.round((pitch / (2 * Math.PI)) * AIM_STEPS), buttons })
  let them: Command = cmd(0, 0, 0, { yaw: Math.PI })
  let other: Command = cmd()
  const step = (a: Command = cmd(), n = 1) => {
    for (let i = 0; i < n; i++) {
      events.push(...tick(m, setups, [a, them, other], COMBAT_RULES))
      them = { ...them, buttons: 0 }
    }
  }
  const of = <T extends MatchEvent['type']>(type: T) => events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  const moved = (what: string, hero = 0) => of('move').filter((e) => e.move === what && e.hero === hero)
  return { m, setups, step, cmd, of, moved, events, setThem: (c: Command) => void (them = c), setOther: (c: Command) => void (other = c) }
}

describe('E: going somewhere at once (full kit)', () => {
  it('a teleport puts the hero behind the one the crosshair covers, or where the aim meets the world', () => {
    const d = lab({ mine: moveOf('teleport', 15, 0) })
    d.step(d.cmd(E))
    d.step(d.cmd(), 30)
    expect(d.moved('teleport')).toHaveLength(1)
    expect(d.m.heroes[0].position.z).toBeGreaterThan(8.5)
    const far = lab({ mine: moveOf('teleport', 10, 0) })
    far.step(far.cmd(E, 0, 0, { yaw: -Math.PI / 2 }))
    far.step(far.cmd(0, 0, 0, { yaw: -Math.PI / 2 }), 30)
    expect(far.m.heroes[0].position.x).toBeLessThan(-9)
  })

  it('a swap trades places with the hero the crosshair covers', () => {
    const d = lab({ mine: moveOf('swap', 15, 0) })
    d.step(d.cmd(E))
    d.step(d.cmd(), 30)
    expect(d.m.heroes[0].position.z).toBeCloseTo(8, 0)
    expect(d.m.heroes[1].position.z).toBeCloseTo(0, 0)
  })

  it('a homing dash runs onto the enemy near the crosshair and lands its blow there', () => {
    const d = lab({ mine: moveOf('homing', 12, 0, [phys(60)]), foe: { x: 2, y: 0, z: 8 } })
    d.step(d.cmd(E))
    d.step(d.cmd(), 40)
    const h = d.m.heroes[0].position
    expect(Math.sqrt((h.x - 2) * (h.x - 2) + (h.z - 8) * (h.z - 8))).toBeLessThan(2)
    expect(d.of('hit').filter((e) => e.source === 0 && e.target === 1)).toHaveLength(1)
  })

  it('a combat roll carries the hero untouchable all the way, and reloads its gun', () => {
    const d = lab({ mine: moveOf('combatRoll', 6, 0) })
    d.m.heroes[0].ammo = 2
    d.step(d.cmd(0, 1), 20)
    const z = d.m.heroes[0].position.z
    d.step(d.cmd(E, 1))
    let untouchable = true
    for (let i = 0; i < 40; i++) {
      d.step(d.cmd(0, 1))
      if (d.m.heroes[0].travel && d.m.heroes[0].invulnerableUntil <= d.m.tick) untouchable = false
    }
    expect(d.moved('roll').length).toBeGreaterThan(0)
    expect(untouchable).toBe(true)
    expect(d.m.heroes[0].position.z).toBeGreaterThan(z + 5)
    expect(d.m.heroes[0].ammo).toBe(12)
  })

  it('a power slide bowls over the enemy it meets', () => {
    const d = lab({ mine: moveOf('powerSlide', 9, 0, [phys(30)]), foe: { x: 0, y: 0, z: 9 } })
    d.step(d.cmd(0, 1), 20)
    d.step(d.cmd(E, 1))
    let down = false
    for (let i = 0; i < 60; i++) (d.step(d.cmd()), (down ||= !!d.m.heroes[1].down))
    expect(d.moved('power-slide')).toHaveLength(1)
    expect(down).toBe(true)
    expect(d.of('hit').filter((e) => e.source === 0 && e.target === 1).length).toBeGreaterThan(0)
  })

  it('wall run lets any wall be run along for a while', () => {
    const d = lab({ mine: moveOf('wallRun', 0, 6) })
    d.step(d.cmd(E))
    d.step(d.cmd(), 20)
    expect(d.m.heroes[0].anyWallUntil! - d.m.tick).toBeGreaterThan(ticks(5))
  })
})

describe('E: held ways of moving (full kit)', () => {
  it('flight climbs while jump is held, flies the way it steers, and falls back when it ends', () => {
    const d = lab({ mine: moveOf('flight', 0, 2), foe: { x: 20, y: 0, z: 0 } })
    d.step(d.cmd(E))
    d.step(d.cmd(0, 0, 0, { moves: MOVES.jump }), 50)
    expect(d.m.heroes[0].position.y).toBeGreaterThan(3)
    d.step(d.cmd(0, 1), 40)
    expect(d.m.heroes[0].position.z).toBeGreaterThan(5)
    d.step(d.cmd(), 180)
    expect(d.m.heroes[0].position.y).toBeLessThan(0.05)
    expect(d.m.heroes[0].traverse).toBeUndefined()
  })

  it('a glide hops up and falls slowly, carried forward', () => {
    const d = lab({ mine: moveOf('glide', 0, 6), foe: { x: 20, y: 0, z: 0 } })
    d.step(d.cmd(E, 1))
    let air = 0
    for (let i = 0; i < 300 && (i < 20 || d.m.heroes[0].airborne); i++) (d.step(d.cmd(0, 1)), d.m.heroes[0].airborne && air++)
    // a plain jump is about 0.6 s in the air
    expect(air).toBeGreaterThan(ticks(0.6))
    expect(d.m.heroes[0].position.z).toBeGreaterThan(4)
  })

  it('a swing carries the hero on a line from a point up ahead, and a jump lets go', () => {
    const d = lab({ mine: moveOf('swing', 14, 4), foe: { x: 20, y: 0, z: 0 } })
    d.step(d.cmd(E, 0, 0, { pitch: 0.6 }))
    let high = 0
    for (let i = 0; i < 50; i++) (d.step(d.cmd(0, 1)), (high = Math.max(high, d.m.heroes[0].position.y)))
    expect(d.moved('swing')).toHaveLength(1)
    expect(d.m.heroes[0].position.z).toBeGreaterThan(3)
    d.step(d.cmd(0, 1, 0, { moves: MOVES.jump }))
    expect(d.m.heroes[0].traverse).toBeUndefined()
  })

  it('wall crawl climbs a wall pushed into, and over its top', () => {
    const wall: CoverPiece = { shape: { kind: 'block', x: 0, z: 5, hx: 3, hz: 3 }, base: 0, top: 4, look: 'wall' }
    const d = lab({ mine: moveOf('wallCrawl', 0, 6), cover: [wall], foe: { x: 20, y: 0, z: 0 } })
    d.step(d.cmd(E))
    // into the wall until it is up on top, then it stands there
    d.step(d.cmd(0, 1), 70)
    d.step(d.cmd(), 30)
    expect(d.m.heroes[0].position.y).toBeCloseTo(4, 1)
    expect(d.m.heroes[0].position.z).toBeGreaterThan(2)
  })

  it('a burrow goes under the ground, untouchable and unable to act, and comes up under the enemy', () => {
    const d = lab({ mine: moveOf('burrow', 0, 1.5, [phys(50)]), foe: { x: 0, y: 0, z: 5 } })
    d.step(d.cmd(E))
    d.step(d.cmd(0, 1), 10)
    d.setThem(d.cmd(LMB, 0, 0, { yaw: Math.PI }))
    d.step(d.cmd(LMB, 1), 25)
    d.step(d.cmd(LMB), 15)
    expect(d.of('hit').filter((e) => e.target === 0)).toHaveLength(0)
    expect(d.of('projectile').filter((e) => e.hero === 0)).toHaveLength(0)
    d.step(d.cmd(), 60)
    expect(d.moved('emerge')).toHaveLength(1)
    expect(d.of('hit').filter((e) => e.source === 0 && e.target === 1).length).toBeGreaterThan(0)
  })

  it('a rider sits up on its ally and goes where it goes, and a jump gets it off', () => {
    const d = lab({ theirs: moveOf('ride', 8, 6), foe: { x: 4, y: 0, z: 8 }, third: { x: 6, y: 0, z: 8 } })
    d.setThem(d.cmd(E, 0, 0, { yaw: Math.PI }))
    d.step(d.cmd(), 20)
    expect(d.m.heroes[1].traverse?.how).toBe('ride')
    d.setOther(d.cmd(0, 1))
    d.step(d.cmd(), 40)
    const rider = d.m.heroes[1].position
    const mount = d.m.heroes[2].position
    expect(Math.abs(rider.z - mount.z)).toBeLessThan(0.5)
    expect(rider.y).toBeGreaterThan(mount.y + 1)
    d.setThem(d.cmd(0, 0, 0, { yaw: Math.PI, moves: MOVES.jump }))
    d.step(d.cmd())
    expect(d.m.heroes[1].traverse).toBeUndefined()
  })

  it('a zipline fires a line along the aim and rides it up', () => {
    const d = lab({ mine: moveOf('zipline', 14, 4), foe: { x: 20, y: 0, z: 0 } })
    d.step(d.cmd(E, 0, 0, { pitch: 0.4 }))
    let high = 0
    for (let i = 0; i < 60; i++) (d.step(d.cmd(0, 0, 0, { pitch: 0.4 })), (high = Math.max(high, d.m.heroes[0].position.y)))
    expect(d.of('line').filter((e) => e.phase === 'up')).toHaveLength(1)
    expect(high).toBeGreaterThan(3)
  })
})
