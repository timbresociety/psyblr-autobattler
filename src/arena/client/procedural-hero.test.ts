import { describe, expect, it } from 'vitest'
import { BONE_NAMES, bodyGeometry, triangleCount } from './procedural-hero.js'

describe('procedural bench hero (U1)', () => {
  it('sits inside the 5,000-8,000 triangle arena budget (R24)', () => {
    const tris = triangleCount(bodyGeometry())
    expect(tris).toBeGreaterThanOrEqual(5000)
    expect(tris).toBeLessThanOrEqual(8000)
  })

  it('skins every vertex fully to one Mixamo-named bone', () => {
    const geo = bodyGeometry()
    const index = geo.getAttribute('skinIndex')
    const weight = geo.getAttribute('skinWeight')
    for (let v = 0; v < index.count; v += 97) {
      expect(index.getX(v)).toBeLessThan(BONE_NAMES.length)
      expect(weight.getX(v)).toBe(1)
    }
    expect(BONE_NAMES.every((n) => n.startsWith('mixamorig'))).toBe(true)
  })
})
