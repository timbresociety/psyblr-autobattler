import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { facingField, whiskerStrokes } from './composite.js'
import type { FaceMeta } from './patch.js'

const meta = JSON.parse(readFileSync(new URL('../../../../public/heroes/m-medium.kit.json', import.meta.url), 'utf8')) as FaceMeta

describe("a form's whisker marks", () => {
  it('draws three strokes on each cheek, out from beside the nose toward the ear, the two sides alike', () => {
    const strokes = whiskerStrokes(meta.landmarks)
    expect(strokes).toHaveLength(6)
    const mid = meta.landmarks[1]![0]
    for (const s of strokes) expect(Math.abs(s.to[0] - mid)).toBeGreaterThan(Math.abs(s.from[0] - mid) + 50)
    expect(strokes.slice(0, 3).every((s) => s.from[0] < mid)).toBe(true)
    expect(strokes.slice(3).every((s) => s.from[0] > mid)).toBe(true)
    expect(Math.abs(strokes[1].from[1] - strokes[4].from[1])).toBeLessThan(10)
    // fanned: the strokes spread wider at the ear than by the nose
    const gap = (a: [number, number], b: [number, number]) => Math.abs(a[1] - b[1])
    expect(gap(strokes[0].to, strokes[2].to)).toBeGreaterThan(gap(strokes[0].from, strokes[2].from))
  })

  it('leaves out a cheek whose landmarks are missing', () => {
    const some = meta.landmarks.map((p, i) => (i === 352 ? undefined : p))
    expect(whiskerStrokes(some as FaceMeta['landmarks'])).toHaveLength(3)
  })
})

describe('how squarely a face patch faces the camera', () => {
  // a 1 m frame centred on the origin, 10 pixels across: a skin square facing the camera on the left half, a skin
  // triangle turned away over the right half and part of the square, but behind it; and an eye triangle (not skin)
  const frame = { cx: 0, cz: 0, size: 1, res: 10 }
  const geo = new THREE.BufferGeometry()
  const square = [-0.5, -0.5, 0, 0, -0.5, 0, 0, 0.5, 0, -0.5, -0.5, 0, 0, 0.5, 0, -0.5, 0.5, 0]
  const turned = [-0.2, -0.5, -0.1, 0.5, -0.5, -0.1, 0.5, 0.5, -0.1]
  const eye = [0.1, 0.1, 0.2, 0.4, 0.1, 0.2, 0.4, 0.4, 0.2]
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...square, ...turned, ...eye], 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([...Array(6).fill([0, 0, 1]).flat(), ...Array(3).fill([0.95, 0, 0.3]).flat(), ...Array(3).fill([0, 0, 1]).flat()], 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([...Array(9).fill([0, 0]).flat(), ...Array(3).fill([1, 0]).flat()], 2))
  const field = facingField(geo, frame, 10)
  const at = (x: number, y: number) => field[y * 10 + x]

  it('reads each pixel off the nearest skin facing it, and nothing where no skin is', () => {
    expect(at(2, 5)).toBeCloseTo(1)
    // over the square, the turned triangle behind it doesn't count; past the square's edge it does
    expect(at(4, 8)).toBeCloseTo(1)
    expect(at(6, 8)).toBeCloseTo(0.3)
    // the eye isn't skin, so the turned skin behind it shows through
    expect(at(8, 3)).toBeCloseTo(0.3)
    // above the turned triangle's diagonal, nothing
    expect(at(6, 1)).toBe(0)
  })
})
