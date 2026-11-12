import { describe, expect, it } from 'vitest'
import { ai, at, melee, passive, phys, spell, ultimate } from '../../charter/templates/dsl.js'
import type { BuildSlot, Delivery, Effect, Template } from '../../charter/types.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ticks } from './calibration.js'
import { COMBAT_RULES } from './deliveries.js'
import { enemiesOf } from './effects.js'
import type { MatchEvent } from './events.js'
import { AIM_STEPS, MOVES, createHero, emptyMatch, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'

const BASIC = slotBit('basic')
const Q = slotBit('active2')
const R = slotBit('ultimate')

const fist = melee({ style: 'unarmed', id: 'fist', name: 'Fist', roles: ['fighter'], tags: ['t'], ai: ai('poke', 1), delivery: at.melee(2.5), effects: [phys(40)] })
const aura = (id: string, effects: Effect[], trigger?: Template['trigger']): Template => passive({ id, name: id, roles: ['fighter'], tags: ['t'], ai: ai('always', 1), delivery: at.self(), effects, ...(trigger ? { trigger } : {}) })
const ult = (id: string, delivery: Delivery, effects: Effect[]): Template => ultimate({ id, name: id, roles: ['fighter'], tags: ['t'], ai: ai('engage', 1), cooldown: 30, delivery, effects })

type Kit = Partial<Record<BuildSlot, Template>>

/**
 * Hero 0 (a fighter, fist basic) at the origin facing +z; hero 1 (a tank, fist basic) `gap` ahead facing it; hero 2 (a
 * support on hero 1's side) at `third`. Each takes its `kits` slots. The full kit is on and every passive starts on.
 */
function lab({ kits = [], gap = 1.6, third = { x: 1.5, y: 0, z: 1.6 } }: { kits?: Kit[]; gap?: number; third?: { x: number; y: number; z: number } } = {}) {
  const m: MatchState = emptyMatch(5)
  m.fullKit = true
  const base = [prepareHero(defaultBuild('fighter')), prepareHero(defaultBuild('tank')), prepareHero(defaultBuild('support'))]
  const setups: HeroSetup[] = base.map((s, i) => ({ ...s, kit: { ...s.kit, ...(i < 2 ? { basic: fist } : {}), ...(kits[i] ?? {}) } }))
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }), createHero(setups[1], 1, 1, { x: 0, y: 0, z: gap }), createHero(setups[2], 2, 1, third))
  m.heroes[1].yaw = Math.PI
  for (const h of m.heroes) h.passiveOn = true
  const events: MatchEvent[] = []
  const cmd = (buttons = 0, { yaw = 0, moves = 0 } = {}): Command => ({ moveX: 0, moveZ: 0, moves, aimYaw: Math.round((yaw / (2 * Math.PI)) * AIM_STEPS), aimPitch: 0, buttons })
  const back = (buttons = 0, moves = 0) => cmd(buttons, { yaw: Math.PI, moves })
  let them: Command = back()
  let other: Command = back()
  const step = (a: Command = cmd(), n = 1) => {
    for (let i = 0; i < n; i++) {
      events.push(...tick(m, setups, [a, them, other], COMBAT_RULES))
      them = { ...them, buttons: 0 }
      other = { ...other, buttons: 0 }
    }
  }
  const swing = () => {
    step(cmd(BASIC))
    step(cmd(), 50)
  }
  const of = <T extends MatchEvent['type']>(type: T) => events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  const hits = (source: number, target?: number) => of('hit').filter((e) => e.source === source && (target === undefined || e.target === target))
  return { m, setups, step, swing, cmd, back, of, hits, events, setThem: (c: Command) => void (them = c), setOther: (c: Command) => void (other = c) }
}

describe('F elements and the when-hit trigger (full kit)', () => {
  it('a flame sheath sets what it hits burning, frost slows it, and lightning leaps to the next enemy', () => {
    const flame = lab({ kits: [{ passive: aura('flame', [{ kind: 'element', element: 'flame' }]) }] })
    flame.swing()
    expect(flame.of('element').filter((e) => e.element === 'flame')).toHaveLength(1)
    expect(flame.m.heroes[1].dots.length + (flame.m.heroes[1].hp < flame.m.heroes[1].maxHp ? 1 : 0)).toBeGreaterThan(0)
    const frost = lab({ kits: [{ passive: aura('frost', [{ kind: 'element', element: 'frost' }]) }] })
    frost.step(frost.cmd(BASIC))
    frost.step(frost.cmd(), 20)
    expect(frost.m.heroes[1].slows.length).toBeGreaterThan(0)
    const bolt = lab({ kits: [{ passive: aura('bolt', [{ kind: 'element', element: 'lightning' }]) }] })
    const hp = bolt.m.heroes[2].hp
    bolt.swing()
    expect(bolt.of('element').find((e) => e.element === 'lightning')?.to).toBe(2)
    expect(bolt.m.heroes[2].hp).toBeLessThan(hp)
  })

  it('a when-hit passive answers the blow that struck its hero, and two of them never trade forever', () => {
    const thorns = aura('thorns', [phys(30, 0)], 'whenHit')
    const d = lab({ kits: [{ passive: thorns }, { passive: thorns }] })
    d.swing()
    expect(d.hits(1, 0).filter((e) => e.slot === 'passive')).toHaveLength(1)
    expect(d.hits(0, 1).filter((e) => e.slot === 'passive')).toHaveLength(0)
  })
})

describe('systems: power meter and charges (full kit)', () => {
  const zap = (extra: Partial<Template>) => ({ ...spell({ id: `zap-${JSON.stringify(extra)}`, name: 'Zap', family: 'burst', roles: ['fighter'], tags: ['t'], ai: ai('poke', 1), cooldown: 3, delivery: at.proj(20), effects: [phys(10)] }), ...extra })

  it('a skill that costs power waits for the meter, spends it, and hits fill it', () => {
    const d = lab({ kits: [{ active2: zap({ cost: 0.5 }) }] })
    d.step(d.cmd(Q))
    d.step(d.cmd(), 5)
    expect(d.of('cast').filter((e) => e.slot === 'active2')).toHaveLength(0)
    d.swing()
    // a blow fills the striker's meter, and more slowly the struck's
    expect(d.m.heroes[0].power).toBeGreaterThan(0)
    expect(d.m.heroes[1].power).toBeGreaterThan(0)
    d.m.heroes[0].power = 0.6
    const before = d.m.heroes[0].power
    d.step(d.cmd(Q))
    d.step(d.cmd(), 5)
    expect(d.of('cast').filter((e) => e.slot === 'active2')).toHaveLength(1)
    expect(d.m.heroes[0].power).toBeCloseTo(before - 0.5, 1)
  })

  it('a skill with charges casts that many times running, and they come back one a cooldown', () => {
    const d = lab({ kits: [{ active2: zap({ charges: 2 }) }] })
    const casts = () => d.of('cast').filter((e) => e.slot === 'active2').length
    for (let i = 0; i < 3; i++) (d.step(d.cmd(Q)), d.step(d.cmd(), 30))
    expect(casts()).toBe(2)
    d.step(d.cmd(), ticks(3))
    d.step(d.cmd(Q))
    d.step(d.cmd(), 5)
    expect(casts()).toBe(3)
  })
})

describe('R shapes (full kit)', () => {
  it('R pressed again in a staged form steps it up, bigger each stage, as far as it goes', () => {
    const d = lab({ kits: [{ ultimate: ult('ascend', at.self(), [{ kind: 'form', duration: 20, stages: 3 }]) }] })
    d.step(d.cmd(R))
    d.step(d.cmd(), 40)
    expect(d.m.heroes[0].formStage).toBe(1)
    const sizes = [d.m.heroes[0].size]
    for (let i = 0; i < 3; i++) (d.step(d.cmd(R)), d.step(d.cmd(), 5), sizes.push(d.m.heroes[0].size))
    expect(d.m.heroes[0].formStage).toBe(3)
    expect(sizes).toEqual(['medium', 'large', 'huge', 'huge'])
    expect(d.of('form').filter((e) => e.phase === 'stage')).toHaveLength(2)
  })

  it("a Strike locks on and lands its blows one by one, the caster untouchable, the last blow throwing the target", () => {
    const d = lab({ kits: [{ ultimate: ult('strike', at.melee(3), [{ kind: 'lockon', hits: 4, duration: 1.2 }, phys(200, 0)]) }], gap: 2, third: { x: 30, y: 0, z: 0 } })
    d.step(d.cmd(R))
    let untouchable = true
    for (let i = 0; i < 120; i++) {
      d.step()
      if (d.m.heroes[0].lockon && d.m.heroes[0].invulnerableUntil <= d.m.tick) untouchable = false
    }
    const blows = d.of('lockon').filter((e) => e.phase === 'blow')
    expect(blows).toHaveLength(4)
    expect(d.hits(0, 1).filter((e) => e.slot === 'ultimate')).toHaveLength(4)
    expect(untouchable).toBe(true)
    expect(d.of('lockon').filter((e) => e.phase === 'end')).toHaveLength(1)
    expect(d.m.heroes[1].position.z).toBeGreaterThan(4)
  })

  it('fusion takes the nearest ally in, bigger and stronger, and lets it out when it ends', () => {
    const d = lab({ kits: [{}, { ultimate: ult('fuse', at.self(), [{ kind: 'fuse', duration: 3 }]) }], gap: 8, third: { x: 1.5, y: 0, z: 8 } })
    d.setThem(d.back(R))
    d.step(d.cmd(), 40)
    const [, caster, ally] = d.m.heroes
    expect(ally.fused?.into).toBe(1)
    expect(enemiesOf(d.m, d.m.heroes[0]).includes(ally)).toBe(false)
    expect(caster.size).toBe('huge')
    expect(caster.shield).toBeGreaterThan(0)
    d.step(d.cmd(), ticks(3))
    expect(ally.fused).toBeUndefined()
    expect(caster.fusing).toBeUndefined()
    expect(d.of('fuse').map((e) => e.phase)).toEqual(['start', 'end'])
  })
})

describe('team-ups (full kit)', () => {
  it('the interact key beside an ally gets it thrown along its aim, coming down hard on the enemy there', () => {
    const d = lab({ gap: 12, third: { x: 1, y: 0, z: 12 } })
    d.setThem(d.back(0, MOVES.interact))
    d.step(d.cmd(), 60)
    expect(d.of('teamup').map((e) => e.phase)).toEqual(['throw', 'land'])
    expect(d.hits(1, 0).length).toBeGreaterThan(0)
    expect(d.m.heroes[1].position.z).toBeLessThan(3)
  })
})
