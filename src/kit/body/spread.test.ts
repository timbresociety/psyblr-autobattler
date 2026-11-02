import { describe, expect, it } from 'vitest'
import { readBody } from './node.js'
import { presetDials, type ArchetypeId } from './physique.js'
import { bodyBase, shapeBody } from './shape.js'
import { bodySpread, extraSpread, hangShare, SPREAD_MAX, SPREAD_REF, type Spread } from './spread.js'

const DEG = Math.PI / 180

async function measure(file: string, gender: 'm' | 'f', preset?: ArchetypeId): Promise<Spread> {
  const body = await readBody(new URL(`../../../public/heroes/v2/${file}.glb`, import.meta.url))
  const skeleton = { bones: body.bones, rest: body.rest }
  const shape = shapeBody(bodyBase(body), [], { weight: 0.5, muscle: 0.5, age: 0, ...(preset ? presetDials(preset) : {}) }, undefined, { skeleton, gender })
  return bodySpread(shape, skeleton)
}

describe('arm and leg spread by girth (§9.6 fix-ups)', () => {
  it('leaves the bodies the clips are made on as they are', async () => {
    for (const g of ['m', 'f'] as const) {
      const s = await measure(`${g}-medium`, g)
      expect(Math.abs(s.arm - SPREAD_REF[g].arm), g).toBeLessThan(0.5 * DEG)
      expect(extraSpread(s, g).arm, g).toBeLessThan(0.5 * DEG)
      expect(extraSpread(s, g).leg, g).toBe(0)
    }
  })

  it('spreads bulkier bodies more, and never past the cap', async () => {
    const athletic = extraSpread(await measure('m-medium', 'm', 'athletic'), 'm')
    const bodybuilder = extraSpread(await measure('m-huge', 'm', 'bodybuilder'), 'm')
    const heavy = extraSpread(await measure('m-huge', 'm', 'heavyweight'), 'm')
    expect(bodybuilder.arm).toBeGreaterThan(athletic.arm + 2 * DEG)
    expect(heavy.arm).toBeGreaterThan(6 * DEG)
    expect(heavy.leg).toBeGreaterThan(2 * DEG)
    for (const s of [athletic, bodybuilder, heavy]) {
      expect(s.arm).toBeLessThanOrEqual(SPREAD_MAX.arm)
      expect(s.leg).toBeLessThanOrEqual(SPREAD_MAX.leg)
    }
  }, 60000)

  it('applies to a hanging limb only', () => {
    expect(hangShare(1)).toBeCloseTo(1, 9)
    expect(hangShare(0.25)).toBe(0)
    expect(hangShare(-1)).toBe(0)
    for (let d = -1; d < 1; d += 0.05) expect(hangShare(d + 0.05)).toBeGreaterThanOrEqual(hangShare(d))
  })
})
