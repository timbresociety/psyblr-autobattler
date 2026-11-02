import type { Quaternion } from 'three'
import type { FaceGroup } from '../body/face-basis.js'
import type { Binding } from '../wear/bind.js'

/**
 * The head as its own object (GAME.md §9.1), renderer-free: which of a body's triangles the head draws, the collar
 * where it meets the body, its face shapes on the brow and lash cards, its eyes' spheres and turns, the jaw's opening
 * and the blinks. The game builds the head from these (src/arena/client/head/); the parts come from
 * tools/blender/humanlib/head.py (public/kit/v2/head-<gender>.*).
 */

/** The 52 ARKit face shapes, in the file's order. */
export const ARKIT_SHAPES = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawRight', 'jawOpen',
  'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
  'mouthShrugUpper', 'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'noseSneerLeft', 'noseSneerRight', 'tongueOut',
] as const
export type ArkitShape = (typeof ARKIT_SHAPES)[number]

/**
 * The shapes a head carries in the arena, where it is small on screen: blinks, the jaw and the broad expressions.
 * Close up (the Forge, the gacha reveal) it carries all 52.
 */
export const LITE_SHAPES: readonly ArkitShape[] = ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthClose', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFunnel', 'browInnerUp', 'browDownLeft', 'browDownRight']

/** public/kit/v2/head-<gender>.json */
export interface HeadMeta {
  version: 1
  from: string
  vertices: number
  /** The reference body's face scale: a body's shapes are its kit's faceScale over this times the file's. */
  faceScale: number
  shapes: ArkitShape[]
  /** The middle of the lips, where they part (glTF axes, on the reference body). */
  mouth: [number, number, number]
  parts: Record<string, string>
}

interface PartGeometry {
  texture: string | null
  /** xyz per vertex, glTF axes, on the reference body. */
  position: number[]
  uv: number[]
  index: number[]
}

/** A brow or lash part: cards bound to the face (src/kit/wear/bind.ts), so they follow any hero's. */
export interface CardPart extends PartGeometry {
  tri: number[]
  st: number[]
  lift: number[]
}

/** The teeth and tongue: rigid, placed on a hero by their middle, bound to the face the same way. */
export interface RigidPart extends PartGeometry {
  anchor: { tri: [number, number, number]; st: [number, number]; lift: number; at: [number, number, number] }
}

/** The bones a head is skinned to; a vertex they carry at least half of is the head's. */
export const HEAD_BONES = ['Head', 'HeadTop_End', 'Jaw', 'LeftEye', 'RightEye'] as const

/** Per welded vertex, the share of it the head's bones carry (joints and weights four per vertex). */
export function headShare(joints: ArrayLike<number>, weights: ArrayLike<number>, bones: readonly string[]): Float32Array {
  const head = new Set(HEAD_BONES.map((b) => bones.indexOf(b)).filter((i) => i >= 0))
  const n = joints.length / 4
  const out = new Float32Array(n)
  for (let v = 0; v < n; v++) {
    let s = 0
    let total = 0
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k]
      total += w
      if (head.has(joints[v * 4 + k])) s += w
    }
    out[v] = total > 0 ? s / total : 0
  }
  return out
}

/** Per welded triangle, 1 if the head draws it: its corners' head share averages at least `threshold`. */
export function headTriangles(triangles: ArrayLike<number>, share: ArrayLike<number>, threshold = 0.5): Uint8Array {
  const out = new Uint8Array(triangles.length / 3)
  for (let t = 0; t < out.length; t++) out[t] = (share[triangles[t * 3]] + share[triangles[t * 3 + 1]] + share[triangles[t * 3 + 2]]) / 3 >= threshold ? 1 : 0
  return out
}

/** The collar: the welded vertices on edges where a head triangle meets a body one, the seam the two share. */
export function collarRing(triangles: ArrayLike<number>, inHead: ArrayLike<number>): Uint32Array {
  const side = new Map<string, number>()
  const ring = new Set<number>()
  for (let t = 0; t < inHead.length; t++) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t * 3 + k]
      const b = triangles[t * 3 + ((k + 1) % 3)]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const seen = side.get(key)
      const mine = inHead[t] ? 1 : 2
      if (seen === undefined) side.set(key, mine)
      else if (seen !== mine) (ring.add(a), ring.add(b))
    }
  }
  return Uint32Array.from([...ring].sort((x, y) => x - y))
}

/**
 * The blend ring for a head that brings its own neck (a generated or helmeted head): each of its ring's vertices
 * moved onto the nearest of the body's, and the vertices within `band` metres above the ring moved part of the way,
 * fading out, so the seam closes without a step. A head cut from the body's own surface already shares its ring, and
 * nothing moves. `positions` (xyz) is changed in place; returns the largest move.
 */
export function blendCollar(positions: Float32Array, ring: ArrayLike<number>, bodyRing: ArrayLike<number>, band: number): number {
  const at = (p: ArrayLike<number>, i: number) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]
  const moves: { from: number[]; by: number[] }[] = []
  for (let r = 0; r < ring.length; r++) {
    const p = at(positions, ring[r])
    let best = Infinity
    let to = p
    for (let b = 0; b < bodyRing.length / 3; b++) {
      const q = at(bodyRing, b)
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
      if (d < best) (best = d), (to = q)
    }
    moves.push({ from: p, by: [to[0] - p[0], to[1] - p[1], to[2] - p[2]] })
  }
  let most = 0
  const n = positions.length / 3
  const moved = new Float32Array(positions.length)
  for (let v = 0; v < n; v++) {
    const p = at(positions, v)
    // the nearest ring vertex's move, fading over the band
    let best = Infinity
    let by = [0, 0, 0]
    for (const m of moves) {
      const d = Math.hypot(p[0] - m.from[0], p[1] - m.from[1], p[2] - m.from[2])
      if (d < best) (best = d), (by = m.by)
    }
    const k = band > 0 ? Math.max(0, 1 - best / band) ** 2 : best === 0 ? 1 : 0
    for (let c = 0; c < 3; c++) moved[v * 3 + c] = by[c] * k
    most = Math.max(most, Math.hypot(by[0], by[1], by[2]) * k)
  }
  for (let i = 0; i < positions.length; i++) positions[i] += moved[i]
  return most
}

/**
 * The neck socket a head sits on: its collar's middle and radius on this body. The radius follows the physique (a
 * thick neck, a heavy body), as the body's own collar does; a separate head is scaled to it.
 */
export function neckSocket(positions: ArrayLike<number>, ring: ArrayLike<number>): { centre: [number, number, number]; radius: number } {
  const c: [number, number, number] = [0, 0, 0]
  for (const v of Array.from(ring)) for (let k = 0; k < 3; k++) c[k] += positions[v * 3 + k] / ring.length
  let r = 0
  for (const v of Array.from(ring)) r += Math.hypot(positions[v * 3] - c[0], positions[v * 3 + 2] - c[2]) / ring.length
  return { centre: c, radius: r }
}

/**
 * The eyeballs' welded vertices: every piece of the surface apart from the skin (its largest piece), the left eye's
 * (+x, the hero's left) first. The game draws its own eyes there; these say where.
 */
export function eyeIds(triangles: ArrayLike<number>, positions: ArrayLike<number>, count: number): { left: number[]; right: number[] } {
  const parent = Int32Array.from({ length: count }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  for (let t = 0; t < triangles.length; t += 3) for (const k of [1, 2]) parent[find(triangles[t + k])] = find(triangles[t])
  const pieces = new Map<number, number[]>()
  for (let v = 0; v < count; v++) {
    const r = find(v)
    let list = pieces.get(r)
    if (!list) pieces.set(r, (list = []))
    list.push(v)
  }
  const sorted = [...pieces.values()].sort((a, b) => b.length - a.length).slice(1)
  const x = (ids: number[]) => ids.reduce((s, v) => s + positions[v * 3], 0) / ids.length
  const eyes = sorted.filter((ids) => ids.length > 8).slice(0, 2)
  if (eyes.length < 2) return { left: [], right: [] }
  return x(eyes[0]) > x(eyes[1]) ? { left: eyes[0], right: eyes[1] } : { left: eyes[1], right: eyes[0] }
}

/** A sphere's middle and mean radius from points on it (an eye's welded vertices). */
export function sphereOf(positions: ArrayLike<number>, ids: ArrayLike<number>): { centre: [number, number, number]; radius: number } {
  const c: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < ids.length; i++) for (let k = 0; k < 3; k++) c[k] += positions[ids[i] * 3 + k] / ids.length
  let r = 0
  for (let i = 0; i < ids.length; i++) r += Math.hypot(positions[ids[i] * 3] - c[0], positions[ids[i] * 3 + 1] - c[1], positions[ids[i] * 3 + 2] - c[2]) / ids.length
  return { centre: c, radius: r }
}

/**
 * A card part's deltas for one face shape: its binding evaluated on the shape's deltas (the bound formula is linear in
 * the surface, and a shape moves the face only millimetres, so the normals' change is left out). `scale` takes the
 * reference body's deltas to this one's.
 */
export function boundDeltas(binding: Binding, group: FaceGroup, scale: number, out = new Float32Array(binding.lift.length * 3)): Float32Array {
  out.fill(0)
  const at = new Map<number, number>()
  for (let i = 0; i < group.ids.length; i++) at.set(group.ids[i], i)
  const d = (v: number, k: number) => {
    const i = at.get(v)
    return i === undefined ? 0 : group.deltas[i * 3 + k] * scale
  }
  for (let i = 0; i < binding.lift.length; i++) {
    const a = binding.tri[i * 3]
    const b = binding.tri[i * 3 + 1]
    const c = binding.tri[i * 3 + 2]
    const s = binding.st[i * 2]
    const t = binding.st[i * 2 + 1]
    for (let k = 0; k < 3; k++) out[i * 3 + k] = d(a, k) + s * (d(b, k) - d(a, k)) + t * (d(c, k) - d(a, k))
  }
  return out
}

/**
 * How the jaw moves when jawOpen is full: the turn about its hinge (its left-right axis through `pivot`, degrees,
 * opening positive) that best carries the skin round the lower teeth (the vertices within `near.radius` of
 * `near.centre` that the shape moves, under the lips' parting at `near.below` and within `near.width` of the middle
 * across: the lower lip's middle, in front of the teeth), and what that turn leaves over, as a shift (metres): the lower teeth and the
 * tongue turn and shift with it, so they keep to the lip. Without `near`, measured on the chin (the most-moved skin).
 */
export function jawFit(group: FaceGroup, positions: ArrayLike<number>, pivot: readonly number[], near?: { centre: readonly number[]; radius: number; below?: number; width?: number }): { deg: number; shift: [number, number, number] } {
  let most = 0
  for (let i = 0; i < group.ids.length; i++) most = Math.max(most, Math.hypot(group.deltas[i * 3], group.deltas[i * 3 + 1], group.deltas[i * 3 + 2]))
  const used: number[] = []
  for (let i = 0; i < group.ids.length; i++) {
    const m = Math.hypot(group.deltas[i * 3], group.deltas[i * 3 + 1], group.deltas[i * 3 + 2])
    const v = group.ids[i]
    if (near) {
      const d = Math.hypot(positions[v * 3] - near.centre[0], positions[v * 3 + 1] - near.centre[1], positions[v * 3 + 2] - near.centre[2])
      const across = near.width === undefined || Math.abs(positions[v * 3] - near.centre[0]) <= near.width
      if (d <= near.radius && m >= most * 0.2 && across && (near.below === undefined || positions[v * 3 + 1] < near.below)) used.push(i)
    } else if (m >= most * 0.6) used.push(i)
  }
  if (!used.length) return { deg: 0, shift: [0, 0, 0] }
  // the angle in the side view (y up, z forward); opening drops the chin, turning it back toward -y
  let sum = 0
  for (const i of used) {
    const v = group.ids[i]
    const y = positions[v * 3 + 1] - pivot[1]
    const z = positions[v * 3 + 2] - pivot[2]
    sum += Math.atan2(y, z) - Math.atan2(y + group.deltas[i * 3 + 1], z + group.deltas[i * 3 + 2])
  }
  const theta = sum / used.length
  const shift: [number, number, number] = [0, 0, 0]
  for (const i of used) {
    const v = group.ids[i]
    const y = positions[v * 3 + 1] - pivot[1]
    const z = positions[v * 3 + 2] - pivot[2]
    const r = Math.hypot(y, z)
    const a = Math.atan2(y, z) - theta
    shift[0] += group.deltas[i * 3] / used.length
    shift[1] += (group.deltas[i * 3 + 1] - (r * Math.sin(a) - y)) / used.length
    shift[2] += (group.deltas[i * 3 + 2] - (r * Math.cos(a) - z)) / used.length
  }
  return { deg: (theta * 180) / Math.PI, shift }
}

/** Turn `q` (a rotation from rest) back to at most `maxDeg` degrees, keeping its axis. Returns whether it was clamped. */
export function clampTurn(q: Quaternion, maxDeg: number): boolean {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const angle = 2 * Math.acos(Math.min(1, q.w))
  const max = (maxDeg * Math.PI) / 180
  if (angle <= max + 1e-9) return false
  const s = Math.sin(angle / 2)
  const k = Math.sin(max / 2) / s
  q.set(q.x * k, q.y * k, q.z * k, Math.cos(max / 2))
  return true
}

/**
 * Blinking: every few seconds (a seeded, irregular gap), the lids close over a tenth of a second and open again a
 * little slower; now and then twice in a row. `step` advances it and returns how closed the lids are (0 to 1).
 */
export interface Blink {
  next: number
  t: number
  seed: number
  double: boolean
}

export const blinkState = (seed = 1): Blink => ({ next: 1 + (seed % 7) * 0.4, t: -1, seed, double: false })

const CLOSE = 0.08
const SHUT = 0.04
const OPEN = 0.14

export function stepBlink(b: Blink, dt: number): number {
  if (b.t < 0) {
    b.next -= dt
    if (b.next > 0) return 0
    b.t = 0
  }
  b.t += dt
  const t = b.t
  let closed: number
  if (t < CLOSE) closed = t / CLOSE
  else if (t < CLOSE + SHUT) closed = 1
  else if (t < CLOSE + SHUT + OPEN) closed = 1 - (t - CLOSE - SHUT) / OPEN
  else {
    // the next gap: 2 to 6 seconds, from a small LCG so every hero blinks on its own beat
    b.seed = (b.seed * 1103515245 + 12345) & 0x7fffffff
    const r = b.seed / 0x7fffffff
    b.double = !b.double && r < 0.15
    b.next = b.double ? 0.12 : 2 + r * 4
    b.t = -1
    closed = 0
  }
  return closed * closed * (3 - 2 * closed)
}
