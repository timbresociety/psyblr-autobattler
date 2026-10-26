import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseFaceBasis, type FaceBasisMeta } from '../../../kit/body/face-basis.js'
import { readBody } from '../../../kit/body/node.js'
import { weldValues } from '../../../kit/body/surface.js'
import { faceModel, fitFace, type FaceModel } from './shape.js'
import { applySimilarity, similarity, type Pt } from './warp.js'

const repo = (path: string) => new URL(`../../../../${path}`, import.meta.url)
const meta = JSON.parse(readFileSync(repo('public/kit/face-basis.json'), 'utf8')) as FaceBasisMeta
const basis = parseFaceBasis(readFileSync(repo('public/kit/face-basis.bin')).buffer as ArrayBuffer)
// fit_face on the reference body for each demo hero's portrait (tools/blender/human.py --face-fits)
const blender = JSON.parse(readFileSync(new URL('./blender-fits.json', import.meta.url), 'utf8')) as { groups: string[]; fits: Record<string, { portrait: string; weights: number[] }> }

const portrait = (id: string): Pt[] => (JSON.parse(readFileSync(repo(`tools/blender/portraits/${id}.lm.json`), 'utf8')) as { points: number[][] }).points.map((p) => [p[0], p[1]] as const)

interface Kit {
  faceScale: number
  fit: number[]
}

const kits: Record<string, Kit> = {}
const models: Record<string, FaceModel> = {}

beforeAll(async () => {
  for (const body of ['m-medium', 'f-medium']) {
    const f = await readBody(repo(`public/heroes/${body}.glb`))
    const kit = (kits[body] = JSON.parse(readFileSync(repo(`public/heroes/${body}.kit.json`), 'utf8')) as Kit)
    models[body] = faceModel(basis, meta, weldValues(f.surface, f.positions, 3), kit.fit, kit.faceScale / meta.faceScale, kit.faceScale)
  }
})

/** The fit landmarks front on with weights `w`, through a body's model. */
function landmarks(model: FaceModel, w: readonly number[]): Float64Array {
  const n = model.rest.length
  const out = Float64Array.from(model.rest)
  w.forEach((k, g) => {
    for (let j = 0; j < n; j++) out[j] += k * model.columns[g * n + j]
  })
  return out
}

/** Mean distance between two sets of landmarks front on, in metres. */
function apart(a: Float64Array, b: Float64Array): number {
  let sum = 0
  for (let k = 0; k < a.length; k += 2) sum += Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1])
  return sum / (a.length / 2)
}

/** How far the photo's landmarks, aligned, sit from the plain face's (fitFace's error with every weight at 0). */
function plainError(model: FaceModel, points: readonly Pt[]): number {
  const photo = model.ids.map((i) => points[i])
  const face = model.ids.map((_, k) => [model.rest[k * 2], model.rest[k * 2 + 1]] as const)
  const t = similarity(photo, face)
  let sum = 0
  photo.forEach((p, k) => {
    const [x, y] = applySimilarity(t, p)
    sum += Math.abs(x - face[k][0]) + Math.abs(y - face[k][1])
  })
  return sum / model.rest.length
}

describe('the face fit', () => {
  it('names the same groups in the same order as Blender', () => {
    expect(meta.groups).toEqual(blender.groups)
  })

  it('fits each demo portrait as Blender did, and closer than the plain face', () => {
    const model = models['m-medium']
    for (const [name, { portrait: id, weights }] of Object.entries(blender.fits)) {
      const points = portrait(id)
      const fit = fitFace(model, points)
      // the same face to a third of a millimetre (0.16 to 0.34 mm measured; the basis is Blender's targets carried
      // onto the game's mesh), from weights within a hundredth on average
      expect(apart(landmarks(model, fit.weights), landmarks(model, weights)), name).toBeLessThan(0.0005)
      const diffs = fit.weights.map((w, g) => Math.abs(w - weights[g]))
      expect(diffs.reduce((a, b) => a + b, 0) / diffs.length, name).toBeLessThan(0.015)
      expect(Math.max(...diffs), name).toBeLessThan(0.12)
      expect(fit.weights.every((w) => w >= 0 && w <= 1), name).toBe(true)
      expect(fit.error, name).toBeLessThan(plainError(model, points))
    }
  })

  it("finds a body's own face in the portrait it was fitted to, on either gender's body", () => {
    for (const [body, id] of [['m-medium', 'base_male'], ['f-medium', 'base_female']]) {
      const model = models[body]
      const fit = fitFace(model, portrait(id))
      // 0.23 and 0.17 mm measured: taking the body's own face away through the basis leaves the plain face
      expect(apart(landmarks(model, fit.weights), landmarks(model, kits[body].fit)), body).toBeLessThan(0.0004)
      const diffs = fit.weights.map((w, g) => Math.abs(w - kits[body].fit[g]))
      expect(diffs.reduce((a, b) => a + b, 0) / diffs.length, body).toBeLessThan(0.012)
    }
  })
})
