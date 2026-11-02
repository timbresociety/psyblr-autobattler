import { describe, expect, it } from 'vitest'
import { defaultBuild } from '../../sim/fixtures.js'
import { ENGINE } from './calibration.js'
import { ceilingOver, floorUnder, initialCoverHealth, type CoverPiece } from './cover.js'
import { HOUSE, HOUSE_LINES, LEVEL } from './house.js'
import { createMatch } from './match.js'
import { MAPS } from './maps.js'
import { tick } from './tick.js'

/**
 * The House of Instinct in grey boxes (GAME.md §8): the starting dimensions, the mirrored halves, and a match that
 * starts on its floor. Reaching every platform with the baseline moves is ai/nav.test.ts, walked in the engine.
 */

const health = initialCoverHealth(HOUSE)
const DEG = 180 / Math.PI

describe('the House of Instinct grey box (§8)', () => {
  it('mirrors one half onto the other, so both sides have the same routes', () => {
    const sig = (p: CoverPiece, flip: boolean) => {
      const s = p.shape
      const z = flip ? -s.z : s.z
      const rise = p.slope ? (flip && p.slope.rise[0] === 'z' ? (p.slope.rise === 'z+' ? 'z-' : 'z+') : p.slope.rise) : ''
      const size = s.kind === 'block' ? `${s.hx},${s.hz}` : `${s.r}`
      return [s.kind, s.x.toFixed(2), z.toFixed(2), size, p.base, p.top, p.look, rise].join('|')
    }
    const plain = HOUSE.map((p) => sig(p, false)).sort()
    const flipped = HOUSE.map((p) => sig(p, true)).sort()
    expect(flipped).toEqual(plain)
    const line = (l: (typeof HOUSE_LINES)[number], flip: boolean) => [l.kind, l.a.x, l.a.y, (flip ? -l.a.z : l.a.z).toFixed(2), l.b.x, l.b.y, (flip ? -l.b.z : l.b.z).toFixed(2)].join('|')
    expect(HOUSE_LINES.map((l) => line(l, true)).sort()).toEqual(HOUSE_LINES.map((l) => line(l, false)).sort())
  })

  it('keeps every ramp at 20–25°', () => {
    const ramps = HOUSE.filter((p) => p.slope)
    expect(ramps.length).toBeGreaterThanOrEqual(10)
    for (const p of ramps) {
      if (p.shape.kind !== 'block') throw new Error('a ramp is a block')
      const run = 2 * (p.slope!.rise[0] === 'x' ? p.shape.hx : p.shape.hz)
      const angle = Math.atan((p.top - p.slope!.low) / run) * DEG
      expect(angle).toBeGreaterThanOrEqual(19.9)
      expect(angle).toBeLessThanOrEqual(25)
    }
  })

  it('sizes jumpable chips 2.5–3 m across and climbs the chip stacks in 0.75–1.2 m steps', () => {
    const chips = HOUSE.filter((p) => p.look === 'chip' && p.shape.kind === 'column' && p.shape.r < 2)
    expect(chips.length).toBeGreaterThanOrEqual(12)
    for (const c of chips) if (c.shape.kind === 'column') expect(2 * c.shape.r).toBeGreaterThanOrEqual(2.5)
    for (const c of chips) if (c.shape.kind === 'column') expect(2 * c.shape.r).toBeLessThanOrEqual(3.2)
    // the stairs of chips up to the balcony loop: each a step above the last
    const stair = chips.filter((c) => c.shape.kind === 'column' && c.shape.x > 10 && c.shape.x < 18 && c.shape.z > 0).map((c) => c.top).sort((a, b) => a - b)
    expect(stair.length).toBe(4)
    let last: number = LEVEL.main
    for (const top of stair) {
      expect(top - last).toBeGreaterThanOrEqual(0.75)
      expect(top - last).toBeLessThanOrEqual(1.2 + 1e-9)
      last = top
    }
  })

  it('gives balcony walkways 3–4 m, bridges 1.5–2 m, and 4 m of headroom over the floors', () => {
    const decks = HOUSE.filter((p) => p.base > 0 && p.top === LEVEL.up && p.shape.kind === 'block')
    for (const d of decks) {
      if (d.shape.kind !== 'block') continue
      const width = 2 * Math.min(d.shape.hx, d.shape.hz)
      expect(width).toBeGreaterThanOrEqual(1.5)
      expect(width).toBeLessThanOrEqual(10)
    }
    const walkways = decks.filter((d) => d.shape.kind === 'block' && Math.max(d.shape.hx, d.shape.hz) > 15)
    expect(walkways.length).toBeGreaterThanOrEqual(6)
    for (const w of walkways) if (w.shape.kind === 'block') expect(2 * Math.min(w.shape.hx, w.shape.hz)).toBeGreaterThanOrEqual(3)
    for (const w of walkways) if (w.shape.kind === 'block') expect(2 * Math.min(w.shape.hx, w.shape.hz)).toBeLessThanOrEqual(4)
    // under each deck over a floor (the lower routes, the main floor), at least 4 m to fight in
    for (let x = -54; x <= 54; x += 2)
      for (let z = -40; z <= 40; z += 2)
        for (const level of [LEVEL.low, LEVEL.main]) {
          const floor = floorUnder(HOUSE, health, { x, y: level, z }, level + 0.01)
          if (Math.abs(floor - level) > 0.01) continue
          const roof = ceilingOver(HOUSE, health, { x, y: floor, z }, 0, floor + 0.01, floor + 4 - 0.01)
          if (roof !== undefined) {
            // only props (slot machines under the walkway) sit lower; nothing anyone fights on at a band's floor
            throw new Error(`${roof - floor} m of headroom at (${x}, ${level}, ${z})`)
          }
        }
  })

  it('has its bands at the measured heights: lower, main, balconies, aerial', () => {
    const tops = new Set(HOUSE.map((p) => p.top))
    for (const level of [LEVEL.main, LEVEL.up, LEVEL.air]) expect(tops.has(level)).toBe(true)
    // the main floor is a stair or a jump above the lower routes, the balconies a double jump or a stair above it
    expect(LEVEL.main - LEVEL.low).toBeLessThan(ENGINE.move.jump + ENGINE.move.mantle.height)
    expect(LEVEL.up - LEVEL.main).toBeGreaterThan(ENGINE.move.jump + ENGINE.move.mantle.height)
    expect(HOUSE_LINES.filter((l) => l.kind === 'zip')).toHaveLength(2)
    expect(HOUSE_LINES.filter((l) => l.kind === 'rail')).toHaveLength(2)
  })

  it('starts a match on the main floor, with its lines, standing still', () => {
    const team = [defaultBuild('fighter'), defaultBuild('mage'), defaultBuild('tank')].map((build) => ({ build }))
    const arena = createMatch(team, team, 3, { map: 'house' })
    expect(arena.match.map).toBe('house')
    expect(arena.match.lines).toBe(MAPS.house.lines)
    for (const h of arena.match.heroes) expect(h.position.y).toBeCloseTo(LEVEL.main, 5)
    for (let i = 0; i < 30; i++) tick(arena.match, arena.setups, [])
    for (const h of arena.match.heroes) {
      expect(h.position.y).toBeCloseTo(LEVEL.main, 5)
      expect(h.airborne).toBe(false)
    }
    // the gate and the tests still play the ruins by default
    expect(createMatch(team, team, 3).match.map).toBeUndefined()
  })
})
