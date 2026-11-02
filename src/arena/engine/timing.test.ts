import { describe, expect, it } from 'vitest'
import { CATALOG, getTemplate } from '../../charter/templates/catalog.js'
import STYLE_TIMING from './style-timing.json'
import { spell, ai, at, disarm, phys, ranged, silence, slow, stun, ultimate } from '../../charter/templates/dsl.js'
import type { BuildSlot, Template } from '../../charter/types.js'
import { armyModifiers } from '../../charter/traits.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { referenceArmy } from '../../sim/field.js'
import { aiCommands } from '../ai/brain.js'
import { ENGINE } from './calibration.js'
import { COMBAT_RULES } from './deliveries.js'
import type { MatchEvent } from './events.js'
import { createMatch, matchRules } from './match.js'
import { hashState } from './snapshot.js'
import { AIM_STEPS, createHero, emptyMatch, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'
import { BASIC_SHARE, moveShare, timingOf, timingTicks } from './timing.js'
import { land } from './testing.js'
import { shotTemplate } from './combat.js'

const base = { id: 'timing', name: 'Timing', roles: ['fighter' as const], tags: ['t'], cooldown: 5, ai: ai('poke', 1) }
const swing = spell({ ...base, family: 'burst', delivery: at.melee(2.5), effects: [phys(40)] })
const big = ultimate({ ...base, id: 'big', cooldown: 60, delivery: at.melee(2.5), effects: [phys(40)] })
const bash = spell({ ...base, family: 'burst', id: 'bash', delivery: at.melee(2.5), effects: [stun(1)] })
const hush = spell({ ...base, family: 'burst', id: 'hush', delivery: at.melee(2.5), effects: [silence(1)] })
const unarm = spell({ ...base, family: 'burst', id: 'unarm', delivery: at.melee(2.5), effects: [disarm(1)] })

/** Hero 0 (blue) at the origin facing +z with `skills` slotted; hero 1 (a red tank) right in front of it. */
function duel(skills: Partial<Record<BuildSlot, Template>>, gap = 1.6) {
  const m: MatchState = emptyMatch(1)
  const fighter = prepareHero(defaultBuild('fighter'))
  const setups: HeroSetup[] = [{ ...fighter, kit: { ...fighter.kit, ...skills } }, prepareHero(defaultBuild('tank'))]
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }), createHero(setups[1], 1, 1, { x: 0, y: 0, z: gap }))
  m.heroes[1].yaw = Math.PI
  const events: MatchEvent[] = []
  // the fighter aims along +z and the tank back along -z, at each other, whoever presses
  const press = (buttons: number, who = 0, moveZ = 0): Command[] => [
    { moveX: 0, moveZ: who ? 0 : moveZ, moves: 0, aimYaw: 0, aimPitch: 0, buttons: who ? 0 : buttons },
    { moveX: 0, moveZ: 0, moves: 0, aimYaw: AIM_STEPS / 2, aimPitch: 0, buttons: who ? buttons : 0 },
  ]
  const step = (commands: (Command | undefined)[] = press(0)) => {
    const out = tick(m, setups, commands, COMBAT_RULES)
    events.push(...out)
    return out
  }
  const of = <T extends MatchEvent['type']>(type: T, list: MatchEvent[] = events) => list.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  return { m, setups, events, press, step, of, ctx: { match: m, setups, events } }
}

describe('action timing (Forge goal, phase 1)', () => {
  it('every template winds up for at least a tick, and an ultimate winds up longer than the same skill', () => {
    for (const t of CATALOG) {
      if (t.slot === 'passive') continue
      const slot: BuildSlot = t.slot === 'melee' ? 'basic' : t.slot === 'ranged' ? 'active1' : t.slot === 'ultimate' ? 'ultimate' : t.slot === 'movement' ? 'movement' : 'active2'
      const { prep, recover } = timingTicks(t, slot, 1)
      expect(prep, t.id).toBeGreaterThanOrEqual(1)
      expect(recover, t.id).toBeGreaterThanOrEqual(0)
    }
    expect(timingOf(big, 'ultimate').prep).toBeGreaterThan(timingOf(swing, 'active2').prep)
  })

  it('a hit lands on the release tick and never before, after a cast event that says when', () => {
    const d = duel({ active2: swing })
    const first = d.step(d.press(slotBit('active2')))
    const cast = d.of('cast', first)[0]
    expect(cast).toMatchObject({ hero: 0, slot: 'active2' })
    const prep = timingTicks(swing, 'active2').prep
    expect(cast.release).toBe(d.m.tick + prep)
    while (d.m.tick < cast.release - 1) d.step()
    expect(d.of('hit')).toEqual([])
    const landed = d.step()
    expect(d.m.tick).toBe(cast.release)
    expect(landed.map((e) => e.type)).toEqual(expect.arrayContaining(['release', 'impact', 'hit']))
    expect(landed.findIndex((e) => e.type === 'release')).toBeLessThan(landed.findIndex((e) => e.type === 'hit'))
  })

  it('a basic attack swings again only after its recovery, and each swing is its own cast', () => {
    const d = duel({})
    const starts: number[] = []
    const ends: number[] = []
    for (let i = 0; i < 240; i++) for (const e of d.step(d.press(i % 2 ? 0 : slotBit('basic')))) if (e.type === 'cast' && e.slot === 'basic') (starts.push(d.m.tick), ends.push(e.ends))
    expect(starts.length).toBeGreaterThan(2)
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThanOrEqual(ends[i - 1])
    expect(d.of('release').filter((e) => e.slot === 'basic').length).toBeGreaterThanOrEqual(starts.length - 1)
  })

  it('each melee style swings to its own clips’ beat, read off their contact frames (§5)', () => {
    const base = timingOf(swing, 'basic')
    const prep = (style: string) => timingOf(getTemplate(`melee-${style}`), 'basic').prep
    for (const style of ['unarmed', 'kicks', 'blade', 'greatsword', 'shield', 'staff', 'club']) {
      const t = STYLE_TIMING[style as keyof typeof STYLE_TIMING]
      // every style is measured from clips, and none strays far from the engine's basic beat
      expect(t.clips, style).toBeGreaterThan(0)
      expect(prep(style) / base.prep, style).toBeCloseTo(t.prep, 6)
      expect(t.prep).toBeGreaterThanOrEqual(0.75)
      expect(t.prep).toBeLessThanOrEqual(1.4)
    }
    // the club's blows land later in its clips than the greatsword's quick cuts
    expect(prep('club')).toBeGreaterThan(prep('greatsword'))
  })

  it('a fast attacker’s swing shrinks to fit between its attacks', () => {
    const quick = timingOf(swing, 'basic', 0.3)
    expect(quick.prep + quick.recover).toBeLessThanOrEqual(0.3 * BASIC_SHARE + 1e-9)
    const slow = timingOf(swing, 'basic', 2)
    expect(slow.prep).toBeGreaterThan(quick.prep)
  })

  it('a stun during the wind-up cuts it short: no hit, an interrupt, and the cooldown stays spent', () => {
    const d = duel({ active2: swing }, 1.6)
    // the tank stuns the fighter first: its own bash lands at once, as a test cast
    d.setups[1] = { ...d.setups[1], kit: { ...d.setups[1].kit, active2: bash } }
    d.step(d.press(slotBit('active2')))
    expect(d.m.heroes[0].action?.released).toBe(false)
    land(d.ctx, 1, 'active2')
    expect(d.of('interrupt')).toEqual([{ type: 'interrupt', hero: 0, slot: 'active2' }])
    expect(d.m.heroes[0].action).toBeUndefined()
    for (let i = 0; i < 90; i++) d.step()
    expect(d.of('hit').filter((e) => e.source === 0)).toEqual([])
    expect(d.m.heroes[0].cooldowns.active2).toBeGreaterThan(0)
  })

  it('the ranged weapon fires on repeat while held, at its rate, until the magazine runs dry and it reloads (§4 LMB)', () => {
    const gun = ranged({ ...base, id: 'gun', cooldown: 0, ranged: { style: 'pistol', mode: 'single', rate: 4, magazine: 6, reload: 1 }, delivery: at.proj(20), effects: [phys(40), slow(30, 1)] })
    const d = duel({ active1: gun }, 6)
    const magazine = d.m.heroes[0].ammo
    expect(magazine).toBeGreaterThan(1)
    const casts: MatchEvent[] = []
    for (let i = 0; i < 120; i++) casts.push(...d.step(d.press(slotBit('active1'))).filter((e) => e.type === 'cast'))
    // two seconds of fire is many shots, not one
    expect(casts.length).toBeGreaterThan(4)
    expect(d.of('hit').filter((e) => e.source === 0).length).toBeGreaterThan(4)
    // the magazine ran dry and the weapon reloaded rather than firing on
    expect(d.of('reload').some((e) => e.phase === 'start')).toBe(true)
    // a weapon's rider is part of every shot
    expect(d.m.heroes[1].slows.length).toBeGreaterThan(0)
    const full = gun.effects.find((e) => e.kind === 'damage')!
    expect(shotTemplate(gun, { share: 0.1, rider: false }).effects).toEqual([{ ...full, amount: full.amount * 0.1, ratio: full.ratio * 0.1 }])
  })

  it('silence cuts a skill’s wind-up but not a basic attack’s, and disarm the other way round', () => {
    // the tank holds the silence in Q and the disarm in R
    const skillUp = duel({ active2: swing })
    skillUp.setups[1] = { ...skillUp.setups[1], kit: { ...skillUp.setups[1].kit, active2: hush, ultimate: { ...unarm, slot: 'ultimate' } } }
    skillUp.m.heroes[1].cooldowns.ultimate = 0
    skillUp.step(skillUp.press(slotBit('active2')))
    land(skillUp.ctx, 1, 'ultimate')
    expect(skillUp.m.heroes[0].action?.slot).toBe('active2')
    land(skillUp.ctx, 1, 'active2')
    expect(skillUp.m.heroes[0].action).toBeUndefined()

    const swingUp = duel({})
    swingUp.setups[1] = { ...swingUp.setups[1], kit: { ...swingUp.setups[1].kit, active2: hush, ultimate: { ...unarm, slot: 'ultimate' } } }
    swingUp.m.heroes[1].cooldowns.ultimate = 0
    // the basic attack strikes as its button is let go (combat.ts)
    swingUp.step(swingUp.press(slotBit('basic')))
    swingUp.step(swingUp.press(0))
    land(swingUp.ctx, 1, 'active2')
    expect(swingUp.m.heroes[0].action?.slot).toBe('basic')
    land(swingUp.ctx, 1, 'ultimate')
    expect(swingUp.m.heroes[0].action).toBeUndefined()
  })

  it('a skill pressed during a basic attack’s wind-up takes over, and the swing never lands', () => {
    const d = duel({ active2: swing })
    d.step(d.press(slotBit('basic')))
    d.step(d.press(0))
    expect(d.m.heroes[0].action?.slot).toBe('basic')
    d.step(d.press(slotBit('active2')))
    expect(d.of('interrupt')).toEqual([{ type: 'interrupt', hero: 0, slot: 'basic' }])
    expect(d.m.heroes[0].action?.slot).toBe('active2')
    for (let i = 0; i < 60; i++) d.step()
    expect(d.of('release').map((e) => e.slot)).toEqual(['active2'])
  })

  it('feet stay planted through a wind-up: slowed for a skill, rooted for an ultimate', () => {
    expect(moveShare('active1', false)).toBeLessThan(moveShare('active1', true))
    expect(moveShare('ultimate', false)).toBe(0)
    const d = duel({ ultimate: big }, 30)
    d.m.heroes[0].cooldowns.ultimate = 0
    d.step(d.press(slotBit('ultimate'), 0, 1))
    const z = d.m.heroes[0].position.z
    d.step(d.press(0, 0, 1))
    expect(d.m.heroes[0].position.z).toBeCloseTo(z, 9)
    const free = duel({}, 30)
    for (let i = 0; i < 10; i++) free.step(free.press(0, 0, 1))
    const z0 = free.m.heroes[0].position.z
    free.step(free.press(0, 0, 1))
    expect(free.m.heroes[0].position.z - z0).toBeGreaterThan(0.05)
  })

  it('the same commands give the same match whether the AI or a player sends them', () => {
    const army = () => armyModifiers(referenceArmy())
    const ai = createMatch(army(), army(), 7, { cover: false })
    const recorded: (Command | undefined)[][] = []
    const hashes: number[] = []
    // the AI's memory and dice are the AI's own; everything else must match
    const fair = ({ brains: _b, ai: _a, human: _h, ...rest }: MatchState) => hashState(rest as MatchState)
    const rules = matchRules(ai)
    let releases = 0
    for (let t = 0; t < 20 * ENGINE.tickHz; t++) {
      const commands = aiCommands(ai)
      recorded.push(commands)
      releases += tick(ai.match, ai.setups, commands, rules).filter((e) => e.type === 'release').length
      hashes.push(fair(ai.match))
    }
    expect(releases).toBeGreaterThan(20)
    // the replay has no AI at all; hero 3 is the player's, and its commands come in by the player's path
    const human = createMatch(army(), army(), 7, { cover: false })
    human.match.human = 3
    const humanRules = matchRules(human)
    for (let t = 0; t < recorded.length; t++) {
      tick(human.match, human.setups, recorded[t], humanRules)
      expect(fair(human.match), `tick ${t + 1}`).toBe(hashes[t])
    }
  })
})
