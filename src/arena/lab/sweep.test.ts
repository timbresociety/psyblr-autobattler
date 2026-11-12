import { describe, expect, it } from 'vitest'
import { proposeBuild, type Build } from '../../charter/build.js'
import type { SizeClass } from '../../charter/sizes.js'
import { armyModifiers } from '../../charter/traits.js'
import type { BuildSlot } from '../../charter/types.js'
import { LAB_HEROES, type LabBot } from '../engine/lab.js'
import type { MatchEvent } from '../engine/events.js'
import { matchRules } from '../engine/match.js'
import { LIVE_MAP } from '../engine/maps.js'
import { yawPitch } from '../engine/maths.js'
import { advance, arenaFor } from '../engine/replay.js'
import { AIM_STEPS, IDLE, capsule, slotBit, type Command } from '../engine/state.js'
import { STARTERS, starterBuild } from '../starters.js'
import { E_OPTIONS, F_OPTIONS, LMB_FAMILIES, LMB_FLIGHTS, LMB_MODES, Q_OPTIONS, R_OPTIONS, V_OPTIONS, lmbId, type LabKit, type LabTarget } from './library.js'

/**
 * The lab's automated sweep (session 2 plan): every option on John's buttons, in the lab itself (the house's blue deck,
 * the full kit on), pressed at whoever it's for a few steps ahead. It catches what breaks between the owner's checks:
 * a press that throws, never goes off, misses a dummy it can't miss, or leaves a hero somewhere that isn't a place.
 * The owner's marks in the lab stay the exit.
 */

const starter = (squad: 'vanguard' | 'outlaws', role: string): Build => starterBuild(STARTERS.find((s) => s.squad === squad && s.roleId === role)!)

function lab(kit: LabKit, size: SizeClass = 'medium', target: LabTarget = 'dummy') {
  const john = { ...starter('vanguard', 'fighter'), heroName: 'John', sizeClass: size }
  const dummy = proposeBuild({ heroName: 'Training dummy', roleId: 'tank', skills: {} }).build
  const teams = [armyModifiers([john, starter('vanguard', 'support')]), armyModifiers([dummy, starter('outlaws', 'fighter')])] as [ReturnType<typeof armyModifiers>, ReturnType<typeof armyModifiers>]
  const arena = arenaFor({ teams, seed: 11, side: 0, map: LIVE_MAP, lab: { kit } })
  const m = arena.match
  m.human = LAB_HEROES.john
  // whoever the row is for stands a few steps ahead of John, who faces it
  const who = LAB_HEROES[target as LabBot]
  const me = m.heroes[LAB_HEROES.john].position
  m.heroes[who].position = { x: me.x, y: me.y, z: me.z + 3 }
  const rules = matchRules(arena)
  const events: MatchEvent[] = []
  const step = (c: Command, n = 1) => {
    for (let i = 0; i < n; i++) events.push(...advance(arena, rules, undefined, c).events)
  }
  // aimed as a player would: from John's eyes at the middle of whoever the row is for
  let level = false
  const aim = () => {
    if (level) return IDLE
    const j = m.heroes[LAB_HEROES.john]
    const t = m.heroes[who]
    const { pitch } = yawPitch({ x: 0, y: t.position.y + capsule(t).height / 2 - (j.position.y + capsule(j).height * 0.9), z: t.position.z - j.position.z })
    return { ...IDLE, aimPitch: Math.round((pitch / (2 * Math.PI)) * AIM_STEPS) }
  }
  const press = (slot: BuildSlot, hold = 1) => {
    step({ ...aim(), buttons: slotBit(slot) }, hold)
    step(aim(), 150)
  }
  const sane = () => m.heroes.every((h) => [h.position.x, h.position.y, h.position.z, h.hp].every(Number.isFinite) && h.position.y > -1)
  const released = (slot: BuildSlot) => events.some((e) => e.type === 'release' && e.hero === LAB_HEROES.john && e.slot === slot)
  const hit = (slot: BuildSlot) => events.some((e) => e.type === 'hit' && e.source === LAB_HEROES.john && e.slot === slot)
  return { arena, events, press, sane, released, hit, step, level: () => void (level = true) }
}

const SIZES: readonly SizeClass[] = ['tiny', 'medium', 'colossal']

describe("John's lab: every option goes off", () => {
  it.each(SIZES)('V, every family, lands on the dummy (%s John)', (size) => {
    for (const o of V_OPTIONS) {
      const d = lab({ basic: o.id }, size)
      d.press('basic')
      expect(d.hit('basic'), `${o.id} on a ${size} John`).toBe(true)
      expect(d.sane()).toBe(true)
    }
  })

  it('LMB, every family firing every way, goes off and lands', () => {
    for (const f of LMB_FAMILIES)
      for (const mode of LMB_MODES) {
        const d = lab({ active1: lmbId(f.id, mode.id) })
        d.press('active1', mode.id === 'auto' || mode.id === 'channel' ? 60 : mode.id === 'charge' ? 40 : 1)
        const what = `${f.id} ${mode.id}`
        expect(d.released('active1') || d.events.some((e) => e.type === 'beam' && e.hero === 0), what).toBe(true)
        expect(d.hit('active1'), what).toBe(true)
        expect(d.sane(), what).toBe(true)
      }
  })

  it('LMB, every flight, goes off', () => {
    for (const fl of LMB_FLIGHTS) {
      const d = lab({ active1: lmbId('magic1', 'single', fl.id) })
      d.press('active1')
      expect(d.released('active1'), fl.id).toBe(true)
      expect(d.sane(), fl.id).toBe(true)
    }
  })

  it('Q, every family, goes off on whoever it is for', () => {
    for (const o of Q_OPTIONS)
      for (const t of o.targets ?? (['dummy'] as const)) {
        const d = lab({ active2: o.id }, 'medium', t)
        // a skill that costs power waits for the meter: it starts full here
        if (o.template.cost) d.arena.match.heroes[0].power = 1
        d.press('active2', o.template.charge ? 40 : 1)
        expect(d.released('active2'), `${o.id} on the ${t}`).toBe(true)
        expect(d.sane(), `${o.id} on the ${t}`).toBe(true)
      }
  })

  it.each(SIZES)('E, every kind, moves John (%s John)', (size) => {
    for (const o of E_OPTIONS) {
      // the ride needs an ally to ride; everything else runs at the dummy
      const d = lab({ movement: o.id }, size, o.id === 'e-ride' || o.id === 'e-swap' ? 'ally' : 'dummy')
      // a way of moving that isn't at a hero is used looking ahead
      if (!['e-teleport', 'e-swap', 'e-homing', 'e-ride'].includes(o.id)) d.level()
      const from = { ...d.arena.match.heroes[0].position }
      d.press('movement')
      const to = d.arena.match.heroes[0].position
      expect(d.released('movement'), `${o.id} on a ${size} John`).toBe(true)
      expect(d.sane(), `${o.id} on a ${size} John`).toBe(true)
      // held kinds hold John where he is until steered, and the wall ones need a wall: the rest go somewhere
      if (!['e-flight', 'e-glide', 'e-crawl', 'e-wall-run', 'e-burrow', 'e-zipline', 'e-swing'].includes(o.id)) expect(Math.hypot(to.x - from.x, to.z - from.z), `${o.id} on a ${size} John`).toBeGreaterThan(0.5)
    }
  })

  it('F, every aura, switches on', () => {
    for (const o of F_OPTIONS) {
      const d = lab({ passive: o.id })
      d.step({ ...IDLE, buttons: slotBit('passive') })
      d.step(IDLE, 30)
      expect(d.events.some((e) => e.type === 'passive' && e.hero === 0 && e.on), o.id).toBe(true)
      expect(d.sane(), o.id).toBe(true)
    }
  })

  it('every summon calls its bodies in beside John, and they act', () => {
    const want: Record<string, [string, number]> = { 'q-minions': ['minion', 2], 'q-clone': ['clone', 1], 'q-decoy': ['decoy', 1], 'r-titan': ['titan', 1] }
    for (const [id, [what, count]] of Object.entries(want)) {
      const slot: BuildSlot = id.startsWith('r-') ? 'ultimate' : 'active2'
      const d = lab({ [slot]: id })
      const m = d.arena.match
      const ours = () => m.heroes.filter((h) => h.summon?.owner === LAB_HEROES.john && h.summon.what === what)
      expect(ours().length, id).toBe(count)
      expect(ours().every((h) => !h.alive), id).toBe(true)
      const at = ours().map((h) => ({ ...h.position }))
      d.press(slot)
      expect(ours().every((h) => h.alive && h.summon!.active), id).toBe(true)
      // called in where John stands, and moving on their own since
      expect(ours().some((h, i) => Math.hypot(h.position.x - at[i].x, h.position.z - at[i].z) > 0.5), id).toBe(true)
      expect(d.sane(), id).toBe(true)
    }
  })

  it("the allies aura holds its buffs on the ally beside John, and not on the dummy", () => {
    const d = lab({ passive: 'f-allies' }, 'medium', 'ally')
    d.step({ ...IDLE, buttons: slotBit('passive') })
    d.step(IDLE, 30)
    const m = d.arena.match
    expect(m.heroes[LAB_HEROES.ally].buffs.some((b) => b.stat === 'moveSpeed' && b.source === 'passive:0')).toBe(true)
    expect(m.heroes[LAB_HEROES.john].buffs.some((b) => b.stat === 'damageReduction' && b.source === 'passive:0')).toBe(true)
    expect(m.heroes[LAB_HEROES.dummy].buffs.some((b) => b.source === 'passive:0')).toBe(false)
  })

  it.each(SIZES)('R, every shape, goes off (%s John)', (size) => {
    for (const o of R_OPTIONS) {
      const d = lab({ ultimate: o.id }, size, o.id === 'r-fuse' ? 'ally' : 'dummy')
      d.press('ultimate')
      expect(d.released('ultimate'), `${o.id} on a ${size} John`).toBe(true)
      expect(d.sane(), `${o.id} on a ${size} John`).toBe(true)
    }
  })
})

describe("John's lab: the bots", () => {
  it('a bot on beam holds one on John, on block guards, and on still does nothing', () => {
    const d = lab({})
    const lab0 = d.arena.lab!
    lab0.bots.enemy = 'beam'
    d.arena.match.heroes[LAB_HEROES.enemy].position = { x: 5.5, y: 4.5, z: -32 }
    d.step(IDLE, 90)
    expect(d.events.some((e) => e.type === 'beam' && e.hero === LAB_HEROES.enemy && e.phase === 'on')).toBe(true)
    lab0.bots.enemy = 'block'
    d.step(IDLE, 30)
    expect(d.arena.match.heroes[LAB_HEROES.enemy].blocking).toBe(true)
    // back off the beam, the bot has its own LMB again
    expect(d.arena.setups[LAB_HEROES.enemy].kit.active1.id).not.toBe(lmbId('magic2', 'channel'))
    lab0.bots.enemy = 'still'
    const at = { ...d.arena.match.heroes[LAB_HEROES.enemy].position }
    d.step(IDLE, 60)
    expect(d.arena.match.heroes[LAB_HEROES.enemy].position).toEqual(at)
  })

  it('the deck has its wall, column, ledge, pad and zipline, and a pad throws John up', () => {
    const d = lab({})
    const m = d.arena.match
    expect(m.cover!.pieces.filter((p) => p.run)).toHaveLength(1)
    expect(m.lines!.some((l) => l.kind === 'zip' && l.a.z === -41)).toBe(true)
    m.heroes[0].position = { x: 5.5, y: 4.5, z: -14 }
    d.step({ ...IDLE, moveZ: 1, aimYaw: 0 }, 40)
    expect(d.events.some((e) => e.type === 'move' && e.hero === 0 && e.move === 'pad')).toBe(true)
  })
})

