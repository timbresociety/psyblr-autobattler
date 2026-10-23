import { describe, expect, it } from 'vitest'
import { armyModifiers } from '../../charter/synergy'
import { getTemplate } from '../../charter/templates/catalog'
import { referenceArmy } from '../../sim/field'
import { defaultBuild } from '../../sim/fixtures'
import { chest } from '../engine/deliveries'
import type { MatchEvent } from '../engine/events'
import { GATE_PROFILE, createMatch, matchRules, play, type Arena } from '../engine/match'
import { hashState } from '../engine/snapshot'
import { tick } from '../engine/tick'
import { anglesTo, trackAim } from './aim'
import { aiCommands } from './brain'
import { AI } from './calibration'
import { wrapAngle } from '../engine/maths'

const run = (arena: Arena, n: number) => {
  const rules = matchRules(arena)
  const events: MatchEvent[] = []
  for (let i = 0; i < n && arena.match.winner === undefined; i++) events.push(...tick(arena.match, arena.setups, aiCommands(arena), rules))
  return events
}
const casts = (events: MatchEvent[], hero: number) => events.filter((e) => e.type === 'cast' && e.hero === hero).map((e) => (e as Extract<MatchEvent, { type: 'cast' }>).slot)

describe('demo AI (U7)', () => {
  it('uses an escape skill below 30% health when an enemy is near', () => {
    const build = defaultBuild('assassin')
    const sprint = { ...build, slots: { ...build.slots, movement: { ...build.slots.movement, templateId: 'shared-sprint-burst' } } }
    const a = createMatch([{ build: sprint }], [{ build: defaultBuild('fighter') }], 1, { formations: [[{ x: 0, y: 0, z: -2 }], [{ x: 0, y: 0, z: 2 }]], cover: false })
    a.match.heroes[0].hp = a.match.heroes[0].maxHp * 0.2
    expect(getTemplate('shared-sprint-burst').ai.use).toBe('escape')
    expect(casts(run(a, 60), 0)).toContain('movement')
  })

  it('fires a finisher only when the target is under its threshold', () => {
    const build = defaultBuild('fighter')
    const meteor = { ...build, slots: { ...build.slots, ultimate: { ...build.slots.ultimate, templateId: 'fighter-meteor-combo' } } }
    const setup = (hpFraction: number) => {
      const a = createMatch([{ build: meteor }], [{ build: defaultBuild('tank') }], 2, { formations: [[{ x: 0, y: 0, z: -1 }], [{ x: 0, y: 0, z: 1 }]], cover: false })
      a.match.heroes[0].cooldowns.ultimate = 0
      a.match.heroes[1].hp = a.match.heroes[1].maxHp * hpFraction
      return a
    }
    expect(casts(run(setup(0.95), 30), 0)).not.toContain('ultimate')
    expect(casts(run(setup(0.3), 30), 0)).toContain('ultimate')
  })

  it('tracks a strafing target within an error band, not perfectly', () => {
    const a = createMatch([{ build: defaultBuild('marksman') }], [{ build: defaultBuild('tank') }], 3)
    a.match.brains = undefined
    aiCommands(a)
    const brain = a.match.brains![0]
    const errors: number[] = []
    for (let t = 0; t < 400; t++) {
      a.match.tick++
      a.match.heroes[1].position.x = Math.sin(t / 20) * 6
      const want = anglesTo(chest(a.match.heroes[0]), chest(a.match.heroes[1]))
      const off = trackAim(a.match, brain, want, t === 0)
      if (t > 60) errors.push(off)
    }
    errors.sort((x, y) => x - y)
    expect(errors[Math.floor(errors.length / 2)]).toBeLessThan(0.1)
    expect(errors.filter((e) => e > AI.aimJitter).length).toBeGreaterThan(5)
  })

  it('takes a new target only after the reaction delay', () => {
    const a = createMatch([{ build: defaultBuild('fighter') }], [{ build: defaultBuild('tank') }, { build: defaultBuild('mage') }], 4, {
      formations: [[{ x: 0, y: 0, z: -2 }], [{ x: 0, y: 0, z: 2 }, { x: 10, y: 0, z: 20 }]],
    })
    aiCommands(a)
    const brain = a.match.brains![0]
    expect(brain.target).toBe(1)
    // the mage walks right up and is far weaker: the fighter should switch, but not at once
    a.match.heroes[2].position = { x: 0.5, y: 0, z: 1 }
    a.match.heroes[2].hp = 10
    a.match.tick = brain.nextDecision
    aiCommands(a)
    expect(brain.target).toBe(1)
    expect(brain.pending?.target).toBe(2)
    const at = brain.pending!.at
    expect(at - a.match.tick).toBeGreaterThanOrEqual(AI.reaction.min)
    a.match.tick = at
    aiCommands(a)
    expect(brain.target).toBe(2)
  })

  it('dodges some projectiles it can see, and never one beyond sight', () => {
    let dodged = 0
    for (let seed = 1; seed <= 20; seed++) {
      const a = createMatch([{ build: defaultBuild('fighter') }], [{ build: defaultBuild('marksman') }], seed, { formations: [[{ x: 0, y: 0, z: -10 }], [{ x: 0, y: 0, z: 10 }]], cover: false })
      aiCommands(a)
      const me = chest(a.match.heroes[0])
      a.match.projectiles.push({ id: 1, owner: 1, slot: 'basic', position: { x: me.x, y: me.y, z: me.z + AI.seeDistance - 4 }, step: { x: 0, y: 0, z: -0.5 }, ticksLeft: 60 })
      a.match.tick = a.match.brains![0].nextDecision
      aiCommands(a)
      if (a.match.brains![0].action === 'dodge') dodged++
    }
    // it dodges about AI.dodgeChance of the shots it sees
    expect(dodged).toBeGreaterThanOrEqual(Math.floor(20 * AI.dodgeChance * 0.5))
    expect(dodged).toBeLessThan(20)
    const far = createMatch([{ build: defaultBuild('fighter') }], [{ build: defaultBuild('marksman') }], 1)
    aiCommands(far)
    const me = chest(far.match.heroes[0])
    far.match.projectiles.push({ id: 1, owner: 1, slot: 'basic', position: { x: me.x, y: me.y, z: me.z + AI.seeDistance + 10 }, step: { x: 0, y: 0, z: -0.5 }, ticksLeft: 200 })
    far.match.tick = far.match.brains![0].nextDecision
    aiCommands(far)
    expect(far.match.brains![0].action).not.toBe('dodge')
  })

  it('covers F2: after a human hands a hero back, the AI commands it again within one decision', () => {
    const a = createMatch([{ build: defaultBuild('fighter') }], [{ build: defaultBuild('tank') }], 5)
    run(a, 30)
    a.match.human = 0
    expect(aiCommands(a)[0]).toBeUndefined()
    run(a, 30)
    a.match.human = undefined
    let commanded = false
    for (let i = 0; i < AI.decisionTicks && !commanded; i++) {
      const c = aiCommands(a)[0]
      commanded = !!c && (c.moveX !== 0 || c.moveZ !== 0 || c.buttons !== 0)
      tick(a.match, a.setups, [c], matchRules(a))
    }
    expect(commanded).toBe(true)
  })

  it('makes the same decisions for the same seed', () => {
    const army = () => armyModifiers([defaultBuild('fighter'), defaultBuild('mage'), defaultBuild('support')])
    const x = createMatch(army(), army(), 77)
    const y = createMatch(army(), army(), 77)
    run(x, 600)
    run(y, 600)
    expect(hashState(x.match)).toBe(hashState(y.match))
  })

  it('in a headless 5v5, heroes use their actives and ultimates', () => {
    const roles = ['tank', 'fighter', 'assassin', 'mage', 'support'] as const
    const army = () => armyModifiers(roles.map((r) => defaultBuild(r)))
    const a = createMatch(army(), army(), 9)
    const events: MatchEvent[] = []
    const rules = matchRules(a)
    while (a.match.winner === undefined) events.push(...tick(a.match, a.setups, aiCommands(a), rules))
    const used = (slot: string) => a.match.heroes.filter((h) => casts(events, h.id).includes(slot as never)).length
    expect(used('active1') + used('active2')).toBeGreaterThanOrEqual(8)
    expect(used('ultimate')).toBeGreaterThanOrEqual(3)
    expect(play).toBeDefined()
    expect(Math.abs(wrapAngle(7))).toBeLessThan(Math.PI + 1e-9)
  })

  it('fights on the ground among the ruins instead of drifting up into the sky (R25)', () => {
    const army = referenceArmy()
    const arena = createMatch(armyModifiers(army), armyModifiers(army), 3)
    const rules = matchRules(arena)
    let airborne = 0
    let samples = 0
    for (let i = 0; i < 60 * 40 && arena.match.winner === undefined; i++) {
      tick(arena.match, arena.setups, aiCommands(arena), rules)
      // a hero thrown up by a knock-up is not flying, it is falling
      for (const h of arena.match.heroes) if (h.alive) (samples++, h.position.y > 0.5 && !h.launch && airborne++)
    }
    // hops over low cover only: a fight that chases targets upward ends at the ceiling, above every wall
    expect(airborne / samples).toBeLessThan(0.1)
  })

  it('a sword across low cover from its target goes round it rather than standing there swinging at stone', () => {
    // a fighter and an assassin meet across the fallen column in the middle; when they stood still, every seed timed out
    for (const seed of [1, 2, 3]) {
      const arena = createMatch([{ build: defaultBuild('fighter') }], [{ build: defaultBuild('assassin') }], seed, { profile: GATE_PROFILE })
      play(arena, aiCommands)
      expect(arena.match.endReason).toBe('wipe')
    }
  })
})
