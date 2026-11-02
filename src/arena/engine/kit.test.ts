import { describe, expect, it } from 'vitest'
import type { BuildSlot, Template } from '../../charter/types.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import { ai, at, buff, heal, passive, phys, ranged, reveal, rewind, spell, steal, swapHealth } from '../../charter/templates/dsl.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE, ticks } from './calibration.js'
import { carryOn, cast, COMBAT_RULES, muzzle } from './deliveries.js'
import { togglePassive } from './effects.js'
import type { MatchEvent } from './events.js'
import { land } from './testing.js'
import { createHero, emptyMatch, prepareHero, slotBit, type Command, type HeroSetup, type MatchState } from './state.js'
import { tick } from './tick.js'

/**
 * The kit engine's rules (GAME.md §4, §5): the passive's energy meter, the ranged weapon's magazine and bloom, the heavy
 * blow that breaks a guard, the melee lunge, and the vision and trick spells.
 */

const base = { id: 'kit', name: 'Kit', roles: ['mage' as const], tags: ['t'], cooldown: 8, ai: ai('poke', 1) }

/** Hero 0 (blue, a mage) at the origin facing +z with `kit` slotted; heroes after it at the given spots, red unless `team` says. */
function arena(kit: Partial<Record<BuildSlot, Template>>, others: { z: number; x?: number; team?: 0 | 1; role?: 'tank' | 'support' }[]) {
  const m: MatchState = emptyMatch(1)
  const mine = prepareHero(defaultBuild('mage'))
  const setups: HeroSetup[] = [{ ...mine, kit: { ...mine.kit, ...kit } }]
  m.heroes.push(createHero(setups[0], 0, 0, { x: 0, y: 0, z: 0 }))
  others.forEach((o, i) => {
    const setup = prepareHero(defaultBuild(o.role ?? 'tank'))
    setups.push(setup)
    const h = createHero(setup, i + 1, o.team ?? 1, { x: o.x ?? 0, y: 0, z: o.z })
    h.yaw = Math.PI
    m.heroes.push(h)
  })
  const events: MatchEvent[] = []
  const ctx = { match: m, setups, events }
  const idle: Command = { moveX: 0, moveZ: 0, moves: 0, aimYaw: 0, aimPitch: 0, buttons: 0 }
  const run = (n: number, commands: (Command | undefined)[] = []) => {
    for (let i = 0; i < n; i++) events.push(...tick(m, setups, commands, COMBAT_RULES))
  }
  const of = <T extends MatchEvent['type']>(type: T) => events.filter((e): e is Extract<MatchEvent, { type: T }> => e.type === type)
  return { m, setups, ctx, events, run, of, idle }
}

describe('the passive energy meter (§4 F)', () => {
  const surge = passive({ ...base, id: 'surge', cooldown: 0, delivery: at.self(), effects: [buff('damage', 20, 1)], trigger: 'always', energy: { seconds: 2, refill: 4 } })

  it('starts off; switched on, it holds its buff while the meter drains, then switches itself off when dry', () => {
    const a = arena({ passive: surge }, [{ z: 30 }])
    const me = a.m.heroes[0]
    expect(me.passiveOn).toBe(false)
    a.run(5)
    expect(me.buffs.some((b) => b.stat === 'damage')).toBe(false)
    togglePassive(a.ctx, me)
    a.run(ticks(1))
    expect(me.buffs.some((b) => b.stat === 'damage')).toBe(true)
    expect(me.energy).toBeCloseTo(0.5, 1)
    a.run(ticks(1.2))
    expect(me.passiveOn).toBe(false)
    expect(a.of('passive').some((e) => e.on === false && e.dry)).toBe(true)
    a.run(5)
    expect(me.buffs.some((b) => b.stat === 'damage')).toBe(false)
  })

  it('refills while off, never costs health and never blocks: an empty meter switches on and straight off', () => {
    const a = arena({ passive: surge }, [{ z: 30 }])
    const me = a.m.heroes[0]
    me.energy = 0
    const hp = me.hp
    togglePassive(a.ctx, me)
    expect(me.passiveOn).toBe(true)
    a.run(1)
    expect(me.passiveOn).toBe(false)
    expect(me.hp).toBeGreaterThanOrEqual(hp)
    a.run(ticks(2))
    expect(me.energy).toBeCloseTo(0.5, 1)
  })

  it('a power that used to be a cast lands once as it switches on, paid from the meter', () => {
    const mend = getTemplate('mage-mana-shield')
    expect(mend.energy?.onSwitch).toBe(true)
    const a = arena({ passive: mend }, [{ z: 30 }])
    const me = a.m.heroes[0]
    togglePassive(a.ctx, me)
    expect(me.shield).toBeGreaterThan(0)
    expect(me.energy).toBeCloseTo(1 - ENGINE.passive.switchCost, 5)
  })
})

describe('the ranged weapon (§4 LMB, §5)', () => {
  const pistol = ranged({ ...base, id: 'pistol', cooldown: 0, ranged: { style: 'pistol', mode: 'single', rate: 3, magazine: 4, reload: 1 }, delivery: at.proj(20), effects: [phys(20)] })

  it('shots leave the muzzle, in the hand ahead and to the side, not the chest', () => {
    const a = arena({ active1: pistol }, [{ z: 8 }])
    // the first shot leaves at the end of the draw's wind-up
    for (let i = 0; i < 30 && !a.of('projectile').length; i++) a.run(1, [{ ...a.idle, buttons: slotBit('active1') }])
    const shot = a.of('projectile')[0]
    expect(shot).toBeDefined()
    const m = muzzle(a.m.heroes[0], 'pistol')
    expect(shot.from).toEqual(m)
    expect(m.z).toBeGreaterThan(0.1)
    expect(Math.abs(m.x)).toBeGreaterThan(0.05)
  })

  it('bloom grows with each shot and settles when the trigger rests', () => {
    const a = arena({ active1: pistol }, [{ z: 8 }])
    const me = a.m.heroes[0]
    a.run(ticks(0.9), [{ ...a.idle, buttons: slotBit('active1') }])
    expect(me.bloom).toBeGreaterThan(ENGINE.ranged.perShot)
    a.run(ticks(1.5))
    expect(me.bloom).toBe(0)
  })

  it('an empty magazine reloads over the weapon’s reload time and refills it', () => {
    const a = arena({ active1: pistol }, [{ z: 8 }])
    const me = a.m.heroes[0]
    // the magazine as the sheet scales it can be deep; this one holds four
    a.setups[0] = { ...a.setups[0], magazine: 4 }
    me.ammo = 4
    const full = me.ammo
    a.run(ticks(3), [{ ...a.idle, buttons: slotBit('active1') }])
    const starts = a.of('reload').filter((e) => e.phase === 'start')
    const ends = a.of('reload').filter((e) => e.phase === 'end')
    expect(starts.length).toBeGreaterThan(0)
    expect(ends.length).toBeGreaterThan(0)
    // it ends on the tick it said it would
    expect(ends[0].until).toBe(starts[0].until)
    // a part-spent magazine tops up once the trigger has rested a while
    a.run(ticks(ENGINE.ranged.topUp + 1.2))
    expect(me.ammo).toBe(full)
  })
})

describe('melee (§5)', () => {
  const sword = getTemplate('melee-blade')

  it('a heavy blow breaks a guard: the guard drops and staggers, and the blow lands', () => {
    const a = arena({ basic: sword }, [{ z: 1.8 }])
    const guard = a.m.heroes[1]
    guard.blocking = true
    const hp = guard.hp
    expect(cast(a.ctx, 0, 'basic', { step: 0, heavy: 1 })).toBe(true)
    a.m.heroes[0].action!.release = a.m.tick
    carryOn(a.ctx, 0)
    expect(a.of('melee').some((e) => e.what === 'guard-broken' && e.hero === 1)).toBe(true)
    expect(guard.blocking).toBe(false)
    expect(guard.stunnedUntil).toBeGreaterThan(a.m.tick)
    expect(guard.hp).toBeLessThan(hp)
  })

  it('a light strike into a guard is blocked and staggers the striker instead', () => {
    const a = arena({ basic: sword }, [{ z: 1.8 }])
    const guard = a.m.heroes[1]
    guard.blocking = true
    const hp = guard.hp
    cast(a.ctx, 0, 'basic', { step: 0 })
    a.m.heroes[0].action!.release = a.m.tick
    carryOn(a.ctx, 0)
    expect(a.of('melee').some((e) => e.what === 'blocked')).toBe(true)
    expect(guard.hp).toBe(hp)
    expect(a.m.heroes[0].stunnedUntil).toBeGreaterThan(a.m.tick)
  })

  it('a swing lunges toward an enemy just out of reach, by up to its style’s lunge', () => {
    const a = arena({ basic: sword }, [{ z: 3.6 }])
    const me = a.m.heroes[0]
    cast(a.ctx, 0, 'basic', { step: 0 })
    expect(me.lunge?.target).toBe(1)
    a.run(ticks(ENGINE.melee.lungeTime) + 1)
    expect(me.position.z).toBeGreaterThan(0.3)
    expect(me.position.z).toBeLessThanOrEqual(1.6 + 1e-6)
  })
})

describe('vision and trick spells (§4 Q)', () => {
  const q = (family: 'vision' | 'trick' | 'support', effects: Template['effects'], delivery = at.zone(0, 6)) => spell({ ...base, family, delivery, effects })

  it('a reveal ends stealth and keeps it from coming back', () => {
    const a = arena({ active2: q('vision', [reveal(4)]) }, [{ z: 3 }])
    const hidden = a.m.heroes[1]
    hidden.stealthUntil = a.m.tick + 600
    land(a.ctx, 0, 'active2')
    expect(hidden.stealthUntil).toBeLessThanOrEqual(a.m.tick)
    expect(hidden.revealedUntil).toBeGreaterThan(a.m.tick + ticks(3))
  })

  it('a reflect turns a shot back on its shooter', () => {
    const bolt = spell({ ...base, family: 'burst', id: 'bolt', delivery: at.proj(20), effects: [phys(80)] })
    const a = arena({ active2: bolt }, [{ z: 6 }])
    const mirror = a.m.heroes[1]
    mirror.reflectUntil = a.m.tick + 600
    const mine = a.m.heroes[0].hp
    const theirs = mirror.hp
    land(a.ctx, 0, 'active2')
    a.run(ticks(1.5))
    expect(a.of('reflect').length).toBe(1)
    expect(mirror.hp).toBe(theirs)
    expect(a.m.heroes[0].hp).toBeLessThan(mine)
  })

  it('a health swap trades health shares with the enemy, each change capped', () => {
    const a = arena({ active2: q('trick', [swapHealth(0.35)], at.proj(20)) }, [{ z: 3 }])
    const me = a.m.heroes[0]
    const foe = a.m.heroes[1]
    me.hp = me.maxHp * 0.3
    foe.hp = foe.maxHp * 0.9
    land(a.ctx, 0, 'active2')
    a.run(ticks(0.5))
    expect(me.hp / me.maxHp).toBeCloseTo(0.65, 1)
    expect(foe.hp / foe.maxHp).toBeCloseTo(0.55, 1)
  })

  it('a steal puts the enemy’s spell back and brings the caster’s forward', () => {
    const a = arena({ active2: q('trick', [steal(4)]) }, [{ z: 3 }])
    const foe = a.m.heroes[1]
    foe.cooldowns.active2 = 0
    land(a.ctx, 0, 'active2')
    expect(foe.cooldowns.active2).toBe(ticks(4))
    expect(a.m.heroes[0].cooldowns.active2).toBeLessThan(ticks(base.cooldown))
  })

  it('a rewind gives an ally back the health it lost', () => {
    const a = arena({ active2: q('support', [rewind(3), heal(5, 0, 'ally')], at.zone(0, 8)) }, [{ z: 30 }, { z: 2, team: 0, role: 'support' }])
    const ally = a.m.heroes[2]
    a.run(ticks(3.5))
    ally.hp = ally.maxHp * 0.4
    land(a.ctx, 0, 'active2')
    expect(ally.hp).toBeGreaterThan(ally.maxHp * 0.95)
  })
})
