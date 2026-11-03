import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HOUSE } from '../../engine/house.js'
import { initialCoverHealth } from '../../engine/cover.js'
import { LEVEL } from '../../engine/house.js'
import { ANCHOR, contactPoint, groundUnder } from './anchors.js'

describe('effects land where they happen (GAME.md §6)', () => {
  it('no effect is anchored on the torso by default', () => {
    expect(ANCHOR).toEqual({ 'cast flash': 'hand', projectile: 'muzzle', impact: 'contact', 'melee spark': 'tip', zone: 'ground', aura: 'body' })
  })

  it('a hit lands on the near side of the body, at the height it came in', () => {
    const body = { feet: { x: 0, y: 4.5, z: 0 }, radius: 0.4, height: 1.8 }
    const side = contactPoint(body, { x: 10, y: 5.5, z: 0 })
    expect(side.x).toBeCloseTo(0.4)
    expect(side.y).toBeCloseTo(5.5)
    expect(side.z).toBeCloseTo(0)
    // from far above it lands on the crown; from below, on the shins
    expect(contactPoint(body, { x: 0, y: 20, z: 0 }).y).toBeCloseTo(4.5 + 1.8)
    expect(contactPoint(body, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(4.5)
  })

  it('a ground effect lies on the floor under it, not at y 0: the house stands on a raised floor', () => {
    const match = { cover: { pieces: HOUSE, health: initialCoverHealth(HOUSE) } }
    expect(groundUnder(match, { x: 20, y: LEVEL.main + 1.2, z: -10 })).toBeCloseTo(LEVEL.main)
    // a hand over the balcony loop: the walkway's top
    expect(groundUnder(match, { x: 0, y: LEVEL.up + 1.2, z: 21 })).toBeCloseTo(LEVEL.up)
    // down in a trench
    expect(groundUnder(match, { x: -43, y: 1, z: 14 })).toBeCloseTo(0)
    expect(groundUnder({}, { x: 0, y: 3, z: 0 })).toBe(0)
  })

  it('the effect player and the skill drawer keep no floor at a fixed height', () => {
    // a fixed y for a ground effect (rings, cracks, dust, discs) hides it under the house's 4.5 m floor
    for (const file of ['player.ts', 'draw.ts', 'world-fx.ts']) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      expect(src.match(/position\.set\([\w.[\]]+\.x, [0-9.]+, [\w.[\]]+\.z\)/g) ?? [], file).toEqual([])
      expect(src.match(/\{ x: [\w.]+\.x, y: [0-9.]+, z: [\w.]+\.z \}/g) ?? [], file).toEqual([])
    }
  })
})
