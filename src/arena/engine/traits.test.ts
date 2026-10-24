import { describe, expect, it } from 'vitest'
import type { RoleId } from '../../charter/types.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { TraitMods } from '../../charter/traits.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { ticks } from './calibration.js'
import { applyEffect, dealDamage, type Ctx } from './effects.js'
import { GATE_PROFILE, createMatch } from './match.js'

/** One hero with these trait modifiers against a tank, on the open floor. */
function duel(mods: TraitMods, role: RoleId = 'support') {
  const arena = createMatch([{ build: defaultBuild(role), mods }], [{ build: defaultBuild('tank') }], 7, { profile: GATE_PROFILE, cover: false })
  const ctx: Ctx = { match: arena.match, setups: arena.setups, events: [] }
  return { arena, ctx, me: arena.match.heroes[0], foe: arena.match.heroes[1] }
}

describe('traits in the engine', () => {
  it('stat traits multiply and add to the derived sheet', () => {
    const plain = duel({}, 'tank').arena.setups[0].sheet
    const tank = duel({ mul: { armor: 0.5 }, add: { lifesteal: 4 } }, 'tank').arena.setups[0].sheet
    expect(tank.armor).toBeCloseTo(plain.armor * 1.5, 5)
    expect(tank.lifesteal).toBeCloseTo(plain.lifesteal + 4, 5)
  })

  it('an Ambush assassin starts the fight stealthed', () => {
    expect(duel({ stealthStart: 1.5 }, 'assassin').me.stealthUntil).toBe(ticks(1.5))
    expect(duel({}, 'assassin').me.stealthUntil).toBe(0)
  })

  it("a Lifeline support's heals and shields are stronger", () => {
    const burst = getTemplate('support-healing-burst')
    const healed = (mods: TraitMods) => {
      const d = duel(mods)
      d.me.hp = 1
      applyEffect(d.ctx, d.me, burst, 'active1', burst.effects[0], [d.me], { at: d.me.position, radius: 6 })
      return d.me.hp - 1
    }
    expect(healed({ healPower: 0.5 }) / healed({})).toBeCloseTo(1.5, 5)
    const barrier = getTemplate('support-barrier')
    const shielded = (mods: TraitMods) => {
      const d = duel(mods)
      applyEffect(d.ctx, d.me, barrier, 'active1', barrier.effects[0], [d.foe])
      return d.arena.match.heroes.reduce((s, h) => s + h.shield, 0)
    }
    expect(shielded({ healPower: 0.5 }) / shielded({})).toBeCloseTo(1.5, 5)
  })

  it("a Lockdown controller's stuns last longer", () => {
    const bolt = getTemplate('controller-stasis-bolt')
    const stun = bolt.effects.find((e) => e.kind === 'stun')!
    const held = (mods: TraitMods) => {
      const d = duel(mods, 'controller')
      applyEffect(d.ctx, d.me, bolt, 'active1', stun, [d.foe])
      return d.foe.stunnedUntil - d.arena.match.tick
    }
    expect(held({})).toBe(ticks(1.2))
    expect(held({ controlPower: 0.5 })).toBe(ticks(1.8))
  })

  it('Ambush hits the wounded harder, and only the wounded', () => {
    const hit = (mods: TraitMods, health: number) => {
      const d = duel(mods, 'assassin')
      d.foe.hp = d.foe.maxHp * health
      const before = d.foe.hp
      dealDamage(d.ctx, d.me, d.foe, 100, 'physical', 'active1')
      return before - d.foe.hp
    }
    expect(hit({ lowHpBonus: 0.5 }, 0.4) / hit({}, 0.4)).toBeCloseTo(1.5, 5)
    expect(hit({ lowHpBonus: 0.5 }, 0.9) / hit({}, 0.9)).toBeCloseTo(1, 5)
  })

  it("a Legion summoner's zones, traps and turrets run on a stronger copy of its kit", () => {
    const plain = duel({}, 'summoner').arena.setups[0]
    const legion = duel({ constructPower: 1 }, 'summoner').arena.setups[0]
    expect(plain.constructKit).toBeUndefined()
    const damage = (kit: typeof plain.kit) => Object.values(kit).flatMap((t) => t.effects).reduce((s, e) => s + ('amount' in e && (e.kind === 'damage' || e.kind === 'turret') ? e.amount : 0), 0)
    expect(damage(legion.constructKit!)).toBeCloseTo(damage(legion.kit) * 2, 0)
  })
})
