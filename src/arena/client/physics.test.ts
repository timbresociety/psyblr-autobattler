import { describe, expect, it } from 'vitest'
import { armyModifiers } from '../../charter/traits.js'
import { referenceArmy } from '../../sim/field.js'
import { aiCommands } from '../ai/brain.js'
import { LIVE_PROFILE, createMatch, matchRules } from '../engine/match.js'
import { hashState } from '../engine/snapshot.js'
import { tick } from '../engine/tick.js'
import { LEVEL } from '../engine/house.js'
import { CosmeticPhysics, PHYSICS } from './physics.js'

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

  it('on the house a fallen body lies on the floor it fell on, and falls through a card bridge the engine broke', async () => {
    const arena = createMatch(armyModifiers(referenceArmy()), armyModifiers(referenceArmy()), 4, { map: 'house' })
    const pieces = arena.match.cover!.pieces
    const p = await CosmeticPhysics.create(pieces)
    p.events([{ type: 'death', hero: 2 }], arena.match)
    // one more falls on a card bridge over a trench, and the bridge goes
    const bridge = pieces.findIndex((q) => q.look === 'card')
    const s = pieces[bridge].shape
    arena.match.heroes[3].position = { x: s.x, y: LEVEL.main, z: s.z }
    p.events([{ type: 'death', hero: 3 }], arena.match)
    for (let i = 0; i < 30; i++) p.step(1 / 60)
    p.events([{ type: 'cover-broken', index: bridge, at: { x: s.x, y: LEVEL.main, z: s.z } }], arena.match)
    for (let i = 0; i < 60 * 6; i++) p.step(1 / 60)
    // a body lying down reads 0.6 under its floor (the pose is its feet as if standing), as on the open floor
    expect(p.fallenPose(2)!.position.y).toBeGreaterThan(LEVEL.main - 1)
    expect(p.fallenPose(2)!.position.y).toBeLessThan(LEVEL.main + 0.5)
    expect(p.fallenPose(3)!.position.y).toBeLessThan(0.5)
  })

  it('a rematch builds a fresh world after the last one is freed', async () => {
    const first = (await play(true, 20)).physics!
    first.dispose()
    expect(first.fallenPose(0)).toBeUndefined()
    const second = await play(true, 20)
    expect(second.physics!.broken).toBe(false)
  }, 120_000)

  it('a Rapier failure turns physics off for the rest of the match instead of throwing', async () => {
    const p = await CosmeticPhysics.create()
    const arena = createMatch(armyModifiers(referenceArmy()), armyModifiers(referenceArmy()), 5)
    p.events([{ type: 'death', hero: 1 }], arena.match)
    ;(p as unknown as { world: { step: () => void } }).world.step = () => {
      throw new Error('unreachable')
    }
    expect(() => p.step(1 / 60)).not.toThrow()
    expect(p.broken).toBe(true)
    expect(p.fallenPose(1)).toBeUndefined()
    expect(p.rotation(1)).toBeUndefined()
    expect(() => p.events([{ type: 'death', hero: 2 }], arena.match)).not.toThrow()
    expect(() => p.step(1 / 60)).not.toThrow()
  })
})
