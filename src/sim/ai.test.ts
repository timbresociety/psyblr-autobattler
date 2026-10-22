import { describe, expect, it } from 'vitest'
import { createBattle, step } from './engine'
import { defaultBuild } from './fixtures'
import { getTemplate } from '../charter/templates/catalog'
import type { Build } from '../charter/build'

function withSlot(build: Build, slot: keyof Build['slots'], templateId: string): Build {
  return { ...build, slots: { ...build.slots, [slot]: { ...build.slots[slot], templateId } } }
}

describe('battle AI and effects', () => {
  it('a stun stops the target acting for exactly its duration', () => {
    const battle = createBattle([{ build: defaultBuild('tank') }], [{ build: defaultBuild('mage') }], 1)
    const target = battle.units[1]
    target.stunnedUntil = battle.time + 1.5
    const snapshot = () => JSON.stringify([target.position, target.casts, target.nextAttackAt])
    const before = snapshot()
    let actedAt = -1
    for (let i = 0; i < 30; i++) {
      step(battle)
      if (actedAt < 0 && snapshot() !== before) actedAt = battle.time
    }
    expect(actedAt).toBeGreaterThanOrEqual(1.5)
    expect(actedAt).toBeLessThanOrEqual(1.7)
  })

  it('a "finisher" ultimate is used only below its target-health threshold', () => {
    const killer = withSlot(defaultBuild('assassin'), 'ultimate', 'assassin-thousand-cuts')
    const threshold = getTemplate('assassin-thousand-cuts').ai.targetHealthBelow as number
    const battle = createBattle([{ build: killer }], [{ build: defaultBuild('tank') }], 2)
    const [me, foe] = battle.units
    for (const slot of Object.keys(foe.cooldowns) as (keyof typeof foe.cooldowns)[]) foe.cooldowns[slot] = 99
    me.cooldowns.ultimate = 0
    me.position = { x: 0, y: 0 }
    foe.position = { x: 3, y: 0 }
    step(battle)
    expect(me.casts.ultimate ?? 0).toBe(0)
    foe.hp = foe.maxHp * (threshold - 0.1)
    step(battle)
    expect(me.casts.ultimate ?? 0).toBe(1)
  })

  it('a healer targets the lowest-health ally', () => {
    const healer = withSlot(defaultBuild('support'), 'active1', 'support-barrier')
    const battle = createBattle(
      [{ build: healer }, { build: defaultBuild('fighter', 'f1') }, { build: defaultBuild('fighter', 'f2') }],
      [{ build: defaultBuild('tank') }],
      3,
    )
    const [me, a, b] = battle.units
    me.cooldowns.active1 = 0
    me.cooldowns.active2 = 99
    a.hp = a.maxHp * 0.9
    b.hp = b.maxHp * 0.3
    for (const u of [me, a, b]) u.position = { x: 0, y: 0 }
    step(battle)
    expect(b.shield).toBeGreaterThan(0)
    expect(a.shield).toBe(0)
  })

  it('passive lowHealth fires once when health first drops below the line', () => {
    const tank = withSlot(defaultBuild('tank'), 'passive', 'tank-last-stand')
    const battle = createBattle([{ build: tank }], [{ build: defaultBuild('mage') }], 4)
    const me = battle.units[0]
    me.hp = me.maxHp * 0.3
    step(battle)
    step(battle)
    expect(me.lowHealthFired).toBe(true)
  })
})
