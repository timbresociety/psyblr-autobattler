import { describe, expect, it } from 'vitest'
import { armyModifiers } from '../../charter/synergy.js'
import { referenceArmy } from '../../sim/field.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { aiCommands } from '../ai/brain.js'
import { ENGINE } from './calibration.js'
import { RUINS, coverHit, initialCoverHealth, pushOut, type CoverPiece } from './cover.js'
import { COMBAT_RULES, canSee } from './deliveries.js'
import type { MatchEvent } from './events.js'
import { LIVE_PROFILE, createMatch, matchRules } from './match.js'
import { hashState } from './snapshot.js'
import { IDLE, slotBit } from './state.js'
import { tick } from './tick.js'

const wall: CoverPiece = { shape: { kind: 'block', x: 0, z: 0, hx: 2, hz: 0.5 }, base: 0, top: 3, look: 'wall' }
const column: CoverPiece = { shape: { kind: 'column', x: 5, z: 0, r: 1 }, base: 0, top: 6, look: 'column' }
const lintel: CoverPiece = { shape: { kind: 'block', x: -6, z: 0, hx: 2, hz: 0.5 }, base: 5, top: 6, look: 'lintel' }
const pieces = [wall, column, lintel]
const health = initialCoverHealth(pieces)

describe('cover geometry (R25)', () => {
  it('a line through a wall is blocked where it enters, and a line over it is clear', () => {
    const hit = coverHit(pieces, health, { x: 0, y: 1, z: -4 }, { x: 0, y: 1, z: 4 })
    expect(hit?.index).toBe(0)
    expect(hit?.t).toBeCloseTo(3.5 / 8)
    expect(coverHit(pieces, health, { x: 0, y: 3.5, z: -4 }, { x: 0, y: 3.5, z: 4 })).toBeUndefined()
  })

  it('a column blocks by its round footprint; a lintel blocks only above the heads that walk under it', () => {
    expect(coverHit(pieces, health, { x: 5.9, y: 1, z: -3 }, { x: 5.9, y: 1, z: 3 })?.index).toBe(1)
    expect(coverHit(pieces, health, { x: 6.1, y: 1, z: -3 }, { x: 6.1, y: 1, z: 3 })).toBeUndefined()
    expect(coverHit(pieces, health, { x: -6, y: 1, z: -3 }, { x: -6, y: 1, z: 3 })).toBeUndefined()
    expect(coverHit(pieces, health, { x: -6, y: 5.5, z: -3 }, { x: -6, y: 5.5, z: 3 })?.index).toBe(2)
  })

  it('a broken piece blocks nothing', () => {
    const gone = [0, -1, -1]
    expect(coverHit(pieces, gone, { x: 0, y: 1, z: -4 }, { x: 0, y: 1, z: 4 })).toBeUndefined()
  })

  it('a body walking into a wall slides out to its face, and one flying over it is left alone', () => {
    const p = { x: 0.5, y: 0, z: -0.6 }
    expect(pushOut(pieces, health, p, 0.4, 1.8)).toBe(true)
    expect(p.z).toBeCloseTo(-0.9)
    expect(p.x).toBeCloseTo(0.5)
    const high = { x: 0.5, y: 3.2, z: 0 }
    expect(pushOut(pieces, health, high, 0.4, 1.8)).toBe(false)
  })
})

describe('the ruins in a match (R25)', () => {
  it('every piece sits inside the arena, and no default spawn starts inside one', () => {
    const { halfWidth, halfLength } = ENGINE.arena
    for (const p of RUINS) {
      const s = p.shape
      const ex = s.kind === 'block' ? s.hx : s.r
      const ez = s.kind === 'block' ? s.hz : s.r
      expect(Math.abs(s.x) + ex).toBeLessThanOrEqual(halfWidth)
      expect(Math.abs(s.z) + ez).toBeLessThanOrEqual(halfLength)
    }
    const a = createMatch(armyModifiers(referenceArmy()), armyModifiers(referenceArmy()), 1)
    for (const h of a.match.heroes) expect(pushOut(RUINS, a.match.cover!.health, { ...h.position }, 0.4, 1.8)).toBe(false)
  })

  it('the two halves mirror each other within a few metres, like Dire and Radiant', () => {
    const near = RUINS.filter((p) => p.shape.z < -0.5)
    const far = RUINS.filter((p) => p.shape.z > 0.5)
    expect(near.length).toBe(far.length)
    // the far half mirrors across the centre line or through the centre point, give or take a nudge
    for (const p of near) expect(far.some((q) => q.look === p.look && Math.min(Math.abs(q.shape.x - p.shape.x), Math.abs(q.shape.x + p.shape.x)) <= 2 && Math.abs(q.shape.z + p.shape.z) <= 2)).toBe(true)
  })

  it('a shot into a barricade wears it down and breaks it; then shots pass where it stood', () => {
    const marksman = defaultBuild('marksman')
    const a = createMatch([{ build: marksman }], [{ build: defaultBuild('tank') }], 3, { profile: LIVE_PROFILE, formations: [[{ x: 0, y: 0, z: -12 }], [{ x: 0, y: 0, z: 12 }]] })
    const index = a.match.cover!.pieces.findIndex((p) => p.look === 'barricade' && p.shape.x === 0 && p.shape.z < 0)
    expect(index).toBeGreaterThanOrEqual(0)
    const shooter = a.match.heroes[0]
    const target = a.match.heroes[1]
    target.position = { x: 0, y: 0, z: -3 }
    expect(canSee(a.match, { x: 0, y: 1.08, z: -12 }, { x: 0, y: 1.08, z: -3 })).toBe(false)
    const events: MatchEvent[] = []
    // fire the basic attack straight at the barricade until it breaks
    for (let t = 0; t < 60 * 60 && a.match.cover!.health[index] > 0; t++) {
      shooter.position = { x: 0, y: 0, z: -12 }
      target.hp = target.maxHp
      events.push(...tick(a.match, a.setups, [{ ...IDLE, buttons: slotBit('basic') }, IDLE], COMBAT_RULES))
    }
    expect(a.match.cover!.health[index]).toBe(0)
    expect(events.some((e) => e.type === 'cover-broken' && e.index === index)).toBe(true)
    expect(events.filter((e) => e.type === 'hit' && e.target === 1)).toHaveLength(0)
    expect(canSee(a.match, { x: 0, y: 1.08, z: -12 }, { x: 0, y: 1.08, z: -3 })).toBe(true)
  })

  it('a 10v10 in the ruins replays exactly from the same seed, barriers included', () => {
    const run = () => {
      const a = createMatch(armyModifiers(referenceArmy()), armyModifiers(referenceArmy()), 9, { profile: LIVE_PROFILE })
      const rules = matchRules(a)
      for (let i = 0; i < 60 * 40; i++) tick(a.match, a.setups, aiCommands(a), rules)
      return hashState(a.match)
    }
    expect(run()).toBe(run())
  }, 60_000)
})

describe('bodies pressed against cover (review)', () => {
  it('a thick sweep starting flat against a wall is free to move away, but still stops going into it', () => {
    // a body of radius 0.4 pushed out to the wall's face at z = -0.9
    const p = { x: 0, y: 1, z: -0.9 }
    expect(coverHit(pieces, health, p, { x: 0, y: 1, z: -5 }, 0.4)).toBeUndefined()
    expect(coverHit(pieces, health, p, { x: 3, y: 1, z: -0.9 }, 0.4)).toBeUndefined()
    const into = coverHit(pieces, health, p, { x: 0, y: 1, z: 2 }, 0.4)
    expect(into?.index).toBe(0)
    expect(into?.t).toBeCloseTo(0.4 / 2.9)
  })
})
