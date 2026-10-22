import { describe, expect, it } from 'vitest'
import { armyModifiers } from '../../charter/synergy'
import { referenceArmy } from '../../sim/field'
import { aiCommands } from '../ai/brain'
import { LIVE_PROFILE, createMatch, matchRules } from '../engine/match'
import { hashState } from '../engine/snapshot'
import { tick } from '../engine/tick'
import { CosmeticPhysics, PHYSICS } from './physics'

async function play(withPhysics: boolean, seconds: number) {
  const arena = createMatch(armyModifiers(referenceArmy()), armyModifiers(referenceArmy()), 21, { profile: LIVE_PROFILE })
  const physics = withPhysics ? await CosmeticPhysics.create() : undefined
  const rules = matchRules(arena)
  let maxBodies = 0
  for (let i = 0; i < seconds * 60 && arena.match.winner === undefined; i++) {
    const events = tick(arena.match, arena.setups, aiCommands(arena), rules)
    physics?.events(events, arena.match)
    physics?.step(1 / 60)
    maxBodies = Math.max(maxBodies, physics?.activeBodies() ?? 0)
  }
  return { arena, physics, maxBodies }
}

describe('cosmetic physics (U15)', () => {
  it('a match plays out exactly the same with physics on and off', async () => {
    const on = await play(true, 40)
    const off = await play(false, 40)
    expect(hashState(on.arena.match)).toBe(hashState(off.arena.match))
  }, 120_000)

  it('keeps awake bodies under the cap through a 10v10 with many deaths', async () => {
    const { maxBodies, arena } = await play(true, 60)
    expect(arena.match.heroes.filter((h) => !h.alive).length).toBeGreaterThan(3)
    expect(maxBodies).toBeLessThanOrEqual(PHYSICS.maxBodies)
  }, 120_000)

  it('blends a knocked-back hero upright within a few frames after it lands', async () => {
    const p = await CosmeticPhysics.create()
    const arena = createMatch(armyModifiers(referenceArmy()), armyModifiers(referenceArmy()), 3)
    const hero = arena.match.heroes[0]
    hero.knockback = { step: { x: 0.1, y: 0.02, z: 0 }, until: 10 }
    p.events([{ type: 'knockback', hero: 0, phase: 'start' }], arena.match)
    for (let i = 0; i < 10; i++) p.step(1 / 60)
    expect(p.rotation(0)).toBeDefined()
    p.events([{ type: 'knockback', hero: 0, phase: 'end' }], arena.match)
    for (let i = 0; i < Math.ceil(PHYSICS.blendBack * 60) + 2; i++) p.step(1 / 60)
    expect(p.rotation(0)).toBeUndefined()
  })

  it("a fallen hero's body comes to rest and sleeps", async () => {
    const p = await CosmeticPhysics.create()
    const arena = createMatch(armyModifiers(referenceArmy()), armyModifiers(referenceArmy()), 4)
    p.events([{ type: 'death', hero: 2 }], arena.match)
    for (let i = 0; i < 60 * 6; i++) p.step(1 / 60)
    const pose = p.fallenPose(2)!
    expect(pose.sleeping).toBe(true)
    expect(pose.position.y).toBeLessThan(0.5)
  })

  it('a rematch builds a fresh world after the last one is freed', async () => {
    const first = (await play(true, 20)).physics!
    first.dispose()
    expect(first.debrisPoses()).toEqual([])
    const second = await play(true, 20)
    expect(second.physics!.broken).toBe(false)
  }, 120_000)
})
