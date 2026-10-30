import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { facingField, tonePatch, whiskerStrokes, withinFaces } from './composite.js'
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

describe("a photo face's tone", () => {
  // a disc of photo, its skin darkening toward the rim the way a jaw does underneath, with a fine checker for detail
  const res = 128
  const skin: [number, number, number] = [0.6, 0.4, 0.3]
  const to: [number, number, number] = [0.8, 0.5, 0.36]
  const data = new Uint8ClampedArray(res * res * 4)
  const radius = 48
  for (let y = 0; y < res; y++)
    for (let x = 0; x < res; x++) {
      const r = Math.hypot(x + 0.5 - res / 2, y + 0.5 - res / 2)
      const shade = 1 - 0.4 * THREE.MathUtils.smoothstep(r, radius - 16, radius)
      const detail = (x + y) % 2 ? 1.06 : 0.94
      const i = (y * res + x) * 4
      for (let c = 0; c < 3; c++) data[i + c] = skin[c] * shade * detail * 255
      data[i + 3] = r < radius ? 255 : 0
    }
  const toned = tonePatch({ width: res, height: res, data }, skin, to)
  // a pair of neighbouring pixels: their mean is the colour, their difference the detail
  const at = (x: number, y: number) => [0, 1, 2].map((c) => (toned.data[(y * res + x) * 4 + c] + toned.data[(y * res + x + 1) * 4 + c]) / 2 / 255)
  const detail = (x: number, y: number) => Math.abs(toned.data[(y * res + x) * 4] - toned.data[(y * res + x + 1) * 4]) / 255

  it("brings the photo's own skin to the skin round it", () => {
    const mid = at(res / 2, res / 2)
    for (let c = 0; c < 3; c++) expect(mid[c]).toBeCloseTo(to[c], 1)
  })

  it('swaps the broad colour for the skin toward the edge, so a darker rim meets the skin with no line', () => {
    const y = res / 2
    const rim = at(res / 2 + radius - 3, y)
    // scaled alone the rim would be about a third darker than the skin there; now it lands within a tenth
    for (let c = 0; c < 3; c++) expect(Math.abs(rim[c] - to[c]) / to[c]).toBeLessThan(0.1)
  })

  it('keeps the fine detail all the way to the edge', () => {
    const y = res / 2
    expect(detail(res / 2 + radius - 3, y)).toBeGreaterThan(0.75 * detail(res / 2, y) * 0.65)
    expect(detail(res / 2, y)).toBeGreaterThan(0.05)
  })

  it('leaves the alpha alone, and the photo untouched when there is no skin to match', () => {
    for (let i = 3; i < data.length; i += 4 * 97) expect(toned.data[i]).toBe(data[i])
    const plain = tonePatch({ width: res, height: res, data }, skin, undefined)
    for (let i = 0; i < data.length; i += 4 * 89) expect(plain.data[i]).toBe(data[i])
  })
})

describe("the photo inside the face's triangles", () => {
  // an opaque patch, and two triangles covering its left half
  const res = 100
  const data = new Uint8ClampedArray(res * res * 4).fill(255)
  const out = withinFaces({ width: res, height: res, data }, [0, 0, 50, 0, 50, 100, 0, 0, 50, 100, 0, 100])
  const alpha = (x: number, y: number) => out.data[(y * res + x) * 4 + 3]

  it('is whole deep inside, gone by their outline and outside it, and fades smoothly between', () => {
    expect(alpha(15, 50)).toBe(255)
    expect(alpha(50, 50)).toBe(0)
    expect(alpha(49, 50)).toBeLessThan(20)
    expect(alpha(80, 50)).toBe(0)
    const run = Array.from({ length: 20 }, (_, k) => alpha(30 + k, 50))
    for (let k = 1; k < run.length; k++) expect(run[k]).toBeLessThanOrEqual(run[k - 1])
    expect(run.some((a) => a > 0 && a < 255)).toBe(true)
  })

  it('leaves the colour alone', () => {
    expect(out.data[(50 * res + 80) * 4]).toBe(255)
  })
})
