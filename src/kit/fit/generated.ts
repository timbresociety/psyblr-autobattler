import { bindPoints, evaluate, type Binding } from '../wear/bind.js'
import { fieldAt } from '../wear/fields.js'
import type { ItemChannel, ItemSlot, Knob } from '../wear/item.js'
import type { RawItem, RawSpec } from './fit.js'
import { meshNormals } from './fit.js'
import { TriangleBVH, type V3 } from './ray.js'
import { leanOn, type Reference } from './reference.js'
import { weldPositions } from './weld.js'

/**
 * A generated garment onto the reference body. What a 3D generator makes from a player's words or picture comes at
 * its own scale and place, in its own pose, closed into a solid, often with a mannequin still inside. This takes it
 * to where a built-in item starts (sitting on the reference body), and fitItem (fit.ts) takes it from there:
 *
 *   normalise  scale and place it by the slot's landmarks: a top by its chest, trousers by their hips, shoes by
 *              length, a hood by the head, a cape by the shoulders
 *   re-pose    swing sleeves and trouser legs about the shoulder or hip onto the body's arms and legs
 *   clip       cut what the slot doesn't reach (a mannequin's head and hands), whatever closes an opening the body
 *              passes through (the caps over a neck, a cuff, a hem), what lies inside the body, the item's inner
 *              wall, anything under its own outside (a mannequin, a lining), and stray scraps
 *   push out   every vertex into the slot's band off the skin, spreading the push so the shape survives
 *   hang       guess what hangs free: whatever stands well off the skin
 *   channels   up to four colour regions from its texture, so it recolours like a built-in item
 *
 * The server job that finishes a generated garment (src/forge/) simplifies it to the slot's budget first; one that
 * fails fitItem's checks afterwards is refunded.
 */

export interface GeneratedMesh {
  positions: Float32Array
  index: Uint32Array
  uv?: Float32Array
  /** The base colour texture, decoded (RGBA, 8 bits a channel), for the colour regions. */
  pixels?: { data: ArrayLike<number>; width: number; height: number }
  /** The texture as the item ships it (WebP). */
  texture?: Uint8Array
}

export interface Placed {
  raw: RawItem
  /** What each step did, for the job's log and the tests. */
  steps: { scale: number; reposed: string[]; clipped: Record<Clip, number>; pushed: number }
}

type Clip = 'reach' | 'caps' | 'inside' | 'inner' | 'covered' | 'scraps'

/** Room between the body and a garment's inside where the generator's own fit is measured. */
const EASE = 0.012
/** The least a generated item stands off the skin, by slot. */
const BAND: Partial<Record<ItemSlot, number>> = { upper: 0.004, lower: 0.004, full: 0.004, feet: 0.003, head: 0.004, back: 0.01 }
/** Knobs a generated item gets, by slot: they cut along the body, so they work on anything. */
const KNOBS: Partial<Record<ItemSlot, Knob[]>> = { upper: ['sleeve', 'hem'], lower: ['leg'], full: ['sleeve', 'leg'] }
/** The bones each slot may lie on (where it sits close to the skin). */
const TORSO = ['hips', 'spine', 'chest', 'upper_chest', 'clavicle_L', 'clavicle_R', 'neck']
const ARMS = ['upper_arm_L', 'upper_arm_R', 'forearm_L', 'forearm_R']
const LEGS = ['thigh_L', 'thigh_R', 'shin_L', 'shin_R']
const HANDS = ['hand_L', 'hand_R']
const FEET = ['foot_L', 'foot_R']
const REACH: Partial<Record<ItemSlot, string[]>> = {
  upper: [...TORSO, ...ARMS, ...HANDS, 'thigh_L', 'thigh_R'],
  lower: ['hips', 'spine', 'chest', ...LEGS, ...FEET],
  full: [...TORSO, ...ARMS, ...HANDS, ...LEGS, ...FEET],
  feet: ['foot_L', 'foot_R', 'shin_L', 'shin_R'],
  head: ['head', 'neck'],
  back: [...TORSO, 'upper_arm_L', 'upper_arm_R', ...LEGS],
}
const NAMES = ['main', 'second', 'third', 'fourth']

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const get = (a: ArrayLike<number>, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** v turned by `angle` about the unit axis k (Rodrigues). */
function turn(v: V3, k: V3, angle: number): V3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const kv = cross(k, v)
  const d = dot(k, v) * (1 - c)
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d]
}

function bounds(P: ArrayLike<number>, keep?: (i: number) => boolean): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity]
  const hi: V3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < P.length / 3; i++) {
    if (keep && !keep(i)) continue
    for (let d = 0; d < 3; d++) {
      lo[d] = Math.min(lo[d], P[i * 3 + d])
      hi[d] = Math.max(hi[d], P[i * 3 + d])
    }
  }
  return { lo, hi }
}

/**
 * A level cross-section of a mesh: the points where its edges cross height y (those with x within `half` of cx), and
 * how deep and wide they spread, and where. Edges rather than vertices: a coarse mesh can have no vertex near a height.
 */
function section(P: ArrayLike<number>, index: ArrayLike<number>, y: number, cx: number, half: number, keep?: (v: number) => boolean) {
  const lo = [Infinity, Infinity]
  const hi = [-Infinity, -Infinity]
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k]
      const b = index[t + ((k + 1) % 3)]
      const ya = P[a * 3 + 1] - y
      const yb = P[b * 3 + 1] - y
      if (ya > 0 === yb > 0 || (keep && !(keep(a) && keep(b)))) continue
      const f = ya / (ya - yb)
      const x = P[a * 3] + (P[b * 3] - P[a * 3]) * f
      if (Math.abs(x - cx) > half) continue
      const z = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * f
      lo[0] = Math.min(lo[0], x)
      hi[0] = Math.max(hi[0], x)
      lo[1] = Math.min(lo[1], z)
      hi[1] = Math.max(hi[1], z)
    }
  if (!(hi[0] >= lo[0])) return undefined
  return { depth: hi[1] - lo[1], width: hi[0] - lo[0], cz: (lo[1] + hi[1]) / 2, cx: (lo[0] + hi[0]) / 2, front: hi[1], back: lo[1] }
}

/** Where the reference body's landmarks are: what a generated garment is measured against. */
interface Marks {
  neck: number
  chest: number
  waist: number
  hips: number
  crotch: number
  shoulder: number
  head: { top: number; width: number; cz: number }
  foot: { length: number; x: [number, number]; cz: [number, number] }
  back: number
  chestSlice: Slice
  hipSlice: Slice
}

type Slice = NonNullable<ReturnType<typeof section>>

const marked = new WeakMap<Reference, Marks>()

function marks(ref: Reference): Marks {
  const known = marked.get(ref)
  if (known) return known
  const P = ref.shape.positions
  const V = ref.shape.surface.count
  const skin = (v: number) => ref.shape.skin[v] === 1
  const trunk = (v: number) => skin(v) && leanOn(ref, v, [...ARMS, 'hand_L', 'hand_R']) < 0.2
  const lean = (bones: string[], min: number) => (v: number) => skin(v) && leanOn(ref, v, bones) >= min
  const r = ref.rest
  const neck = r.neck[1]
  const chest = r.upper_chest[1] + 0.1
  const hips = r.hips[1]
  const head = bounds(P, (v) => v < V && lean(['head'], 0.9)(v))
  const level = (y: number, half: number) => {
    const s = section(P, ref.skin.triangles, y, 0, half, (v) => v < V && trunk(v))
    if (!s) throw new Error(`the reference body has no trunk at ${y.toFixed(2)} m`)
    return s
  }
  const feet = [lean(['foot_L'], 0.5), lean(['foot_R'], 0.5)].map((f) => bounds(P, (v) => v < V && f(v)))
  const m: Marks = {
    neck,
    chest,
    waist: r.spine[1] + 0.03,
    hips,
    crotch: r.thigh_L[1] - 0.08,
    shoulder: r.upper_arm_L[0],
    head: { top: head.hi[1], width: head.hi[0] - head.lo[0], cz: (head.lo[2] + head.hi[2]) / 2 },
    foot: { length: Math.max(...feet.map((b) => b.hi[2] - b.lo[2])), x: [(feet[0].lo[0] + feet[0].hi[0]) / 2, (feet[1].lo[0] + feet[1].hi[0]) / 2], cz: [(feet[0].lo[2] + feet[0].hi[2]) / 2, (feet[1].lo[2] + feet[1].hi[2]) / 2] },
    back: level(chest, 0.12).back,
    chestSlice: level(chest, 0.3),
    hipSlice: level(hips, 0.3),
  }
  marked.set(ref, m)
  return m
}

/** A mesh's vertices scaled by s and moved by t (per half for a pair of shoes). */
function place(P: Float32Array, s: number, t: (i: number) => V3): Float32Array {
  const out = new Float32Array(P.length)
  for (let i = 0; i < P.length / 3; i++) {
    const m = t(i)
    for (let d = 0; d < 3; d++) out[i * 3 + d] = P[i * 3 + d] * s + m[d]
  }
  return out
}

/** Scale and place the mesh by the slot's landmarks. */
function normalise(P: Float32Array, index: Uint32Array, slot: ItemSlot, m: Marks): { positions: Float32Array; scale: number } {
  // measured by what the triangles use: a mesh can carry vertices nothing draws
  const used = new Uint8Array(P.length / 3)
  for (let k = 0; k < index.length; k++) used[index[k]] = 1
  const b = bounds(P, (i) => used[i] === 1)
  const H = b.hi[1] - b.lo[1]
  const W = b.hi[0] - b.lo[0]
  const cx = (b.lo[0] + b.hi[0]) / 2
  // a section of the mesh, or the whole of it if the section comes up empty
  const cut = (y: number, half: number): Slice => section(P, index, y, cx, half) ?? { depth: b.hi[2] - b.lo[2], width: W, cz: (b.lo[2] + b.hi[2]) / 2, cx, front: b.hi[2], back: b.lo[2] }
  switch (slot) {
    case 'upper':
    case 'full': {
      // the chest: first a slice a little way down from the collar, then, with the collar at the base of the neck,
      // the slice where the body's chest falls, and so on until the two agree. Sleeves and collars don't change how
      // deep a chest is, but they move where it falls in the mesh
      const target = m.chestSlice.depth + 2 * EASE
      let g = cut(b.hi[1] - (slot === 'upper' ? 0.22 : 0.11) * H, 0.3 * W)
      let s = target / Math.max(1e-6, g.depth)
      for (let k = 0; k < 4; k++) {
        g = cut(b.hi[1] - (m.neck + 0.01 - m.chest) / s, m.chestSlice.width / 2 / s)
        s = target / Math.max(1e-6, g.depth)
      }
      return { positions: place(P, s, () => [-cx * s, m.neck + 0.01 - b.hi[1] * s, m.chestSlice.cz - g.cz * s]), scale: s }
    }
    case 'lower': {
      // the hips, found the same way from the waistband down
      const target = m.hipSlice.depth + 2 * EASE
      let g = cut(b.hi[1] - 0.08 * H, 0.4 * W)
      let s = target / Math.max(1e-6, g.depth)
      for (let k = 0; k < 4; k++) {
        g = cut(b.hi[1] - (m.waist - m.hips) / s, m.hipSlice.width / 2 / s)
        s = target / Math.max(1e-6, g.depth)
      }
      return { positions: place(P, s, () => [-cx * s, m.waist - b.hi[1] * s, m.hipSlice.cz - g.cz * s]), scale: s }
    }
    case 'feet': {
      // each half a shoe: as long as a foot and a toe's room, standing on the floor under its foot
      const left = (i: number) => P[i * 3] >= cx
      const halves = [bounds(P, (i) => used[i] === 1 && left(i)), bounds(P, (i) => used[i] === 1 && !left(i))]
      const length = Math.max(...halves.map((h) => h.hi[2] - h.lo[2]))
      const s = (m.foot.length + 0.025) / Math.max(1e-6, length)
      return {
        positions: place(P, s, (i) => {
          const k = left(i) ? 0 : 1
          const h = halves[k]
          return [m.foot.x[k] - ((h.lo[0] + h.hi[0]) / 2) * s, -b.lo[1] * s, m.foot.cz[k] - ((h.lo[2] + h.hi[2]) / 2) * s]
        }),
        scale: s,
      }
    }
    case 'head': {
      const s = (m.head.width + 2 * EASE) / Math.max(1e-6, W)
      const cz = (b.lo[2] + b.hi[2]) / 2
      return { positions: place(P, s, () => [-cx * s, m.head.top + EASE - b.hi[1] * s, m.head.cz - cz * s]), scale: s }
    }
    case 'back': {
      // as wide as the shoulders at its top, hung from the base of the neck, its back a little behind the body's
      // (whether it wraps the shoulders or hangs flat); the push out settles the rest
      // its top: the widest of a few sections from 5% to 25% of the way down
      const top = [0.05, 0.1, 0.15, 0.2, 0.25].map((k) => cut(b.hi[1] - k * H, W)).reduce((a, c) => (c.width > a.width ? c : a))
      const s = (2 * m.shoulder + 0.08) / Math.max(1e-6, top.width)
      return { positions: place(P, s, () => [-cx * s, m.neck - b.hi[1] * s, m.back - 0.03 - top.back * s]), scale: s }
    }
    default:
      throw new Error(`a generated ${slot} item isn't fitted (only wardrobe slots are)`)
  }
}

/** Triangles joined through shared (welded) edges, by piece: for scraps, and for telling trousers from a skirt. */
function pieces(id: Uint32Array, index: ArrayLike<number>, keep: (t: number) => boolean): number[][] {
  const T = index.length / 3
  const parent = Int32Array.from({ length: T }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const owner = new Map<string, number>()
  for (let t = 0; t < T; t++) {
    if (!keep(t)) continue
    for (let k = 0; k < 3; k++) {
      const a = id[index[t * 3 + k]]
      const b = id[index[t * 3 + ((k + 1) % 3)]]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const o = owner.get(key)
      if (o === undefined) owner.set(key, t)
      else parent[find(t)] = find(o)
    }
  }
  const groups = new Map<number, number[]>()
  for (let t = 0; t < T; t++) if (keep(t)) groups.get(find(t))?.push(t) ?? groups.set(find(t), [t])
  return [...groups.values()].sort((a, b) => b.length - a.length)
}

/** How far p is from the polyline through `joints`. */
function toLine(p: V3, joints: V3[]): number {
  let best = Infinity
  for (let j = 1; j < joints.length; j++) {
    const a = joints[j - 1]
    const ab = sub(joints[j], a)
    const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab))))
    best = Math.min(best, Math.hypot(a[0] + ab[0] * t - p[0], a[1] + ab[1] * t - p[1], a[2] + ab[2] * t - p[2]))
  }
  return best
}

/**
 * Swing sleeves and trouser legs about the shoulder or hip onto the body's arms and legs: each turns, in the body's
 * front plane, to where most of it lies closest round the limb's bones. A turn that gains under 5 mm is no turn: a
 * sleeve already on the arm stays where it is, a short one included (no axis needed), and so does a hanging one.
 */
function repose(P: Float32Array, index: Uint32Array, slot: ItemSlot, ref: Reference, m: Marks): string[] {
  const done: string[] = []
  const n = P.length / 3
  const r = ref.rest
  const swing = (side: 'L' | 'R', pivot: V3, select: (i: number) => boolean, limb: V3[], blend: (i: number) => number, range: [number, number], label: string) => {
    const chosen: number[] = []
    for (let i = 0; i < n; i++) if (select(i)) chosen.push(i)
    if (chosen.length < 12) return
    // turning outward is positive on both sides
    const axis: V3 = [0, 0, side === 'L' ? 1 : -1]
    const turned = (i: number, angle: number): V3 => {
      const q = turn(sub(get(P, i), pivot), axis, angle * blend(i))
      return [pivot[0] + q[0], pivot[1] + q[1], pivot[2] + q[2]]
    }
    // the median distance from the limb's bones
    const miss = (angle: number) => {
      const d = chosen.map((i) => toLine(turned(i, angle), limb)).sort((a, b) => a - b)
      return d[d.length >> 1]
    }
    const still = miss(0)
    let best = 0
    let least = still
    for (const step of [0.05, 0.01]) {
      const [from, to] = step === 0.05 ? range : [best - 0.05, best + 0.05]
      for (let a = from; a <= to + 1e-9; a += step) {
        const d = miss(a)
        if (d < least) [best, least] = [a, d]
      }
    }
    if (still - least < 0.005) return
    for (let i = 0; i < n; i++) if (blend(i) > 0) P.set(turned(i, best), i * 3)
    done.push(`${label} ${Math.round((best * 180) / Math.PI)}°`)
  }
  const along = (a: V3, b: V3, k: number): V3 => [b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k, b[2] + (b[2] - a[2]) * k]
  if (slot === 'upper' || slot === 'full') {
    for (const [side, sx] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      const out = (i: number) => sx * P[i * 3]
      const arm = [r[`upper_arm_${side}`], r[`forearm_${side}`], r[`hand_${side}`], along(r[`forearm_${side}`], r[`hand_${side}`], 0.45)]
      // held out as far as a T-pose, or in a little closer than the body's arms
      swing(side, r[`upper_arm_${side}`], (i) => out(i) > m.shoulder + 0.04 && P[i * 3 + 1] > m.hips + 0.05, arm, (i) => (P[i * 3 + 1] > m.hips ? smooth(m.shoulder, m.shoulder + 0.1, out(i)) : 0), [-1.6, 0.5], `sleeve ${side}`)
    }
  }
  if (slot === 'lower' || slot === 'full') {
    // legs only where the cloth parts in two below the crotch: trousers, not a skirt
    const { id } = weldPositions(P)
    const low = m.crotch - 0.06
    const below = pieces(id, index, (t) => [0, 1, 2].every((k) => P[index[t * 3 + k] * 3 + 1] < low))
    const total = below.reduce((acc, p) => acc + p.length, 0)
    if (below.length >= 2 && below[1].length > total * 0.2) {
      for (const [side, sx] of [
        ['L', 1],
        ['R', -1],
      ] as const) {
        const leg = [r[`thigh_${side}`], r[`shin_${side}`], r[`foot_${side}`]]
        swing(side, r[`thigh_${side}`], (i) => sx * P[i * 3] > 0 && P[i * 3 + 1] < low, leg, (i) => (sx * P[i * 3] > 0 ? smooth(m.crotch, m.crotch - 0.15, P[i * 3 + 1]) : 0), [-0.5, 0.6], `leg ${side}`)
      }
    }
  }
  return done
}

/** The bone a bound point leans on most. */
function boneAt(ref: Reference, binding: Binding, i: number): string {
  const s = binding.st[i * 2]
  const t = binding.st[i * 2 + 1]
  const bary = [1 - s - t, s, t]
  const acc = new Map<number, number>()
  for (let c = 0; c < 3; c++) {
    const v = binding.tri[i * 3 + c]
    for (let k = 0; k < 4; k++) {
      const j = ref.shape.joints[v * 4 + k]
      acc.set(j, (acc.get(j) ?? 0) + ref.shape.weights[v * 4 + k] * bary[c])
    }
  }
  let best = 0
  let most = -1
  for (const [j, w] of acc) if (w > most) [best, most] = [j, w]
  return ref.bones[best]
}

/** The interpolated (unit) skin normal at each bound point. */
function skinNormals(ref: Reference, binding: Binding): Float32Array {
  const N = ref.skin.normals
  const out = new Float32Array(binding.lift.length * 3)
  for (let i = 0; i < binding.lift.length; i++) {
    const s = binding.st[i * 2]
    const t = binding.st[i * 2 + 1]
    const [a, b, c] = [binding.tri[i * 3], binding.tri[i * 3 + 1], binding.tri[i * 3 + 2]]
    const n = unit([0, 1, 2].map((d) => N[a * 3 + d] * (1 - s - t) + N[b * 3 + d] * s + N[c * 3 + d] * t) as V3)
    out.set(n, i * 3)
  }
  return out
}

/** The bones' lines through the body: whatever crosses one closes an opening the body passes through. */
function boneLines(ref: Reference): [V3, V3][] {
  const r = ref.rest
  const along = (a: V3, b: V3, k: number): V3 => [b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k, b[2] + (b[2] - a[2]) * k]
  const lines: [V3, V3][] = []
  const chain = (...ps: V3[]) => ps.slice(1).forEach((p, i) => lines.push([ps[i], p]))
  chain(r.hips, r.spine, r.chest, r.upper_chest, r.neck, r.head, [r.head[0], r.head[1] + 0.2, r.head[2]])
  for (const s of ['L', 'R']) {
    chain(r[`clavicle_${s}`], r[`upper_arm_${s}`], r[`forearm_${s}`], r[`hand_${s}`], along(r[`forearm_${s}`], r[`hand_${s}`], 0.45))
    chain(r.hips, r[`thigh_${s}`], r[`shin_${s}`], r[`foot_${s}`], [r[`foot_${s}`][0], 0.02, r[`foot_${s}`][2] + 0.16])
  }
  return lines
}

function faceNormal(P: ArrayLike<number>, index: ArrayLike<number>, t: number): V3 {
  const a = get(P, index[t * 3])
  return unit(cross(sub(get(P, index[t * 3 + 1]), a), sub(get(P, index[t * 3 + 2]), a)))
}

function centroid(P: ArrayLike<number>, index: ArrayLike<number>, t: number): V3 {
  const out: V3 = [0, 0, 0]
  for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) out[d] += P[index[t * 3 + k] * 3 + d] / 3
  return out
}

/** Which triangles stay, and why the rest went. */
function clip(P: Float32Array, index: Uint32Array, binding: Binding, slot: ItemSlot, ref: Reference): { keep: Uint8Array; clipped: Record<Clip, number> } {
  const T = index.length / 3
  const n = P.length / 3
  const keep = new Uint8Array(T).fill(1)
  const clipped: Record<Clip, number> = { reach: 0, caps: 0, inside: 0, inner: 0, covered: 0, scraps: 0 }
  const drop = (t: number, why: Clip) => {
    if (!keep[t]) return
    keep[t] = 0
    clipped[why]++
  }
  const { id } = weldPositions(P)
  // what the slot doesn't reach: a vertex close on the skin over a bone the slot doesn't cover (a mannequin's head or
  // hands); cloth well off the skin is cloth, whatever it hangs over (a gown's hem over the feet)
  const allowed = new Set(REACH[slot] ?? [])
  const fields = { arm: fieldAt(ref.fields.arm, binding.tri, binding.st), leg: fieldAt(ref.fields.leg, binding.tri, binding.st) }
  const outside = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (Math.abs(binding.lift[i]) > 0.03) continue
    const bone = boneAt(ref, binding, i)
    // a cuff may reach the wrist and a trouser leg the top of the foot, but not past them
    const beyond =
      (/^(forearm|hand)/.test(bone) && fields.arm[i] > 1.02) ||
      (slot !== 'feet' && /^(shin|foot)/.test(bone) && fields.leg[i] > 1.04) ||
      (slot === 'upper' && bone.startsWith('thigh') && fields.leg[i] > 0.35) ||
      (slot === 'feet' && fields.leg[i] < 0.5)
    if (!allowed.has(bone) || beyond) outside[i] = 1
  }
  for (let t = 0; t < T; t++) if (outside[index[t * 3]] || outside[index[t * 3 + 1]] || outside[index[t * 3 + 2]]) drop(t, 'reach')

  // caps: the body's bones pass through every opening, so a triangle a bone line crosses closes one; the cap is it and
  // the triangles round it lying the same way (a tube's wall turns away at the cap's edge)
  const bvh = new TriangleBVH(P, index)
  const seeds = new Set<number>()
  for (const [a, b] of boneLines(ref)) {
    const d = sub(b, a)
    const len = Math.hypot(d[0], d[1], d[2])
    if (len < 1e-6) continue
    for (const h of bvh.hits(a, unit(d), 0, len)) seeds.add(h.triangle)
  }
  if (seeds.size) {
    const byEdge = new Map<string, number[]>()
    for (let t = 0; t < T; t++)
      for (let k = 0; k < 3; k++) {
        const a = id[index[t * 3 + k]]
        const b = id[index[t * 3 + ((k + 1) % 3)]]
        const key = a < b ? `${a},${b}` : `${b},${a}`
        byEdge.get(key)?.push(t) ?? byEdge.set(key, [t])
      }
    const seen = new Uint8Array(T)
    for (const seed of seeds) {
      if (seen[seed]) continue
      const facing = faceNormal(P, index, seed)
      const origin = centroid(P, index, seed)
      const stack = [seed]
      seen[seed] = 1
      while (stack.length) {
        const t = stack.pop()!
        drop(t, 'caps')
        for (let k = 0; k < 3; k++) {
          const a = id[index[t * 3 + k]]
          const b = id[index[t * 3 + ((k + 1) % 3)]]
          for (const u of byEdge.get(a < b ? `${a},${b}` : `${b},${a}`) ?? []) {
            if (seen[u]) continue
            const c = centroid(P, index, u)
            if (Math.abs(dot(faceNormal(P, index, u), facing)) < 0.77 || Math.hypot(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]) > 0.3) continue
            seen[u] = 1
            stack.push(u)
          }
        }
      }
    }
  }

  // inside the body: all three corners more than 8 mm under the skin
  const deep = (i: number) => binding.lift[i] < -0.008
  for (let t = 0; t < T; t++) if (deep(index[t * 3]) && deep(index[t * 3 + 1]) && deep(index[t * 3 + 2])) drop(t, 'inside')

  // the inner wall: facing the skin under it
  const skinN = skinNormals(ref, binding)
  for (let t = 0; t < T; t++) {
    if (!keep[t]) continue
    const f = faceNormal(P, index, t)
    let toward = 0
    for (let k = 0; k < 3; k++) toward += dot(f, get(skinN, index[t * 3 + k])) / 3
    if (toward < -0.3) drop(t, 'inner')
  }

  // under its own outside: looking out from it, the item again, facing the same way (a mannequin, a lining)
  const kept: number[] = []
  for (let t = 0; t < T; t++) if (keep[t]) kept.push(t)
  const outer = new Uint32Array(kept.length * 3)
  kept.forEach((t, j) => outer.set([index[t * 3], index[t * 3 + 1], index[t * 3 + 2]], j * 3))
  const shell = new TriangleBVH(P, outer)
  const covered: number[] = []
  for (const t of kept) {
    const f = faceNormal(P, index, t)
    const c = centroid(P, index, t)
    for (const h of shell.hits([c[0] + f[0] * 1e-3, c[1] + f[1] * 1e-3, c[2] + f[2] * 1e-3], f, 0, 0.05)) {
      const u = kept[h.triangle]
      if (u !== t && dot(faceNormal(P, index, u), f) > 0.3) {
        covered.push(t)
        break
      }
    }
  }
  for (const t of covered) drop(t, 'covered')

  // scraps: pieces too small to be the garment
  const left = pieces(id, index, (t) => keep[t] === 1)
  const total = left.reduce((acc, p) => acc + p.length, 0)
  for (const p of left) if (p.length < total * 0.02) for (const t of p) drop(t, 'scraps')
  return { keep, clipped }
}

/** Up to four colour regions from the texture: k-means over each vertex's colour, small or close regions merged. */
function colourRegions(mesh: GeneratedMesh, keep: number[]): { channel: Uint8Array; colors: string[] } {
  const n = keep.length
  const channel = new Uint8Array(n)
  const px = mesh.pixels
  if (!px || !mesh.uv) return { channel, colors: ['#808080'] }
  const colors = new Float32Array(n * 3)
  keep.forEach((v, i) => {
    const u = mesh.uv![v * 2] - Math.floor(mesh.uv![v * 2])
    const w = mesh.uv![v * 2 + 1] - Math.floor(mesh.uv![v * 2 + 1])
    const x = Math.min(px.width - 1, Math.floor(u * px.width))
    const y = Math.min(px.height - 1, Math.floor(w * px.height))
    const o = (y * px.width + x) * 4
    for (let d = 0; d < 3; d++) colors[i * 3 + d] = px.data[o + d] / 255
  })
  const col = (i: number): V3 => [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]]
  const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  // seeds: the first colour, then each next the one furthest from those picked
  const centres: V3[] = [col(0)]
  while (centres.length < Math.min(4, n)) {
    let far = 0
    let best = -1
    for (let i = 0; i < n; i++) {
      const d = Math.min(...centres.map((c) => dist(c, col(i))))
      if (d > best) [far, best] = [i, d]
    }
    if (best < 0.05) break
    centres.push(col(far))
  }
  const assign = () => {
    for (let i = 0; i < n; i++) {
      let k = 0
      for (let j = 1; j < centres.length; j++) if (dist(centres[j], col(i)) < dist(centres[k], col(i))) k = j
      channel[i] = k
    }
  }
  for (let it = 0; it < 12; it++) {
    assign()
    const sum = centres.map(() => [0, 0, 0, 0])
    for (let i = 0; i < n; i++) {
      const s = sum[channel[i]]
      for (let d = 0; d < 3; d++) s[d] += colors[i * 3 + d]
      s[3]++
    }
    sum.forEach((s, k) => {
      if (s[3]) centres[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
    })
  }
  // merge regions closer than a shade apart, and fold any under 4% into its nearest
  for (let merged = true; merged && centres.length > 1; ) {
    merged = false
    assign()
    const share = centres.map((_, k) => channel.filter((c) => c === k).length / n)
    for (let a = 0; a < centres.length && !merged; a++)
      for (let b = a + 1; b < centres.length && !merged; b++) {
        if (dist(centres[a], centres[b]) < 0.12 || share[b] < 0.04 || share[a] < 0.04) {
          const [keepK, dropK] = share[a] >= share[b] ? [a, b] : [b, a]
          const w = share[keepK] + share[dropK] || 1
          centres[keepK] = [0, 1, 2].map((d) => (centres[keepK][d] * share[keepK] + centres[dropK][d] * share[dropK]) / w) as V3
          centres.splice(dropK, 1)
          merged = true
        }
      }
  }
  assign()
  // the biggest region first
  const share = centres.map((_, k) => channel.filter((c) => c === k).length)
  const order = centres.map((_, k) => k).sort((a, b) => share[b] - share[a])
  const rank = new Uint8Array(centres.length)
  order.forEach((k, r) => (rank[k] = r))
  for (let i = 0; i < n; i++) channel[i] = rank[channel[i]]
  const hex = (c: V3) => `#${c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`
  return { channel, colors: order.map((k) => hex(centres[k])) }
}

/** A generated garment placed on the reference body, ready for fitItem. */
export function placeGenerated(mesh: GeneratedMesh, spec: Omit<RawSpec, 'channels'> & { channels?: ItemChannel[] }, ref: Reference): Placed {
  const m = marks(ref)
  const { positions: P, scale } = normalise(mesh.positions, mesh.index, spec.slot, m)
  const reposed = repose(P, mesh.index, spec.slot, ref, m)
  // nothing binds a metre and more from the body
  const box = bounds(ref.skin.positions)
  const far = (i: number) => [0, 1, 2].some((d) => P[i * 3 + d] < box.lo[d] - 0.6 || P[i * 3 + d] > box.hi[d] + 0.6)
  const near = new Uint8Array(P.length / 3)
  for (let i = 0; i < near.length; i++) near[i] = far(i) ? 0 : 1
  const binding = bindPoints(P.map((x, k) => (near[(k / 3) | 0] ? x : 0)), ref.skin, ref.grid, 1.0)
  const { keep, clipped } = clip(P, mesh.index, binding, spec.slot, ref)
  for (let t = 0; t < keep.length; t++) if (!near[mesh.index[t * 3]] || !near[mesh.index[t * 3 + 1]] || !near[mesh.index[t * 3 + 2]]) keep[t] = 0

  // what's left, re-indexed
  const of = new Int32Array(P.length / 3).fill(-1)
  const kept: number[] = []
  const index: number[] = []
  for (let t = 0; t < keep.length; t++) {
    if (!keep[t]) continue
    for (let k = 0; k < 3; k++) {
      const v = mesh.index[t * 3 + k]
      if (of[v] < 0) {
        of[v] = kept.length
        kept.push(v)
      }
      index.push(of[v])
    }
  }
  if (!index.length) throw new Error('nothing of the generated item is left once clipped to its slot')
  const n = kept.length
  const sub3 = (a: ArrayLike<number>) => Float32Array.from({ length: n * 3 }, (_, k) => a[kept[(k / 3) | 0] * 3 + (k % 3)])
  const b: Binding = {
    tri: Uint16Array.from({ length: n * 3 }, (_, k) => binding.tri[kept[(k / 3) | 0] * 3 + (k % 3)]),
    st: Float32Array.from({ length: n * 2 }, (_, k) => binding.st[kept[(k / 2) | 0] * 2 + (k % 2)]),
    lift: Float32Array.from(kept, (v) => binding.lift[v]),
  }

  // push out: up to the slot's band, and the push spread over the neighbours so a dent doesn't fold
  const band = BAND[spec.slot] ?? 0.004
  const { id, count } = weldPositions(sub3(P))
  const lift = new Float32Array(count).fill(Infinity)
  for (let i = 0; i < n; i++) lift[id[i]] = Math.min(lift[id[i]], b.lift[i])
  const push = new Float32Array(count)
  let pushed = 0
  for (let w = 0; w < count; w++) if (lift[w] < band) (push[w] = band - lift[w]), pushed++
  const nbrs: number[][] = Array.from({ length: count }, () => [])
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = id[index[t + k]]
      const c = id[index[t + ((k + 1) % 3)]]
      nbrs[a].push(c)
      nbrs[c].push(a)
    }
  for (let it = 0; it < 6; it++) {
    const next = Float32Array.from(push)
    for (let w = 0; w < count; w++) {
      if (!nbrs[w].length) continue
      const mean = nbrs[w].reduce((acc, u) => acc + push[u], 0) / nbrs[w].length
      next[w] = Math.max(push[w], mean * 0.7)
    }
    push.set(next)
  }
  for (let i = 0; i < n; i++) b.lift[i] += push[id[i]]
  const positions = evaluate(b, ref.skin)
  const indexArray = Uint32Array.from(index)

  // what hangs: whatever stands well off the skin (a skirt below the hips, a sleeve's drop, a cape)
  const hangs = spec.slot !== 'feet' && spec.slot !== 'head'
  const hang = new Float32Array(n)
  if (hangs) for (let i = 0; i < n; i++) hang[i] = smooth(0.03, 0.09, b.lift[i])

  const regions = colourRegions(mesh, kept)
  const channels: ItemChannel[] = spec.channels ?? regions.colors.map((color, k) => ({ name: NAMES[k], color, finish: 'cotton' }))
  const raw: RawItem = {
    spec: { ...spec, channels, knobs: spec.knobs ?? KNOBS[spec.slot] ?? [] },
    positions,
    normals: meshNormals(positions, indexArray),
    index: indexArray,
    ...(mesh.uv ? { uv: Float32Array.from({ length: n * 2 }, (_, k) => mesh.uv![kept[(k / 2) | 0] * 2 + (k % 2)]) } : {}),
    channel: regions.channel,
    ...(hangs && hang.some((h) => h > 0) ? { hang } : {}),
    ...(mesh.texture ? { texture: mesh.texture } : {}),
  }
  return { raw, steps: { scale, reposed, clipped, pushed } }
}
