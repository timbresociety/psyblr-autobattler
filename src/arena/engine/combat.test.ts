import { describe, expect, it } from 'vitest'
import { ai, at, melee, phys } from '../../charter/templates/dsl.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE } from './calibration.js'
import { COMBAT_RULES } from './deliveries.js'
import type { MatchEvent } from './events.js'
import { AIM_STEPS, createHero, emptyMatch, MOVES, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'

const fist = melee({ style: 'unarmed', id: 'fist', name: 'Fist', roles: ['fighter'], tags: ['t'], cooldown: 0, ai: ai('poke', 1), delivery: at.melee(2.5), effects: [phys(30)] })
const BASIC = slotBit('basic')

/** Hero 0 at the origin facing +z with a melee basic attack; hero 1 (a tank) right in front of it, facing back. */
function duel(gap = 1.6) {
  const m: MatchState = emptyMatch(3)
  const fighter = prepareHero(defaultBuild('fighter'))
  const setups: HeroSetup[] = [{ ...fighter, kit: { ...fighter.kit, basic: fist } }, prepareHero(defaultBuild('tank'))]
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }), createHero(setups[1], 1, 1, { x: 0, y: 0, z: gap }))
  m.heroes[1].yaw = Math.PI
  const events: MatchEvent[] = []
  const cmd = (buttons = 0, moves = 0, moveZ = 0): Command => ({ moveX: 0, moveZ, moves, aimYaw: 0, aimPitch: 0, buttons })
  const still = (moves = 0): Command => ({ moveX: 0, moveZ: 0, moves, aimYaw: AIM_STEPS / 2, aimPitch: 0, buttons: 0 })
  const step = (a: Command = cmd(), b: Command = still(), n = 1) => {
    for (let i = 0; i < n; i++) events.push(...tick(m, setups, [a, b], COMBAT_RULES))
  }
  /** Tap the basic attack, then wait until the hero is free to strike again. */
  const tap = (guard = 0) => {
    step(cmd(BASIC), still(guard))
    step(cmd(), still(guard))
    for (let i = 0; i < 120 && (m.heroes[0].action || m.tick < m.heroes[0].nextAttackAt); i++) step(cmd(), still(guard))
  }
  const of = <T extends MatchEvent['type']>(type: T) => events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  return { m, setups, step, tap, cmd, still, of, events }
}

describe('melee (canon)', () => {
  it('strikes when tapped, and three strikes that land chain into a finisher that launches as high as a double jump', () => {
    const d = duel()
    d.tap()
    expect(d.of('cast').map((e) => e.melee?.step)).toEqual([0])
    expect(d.m.heroes[0].combo.step).toBe(1)
    d.tap()
    expect(d.m.heroes[0].combo.step).toBe(2)
    d.tap()
    expect(d.of('cast').map((e) => e.melee?.step)).toEqual([0, 1, 2])
    expect(d.of('melee').some((e) => e.what === 'launch' && e.hero === 1)).toBe(true)
    // the launched tank rises to a double jump's height, untouchable while it's out of control
    const target = d.m.heroes[1]
    let peak = 0
    for (let i = 0; i < 120 && target.launch; i++) (d.step(), (peak = Math.max(peak, target.position.y)))
    expect(peak).toBeCloseTo(ENGINE.move.jump + ENGINE.move.airJump, 0)
    // and is pushed away from the blow
    expect(target.position.z).toBeGreaterThan(1.6 + 1)
  })

  it('a slow swinger mashing the button still chains to the finisher: early taps wait, the chain waits for the swing', () => {
    const d = duel()
    d.setups[0] = { ...d.setups[0], sheet: { ...d.setups[0].sheet, attackSpeed: 0.7 } }
    for (let t = 0; t < 300 && !d.of('melee').some((e) => e.what === 'launch'); t++) d.step(d.cmd(t % 12 < 2 ? BASIC : 0))
    expect(d.of('cast').map((e) => e.melee?.step)).toEqual([0, 1, 2])
    expect(d.of('melee').some((e) => e.what === 'launch' && e.hero === 1)).toBe(true)
  })

  it('the finisher is worth more than a strike, and a missed strike breaks the chain', () => {
    const d = duel()
    d.tap()
    d.tap()
    d.tap()
    const hits = d.of('hit').filter((e) => e.source === 0)
    expect(hits[2].amount).toBeGreaterThan(hits[0].amount * 1.2)
    const far = duel(8)
    far.tap()
    expect(far.m.heroes[0].combo.step).toBe(0)
  })

  it('held, it charges and lands a heavy blow that launches as high as a jump', () => {
    const d = duel()
    d.step(d.cmd(BASIC), d.still(), Math.ceil(ENGINE.melee.heavyHold * 60) + 30)
    expect(d.of('melee').some((e) => e.what === 'charge')).toBe(true)
    expect(d.of('cast')).toEqual([])
    d.step()
    expect(d.of('cast')[0].melee?.heavy).toBeGreaterThan(0)
    const target = d.m.heroes[1]
    let peak = 0
    for (let i = 0; i < 120 && (d.m.heroes[0].action || target.launch); i++) (d.step(), (peak = Math.max(peak, target.position.y)))
    expect(peak).toBeCloseTo(ENGINE.move.jump, 0)
  })

  it('a guard facing the striker catches the strike and staggers it', () => {
    const d = duel()
    d.step(d.cmd(), d.still(MOVES.block))
    expect(d.m.heroes[1].blocking).toBe(true)
    d.tap(MOVES.block)
    expect(d.of('melee').some((e) => e.what === 'blocked' && e.hero === 1)).toBe(true)
    expect(d.of('hit').filter((e) => e.source === 0)).toEqual([])
    expect(d.m.heroes[0].combo.step).toBe(0)
  })

  it('a launched hero takes control back with any key and falls from there, hittable again', () => {
    const d = duel()
    d.tap()
    d.tap()
    d.step(d.cmd(BASIC))
    d.step()
    while (!d.m.heroes[1].launch) d.step()
    d.step(d.cmd(), d.still(), Math.ceil(ENGINE.melee.regainAfter * 60) + 2)
    const target = d.m.heroes[1]
    expect(target.invulnerableUntil).toBeGreaterThan(d.m.tick)
    d.step(d.cmd(), { ...d.still(), moveX: 1 })
    expect(target.launch).toBeUndefined()
    expect(target.invulnerableUntil).toBeLessThanOrEqual(d.m.tick)
    expect(d.of('melee').some((e) => e.what === 'regain')).toBe(true)
    for (let i = 0; i < 120 && target.airborne; i++) d.step()
    expect(target.airborne).toBe(false)
  })
})

describe('movement (canon)', () => {
  it('a dodge roll carries the hero along its facing, untouchable at first, for a pip', () => {
    const d = duel(20)
    const h = d.m.heroes[0]
    d.step(d.cmd(0, MOVES.dodge))
    expect(h.roll).toBeDefined()
    expect(h.invulnerableUntil).toBeGreaterThan(d.m.tick)
    expect(h.stamina).toBeCloseTo(ENGINE.move.stamina.max - 1, 1)
    d.step(d.cmd(), d.still(), Math.ceil(ENGINE.move.roll.time * 60))
    expect(h.position.z).toBeCloseTo(ENGINE.move.roll.distance, 0)
  })

  it('Shift dashes ahead at once and, held on, sprints faster than a run; prone crawls slower than a crouch', () => {
    const dash = duel(40)
    dash.step(dash.cmd(0, MOVES.dash, 1), dash.still())
    expect(dash.m.heroes[0].velocity.z).toBeCloseTo(ENGINE.move.dash.speed, 0)
    expect(dash.m.heroes[0].stamina).toBeLessThan(ENGINE.move.stamina.max)
    const speedAfter = (moves: number, setup?: (d: ReturnType<typeof duel>) => void) => {
      const d = duel(40)
      setup?.(d)
      d.step(d.cmd(0, moves, 1), d.still(), 60)
      return d.m.heroes[0].velocity.z
    }
    const run = speedAfter(0)
    expect(speedAfter(MOVES.dash)).toBeCloseTo(run * ENGINE.move.sprint.speed, 1)
    const crouch = speedAfter(0, (d) => d.step(d.cmd(0, MOVES.crouch)))
    const prone = speedAfter(0, (d) => d.step(d.cmd(0, MOVES.prone)))
    expect(crouch).toBeCloseTo(run * ENGINE.move.crouch.speed, 1)
    expect(prone).toBeLessThan(crouch)
  })

  it('jumps are bigger for small heroes than for big ones', () => {
    const peakOf = (size: 'tiny' | 'colossal') => {
      const m = emptyMatch(1)
      const setup = prepareHero({ ...defaultBuild('fighter'), sizeClass: size })
      m.heroes.push(createHero(setup, 0, 0, { x: 0, y: 0, z: 0 }))
      const go = (moves: number) => tick(m, [setup], [{ moveX: 0, moveZ: 0, moves, aimYaw: 0, aimPitch: 0, buttons: 0 }], COMBAT_RULES)
      go(MOVES.jump)
      let peak = 0
      for (let i = 0; i < 120; i++) (go(0), (peak = Math.max(peak, m.heroes[0].position.y)))
      return peak
    }
    expect(peakOf('tiny')).toBeCloseTo(ENGINE.move.jump * ENGINE.move.jumpScale.tiny, 0)
    expect(peakOf('colossal')).toBeLessThan(peakOf('tiny') * 0.6)
  })
})
