import { describe, expect, it } from 'vitest'
import { ai, at, phys, ranged } from '../../charter/templates/dsl.js'
import type { Delivery, RangedSpec, Template } from '../../charter/types.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ticks } from './calibration.js'
import type { CoverPiece } from './cover.js'
import { COMBAT_RULES } from './deliveries.js'
import type { MatchEvent } from './events.js'
import { interrupt } from './effects.js'
import { AIM_STEPS, createHero, emptyMatch, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'

const LMB = slotBit('active1')

const gun = (spec: Partial<RangedSpec>, delivery: Delivery = at.proj(30, undefined, 40), extra: Partial<Template> = {}): Template => ({
  ...ranged({ id: `gun-${JSON.stringify(spec)}-${delivery.flight ?? ''}`, name: 'Gun', roles: ['marksman'], tags: ['t'], ai: ai('poke', 1), delivery, effects: [phys(20)], ranged: { style: 'pistol', mode: 'auto', rate: 4, magazine: 40, reload: 1, ...spec } }),
  ...extra,
})

/**
 * Hero 0 (a played marksman) at the origin facing +z with weapon `a`; hero 1 at `foe` with weapon `b`, facing it. The
 * full kit is on.
 */
function range(a: Template, { foe = { x: 0, y: 0, z: 12 }, b, cover }: { foe?: { x: number; y: number; z: number }; b?: Template; cover?: CoverPiece[] } = {}) {
  const m: MatchState = emptyMatch(5)
  m.fullKit = true
  m.human = 0
  if (cover) m.cover = { pieces: cover, health: cover.map((p) => p.health ?? -1) }
  const base = prepareHero(defaultBuild('marksman'))
  const tank = prepareHero(defaultBuild('tank'))
  const setups: HeroSetup[] = [{ ...base, kit: { ...base.kit, active1: a }, magazine: 40 }, { ...tank, kit: b ? { ...tank.kit, active1: b } : tank.kit, magazine: 40 }]
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }), createHero(setups[1], 1, 1, foe))
  m.heroes[1].yaw = Math.PI
  const events: MatchEvent[] = []
  const aim = (yaw = 0, pitch = 0, buttons = 0): Command => ({ moveX: 0, moveZ: 0, moves: 0, aimYaw: Math.round((yaw / (2 * Math.PI)) * AIM_STEPS), aimPitch: Math.round((pitch / (2 * Math.PI)) * AIM_STEPS), buttons })
  let other: Command = aim(Math.PI)
  const step = (c: Command, n = 1) => {
    for (let i = 0; i < n; i++) events.push(...tick(m, setups, [c, other], COMBAT_RULES))
  }
  const of = <T extends MatchEvent['type']>(type: T) => events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  const hits = (source = 0) => of('hit').filter((e) => e.source === source)
  return { m, setups, step, aim, of, hits, events, setOther: (c: Command) => void (other = c) }
}

describe('LMB firing modes (full kit)', () => {
  it("a played hero's single-shot weapon fires once a press; a full-auto one fires while held", () => {
    const semi = range(gun({ mode: 'single' }))
    semi.step(semi.aim(0, 0, LMB), 60)
    expect(semi.of('projectile').filter((e) => e.hero === 0)).toHaveLength(1)
    const auto = range(gun({ mode: 'auto' }))
    auto.step(auto.aim(0, 0, LMB), 60)
    expect(auto.of('projectile').filter((e) => e.hero === 0).length).toBeGreaterThan(2)
  })

  it('hold to charge: a tap fires at the minimum, a full hold at the maximum, and a stun loses the charge', () => {
    const charged = gun({ mode: 'single', style: 'bow' }, at.proj(40, undefined, 60), { charge: { seconds: 1, min: 0.4, max: 2.5 } })
    const tap = range(charged)
    tap.step(tap.aim(0, 0, LMB))
    tap.step(tap.aim(), 40)
    const full = range(charged)
    full.step(full.aim(0, 0, LMB), ticks(1.2))
    full.step(full.aim(), 40)
    const [weak] = tap.hits()
    const [strong] = full.hits()
    expect(tap.of('charge').find((e) => e.phase === 'release')?.power).toBeCloseTo(0.4, 1)
    expect(full.of('charge').find((e) => e.phase === 'release')?.power).toBeCloseTo(2.5, 5)
    expect(strong.amount / weak.amount).toBeGreaterThan(4)
    const cut = range(charged)
    cut.step(cut.aim(0, 0, LMB), 20)
    interrupt({ match: cut.m, setups: cut.setups, events: [] }, cut.m.heroes[0])
    cut.step(cut.aim(), 40)
    expect(cut.hits()).toHaveLength(0)
  })

  it('paired guns fire from each hand in turn', () => {
    const d = range(gun({ style: 'paired' }))
    d.step(d.aim(0, 0, LMB), 40)
    const xs = d.of('projectile').filter((e) => e.hero === 0).map((e) => Math.sign(e.from.x))
    expect(new Set(xs.slice(0, 4)).size).toBe(2)
    expect(xs[0]).not.toBe(xs[1])
  })
})

describe('LMB flights (full kit)', () => {
  it('a lobbed shot arcs over a wall and bursts where it is aimed', () => {
    const wall: CoverPiece = { shape: { kind: 'block', x: 0, z: 6, hx: 3, hz: 0.3 }, base: 0, top: 2.5, look: 'wall' }
    const lob = gun({ mode: 'single', style: 'heavy' }, { ...at.proj(30, 2, 18), flight: 'lobbed' })
    const d = range(lob, { cover: [wall] })
    // aimed up over the wall: thrown along the aim, it falls on the hero behind it
    d.step(d.aim(0, 0.5, LMB))
    let peak = 0
    for (let i = 0; i < 120; i++) (d.step(d.aim(0, 0.5)), (peak = Math.max(peak, ...d.m.projectiles.map((p) => p.position.y))))
    expect(peak).toBeGreaterThan(2.6)
    expect(d.hits()).toHaveLength(1)
  })

  it('a bouncing shot bounces off a wall and flies on', () => {
    const wall: CoverPiece = { shape: { kind: 'block', x: 0, z: 6, hx: 3, hz: 0.3 }, base: 0, top: 4, look: 'wall' }
    const d = range(gun({ mode: 'single' }, { ...at.proj(30, undefined, 30), flight: 'bouncing', bounces: 2 }), { cover: [wall], foe: { x: 8, y: 0, z: -8 } })
    d.step(d.aim(0, 0, LMB))
    d.step(d.aim(), 30)
    expect(d.of('flight').filter((e) => e.what === 'bounce')).toHaveLength(1)
    // back the way it came, past where it was fired
    expect(d.m.projectiles.length ? d.m.projectiles[0].position.z : -1).toBeLessThan(0)
  })

  it('a returning shot passes through its target, turns at the end of its reach, strikes again coming home, and is caught', () => {
    const d = range(gun({ mode: 'single', style: 'thrown' }, { ...at.proj(16, undefined, 24), flight: 'returning' }), { foe: { x: 0, y: 0, z: 8 } })
    d.step(d.aim(0, 0, LMB))
    d.step(d.aim(), 120)
    expect(d.of('flight').filter((e) => e.what === 'return')).toHaveLength(1)
    expect(d.hits()).toHaveLength(2)
    expect(d.m.projectiles).toHaveLength(0)
  })

  it('a homing shot curves onto a target off to the side of the aim', () => {
    const homing = gun({ mode: 'single', style: 'magic' }, { ...at.proj(30, undefined, 18), flight: 'homing' })
    const d = range(homing, { foe: { x: 3, y: 0, z: 12 } })
    d.step(d.aim(0, 0, LMB))
    d.step(d.aim(), 90)
    expect(d.hits()).toHaveLength(1)
    const straight = range(gun({ mode: 'single', style: 'magic' }, at.proj(30, undefined, 18)), { foe: { x: 3, y: 0, z: 12 } })
    straight.step(straight.aim(0, 0, LMB))
    straight.step(straight.aim(), 90)
    expect(straight.hits()).toHaveLength(0)
  })

  it('a guided shot follows the aim while it flies', () => {
    const d = range(gun({ mode: 'single', style: 'magic' }, { ...at.proj(40, undefined, 14), flight: 'guided' }), { foe: { x: 8, y: 0, z: 12 } })
    d.step(d.aim(0, 0, LMB))
    // the player turns the aim onto the target once the shot is out
    d.step(d.aim(Math.atan2(8, 12)), 120)
    expect(d.hits()).toHaveLength(1)
  })
})

describe('held beams and beam clashes (full kit)', () => {
  const beam = (damage: number) => ({ ...gun({ mode: 'channel', style: 'magic', hands: 2, rate: 6, magazine: 400 }, at.beam(20, 0.8)), id: `beam-${damage}`, effects: [phys(damage, 0)] })

  it('a held beam stays on while held and goes off when let go', () => {
    const d = range(beam(10))
    d.step(d.aim(0, 0, LMB), 20)
    expect(d.m.heroes[0].beam).toBeDefined()
    expect(d.of('beam').filter((e) => e.phase === 'on')).toHaveLength(1)
    d.step(d.aim(), 30)
    expect(d.m.heroes[0].beam).toBeUndefined()
  })

  it('two beams that meet clash: neither lands while they push, and the stronger drives the clash home and bursts', () => {
    const d = range(beam(30), { b: beam(10) })
    d.setOther(d.aim(Math.PI, 0, LMB))
    d.step(d.aim(0, 0, LMB), 10)
    expect(d.of('clash').filter((e) => e.phase === 'start')).toHaveLength(1)
    const hitsBefore = d.of('hit').length
    d.step(d.aim(0, 0, LMB), 30)
    expect(d.of('hit').length).toBe(hitsBefore)
    expect(d.m.clashes![0].t).toBeGreaterThan(0.5)
    for (let i = 0; i < 900 && !d.of('clash').some((e) => e.phase === 'end'); i++) d.step(d.aim(0, 0, LMB))
    const end = d.of('clash').find((e) => e.phase === 'end')
    expect(end?.loser).toBe(1)
    expect(d.of('hit').some((e) => e.source === 0 && e.target === 1)).toBe(true)
  })

  it('mashing the trigger lets the weaker beam hold a clash longer', () => {
    const run = (mashing: boolean) => {
      const d = range(beam(30), { b: beam(20) })
      d.step(d.aim(0, 0, LMB), 10)
      let t = 0
      for (; t < 900 && !d.of('clash').some((e) => e.phase === 'end'); t++) {
        d.setOther(d.aim(Math.PI, 0, mashing && t % 6 < 3 ? 0 : LMB))
        d.step(d.aim(0, 0, LMB))
      }
      return t
    }
    expect(run(true)).toBeGreaterThan(run(false))
  })
})
