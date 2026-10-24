import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { pillow, svgTransform } from './chrome'

const square = (c: number, r: number) => [new THREE.Vector2(c - r, c - r), new THREE.Vector2(c + r, c - r), new THREE.Vector2(c + r, c + r), new THREE.Vector2(c - r, c + r)]

describe('the chrome marks', () => {
  it('reads SVG transforms in order', () => {
    const [a, b, c, d, e, f] = svgTransform('translate(10 5) scale(2)')
    expect([a, b, c, d, e, f]).toEqual([2, 0, 0, 2, 10, 5])
    const r = svgTransform('rotate(90)')
    expect(r[0]).toBeCloseTo(0)
    expect(r[1]).toBeCloseTo(1)
  })

  it('inflates an outline into a closed pillow that keeps its holes open', () => {
    const geo = pillow([square(0, 1), square(0, 0.4)], 0.05, 0.08, 0.3)!
    const pos = geo.getAttribute('position')
    const index = geo.getIndex()!.array
    let front = 0
    for (let t = 0; t < index.length; t += 3) {
      const p = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, index[t + k]))
      const c = p[0].clone().add(p[1]).add(p[2]).divideScalar(3)
      // nothing is drawn inside the hole
      expect(Math.max(Math.abs(c.x), Math.abs(c.y))).toBeGreaterThan(0.39)
      const n = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]))
      if (c.z > 0.01) {
        front++
        expect(n.z).toBeGreaterThan(0)
      }
    }
    expect(front).toBeGreaterThan(20)
    // lifted on both sides, flat at the rim
    geo.computeBoundingBox()
    expect(geo.boundingBox!.max.z).toBeGreaterThan(0.1)
    expect(geo.boundingBox!.min.z).toBeCloseTo(-geo.boundingBox!.max.z, 5)
  })
})
