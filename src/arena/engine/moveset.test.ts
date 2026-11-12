import { describe, expect, it } from 'vitest'
import { ai, at, melee, phys } from '../../charter/templates/dsl.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE, ticks } from './calibration.js'
import type { CoverPiece } from './cover.js'
import { COMBAT_RULES } from './deliveries.js'
import type { MatchEvent } from './events.js'
import { KIT } from './kit-tuning.js'
import { endCheck } from './match.js'
import { AIM_STEPS, createHero, emptyMatch, MOVES, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'

const fist = melee({ style: 'unarmed', id: 'fist', name: 'Fist', roles: ['fighter'], tags: ['t'], cooldown: 0, ai: ai('poke', 1), delivery: at.melee(2.5), effects: [phys(30)] })
const BASIC = slotBit('basic')
const M = ENGINE.move

/**
 * Hero 0 at the origin facing +z with a melee basic attack, the full kit on; hero 1 (a tank) in front of it facing
 * back; with `ally`, hero 2 on hero 1's side, off to one side, so hero 1 can go down instead of dying.
 */
function duel({ gap = 1.6, ally = false, cover }: { gap?: number; ally?: boolean; cover?: CoverPiece[] } = {}) {
  const m: MatchState = emptyMatch(3)
  m.fullKit = true
  if (cover) m.cover = { pieces: cover, health: cover.map((p) => p.health ?? -1) }
  const fighter = prepareHero(defaultBuild('fighter'))
  const setups: HeroSetup[] = [{ ...fighter, kit: { ...fighter.kit, basic: fist } }, prepareHero(defaultBuild('tank'))]
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }), createHero(setups[1], 1, 1, { x: 0, y: 0, z: gap }))
  if (ally) {
    setups.push(prepareHero(defaultBuild('support')))
    m.heroes.push(createHero(setups[2], 2, 1, { x: 6, y: 0, z: gap }))
  }
  m.heroes[1].yaw = Math.PI
  const events: MatchEvent[] = []
  const cmd = (buttons = 0, moves = 0, moveZ = 0, moveX = 0): Command => ({ moveX, moveZ, moves, aimYaw: 0, aimPitch: 0, buttons })
  const still = (moves = 0): Command => ({ moveX: 0, moveZ: 0, moves, aimYaw: AIM_STEPS / 2, aimPitch: 0, buttons: 0 })
  let third: Command = still()
  const step = (a: Command = cmd(), b: Command = still(), n = 1) => {
    for (let i = 0; i < n; i++) events.push(...tick(m, setups, ally ? [a, b, third] : [a, b], COMBAT_RULES))
  }
  const setThird = (c: Command) => void (third = c)
  /** Tap the basic attack with `moves` held, then wait until the hero is free to strike again. */
  const tap = (moves = 0, moveZ = 0) => {
    step(cmd(BASIC, moves, moveZ))
    step(cmd(0, moves, moveZ))
    for (let i = 0; i < 120 && (m.heroes[0].action || m.tick < m.heroes[0].nextAttackAt); i++) step(cmd(0, moves, moveZ))
  }
  const of = <T extends MatchEvent['type']>(type: T) => events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  const melees = (what: string, hero?: number) => of('melee').filter((e) => e.what === what && (hero === undefined || e.hero === hero))
  return { m, setups, step, tap, cmd, still, of, melees, events, setThird }
}

describe('the full kit: guard, knockdown and getting up', () => {
  it('X raised just before a blow lands is a perfect guard: no damage, and the striker staggers longer than a block', () => {
    const d = duel()
    const tank = d.m.heroes[1]
    const hp = tank.hp
    d.step(d.cmd(BASIC))
    d.step(d.cmd())
    const a = d.m.heroes[0].action!
    while (a.release - d.m.tick > 3) d.step()
    for (let i = 0; i < 6; i++) d.step(d.cmd(), d.still(MOVES.block))
    expect(d.melees('parry', 1)).toHaveLength(1)
    expect(d.melees('stagger', 0)).toHaveLength(1)
    expect(tank.hp).toBe(hp)
    expect(d.m.heroes[0].stunnedUntil - d.m.tick).toBeGreaterThan(ticks(ENGINE.melee.blockStagger))
  })

  it('a guard held long before the blow only blocks it', () => {
    const d = duel()
    d.step(d.cmd(), d.still(MOVES.block), 30)
    d.step(d.cmd(BASIC), d.still(MOVES.block))
    d.step(d.cmd(), d.still(MOVES.block), 30)
    expect(d.melees('blocked', 1)).toHaveLength(1)
    expect(d.melees('parry')).toHaveLength(0)
  })

  it('a finisher nobody recovers from lands in a knockdown, then the hero gets up, untouchable as it rises', () => {
    const d = duel()
    d.tap()
    d.tap()
    d.tap()
    expect(d.melees('launch', 1)).toHaveLength(1)
    for (let i = 0; i < 200 && !d.melees('get-up', 1).length; i++) d.step()
    expect(d.melees('knockdown', 1)).toHaveLength(1)
    expect(d.melees('get-up', 1)).toHaveLength(1)
    expect(d.m.heroes[1].invulnerableUntil).toBeGreaterThan(d.m.tick)
  })

  it('a dodge while knocked down rolls out at once', () => {
    const d = duel()
    d.tap()
    d.tap()
    d.tap()
    for (let i = 0; i < 200 && !d.melees('knockdown', 1).length; i++) d.step()
    d.step(d.cmd(), d.still(), ticks(KIT.down.techAfter))
    d.step(d.cmd(), d.still(MOVES.dodge))
    expect(d.of('move').some((e) => e.hero === 1 && e.move === 'wake-roll')).toBe(true)
    expect(d.m.heroes[1].down).toBeUndefined()
    expect(d.m.heroes[1].roll).toBeDefined()
  })
})

describe('the full kit: the V moveset', () => {
  it('V at a sprint is a dash attack that carries the striker in and pushes the target away', () => {
    const d = duel({ gap: 8.5 })
    // sprint at it: Shift held while running, past the dash it opens with
    d.step(d.cmd(0, MOVES.dash, 1), d.still(), 24)
    expect(d.m.heroes[0].sprinting).toBe(true)
    d.step(d.cmd(BASIC, MOVES.dash, 1))
    d.step(d.cmd(0, MOVES.dash, 1))
    const cast = d.of('cast').find((e) => e.hero === 0)
    expect(cast?.melee?.kind).toBe('dash')
    d.step(d.cmd(), d.still(), 40)
    expect(d.of('hit').some((e) => e.source === 0 && e.target === 1)).toBe(true)
    expect(d.of('knockback').some((e) => e.hero === 1 && e.phase === 'start')).toBe(true)
  })

  it('back + V launches the target straight up, a jump chases it, air hits hold it up and the third spikes it down', () => {
    const d = duel()
    d.tap(0, -1)
    const tank = d.m.heroes[1]
    expect(d.of('cast')[0].melee?.kind).toBe('launcher')
    expect(tank.launch?.juggle).toBe(true)
    // the chase: a jump right away flies up toward it
    d.step(d.cmd(0, MOVES.jump))
    expect(d.of('move').some((e) => e.hero === 0 && e.move === 'chase')).toBe(true)
    // it rises to meet the target near the top of its flight
    while (tank.launch && d.m.tick < (tank.launch.from + tank.launch.until) / 2 - 8) d.step()
    expect(Math.abs(d.m.heroes[0].position.y - tank.position.y)).toBeLessThan(1.5)
    // three air strikes: two juggle, the third spikes
    for (let k = 0; k < 3; k++) d.tap()
    expect(d.melees('juggle', 1).length).toBeGreaterThanOrEqual(1)
    expect(d.melees('spike', 1)).toHaveLength(1)
    for (let i = 0; i < 200 && !d.melees('knockdown', 1).length; i++) d.step()
    expect(d.melees('knockdown', 1)).toHaveLength(1)
  })

  it('V held in the air plunges into a slam that strikes and pops up everyone round where it lands', () => {
    const d = duel({ gap: 1.8 })
    d.step(d.cmd(0, MOVES.jump))
    d.step(d.cmd(), d.still(), 12)
    for (let i = 0; i < ticks(ENGINE.melee.heavyHold) + 2; i++) d.step(d.cmd(BASIC))
    expect(d.melees('slam', 0)).toHaveLength(1)
    for (let i = 0; i < 60 && !d.melees('slam-land', 0).length; i++) d.step(d.cmd(BASIC))
    d.step()
    expect(d.melees('slam-land', 0)).toHaveLength(1)
    expect(d.of('hit').some((e) => e.source === 0 && e.target === 1)).toBe(true)
    for (let i = 0; i < 120 && !d.melees('knockdown', 1).length; i++) d.step()
    expect(d.melees('knockdown', 1)).toHaveLength(1)
  })

  it('V with X held grabs the enemy in front, ignores its guard, and throws it to a knockdown', () => {
    const d = duel()
    d.step(d.cmd(0, MOVES.block), d.still(MOVES.block), 5)
    d.step(d.cmd(BASIC, MOVES.block), d.still(MOVES.block))
    for (let i = 0; i < 30 && !d.melees('grab', 0).length; i++) d.step(d.cmd(BASIC, MOVES.block), d.still(MOVES.block))
    expect(d.melees('grab', 0)).toHaveLength(1)
    expect(d.m.heroes[1].grabbedBy).toBe(0)
    const before = d.m.heroes[1].hp
    for (let i = 0; i < 60 && !d.melees('throw', 0).length; i++) d.step(d.cmd(), d.still(MOVES.block))
    expect(d.melees('throw', 0)).toHaveLength(1)
    expect(d.m.heroes[1].hp).toBeLessThan(before)
    for (let i = 0; i < 120 && !d.melees('knockdown', 1).length; i++) d.step()
    expect(d.melees('knockdown', 1)).toHaveLength(1)
    // thrown well clear, along the thrower's facing (+z)
    expect(d.m.heroes[1].position.z).toBeGreaterThan(4)
  })

  it('without the full kit, back + V is a plain strike and V in the air does no slam', () => {
    const d = duel()
    d.m.fullKit = false
    d.tap(0, -1)
    expect(d.of('cast')[0].melee?.kind).toBeUndefined()
    d.step(d.cmd(0, MOVES.jump))
    for (let i = 0; i < ticks(ENGINE.melee.heavyHold) + 5; i++) d.step(d.cmd(BASIC))
    expect(d.melees('slam')).toHaveLength(0)
  })
})

describe('the full kit: downed and revived', () => {
  it('at no health with an ally standing, a hero goes down; enemies stop targeting it; an ally holding interact revives it', () => {
    const d = duel({ ally: true })
    const tank = d.m.heroes[1]
    tank.hp = 1
    tank.yaw = Math.PI
    d.tap()
    expect(d.of('downed').some((e) => e.hero === 1 && e.phase === 'down')).toBe(true)
    expect(tank.alive).toBe(true)
    expect(tank.downed).toBeDefined()
    // another strike passes it by: a downed hero isn't a target
    const hits = d.of('hit').length
    d.tap()
    expect(d.of('hit').length).toBe(hits)
    // the ally walks over and holds the key
    d.m.heroes[2].position = { x: tank.position.x + 1, y: 0, z: tank.position.z }
    d.setThird({ moveX: 0, moveZ: 0, moves: MOVES.interact, aimYaw: 0, aimPitch: 0, buttons: 0 })
    d.step(d.cmd(), d.still(), ticks(KIT.downed.time) + 2)
    expect(d.of('downed').some((e) => e.hero === 1 && e.phase === 'revived' && e.by === 2)).toBe(true)
    expect(tank.downed).toBeUndefined()
    expect(tank.hp).toBeCloseTo(tank.maxHp * KIT.downed.health, 0)
  })

  it('a downed hero nobody helps bleeds out, and a squad all down has lost', () => {
    const d = duel({ ally: true })
    d.m.heroes[1].hp = 1
    d.tap()
    expect(d.m.heroes[1].downed).toBeDefined()
    d.step(d.cmd(), d.still(), ticks(KIT.downed.bleed) + 2)
    expect(d.m.heroes[1].alive).toBe(false)
    expect(d.of('downed').some((e) => e.hero === 1 && e.phase === 'out')).toBe(true)

    const e = duel({ ally: true })
    e.m.heroes[2].hp = 1
    e.m.heroes[2].position = { x: 0, y: 0, z: 1.6 }
    e.m.heroes[1].position = { x: 3, y: 0, z: 30 }
    e.m.heroes[1].downed = { from: 0, until: 9999, revive: 0, by: -1 }
    e.tap()
    const ended: MatchEvent[] = []
    endCheck({ match: e.m, setups: e.setups, timerTicks: 99999 } as never)!(e.m, e.setups, ended)
    expect(e.m.winner).toBe(0)
  })
})

describe('the full kit: walls and pads', () => {
  const wall: CoverPiece = { shape: { kind: 'block', x: 1.2, z: 10, hx: 0.4, hz: 10 }, base: 0, top: 6, look: 'wall', run: true }

  it('an airborne hero moving along a marked wall into it runs along it, and a jump kicks it off with the air jump back', () => {
    const d = duel({ gap: 40, cover: [wall] })
    const h = d.m.heroes[0]
    d.m.human = 0
    // jump while running up the wall's length, steering into it (-x is to its right at yaw 0, so +x is toward the wall)
    d.step(d.cmd(0, 0, 1), d.still(), 20)
    d.step(d.cmd(0, MOVES.jump, 1, 0.6))
    for (let i = 0; i < 30 && !h.wallRun; i++) d.step(d.cmd(0, 0, 1, 0.6))
    expect(h.wallRun).toBeDefined()
    expect(d.of('move').some((e) => e.hero === 0 && e.move === 'wall-run')).toBe(true)
    const z0 = h.position.z
    d.step(d.cmd(0, 0, 1, 0.6), d.still(), 10)
    expect(h.position.z - z0).toBeGreaterThan(1)
    expect(h.airborne).toBe(true)
    d.step(d.cmd(0, MOVES.jump, 1, 0.6))
    expect(d.of('move').some((e) => e.hero === 0 && e.move === 'wall-jump')).toBe(true)
    expect(h.velocity.x).toBeLessThan(0)
    expect(h.airJumps).toBe(0)
  })

  it('a hero without the full kit, or at a wall that is not marked, does not run', () => {
    const d = duel({ gap: 40, cover: [{ ...wall, run: false }] })
    d.m.human = 0
    d.step(d.cmd(0, 0, 1), d.still(), 20)
    d.step(d.cmd(0, MOVES.jump, 1, 0.6))
    d.step(d.cmd(0, 0, 1, 0.6), d.still(), 30)
    expect(d.of('move').some((e) => e.move === 'wall-run')).toBe(false)
  })

  it('stepping onto a jump pad throws the hero to its height', () => {
    const d = duel({ gap: 40 })
    d.m.pads = [{ at: { x: 0, y: 0, z: 3 }, r: 1, height: 8 }]
    const h = d.m.heroes[0]
    let peak = 0
    for (let i = 0; i < 120; i++) (d.step(d.cmd(0, 0, i < 40 ? 1 : 0)), (peak = Math.max(peak, h.position.y)))
    expect(d.of('move').some((e) => e.hero === 0 && e.move === 'pad')).toBe(true)
    expect(peak).toBeGreaterThan(7)
    expect(peak).toBeLessThan(8.5)
    expect(M.gravity).toBeGreaterThan(0)
  })
})
