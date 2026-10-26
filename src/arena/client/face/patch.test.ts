import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WARP } from './landmarks.js'
import { buildFacePatch, skinColour, type FaceMeta, type Rgba } from './patch.js'
import { applySimilarity, similarity, tpsFit, type Pt } from './warp.js'

const meta = JSON.parse(readFileSync(new URL('../../../../public/heroes/m-medium.kit.json', import.meta.url), 'utf8')) as FaceMeta

/** A photo whose red channel is its x and green its y, so a patch pixel says where in the photo it came from. */
function coordinatePhoto(size = 256): Rgba {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      data[i] = x
      data[i + 1] = y
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  return { width: size, height: size, data }
}

/** The body's own landmarks moved into a 256 px photo: a quarter the size, nudged over and turned a little. */
const toPhoto = { a: 0.25 * Math.cos(0.08), b: 0.25 * Math.sin(0.08), tx: 6, ty: -40 }
const photoLandmarks = (): Pt[] => meta.landmarks.map((p) => (p ? applySimilarity(toPhoto, p) : [0, 0]))

describe('fitting a photo to a face', () => {
  it('a similarity fit recovers the scale, turn and shift that made the points', () => {
    const src: Pt[] = [[0, 0], [10, 3], [4, 9], [-6, 2], [7, -8]]
    const t = { a: 1.7 * Math.cos(0.3), b: 1.7 * Math.sin(0.3), tx: 12, ty: -5 }
    const fit = similarity(src, src.map((p) => applySimilarity(t, p)))
    expect(fit.a).toBeCloseTo(t.a, 9)
    expect(fit.b).toBeCloseTo(t.b, 9)
    expect(fit.tx).toBeCloseTo(t.tx, 9)
    expect(fit.ty).toBeCloseTo(t.ty, 9)
  })

  it('the spline carries every control point onto its partner', () => {
    const src: Pt[] = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.2, 0.8]]
    const dst: Pt[] = src.map(([x, y]) => [x + 0.1 * Math.sin(3 * y), y + 0.05 * x * x])
    const f = tpsFit(src, dst, 1e-9)
    for (let i = 0; i < src.length; i++) {
      const [x, y] = f(src[i])
      expect(Math.hypot(x - dst[i][0], y - dst[i][1])).toBeLessThan(1e-6)
    }
  })

  it('every warp landmark of the photo lands within half a pixel of the body landmark it belongs to', () => {
    const lm = photoLandmarks()
    const { patch } = buildFacePatch(coordinatePhoto(), lm, meta, 512, 0)
    const k = 512 / meta.frame.res
    let worst = 0
    for (const i of WARP) {
      const p = meta.landmarks[i]
      if (!p) continue
      const at = (Math.floor(p[1] * k) * 512 + Math.floor(p[0] * k)) * 4
      // the patch pixel under the body's landmark came from (red, green) in the photo
      worst = Math.max(worst, Math.hypot(patch.data[at] - lm[i][0], patch.data[at + 1] - lm[i][1]))
    }
    // half a pixel of the 512 patch, measured in photo pixels at a quarter scale, plus the photo's own integer rounding
    expect(worst).toBeLessThan(0.5 / (512 / meta.frame.res) / 4 + 1.5)
  })

  it("the patch is the face: opaque at the nose, clear at the corners", () => {
    const { patch } = buildFacePatch(coordinatePhoto(), photoLandmarks(), meta, 256, 0)
    const k = 256 / meta.frame.res
    const nose = meta.landmarks[1]!
    expect(patch.data[(Math.floor(nose[1] * k) * 256 + Math.floor(nose[0] * k)) * 4 + 3]).toBeGreaterThan(240)
    expect(patch.data[3]).toBe(0)
    expect(patch.data[(256 * 256 - 1) * 4 + 3]).toBe(0)
  })

  it('reads the skin colour off the cheeks and forehead', () => {
    const size = 256
    const data = new Uint8ClampedArray(size * size * 4).fill(255)
    for (let i = 0; i < size * size; i++) data.set([204, 150, 120, 255], i * 4)
    const skin = skinColour({ width: size, height: size, data }, photoLandmarks())
    expect(skin.map((c) => Math.round(c * 255))).toEqual([204, 150, 120])
  })
})
