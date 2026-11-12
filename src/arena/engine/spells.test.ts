import { describe, expect, it } from 'vitest'
import { ai, at, melee, phys, ranged, spell } from '../../charter/templates/dsl.js'
import type { Delivery, Effect, Template } from '../../charter/types.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ticks } from './calibration.js'
import { coverHit } from './cover.js'
import { COMBAT_RULES } from './deliveries.js'
import type { MatchEvent } from './events.js'
import { goDown } from './moveset.js'
import { addReserves, liveSetups } from './spells.js'
import { AIM_STEPS, createHero, emptyMatch, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'

const BASIC = slotBit('basic')
const LMB = slotBit('active1')
const Q = slotBit('active2')

const fist = melee({ style: 'unarmed', id: 'fist', name: 'Fist', roles: ['fighter'], tags: ['t'], cooldown: 0, ai: ai('poke', 1), delivery: at.melee(2.5), effects: [phys(40)] })
const gun = ranged({ id: 'gun', name: 'Gun', roles: ['marksman'], tags: ['t'], ai: ai('poke', 1), delivery: at.proj(40, undefined, 60), effects: [phys(20)], ranged: { style: 'pistol', mode: 'single', rate: 3, magazine: 40, reload: 1 } })
const q = (id: string, delivery: Delivery, effects: Effect[], extra: Partial<Template> = {}): Template => ({
  ...spell({ id, name: id, family: 'trick', roles: ['controller'], tags: ['t'], ai: ai('poke', 1), cooldown: 1, delivery, effects }),
  ...extra,
})

/**
 * Hero 0 (a fighter, fist and gun) at the origin facing +z with `mine` on Q; hero 1 (a tank) `gap` metres ahead facing
 * it with `theirs` on Q; hero 2 (a support on hero 1's side, off to one side) with `third` on Q. The full kit is on,
 * and the summoners get their reserve bodies.
 */
function lab({ mine, theirs, third, gap = 1.6 }: { mine?: Template; theirs?: Template; third?: Template; gap?: number } = {}) {
  const m: MatchState = emptyMatch(9)
  m.fullKit = true
  const fighter = prepareHero(defaultBuild('fighter'))
  const tank = prepareHero(defaultBuild('tank'))
  const support = prepareHero(defaultBuild('support'))
  const setups: HeroSetup[] = [
    { ...fighter, kit: { ...fighter.kit, basic: fist, active1: gun, ...(mine ? { active2: mine } : {}) }, magazine: 40 },
    { ...tank, kit: { ...tank.kit, basic: fist, active1: gun, ...(theirs ? { active2: theirs } : {}) }, magazine: 40 },
    { ...support, kit: { ...support.kit, ...(third ? { active2: third } : {}) } },
  ]
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }), createHero(setups[1], 1, 1, { x: 0, y: 0, z: gap }), createHero(setups[2], 2, 1, { x: 6, y: 0, z: gap }))
  m.heroes[1].yaw = Math.PI
  addReserves(m, setups)
  const events: MatchEvent[] = []
  const cmd = (buttons = 0, moveZ = 0, moveX = 0, yaw = 0): Command => ({ moveX, moveZ, moves: 0, aimYaw: Math.round((yaw / (2 * Math.PI)) * AIM_STEPS), aimPitch: 0, buttons })
  const back = (buttons = 0): Command => ({ moveX: 0, moveZ: 0, moves: 0, aimYaw: AIM_STEPS / 2, aimPitch: 0, buttons })
  let them: Command = back()
  let other: Command = back()
  const step = (a: Command = cmd(), n = 1) => {
    for (let i = 0; i < n; i++) {
      events.push(...tick(m, setups, [a, them, other], COMBAT_RULES))
      // a press lasts one tick
      them = { ...them, buttons: 0 }
      other = { ...other, buttons: 0 }
    }
  }
  /** Cast hero 0's Q and wait for it to land. */
  const cast = (n = 40) => {
    step(cmd(Q))
    step(cmd(), n)
  }
  const of = <T extends MatchEvent['type']>(type: T) => events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  const hits = (source: number, target?: number) => of('hit').filter((e) => e.source === source && (target === undefined || e.target === target))
  return { m, setups, step, cast, cmd, back, of, hits, events, setThem: (c: Command) => void (them = c), setOther: (c: Command) => void (other = c) }
}

/** Hero 1 casts its Q, then hero 0 swings at it until the swing lands or is answered. */
function counterLab(answer: 'strike' | 'substitute' | 'reflect' | 'absorb') {
  const d = lab({ theirs: q(`counter-${answer}`, at.self(), [{ kind: 'counter', duration: 2, answer }, phys(80)], { family: 'counter' }) })
  d.setThem(d.back(Q))
  d.step(d.cmd(), 30)
  expect(d.m.heroes[1].counter).toBeDefined()
  d.step(d.cmd(BASIC))
  d.step(d.cmd(), 60)
  return d
}

describe('Q counters (full kit)', () => {
  it('a strike counter takes the blow and strikes back with the skill', () => {
    const d = counterLab('strike')
    expect(d.of('counter')).toHaveLength(1)
    expect(d.hits(0, 1)).toHaveLength(0)
    expect(d.hits(1, 0).length).toBeGreaterThan(0)
    expect(d.m.heroes[1].counter).toBeUndefined()
  })

  it('a substitute counter slips behind the striker untouched', () => {
    const d = counterLab('substitute')
    expect(d.hits(0, 1)).toHaveLength(0)
    expect(d.m.heroes[1].position.z).toBeLessThan(0)
  })

  it('a reflect counter turns the blow back on the striker; an absorb counter drinks it', () => {
    const r = counterLab('reflect')
    expect(r.hits(1, 0).length).toBeGreaterThan(0)
    expect(r.m.heroes[0].hp).toBeLessThan(r.m.heroes[0].maxHp)
    const a = lab({ theirs: q('counter-absorb', at.self(), [{ kind: 'counter', duration: 2, answer: 'absorb' }], { family: 'counter' }) })
    a.m.heroes[1].hp = a.m.heroes[1].maxHp / 2
    a.setThem(a.back(Q))
    a.step(a.cmd(), 30)
    const before = a.m.heroes[1].hp
    a.step(a.cmd(BASIC))
    a.step(a.cmd(), 60)
    expect(a.m.heroes[1].hp).toBeGreaterThan(before)
  })

  it('a counter that runs out unused lets the next blow land', () => {
    const d = lab({ theirs: q('counter-short', at.self(), [{ kind: 'counter', duration: 0.3, answer: 'strike' }], { family: 'counter' }) })
    d.setThem(d.back(Q))
    d.step(d.cmd(), 60)
    d.step(d.cmd(BASIC))
    d.step(d.cmd(), 60)
    expect(d.of('counter')).toHaveLength(0)
    expect(d.hits(0, 1).length).toBeGreaterThan(0)
  })
})

describe('Q summons (full kit)', () => {
  it('minions come in beside their owner, go for the enemy and strike it, and go when their time is up', () => {
    const d = lab({ mine: q('minions', at.self(), [{ kind: 'summon', what: 'minion', count: 2, duration: 4 }], { family: 'summon' }), gap: 7 })
    expect(d.m.heroes).toHaveLength(5)
    expect(d.m.heroes.slice(3).every((h) => !h.alive)).toBe(true)
    d.cast(20)
    const minions = d.m.heroes.slice(3)
    expect(minions.every((h) => h.alive && h.summon?.active && h.size === 'tiny' && h.team === 0)).toBe(true)
    expect(d.of('summon').filter((e) => e.phase === 'in')).toHaveLength(2)
    d.step(d.cmd(), ticks(3.5))
    expect(d.hits(3, 1).length + d.hits(4, 1).length).toBeGreaterThan(0)
    d.step(d.cmd(), ticks(1))
    expect(minions.every((h) => !h.alive && !h.summon?.active)).toBe(true)
    expect(d.of('summon').filter((e) => e.phase === 'out')).toHaveLength(2)
  })

  it('a decoy runs on the way its owner faced and never strikes', () => {
    const d = lab({ mine: q('decoy', at.self(), [{ kind: 'summon', what: 'decoy', count: 1, duration: 3 }], { family: 'summon' }), gap: 4 })
    d.cast(20)
    const decoy = d.m.heroes[3]
    const z = decoy.position.z
    d.step(d.cmd(), 60)
    expect(decoy.position.z).toBeGreaterThan(z + 2)
    expect(d.hits(3)).toHaveLength(0)
  })

  it('a titan is colossal and stronger than its owner', () => {
    const d = lab({ mine: q('titan', at.self(), [{ kind: 'summon', what: 'titan', count: 1, duration: 6 }], { family: 'summon' }), gap: 9 })
    d.cast(20)
    const titan = d.m.heroes[3]
    expect(titan.size).toBe('colossal')
    expect(titan.maxHp).toBeGreaterThan(d.m.heroes[0].maxHp * 2)
  })
})

describe('Q constructs (full kit)', () => {
  it("a one-way barrier stops the enemy's shots and lets its own side's through", () => {
    const d = lab({ mine: q('barrier', at.zone(3, 0.5), [{ kind: 'barrier', length: 5, height: 3, duration: 6, health: 5000 }], { family: 'construct' }), gap: 10 })
    d.cast(30)
    expect(d.of('wall').filter((e) => e.look === 'barrier')).toHaveLength(1)
    const c = d.m.cover!
    const a = { x: 0, y: 1.2, z: 0.5 }
    const b = { x: 0, y: 1.2, z: 9.5 }
    expect(coverHit(c.pieces, c.health, a, b, 0, 0)).toBeUndefined()
    expect(coverHit(c.pieces, c.health, b, a, 0, 1)).toBeDefined()
    // and in play: hero 0 shoots hero 1 through it, hero 1's shots stop on it
    d.setThem(d.back(LMB))
    d.step(d.cmd(LMB), 60)
    expect(d.hits(0, 1).length).toBeGreaterThan(0)
    expect(d.hits(1, 0)).toHaveLength(0)
  })

  it('a ramp raised ahead is walked up', () => {
    const d = lab({ mine: q('ramp', at.self(), [{ kind: 'terrain', shape: 'ramp', length: 6, width: 2, height: 2.5, duration: 8 }], { family: 'construct' }), gap: 20 })
    d.m.heroes[1].position.x = 8
    d.cast(20)
    let top = 0
    for (let i = 0; i < 90; i++) (d.step(d.cmd(0, 1)), (top = Math.max(top, d.m.heroes[0].position.y)))
    expect(top).toBeGreaterThan(2)
  })

  it('a platform rises where it lands and carries up who stands there', () => {
    const d = lab({ mine: q('platform', at.zone(4, 1), [{ kind: 'terrain', shape: 'platform', length: 3, width: 3, height: 2, duration: 8 }], { family: 'construct' }), gap: 4 })
    d.cast(30)
    expect(d.of('wall').filter((e) => e.look === 'terrain')).toHaveLength(1)
    expect(d.m.heroes[1].position.y).toBeGreaterThan(1.9)
  })

  it('portals take whoever steps in to the other end', () => {
    const d = lab({ mine: q('portal', at.zone(8, 1), [{ kind: 'portal', duration: 6 }], { family: 'construct' }), gap: 4 })
    d.m.heroes[1].position.x = 6
    d.cast(60)
    expect(d.of('portal').filter((e) => e.phase === 'open')).toHaveLength(1)
    const through = d.of('portal').filter((e) => e.phase === 'through' && e.who === 0)
    expect(through).toHaveLength(1)
    expect(d.m.heroes[0].position.z).toBeGreaterThan(7)
  })
})

describe('Q tricks (full kit)', () => {
  it("copying a kit takes the target's weapons and skills for a while, then gives them back", () => {
    const tankFist = melee({ style: 'unarmed', id: 'tank-fist', name: 'Tank Fist', roles: ['tank'], tags: ['t'], ai: ai('poke', 1), delivery: at.melee(2.5), effects: [phys(90)] })
    const d = lab({ mine: q('copy', at.proj(20), [{ kind: 'copyKit', duration: 3 }]), gap: 6 })
    d.setups[1].kit.basic = tankFist
    d.cast(30)
    expect(d.of('kit').filter((e) => e.phase === 'start' && e.from === 1)).toHaveLength(1)
    expect(liveSetups(d.m, d.setups)[0].kit.basic).toBe(tankFist)
    expect(liveSetups(d.m, d.setups)[0].kit.ultimate).toBe(d.setups[0].kit.ultimate)
    d.step(d.cmd(), ticks(3))
    expect(liveSetups(d.m, d.setups)[0].kit.basic).toBe(fist)
  })

  it('a kit switch swaps in its second kit, and casting it again switches back', () => {
    const heavy = melee({ style: 'unarmed', id: 'heavy', name: 'Heavy', roles: ['fighter'], tags: ['t'], ai: ai('poke', 1), delivery: at.melee(2.5), effects: [phys(150)] })
    const d = lab({ mine: q('switch', at.self(), [{ kind: 'kitSwitch', duration: 10 }], { switchTo: { basic: heavy } }) })
    d.cast(70)
    expect(liveSetups(d.m, d.setups)[0].kit.basic).toBe(heavy)
    d.step(d.cmd(BASIC))
    d.step(d.cmd(), 60)
    const struck = d.hits(0, 1)
    expect(struck.length).toBeGreaterThan(0)
    d.cast(40)
    expect(liveSetups(d.m, d.setups)[0].kit.basic).toBe(fist)
  })

  it("possession drives the target with the possessor's input against its own side, then lets go", () => {
    const d = lab({ mine: q('possess', at.proj(20), [{ kind: 'possess', duration: 2 }]), gap: 6 })
    d.cast(40)
    const target = d.m.heroes[1]
    expect(target.possessed?.by).toBe(0)
    expect(target.team).toBe(0)
    const z = target.position.z
    const own = { ...d.m.heroes[0].position }
    d.step(d.cmd(0, 1), 40)
    expect(target.position.z).toBeGreaterThan(z + 1)
    expect(d.m.heroes[0].position.z).toBeCloseTo(own.z, 1)
    d.step(d.cmd(), ticks(2))
    expect(target.possessed).toBeUndefined()
    expect(target.team).toBe(1)
  })

  it('a lift holds the target in the air, then throws it along the aim and knocks it down', () => {
    const d = lab({ mine: q('lift', at.proj(20), [{ kind: 'lift', height: 3, hold: 1, distance: 8 }], { family: 'displacement' }), gap: 5 })
    d.step(d.cmd(Q))
    let high = 0
    for (let i = 0; i < 50; i++) (d.step(), (high = Math.max(high, d.m.heroes[1].position.y)))
    expect(high).toBeGreaterThan(2.8)
    expect(d.m.heroes[1].lifted).toBeDefined()
    const z = d.m.heroes[1].position.z
    let downed = false
    for (let i = 0; i < 120; i++) (d.step(), (downed ||= !!d.m.heroes[1].down))
    expect(d.of('lift').filter((e) => e.phase === 'throw')).toHaveLength(1)
    expect(d.m.heroes[1].position.z).toBeGreaterThan(z + 3)
    expect(downed).toBe(true)
  })

  it('a revive at range brings a downed ally back up at its share of health', () => {
    const d = lab({ third: q('revive', at.zone(8, 2), [{ kind: 'revive', share: 0.5, target: 'ally' }], { family: 'support' }), gap: 2 })
    const fallen = d.m.heroes[1]
    goDown({ match: d.m, setups: d.setups, events: d.events }, fallen)
    expect(fallen.downed).toBeDefined()
    // hero 2 aims at it: it lies 6 m off to its left
    d.setOther({ moveX: 0, moveZ: 0, moves: 0, aimYaw: Math.round((-Math.PI / 2 / (2 * Math.PI)) * AIM_STEPS), aimPitch: 0, buttons: Q })
    d.step(d.cmd(), 40)
    expect(fallen.downed).toBeUndefined()
    expect(fallen.hp / fallen.maxHp).toBeCloseTo(0.5, 1)
  })
})
