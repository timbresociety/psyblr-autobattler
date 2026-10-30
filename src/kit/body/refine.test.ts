import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { refineGeometry } from './refine'

/** A coarse unit sphere, welded, with its normals, every point on two bones, and texture coordinates. */
function coarseSphere() {
  const soup = new THREE.IcosahedronGeometry(1, 1).getAttribute('position')
  const seen = new Map<string, number>()
  const points: number[] = []
  const index: number[] = []
  for (let i = 0; i < soup.count; i++) {
    const p = [soup.getX(i), soup.getY(i), soup.getZ(i)]
    const key = p.map((v) => v.toFixed(5)).join()
    if (!seen.has(key)) {
      seen.set(key, points.length / 3)
      points.push(...p)
    }
    index.push(seen.get(key)!)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const n = points.length / 3
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: n * 2 }, (_, i) => (i % 2 ? 0.25 : 0.75)), 2))
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({ length: n * 4 }, (_, i) => [3, 5, 0, 0][i % 4]), 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => [0.75, 0.25, 0, 0][i % 4]), 4))
  geo.addGroup(0, index.length, 0)
  return geo
}

const radii = (geo: THREE.BufferGeometry, from = 0) => {
  const p = geo.getAttribute('position')
  return Array.from({ length: p.count - from }, (_, i) => Math.hypot(p.getX(from + i), p.getY(from + i), p.getZ(from + i)))
}

describe('refining a body', () => {
  it('splits every triangle in four, keeping its points where they were and its draw groups in order', () => {
    const geo = coarseSphere()
    const fine = refineGeometry(geo)
    expect(fine.getIndex()!.count).toBe(geo.getIndex()!.count * 4)
    const p = geo.getAttribute('position')
    const q = fine.getAttribute('position')
    for (let i = 0; i < p.count; i++) expect([q.getX(i), q.getY(i), q.getZ(i)]).toEqual([p.getX(i), p.getY(i), p.getZ(i)])
    expect(fine.groups).toEqual([{ start: 0, count: geo.getIndex()!.count * 4, materialIndex: 0 }])
  })

  it('puts each new point on the curve its ends’ normals describe, not on the flat edge between them', () => {
    const geo = coarseSphere()
    const n = geo.getAttribute('position').count
    // a flat midpoint of these edges sits about 4% inside the sphere; a bent one sits on it
    for (const r of radii(refineGeometry(geo), n)) expect(r).toBeGreaterThan(0.99)
    for (const r of radii(refineGeometry(geo, 2))) expect(Math.abs(r - 1)).toBeLessThan(0.006)
  })

  it('carries texture coordinates halfway and merges skin weights bone by bone', () => {
    const geo = coarseSphere()
    const n = geo.getAttribute('position').count
    const fine = refineGeometry(geo)
    const uv = fine.getAttribute('uv')
    expect([uv.getX(n), uv.getY(n)]).toEqual([0.75, 0.25])
    const joints = fine.getAttribute('skinIndex')
    const weights = fine.getAttribute('skinWeight')
    expect([joints.getX(n), joints.getY(n)]).toEqual([3, 5])
    expect(weights.getX(n)).toBeCloseTo(0.75)
    expect(weights.getY(n)).toBeCloseTo(0.25)
    expect(weights.getZ(n) + weights.getW(n)).toBe(0)
  })

  it('gives both copies of a seam the same new point, so nothing cracks open', () => {
    // two triangles sharing an edge through different copies of its ends, as a UV seam splits them
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.3], 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0.3, 0, 0.95, 0, 0.3, 0.95, 0.3, 0, 0.95, 0, 0.3, 0.95, 0.3, 0.3, 0.9], 3))
    geo.setIndex([0, 1, 2, 3, 5, 4])
    const fine = refineGeometry(geo)
    const p = fine.getAttribute('position')
    const idx = fine.getIndex()!
    // the first triangle's new point on edge 1-2 (its fifth corner), the second's on edge 4-3 (its third)
    const left = idx.getX(5)
    const right = idx.getX(12 + 2)
    expect(left).not.toBe(right)
    expect([p.getX(left), p.getY(left), p.getZ(left)]).toEqual([p.getX(right), p.getY(right), p.getZ(right)])
    expect(p.getZ(left)).not.toBe(0)
  })
})
