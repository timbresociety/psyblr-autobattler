import { STANDARD_BONES } from '../rig/standard.js'
import type { Skeleton, Skin, Vec3 } from './regions.js'

/**
 * The skeleton fits a generated body (GAME.md §9.5): a new mesh in the hero's frame (y up, facing +z, feet on the
 * floor) gets the base body's skin weights and a skeleton with the same names and hierarchy, so every clip plays on it
 * unchanged. Renderer-free:
 *
 * 1. The base body is laid over the new one by its height and its middle (`alignment`).
 * 2. Each new vertex takes the weights of the nearest base vertex (`transferWeights`).
 * 3. Each joint, parents first, goes to the middle of the ring where the new body's skin passes from the parent bone
 *    to the joint's own, the volume's middle at the joint, set off as the base's joint is from the base's ring
 *    (`fitJoints`). Joints with no ring of their own (the head, jaw, eyes, fingers and ends) keep their offset from
 *    their fitted parent.
 */

export interface Alignment {
  /** Per axis: across by width, up by height, front to back by depth. */
  scale: Vec3
  /** Added after scaling: base point × scale + offset lands on the new body. */
  offset: Vec3
}

/** The base laid over the target: the same standing height, the same middle across and front to back, both on the floor. */
export function alignment(target: ArrayLike<number>, base: ArrayLike<number>): Alignment {
  const box = (p: ArrayLike<number>) => {
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k])
        hi[k] = Math.max(hi[k], p[i + k])
      }
    return { lo, hi }
  }
  const t = box(target)
  const b = box(base)
  const scale = [0, 1, 2].map((k) => (t.hi[k] - t.lo[k]) / (b.hi[k] - b.lo[k])) as Vec3
  const mid = (x: { lo: number[]; hi: number[] }, k: number) => (x.lo[k] + x.hi[k]) / 2
  return { scale, offset: [mid(t, 0) - mid(b, 0) * scale[0], t.lo[1] - b.lo[1] * scale[1], mid(t, 2) - mid(b, 2) * scale[2]] }
}

const place = (a: Alignment, p: ArrayLike<number>, i = 0): Vec3 => [p[i] * a.scale[0] + a.offset[0], p[i + 1] * a.scale[1] + a.offset[1], p[i + 2] * a.scale[2] + a.offset[2]]

/** A grid of points for nearest-point lookups. */
function grid(points: Float32Array, cell: number) {
  const cells = new Map<string, number[]>()
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
  for (let i = 0; i < points.length / 3; i++) {
    const k = key(points[i * 3], points[i * 3 + 1], points[i * 3 + 2])
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  }
  return (x: number, y: number, z: number): number => {
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    const cz = Math.floor(z / cell)
    let best = -1
    let bestD = Infinity
    // rings outward until one has a point and the next ring can't hold a nearer one
    for (let r = 0; r < 64; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue
            const list = cells.get(`${cx + dx},${cy + dy},${cz + dz}`)
            if (!list) continue
            for (const i of list) {
              const d = (points[i * 3] - x) ** 2 + (points[i * 3 + 1] - y) ** 2 + (points[i * 3 + 2] - z) ** 2
              if (d < bestD) (bestD = d), (best = i)
            }
          }
      if (best >= 0 && Math.sqrt(bestD) <= r * cell) return best
    }
    return best
  }
}

/** The base's weights on the target: each target vertex takes its nearest base vertex's (skin to skin). */
export function transferWeights(target: ArrayLike<number>, base: Skin, align: Alignment): { joints: Uint16Array; weights: Float32Array } {
  const n = target.length / 3
  const m = base.positions.length / 3
  const placed = new Float32Array(m * 3)
  for (let i = 0; i < m; i++) placed.set(place(align, base.positions, i * 3), i * 3)
  // eyes and other loose pieces take part only where they are skin on both
  const ids = Array.from({ length: m }, (_, i) => i).filter((i) => !base.skin || base.skin[i])
  const pts = new Float32Array(ids.length * 3)
  ids.forEach((id, k) => pts.set(placed.subarray(id * 3, id * 3 + 3), k * 3))
  const nearest = grid(pts, 0.03 * align.scale[1])
  const joints = new Uint16Array(n * 4)
  const weights = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const j = ids[nearest(target[i * 3], target[i * 3 + 1], target[i * 3 + 2])]
    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = base.joints[j * 4 + k]
      weights[i * 4 + k] = base.weights[j * 4 + k]
    }
  }
  return { joints, weights }
}

/** Joints placed by their parent, not by a ring of their own. */
const CARRIED = (name: string, kind: string) => kind === 'finger' || kind === 'end' || kind === 'face' || kind === 'twist' || /^Head$|Jaw|Eye/.test(name)

/**
 * The middle of the ring where a joint's skin passes from its parent's bone to its own: every vertex both bones hold,
 * by the smaller share. The ring goes round the limb at the joint, so its middle is inside the limb there.
 */
function ring(skin: Skin, bone: number, parent: number): Vec3 | undefined {
  const sum: Vec3 = [0, 0, 0]
  let total = 0
  const n = skin.positions.length / 3
  for (let i = 0; i < n; i++) {
    if (skin.skin && !skin.skin[i]) continue
    let a = 0
    let b = 0
    for (let k = 0; k < 4; k++) {
      const j = skin.joints[i * 4 + k]
      if (j === bone) a += skin.weights[i * 4 + k]
      else if (j === parent) b += skin.weights[i * 4 + k]
    }
    const w = Math.min(a, b)
    if (w < 0.05) continue
    for (let k = 0; k < 3; k++) sum[k] += skin.positions[i * 3 + k] * w
    total += w
  }
  return total < 0.5 ? undefined : [sum[0] / total, sum[1] / total, sum[2] / total]
}

/**
 * Every standard joint on the target, parents first. `skin` is the target with its (transferred) weights in the base
 * skeleton's bone order; `baseSkin` and `base` the base body and its skeleton at rest. Each joint sits where its ring
 * sits on the target, moved as far from it as the base's joint is from the base's ring (scaled), so the base itself
 * refits exactly; joints without a ring keep their offset from their fitted parent.
 */
export function fitJoints(skin: Skin, baseSkin: Skin, base: Skeleton, align: Alignment): Record<string, Vec3> {
  const out: Record<string, Vec3> = {}
  const index = new Map(base.bones.map((b, i) => [b, i]))
  for (const b of STANDARD_BONES) {
    const rest = base.rest[b.name]
    if (!rest) continue
    const parentRest = b.parent ? base.rest[b.parent] : undefined
    const parentAt = b.parent ? out[b.parent] : undefined
    const carried = (): Vec3 => (parentRest && parentAt ? ([0, 1, 2].map((k) => parentAt[k] + (rest[k] - parentRest[k]) * align.scale[k]) as Vec3) : place(align, rest))
    // the hips' ring is with the spine above them
    const other = b.parent ?? STANDARD_BONES.find((c) => c.parent === b.name)?.name
    const bi = index.get(b.name)
    const oi = other ? index.get(other) : undefined
    const there = !CARRIED(b.name, b.kind) && bi !== undefined && oi !== undefined ? ring(skin, bi, oi) : undefined
    const baseThere = there ? ring(baseSkin, bi!, oi!) : undefined
    out[b.name] = there && baseThere ? ([0, 1, 2].map((k) => there[k] + (rest[k] - baseThere[k]) * align.scale[k]) as Vec3) : carried()
  }
  return out
}
