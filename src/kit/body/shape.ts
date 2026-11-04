import type { Gender } from '../../charter/look.js'
import { applyFace, type FaceBasis } from './face-basis.js'
import { sculptVolume, type PhysiqueDials } from './physique.js'
import type { Skeleton } from './regions.js'
import { weldedNormals, weldSurface, weldValues, type BodySurface } from './surface.js'

/**
 * A hero's own body: one of the twelve body files, shaped by the hero's physique and fitted face, welded so anything
 * bound to the surface can be evaluated on it. Renderer-free: the game builds this from a loaded file's attributes,
 * tests and tools from src/kit/body/node.ts.
 */

/**
 * How a hero is built: Structure × Volume (physique.ts, GAME.md §9.3). Weight and muscle at 0.5, and age at 0, are the
 * body as made; every other dial at 0.5 too, or absent.
 */
export type Physique = PhysiqueDials

export const NEUTRAL_PHYSIQUE: Physique = { weight: 0.5, muscle: 0.5, age: 0 }

/**
 * Morph target weights for a physique, in the order the body's kit names its morphs: below 0.5 a slider runs toward
 * the thin or slight body (weight-, muscle-), above it toward the heavy or muscled one, and age toward 75.
 */
export function morphWeights(physique: Partial<Physique>, names: readonly string[]): number[] {
  const p = { ...NEUTRAL_PHYSIQUE, ...physique }
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
  const below = (v: number) => clamp((0.5 - clamp(v)) * 2)
  const above = (v: number) => clamp((clamp(v) - 0.5) * 2)
  // the heavy and built ends run past MakeHuman's own targets, for a brute; past the thin ends clothes crumple (2026-11-02)
  const by: Record<string, number> = { 'weight-': below(p.weight), 'weight+': above(p.weight) * 1.35, 'muscle-': below(p.muscle), 'muscle+': above(p.muscle) * 1.5, age: clamp(p.age) }
  return names.map((n) => by[n] ?? 0)
}

/** A body file welded once: everything a hero's shape is made from. Shared by every hero wearing that body. */
export interface BodyBase {
  surface: BodySurface
  /** Welded rest positions. */
  positions: Float32Array
  /** Welded morph deltas, in the kit's morph order. */
  morphs: Float32Array[]
  /** Welded skin: four bones and four weights per vertex. */
  joints: Uint16Array
  weights: Float32Array
  /** 1 on the skin, 0 on the eyes: things bind to and hide skin only. */
  skin: Uint8Array
}

export interface BodyArrays {
  vid: ArrayLike<number>
  index: ArrayLike<number>
  positions: ArrayLike<number>
  morphs: ArrayLike<number>[]
  joints: ArrayLike<number>
  weights: ArrayLike<number>
}

/** The skin: the largest connected piece of the surface (the eyes are separate spheres). */
export function skinOf(surface: BodySurface): Uint8Array {
  const parent = Int32Array.from({ length: surface.count }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const t = surface.triangles
  for (let i = 0; i < t.length; i += 3) {
    const a = find(t[i])
    parent[find(t[i + 1])] = a
    parent[find(t[i + 2])] = a
  }
  const size = new Map<number, number>()
  for (let i = 0; i < surface.count; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1)
  let biggest = 0
  let most = -1
  for (const [root, n] of size) if (n > most) [biggest, most] = [root, n]
  return Uint8Array.from({ length: surface.count }, (_, i) => (find(i) === biggest ? 1 : 0))
}

/**
 * The heavy morph filled the back of the neck into a hump behind the skull (owner, 2026-11-04): it takes only part of
 * its push there. `cut` is the share taken away; the nape runs from halfway up the upper back to the base of the skull,
 * behind the neck, near the midline, each edge fading over the given metres.
 */
const NAPE = { cut: 0.7, inner: 0.09, outer: 0.15, behind: 0.01, fade: 0.03, aboveSkull: 0.04, skullFade: 0.06 }
const napes = new WeakMap<BodyBase, Float32Array>()

function napeOf(base: BodyBase, skeleton: Skeleton): Float32Array {
  const known = napes.get(base)
  if (known) return known
  const { Spine2, Neck, Head } = skeleton.rest
  const ramp = (v: number, from: number, to: number) => Math.min(1, Math.max(0, (v - from) / (to - from)))
  const low = (Spine2[1] + Neck[1]) / 2
  const top = Head[1] + NAPE.aboveSkull
  const n = base.positions.length / 3
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (!base.skin[i]) continue
    const [x, y, z] = [base.positions[i * 3], base.positions[i * 3 + 1], base.positions[i * 3 + 2]]
    const up = ramp(y, low, Neck[1]) * (1 - ramp(y, top, top + NAPE.skullFade))
    const back = ramp(Neck[2] + NAPE.behind - z, 0, NAPE.fade)
    const mid = 1 - ramp(Math.abs(x - Neck[0]), NAPE.inner, NAPE.outer)
    out[i] = up * back * mid
  }
  napes.set(base, out)
  return out
}

export function bodyBase(arrays: BodyArrays): BodyBase {
  const surface = weldSurface(arrays.vid, arrays.index)
  const weights = weldValues(surface, arrays.weights, 4)
  // renormalise: quantised files store weights that sum to 1 only roughly
  for (let i = 0; i < weights.length; i += 4) {
    const sum = weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] || 1
    for (let k = 0; k < 4; k++) weights[i + k] /= sum
  }
  return {
    surface,
    positions: weldValues(surface, arrays.positions, 3),
    morphs: arrays.morphs.map((m) => weldValues(surface, m, 3)),
    joints: Uint16Array.from(weldValues(surface, arrays.joints, 4)),
    weights,
    skin: skinOf(surface),
  }
}

/** A fitted face: weights on the face basis's groups, the body's own fit to take away, and the scale between them. */
export interface FaceShape {
  basis: FaceBasis
  weights: ArrayLike<number>
  /** The body's own face on the same groups (its kit's `fit`). */
  base: ArrayLike<number>
  /** The body's face scale over the basis's. */
  scale: number
  /** 0 to 1: how much of the photo's shape the hero takes. */
  strength?: number
  /** Weights sculpted by hand on the same groups, added whole on top of the photo's. */
  sculpt?: ArrayLike<number>
}

/** A hero's body: welded positions and normals, and the skin they're drawn with. */
export interface BodyShape extends Omit<BodyBase, 'morphs'> {
  normals: Float32Array
}

/**
 * A hero's body from the file's: its physique's morphs, its fitted face, and, given the body's skeleton at rest, the
 * Volume dials sculpted on (physique.ts).
 */
export function shapeBody(base: BodyBase, morphNames: readonly string[], physique: Partial<Physique> = {}, face?: FaceShape, body?: { skeleton: Skeleton; gender: Gender }): BodyShape {
  const positions = Float32Array.from(base.positions)
  const w = morphWeights(physique, morphNames)
  const nape = body ? napeOf(base, body.skeleton) : undefined
  base.morphs.forEach((delta, i) => {
    const k = w[i]
    if (!k) return
    if (morphNames[i] === 'weight+' && nape) for (let j = 0; j < positions.length; j++) positions[j] += delta[j] * k * (1 - NAPE.cut * nape[(j / 3) | 0])
    else for (let j = 0; j < positions.length; j++) positions[j] += delta[j] * k
  })
  if (face) {
    const strength = Math.min(1, Math.max(0, face.strength ?? 1))
    const weights = Array.from(face.base, (b, i) => ((face.weights[i] ?? b) - b) * strength + (face.sculpt?.[i] ?? 0))
    applyFace(face.basis, weights, face.scale, positions)
  }
  if (body) sculptVolume({ positions: Float32Array.from(positions), normals: weldedNormals(base.surface, positions), triangles: base.surface.triangles, joints: base.joints, weights: base.weights, skin: base.skin }, body.skeleton, physique, body.gender, positions)
  return { surface: base.surface, positions, normals: weldedNormals(base.surface, positions), joints: base.joints, weights: base.weights, skin: base.skin }
}
