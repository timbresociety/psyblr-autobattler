import { landmarkAt, parseFaceBasis, type FaceBasis, type FaceBasisMeta } from '../../../kit/body/face-basis.js'
import type { FaceShape } from '../../../kit/body/shape.js'
import { sculptWeights, type Sculpt } from '../../../kit/body/sculpt.js'
import type { BodyKit } from '../body-kit.js'
import type { RigKind } from '../../../kit/rig/names.js'
import { BROWS, FIT } from './landmarks.js'
import { applySimilarity, similarity, type Pt } from './warp.js'

/**
 * A photo's face shape, ported from tools/blender/humanlib/face.py `fit_face`: weights on the face basis's groups that
 * move a body's landmarks, seen front on, onto the photo's. Each round fits a similarity from the photo onto the face
 * as it stands, then solves for the weights (each 0 to 1, with a little ridge so none runs wild) that move the face
 * there. The game fits any player's photo the way Blender fitted the demo heroes' portraits.
 */

/**
 * Blender's ridge, for a face MakeHuman's size: a body's face is faceScale times that, so its ridge is faceScale² times.
 * The first basis (39 groups) used 4e-4; the full set (the creator goal) fits at 1e-5, where a head can leave the mean.
 */
const RIDGE: Record<RigKind, number> = { legacy: 4e-4, standard: 1e-5 }
const ROUNDS = 4
const ITERATIONS = 900
/** How much a depth row counts against a picture row: MediaPipe's depth is a guess, the picture is measured. */
const DEPTH = 0.5

/** What fitting a photo to one body needs, worked out once per body. */
export interface FaceModel {
  /** The fit landmarks the body has. */
  ids: number[]
  /** Rows per landmark: x and −y front on, and with depth a third, distance from the camera (weighted DEPTH). */
  rows: 2 | 3
  /** Where they sit front on (x, −y[, depth]) less the body's own face. */
  rest: Float64Array
  /** How each group moves them at full weight, on this body: group g's column from g × rest.length. */
  columns: Float64Array
  groups: number
  ridge: number
}

/**
 * The model for one body: its welded rest `positions`, its own face's weights (`base`, its kit's fit), the scale from
 * the basis to it (shapeBody's), and its face scale (its kit's faceScale).
 */
export function faceModel(basis: FaceBasis, meta: FaceBasisMeta, positions: ArrayLike<number>, base: ArrayLike<number>, scale: number, faceScale: number, rig: RigKind = 'legacy', depth = false): FaceModel {
  const rows: 2 | 3 = depth ? 3 : 2
  const picked = depth ? [...new Set([...FIT, ...BROWS])].sort((a, b) => a - b) : FIT
  const ids = picked.filter((i) => meta.landmarks[i])
  const n = ids.length * rows
  const groups = basis.groups.length
  // each group's deltas at the vertices the landmarks sit between
  const slot = new Map<number, number>()
  for (const i of ids) for (const v of meta.landmarks[i]!.slice(0, 3)) if (!slot.has(v)) slot.set(v, slot.size)
  const columns = new Float64Array(groups * n)
  basis.groups.forEach((g, gi) => {
    const at = new Float64Array(slot.size * 3)
    for (let k = 0; k < g.ids.length; k++) {
      const s = slot.get(g.ids[k])
      if (s !== undefined) for (let c = 0; c < 3; c++) at[s * 3 + c] = g.deltas[k * 3 + c]
    }
    ids.forEach((i, k) => {
      const [a, b, c, u, v, w] = meta.landmarks[i]!
      const [sa, sb, sc] = [slot.get(a)! * 3, slot.get(b)! * 3, slot.get(c)! * 3]
      columns[gi * n + k * rows] = (at[sa] * u + at[sb] * v + at[sc] * w) * scale
      columns[gi * n + k * rows + 1] = -(at[sa + 1] * u + at[sb + 1] * v + at[sc + 1] * w) * scale
      // depth away from the camera is −z (the face looks along +z)
      if (depth) columns[gi * n + k * rows + 2] = -(at[sa + 2] * u + at[sb + 2] * v + at[sc + 2] * w) * scale * DEPTH
    })
  })
  const rest = new Float64Array(n)
  ids.forEach((i, k) => {
    const [x, y, z] = landmarkAt(meta.landmarks[i], positions)!
    rest[k * rows] = x
    rest[k * rows + 1] = -y
    if (depth) rest[k * rows + 2] = -z * DEPTH
  })
  for (let g = 0; g < groups; g++) {
    const b = base[g] ?? 0
    if (b) for (let j = 0; j < n; j++) rest[j] -= b * columns[g * n + j]
  }
  return { ids, rows, rest, columns, groups, ridge: RIDGE[rig] * faceScale * faceScale }
}

/** rest + J·w: the landmarks front on with the weights `w`. */
function shaped(model: FaceModel, w: Float64Array): Float64Array {
  const out = Float64Array.from(model.rest)
  const n = out.length
  for (let g = 0; g < model.groups; g++) if (w[g]) for (let j = 0; j < n; j++) out[j] += w[g] * model.columns[g * n + j]
  return out
}

/** Jᵀ·J plus the ridge on the diagonal, row by row. */
function normalMatrix(model: FaceModel): Float64Array {
  const { columns, groups: G } = model
  const n = model.rest.length
  const A = new Float64Array(G * G)
  for (let a = 0; a < G; a++)
    for (let b = a; b < G; b++) {
      let s = 0
      for (let j = 0; j < n; j++) s += columns[a * n + j] * columns[b * n + j]
      A[a * G + b] = A[b * G + a] = s
    }
  for (let a = 0; a < G; a++) A[a * G + a] += model.ridge
  return A
}

/** The largest eigenvalue of a symmetric matrix, by power iteration (from below, so a hair over it to be safe). */
function largestEigenvalue(A: Float64Array, G: number): number {
  let v = new Float64Array(G).fill(1 / Math.sqrt(G))
  let lambda = 0
  for (let it = 0; it < 200; it++) {
    const u = new Float64Array(G)
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) u[i] += A[i * G + j] * v[j]
    const norm = Math.hypot(...u)
    if (!norm) return 1
    lambda = norm
    v = u.map((x) => x / norm)
  }
  return lambda * 1.001
}

/** min |J·w − r|² + ridge·|w|² with every weight in 0 to 1: accelerated projected gradient on A·w = b, from zero. */
function solveBox(A: Float64Array, b: Float64Array, L: number, G: number): Float64Array {
  let w = new Float64Array(G)
  const y = new Float64Array(G)
  let t = 1
  for (let it = 0; it < ITERATIONS; it++) {
    const next = new Float64Array(G)
    for (let i = 0; i < G; i++) {
      let g = -b[i]
      for (let j = 0; j < G; j++) g += A[i * G + j] * y[j]
      next[i] = Math.min(1, Math.max(0, y[i] - g / L))
    }
    const tn = (1 + Math.sqrt(1 + 4 * t * t)) / 2
    for (let i = 0; i < G; i++) y[i] = next[i] + ((t - 1) / tn) * (next[i] - w[i])
    w = next
    t = tn
  }
  return w
}

export interface FaceFit {
  /** One per basis group, 0 to 1. */
  weights: number[]
  /** Mean distance, front on, between the photo's landmarks (aligned) and the fitted face's, in metres per axis. */
  error: number
}

/**
 * Fit a photo's landmarks (all 478, in its own pixels) to a body's face; with the photo's `depth` per landmark and a
 * model made with depth rows, in depth too (the photo's depth takes the picture's scale, and sits wherever it lands
 * on average, since a photo says nothing about where the face is from the camera).
 */
export function fitFace(model: FaceModel, points: readonly Pt[], depth?: readonly number[]): FaceFit {
  const { ids, rows, rest, columns, groups: G } = model
  const n = rest.length
  const photo = ids.map((i) => points[i])
  const deep = rows === 3 && depth ? ids.map((i) => depth[i]) : undefined
  const A = normalMatrix(model)
  const L = largestEigenvalue(A, G)
  const asPoints = (m: Float64Array): Pt[] => ids.map((_, k) => [m[k * rows], m[k * rows + 1]] as const)
  let w: Float64Array = new Float64Array(G)
  const residual = (m: Float64Array) => {
    const t = similarity(photo, asPoints(m))
    const r = new Float64Array(n)
    photo.forEach((p, k) => {
      const [x, y] = applySimilarity(t, p)
      r[k * rows] = x - rest[k * rows]
      r[k * rows + 1] = y - rest[k * rows + 1]
    })
    if (deep) {
      const s = Math.hypot(t.a, t.b) * DEPTH
      let offset = 0
      deep.forEach((d, k) => (offset += m[k * rows + 2] - d * s))
      offset /= deep.length
      deep.forEach((d, k) => (r[k * rows + 2] = d * s + offset - rest[k * rows + 2]))
    }
    return r
  }
  for (let round = 0; round < ROUNDS; round++) {
    // where the photo says each landmark should move from the plain face
    const r = residual(shaped(model, w))
    const b = new Float64Array(G)
    for (let g = 0; g < G; g++) for (let j = 0; j < n; j++) b[g] += columns[g * n + j] * r[j]
    w = solveBox(A, b, L, G)
  }
  const m = shaped(model, w)
  const t = similarity(photo, asPoints(m))
  let error = 0
  photo.forEach((p, k) => {
    const [x, y] = applySimilarity(t, p)
    error += Math.abs(x - m[k * rows]) + Math.abs(y - m[k * rows + 1])
  })
  return { weights: Array.from(w), error: error / (ids.length * 2) }
}

// ------------------------------------------------------------------------------------------------ in the game

interface BasisFile {
  basis: FaceBasis
  meta: FaceBasisMeta
}

const loading = new Map<RigKind, Promise<BasisFile | undefined>>()
const loadedBy = new Map<RigKind, BasisFile | undefined>()
const settledBy = new Set<RigKind>()

/** Where a rig's basis lives: the first bodies' in public/kit, the Psyblr Human's (over the full target set) in public/kit/v2. */
const basisUrl = (rig: RigKind) => (rig === 'standard' ? '/kit/v2/face-basis' : '/kit/face-basis')

/** A rig's face basis, fetched once; undefined when it can't load (faces then keep the body's shape). */
export function faceBasisFile(rig: RigKind = 'legacy'): Promise<BasisFile | undefined> {
  let load = loading.get(rig)
  if (!load) {
    const url = basisUrl(rig)
    load = Promise.all([fetch(`${url}.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))), fetch(`${url}.json`).then((r) => (r.ok ? (r.json() as Promise<FaceBasisMeta>) : Promise.reject(r.status)))])
      .then(([bin, meta]) => {
        const file = { basis: parseFaceBasis(bin), meta }
        loadedBy.set(rig, file)
        return file
      })
      .catch(() => undefined)
      .finally(() => settledBy.add(rig))
    loading.set(rig, load)
  }
  return load
}

/** True once a rig's face basis has loaded or failed to: a face drawn now is drawn as it will stay. */
export const faceBasisSettled = (rig: RigKind = 'legacy') => settledBy.has(rig)

/** A body's rig, from its kit; the first bodies' kits say nothing. */
export const kitRig = (kit: BodyKit | undefined): RigKind => kit?.rig ?? 'legacy'

const fits = new Map<string, number[]>()

/**
 * A photo face's shape on one body, for shapeBody: undefined when the hero has no photo, or the basis or the body's
 * kit hasn't loaded (the atlas waits for both, so a hero dressed with its face has them). Fitted once per body and
 * photo, and taken at the photo's strength; `positions` are the body's welded rest positions.
 */
export function photoFaceShape(face: { url: string; points: readonly number[]; depth?: readonly number[]; strength?: number } | undefined, body: string, kit: BodyKit | undefined, positions: ArrayLike<number>): FaceShape | undefined {
  const rig = kitRig(kit)
  const loaded = loadedBy.get(rig)
  if (!face || !loaded || !kit?.fit || !kit.faceScale) return undefined
  const { basis, meta } = loaded
  const scale = kit.faceScale / meta.faceScale
  const key = `${body}|${face.url}`
  let weights = fits.get(key)
  if (!weights) {
    const points: Pt[] = []
    for (let i = 0; i < face.points.length; i += 2) points.push([face.points[i], face.points[i + 1]])
    // depth only helps on the full basis, whose groups move the face in depth (the nose's bridge, the brow, the chin)
    const depth = rig === 'standard' && face.depth && face.depth.length * 2 === face.points.length ? face.depth : undefined
    weights = fitFace(faceModel(basis, meta, positions, kit.fit, scale, kit.faceScale, rig, !!depth), points, depth).weights
    fits.set(key, weights)
  }
  return { basis, weights, base: kit.fit, scale, strength: face.strength }
}

/**
 * A hero's face for shapeBody: the photo's shape (photoFaceShape) with what was sculpted by hand on top, or the sculpt
 * alone on the body's own face. Undefined when there is neither, or the basis or the body's kit hasn't loaded
 * (heroAtlas brings both in for a sculpted hero).
 */
export function faceShape(face: { url: string; points: readonly number[]; depth?: readonly number[]; strength?: number } | undefined, sculpt: Sculpt | undefined, body: string, kit: BodyKit | undefined, positions: ArrayLike<number>): FaceShape | undefined {
  const photo = photoFaceShape(face, body, kit, positions)
  const loaded = loadedBy.get(kitRig(kit))
  const extra = loaded && sculptWeights(sculpt, loaded.meta.groups)
  if (!extra) return photo
  if (photo) return { ...photo, sculpt: extra }
  if (!loaded || !kit?.faceScale) return undefined
  const none = new Array<number>(extra.length).fill(0)
  return { basis: loaded.basis, weights: none, base: none, scale: kit.faceScale / loaded.meta.faceScale, sculpt: extra }
}
