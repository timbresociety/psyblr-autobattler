import { bindPoints, evaluate, surfaceFrame, toLocal } from '../wear/bind.js'
import { fieldAt } from '../wear/fields.js'
import { CARD_U, checkMeta, surfaceItem, type ItemChannel, type ItemMeta, type ItemSlot, type Knob, type SurfaceItem } from '../wear/item.js'
import { chainsOf } from './chains.js'
import type { V3 } from '../wear/ray.js'
import { TriangleBVH } from '../wear/ray.js'
import { leanOn, type Reference } from './reference.js'
import { kitRigOf } from '../rig/names.js'
import { weldPositions } from '../wear/weld.js'
import type { ItemFile } from './write.js'

/**
 * The fit pipeline: any garment, hairstyle or hat mesh, sitting on the reference body, into an item file that fits
 * every body. Blender's built-in items arrive already in place (tools/blender/wardrobe.py); generated ones are first
 * normalised, re-posed, clipped and pushed out (generated.ts). Both then go the same road:
 *
 *   bury     drop what lies under the item's own outer parts (a robe under its obi): it could only poke through
 *   bind     every vertex to the skin triangle under it (src/kit/wear/bind.ts)
 *   cover    which body vertices it lies over, how far out, and which of those it hides (rays along the skin's normals)
 *   chains   the loose cloth, as rows of short particle chains (chains.ts)
 *   check    slot coverage, nothing under the skin, the triangle budget, and binding error
 *
 * A generated item that fails its checks is refunded (src/forge); a built-in one fails the build.
 */

/** A mesh to fit, with what the item is. Positions in glTF axes (y up, the body facing +z), metres. */
export interface RawItem {
  spec: RawSpec
  positions: Float32Array
  normals?: Float32Array
  uv?: Float32Array
  index: Uint32Array
  /** Per vertex, which channel. */
  channel?: Uint8Array
  /** Per vertex, 0 riding the body to 1 hanging free. */
  hang?: Float32Array
  /** Per vertex, 0 at a strand's or panel's root to 1 at its longest tip (for the length knob). */
  len?: Float32Array
  texture?: Uint8Array
}

export interface RawSpec {
  id: string
  name: string
  slot: ItemSlot
  hides?: boolean
  channels: ItemChannel[]
  knobs?: Knob[]
  tags?: string[]
  /** How well loose parts hold their shape, 0 to 1 (the slot's default otherwise). */
  stiff?: number
  /** Rides one bone whole (ItemMeta.hard): hats, helmets, a lacquered mask. */
  hard?: boolean
}

/** Triangles per item, by slot: a whole outfit stays light enough for twenty heroes. */
export const BUDGET: Record<ItemSlot, number> = { hair: 3200, beard: 1200, head: 2400, upper: 4200, lower: 3000, full: 6400, back: 3200, feet: 1800, face: 2400, hand: 1200, offhand: 1200 }
/** Hair cards (u past CARD_U) are drawn in the creator's close look alone, so they count apart, against their own budget. */
export const CARD_BUDGET = 14000

/** How far a cover reaches out from the skin, and how close an item must lie to hide what's under it. */
const REACH = 0.32
/**
 * How far out an item may stand and still hide the skin under it. A hanging part never hides (hang, below); a
 * standing one does from this far. At 2.5 cm the skin under a trouser's loose front, which stood 3 cm off the
 * thigh, stayed shown, and showed through once the trousers were pressed in under a jacket's hem.
 */
const TIGHT = 0.06
/** Layers of one item within this of each other count as one (a solid shell's two sides, a collar on a shirt). */
const RUN = 0.03
const START = 0.003
/** How far from the skin a vertex may bind: a gown's hem, out past the toes, lies a metre out along the normal of the skin it binds to. */
const BIND_REACH = 1.2
/** How far over one part of an item another may lie and still bury it: an obi over a robe, a jacket over its shirt. */
/**
 * How far out a part may lie and still bury what's under it: layers lie within a centimetre and a half (a robe under
 * its obi, a shirt under a jacket). Set to TIGHT, a cargo pocket standing two centimetres and more off the thigh buried
 * the trouser leg under it, and stood too far out itself to hide the skin: the skin showed in a pocket-shaped hole.
 */
const BURY = 0.015
/** Whether triangles buried whole are dropped (false: every one stays, tucked), see unburied. */
const DROP_BURIED = false
/** Closer than this (past the millimetre the ray starts out), what a ray meets is the part's own seam, not a layer over it. */
const BURY_NEAR = 0.002
/** A buried vertex a showing triangle still needs is tucked at least this far under what buries it, and no closer to the skin than TUCK_FLOOR. */
const TUCK = 0.01
const TUCK_FLOOR = 0.002
/** How squarely a part must face the skin's normal to bury what's under it (the cosine): over it, not beside it. */
const OVER = 0.5
/** How far out an item that hides the skin is kept over it, by slot (pushOut). */
const BAND: Partial<Record<ItemSlot, number>> = { feet: 0.003, head: 0.004 }
const BAND_DEFAULT = 0.0025
/** How far under the skin an item's outer surface may dip: hair, beards and helmets tuck their edges in by design. */
const DIP: Partial<Record<ItemSlot, number>> = { hair: 0.012, beard: 0.012, head: 0.008 }

export interface Covers {
  covers: number[]
  shell: number[]
  hidden: number[]
}

/**
 * What a mesh covers on the reference body: for each skin vertex, a ray out along its normal (from just under the
 * skin, so an edge dipped into it counts). The first hit is the item's inner surface there, the end of that run of
 * hits its outer one. A hit behind more body (an inner thigh looking at the other leg), or lying on it, doesn't count. The item hides
 * a vertex when it lies within TIGHT of it and doesn't hang there.
 */
export function coversOf(ref: Reference, positions: ArrayLike<number>, index: ArrayLike<number>, hides: boolean, hang?: ArrayLike<number>): Covers {
  const bvh = new TriangleBVH(positions, index)
  const P = ref.shape.positions
  const N = ref.shape.normals
  const covers: number[] = []
  const shell: number[] = []
  const hidden: number[] = []
  for (let v = 0; v < ref.shape.surface.count; v++) {
    if (!ref.shape.skin[v]) continue
    const n: V3 = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]]
    const o: V3 = [P[v * 3] - n[0] * START, P[v * 3 + 1] - n[1] * START, P[v * 3 + 2] - n[2] * START]
    const hits = bvh.hits(o, n, 0, REACH + START)
    if (!hits.length) continue
    // more body in the way: the ray left the skin around v and went into someone else's limb
    const block = ref.bvh.first([P[v * 3] + n[0] * 0.006, P[v * 3 + 1] + n[1] * 0.006, P[v * 3 + 2] + n[2] * 0.006], n, 0, REACH)
    const limit = block ? block.t + 0.006 + START : Infinity
    // and what lies nearer the body beyond it than this vertex belongs to that body: an arm looking across at the
    // shirt on the torso isn't covered by it
    if (hits[0].t >= limit || limit - hits[0].t < hits[0].t - START) continue
    let last = 0
    while (last + 1 < hits.length && hits[last + 1].t < limit && hits[last + 1].t - hits[last].t <= RUN) last++
    const inner = hits[0].t - START
    const outer = hits[last].t - START
    covers.push(v)
    shell.push(Math.round(inner * 1e4), Math.round(outer * 1e4))
    if (!hides || inner > TIGHT) continue
    if (hang) {
      const h = hits[0]
      const t = h.triangle * 3
      const free = hang[index[t]] * (1 - h.u - h.v) + hang[index[t + 1]] * h.u + hang[index[t + 2]] * h.v
      if (free > 0.05) continue
    }
    hidden.push(v)
  }
  return { covers, shell, hidden }
}

/**
 * An item without the parts that lie under its own outer parts (a robe under its obi, a shirt under its jacket). Two
 * layers a few millimetres apart on the reference can cross on a body shaped unlike it, and the inner one pokes
 * through; a part that isn't there can't. A vertex is buried when a ray out along the skin's normal meets the item
 * again within BURY, from behind (an outer part's back). Neither end may hang, since a swinging part would uncover what
 * it lay over. The vertex must face out, so a solid's inner wall stays. And what it meets must lie nearer this body than
 * any other limb, so a sleeve doesn't bury the torso beside it. Triangles with all three corners buried go, and so do
 * the vertices only they used. A buried vertex that a showing triangle still needs (along an obi's edges) is tucked
 * TUCK under what buries it, the way cloth tucks under a belt.
 */
export function unburied(raw: RawItem, ref: Reference): { raw: RawItem; buried: number } {
  const P = raw.positions
  const n = P.length / 3
  const index = raw.index
  const normals = raw.normals ?? meshNormals(P, index)
  const binding = bindPoints(P, ref.skin, ref.grid, BIND_REACH)
  const bvh = new TriangleBVH(P, index)
  const { id } = weldPositions(P)
  const S = ref.skin.positions
  const frame = new Float32Array(9)
  const hangAt = (h: { triangle: number; u: number; v: number }) =>
    raw.hang ? raw.hang[index[h.triangle * 3]] * (1 - h.u - h.v) + raw.hang[index[h.triangle * 3 + 1]] * h.u + raw.hang[index[h.triangle * 3 + 2]] * h.v : 0
  // the welded neighbours two edges out from each vertex: a surface folding over itself (a waistband's ring over the
  // thigh, a cuff) is one part, and never buries the vertices next to it in the mesh
  const nbrs: Set<number>[] = Array.from({ length: n }, () => new Set<number>())
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = id[index[t + k]]
      const c = id[index[t + ((k + 1) % 3)]]
      nbrs[a].add(c)
      nbrs[c].add(a)
    }
  const near = (v: number, w: number) => {
    const a = id[v]
    const b = id[w]
    if (a === b || nbrs[a].has(b)) return true
    for (const u of nbrs[a]) if (nbrs[u].has(b)) return true
    return false
  }
  // per vertex, how far out the part burying it lies (NaN: not buried)
  const buried = new Float32Array(n).fill(NaN)
  const normal = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    if ((raw.hang?.[v] ?? 0) > 0.05) continue
    surfaceFrame(binding, ref.skin, v, frame)
    const d: V3 = [frame[3], frame[4], frame[5]]
    normal.set(d, v * 3)
    if (normals[v * 3] * d[0] + normals[v * 3 + 1] * d[1] + normals[v * 3 + 2] * d[2] <= 0) continue
    let over = -1
    for (const h of bvh.hits([P[v * 3] + d[0] * 0.001, P[v * 3 + 1] + d[1] * 0.001, P[v * 3 + 2] + d[2] * 0.001], d, 0, BURY)) {
      const [a, b, c] = [index[h.triangle * 3], index[h.triangle * 3 + 1], index[h.triangle * 3 + 2]]
      // a part overlapping this one by under BURY_NEAR is a seam (a waistband's rows meeting the legs'), not a layer
      if (h.t < BURY_NEAR || near(v, a) || near(v, b) || near(v, c)) continue
      if (!fromBehind(P, a, b, c, d, OVER) || hangAt(h) > 0.05) continue
      over = h.t + 0.001
      break
    }
    if (over < 0) continue
    // the skin under v: is another limb nearer what lies over it?
    const ia = binding.tri[v * 3] * 3
    const ib = binding.tri[v * 3 + 1] * 3
    const ic = binding.tri[v * 3 + 2] * 3
    const s = binding.st[v * 2]
    const t = binding.st[v * 2 + 1]
    const skin = [0, 1, 2].map((k) => S[ia + k] + s * (S[ib + k] - S[ia + k]) + t * (S[ic + k] - S[ia + k]) + d[k] * 0.006) as V3
    const block = ref.bvh.first(skin, d, 0, REACH)
    const out = Math.max(0, binding.lift[v]) + over
    if (block && (out >= block.t + 0.006 || block.t + 0.006 - out < out)) continue
    buried[v] = over
  }
  // a vertex split along a seam is buried only when every copy is
  const showing = new Uint8Array(n)
  for (let v = 0; v < n; v++) if (buried[v] !== buried[v]) showing[id[v]] = 1
  for (let v = 0; v < n; v++) if (showing[id[v]]) buried[v] = NaN
  const under = (v: number) => buried[v] === buried[v]
  // the buried triangles stay, tucked under what buries them: dropped, a cargo pocket's leg surface left the skin
  // under it bare (the pocket stood too far out to hide it) and the skin showed in a pocket-shaped hole
  const kept: number[] = []
  for (let t = 0; t < index.length; t += 3) if (!DROP_BURIED || !(under(index[t]) && under(index[t + 1]) && under(index[t + 2]))) kept.push(index[t], index[t + 1], index[t + 2])
  if (!buried.some((o) => o === o)) return { raw, buried: 0 }
  // the vertices still used, in their order, the buried ones among them tucked in
  const remap = new Int32Array(n).fill(-1)
  for (const v of kept) remap[v] = 0
  let count = 0
  for (let v = 0; v < n; v++) if (remap[v] === 0) remap[v] = ++count
  const positions = Float32Array.from(P)
  for (let v = 0; v < n; v++) {
    if (remap[v] <= 0 || !under(v)) continue
    const tuck = Math.min(Math.max(0, TUCK - buried[v]), Math.max(0, binding.lift[v] - TUCK_FLOOR))
    for (let k = 0; k < 3; k++) positions[v * 3 + k] -= normal[v * 3 + k] * tuck
  }
  const pick = <T extends Float32Array | Uint8Array>(from: T, size: number): T => {
    const to = new (from.constructor as new (length: number) => T)(count * size)
    for (let v = 0; v < n; v++) if (remap[v] > 0) for (let k = 0; k < size; k++) to[(remap[v] - 1) * size + k] = from[v * size + k]
    return to
  }
  return {
    raw: {
      ...raw,
      positions: pick(positions, 3),
      normals: pick(normals, 3),
      index: Uint32Array.from(kept, (v) => remap[v] - 1),
      ...(raw.uv ? { uv: pick(raw.uv, 2) } : {}),
      ...(raw.channel ? { channel: pick(raw.channel, 1) } : {}),
      ...(raw.hang ? { hang: pick(raw.hang, 1) } : {}),
      ...(raw.len ? { len: pick(raw.len, 1) } : {}),
    },
    buried: (index.length - kept.length) / 3,
  }
}

/** Whether a ray along d leaves through the triangle's back: its winding's normal points along d. */
/**
 * Whether the triangle a, b, c faces along d (its back is toward whatever looks along d), and, with `least`, how squarely:
 * the cosine between its normal and d must reach it. A part lies over another when it faces the same way as the skin
 * under both; a wall crossing the ray edge-on (a cargo pocket's side next to the thigh) lies beside it, not over it.
 */
function fromBehind(P: ArrayLike<number>, a: number, b: number, c: number, d: V3, least = 0): boolean {
  const ux = P[b * 3] - P[a * 3]
  const uy = P[b * 3 + 1] - P[a * 3 + 1]
  const uz = P[b * 3 + 2] - P[a * 3 + 2]
  const vx = P[c * 3] - P[a * 3]
  const vy = P[c * 3 + 1] - P[a * 3 + 1]
  const vz = P[c * 3 + 2] - P[a * 3 + 2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const dot = nx * d[0] + ny * d[1] + nz * d[2]
  if (dot <= 0) return false
  return least <= 0 || dot >= least * Math.hypot(nx, ny, nz)
}

/**
 * What hides the skin must lie over it. An item modelled on the first body sits under the skin of another where that is
 * fuller (a boot's toe cap inside the Psyblr Human's longer foot, its toes out through the leather), so every inner
 * vertex facing out from under the band is pushed out to it, the push spread over its neighbours so a dent doesn't
 * fold. Open edges are left: they tuck under the skin by design. Returns how many vertices were pushed.
 */
function pushOut(binding: { lift: Float32Array }, positions: ArrayLike<number>, index: ArrayLike<number>, local: Float32Array, edge: Uint8Array, band: number): number {
  const n = positions.length / 3
  const { id, count } = weldPositions(positions)
  const lift = new Float32Array(count).fill(Infinity)
  const inner = new Uint8Array(count)
  for (let v = 0; v < n; v++) {
    if (edge[v] || local[v * 3 + 1] <= 0) continue
    inner[id[v]] = 1
    lift[id[v]] = Math.min(lift[id[v]], binding.lift[v])
  }
  const push = new Float32Array(count)
  let pushed = 0
  for (let w = 0; w < count; w++) if (inner[w] && lift[w] < band) (push[w] = band - lift[w]), pushed++
  if (!pushed) return 0
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
  for (let v = 0; v < n; v++) binding.lift[v] += push[id[v]]
  return pushed
}

/** Area-weighted normals, joined across split vertices. */
export function meshNormals(positions: ArrayLike<number>, index: ArrayLike<number>): Float32Array {
  const { id, count } = weldPositions(positions)
  const acc = new Float32Array(count * 3)
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3]
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    for (const k of [index[t], index[t + 1], index[t + 2]]) for (let d = 0; d < 3; d++) acc[id[k] * 3 + d] += n[d]
  }
  const out = new Float32Array(positions.length)
  for (let v = 0; v < out.length / 3; v++) {
    const w = id[v] * 3
    const len = Math.hypot(acc[w], acc[w + 1], acc[w + 2]) || 1
    for (let d = 0; d < 3; d++) out[v * 3 + d] = acc[w + d] / len
  }
  return out
}

/** Vertices on an open edge of the mesh (a hem, a neckline), after joining split copies. */
export function boundaryVertices(positions: ArrayLike<number>, index: ArrayLike<number>): Uint8Array {
  const { id } = weldPositions(positions)
  const edges = new Map<string, number>()
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = id[index[t + k]]
      const b = id[index[t + ((k + 1) % 3)]]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  const open = new Set<number>()
  for (const [key, n] of edges) if (n === 1) for (const w of key.split(',')) open.add(Number(w))
  return Uint8Array.from(id, (w) => (open.has(w) ? 1 : 0))
}

/** The body vertices an item in each slot must mostly cover, what to call them, and how much of them. */
function core(ref: Reference, slot: ItemSlot): { name: string; verts: number[]; need: number }[] {
  const V = ref.shape.surface.count
  const y = (v: number) => ref.shape.positions[v * 3 + 1]
  const z = (v: number) => ref.shape.positions[v * 3 + 2]
  const pick = (test: (v: number) => boolean) => Array.from({ length: V }, (_, v) => v).filter((v) => ref.shape.skin[v] && test(v))
  const n = kitRigOf(ref.bones)
  const torso = () => pick((v) => leanOn(ref, v, [n.spine, n.chest, n.upperChest]) >= 0.6 && ref.fields.hem[v] > 0.35 && ref.fields.hem[v] < 0.85)
  const thighs = () => pick((v) => leanOn(ref, v, [n.thigh.L, n.thigh.R]) >= 0.6 && ref.fields.leg[v] < 0.4)
  const crown = () => pick((v) => leanOn(ref, v, [n.head]) >= 0.95 && y(v) > (ref.rest[n.head]?.[1] ?? 1.6) + 0.08)
  switch (slot) {
    case 'upper':
      return [{ name: 'torso', verts: torso(), need: 0.6 }]
    case 'lower':
      return [{ name: 'thighs', verts: thighs(), need: 0.6 }]
    case 'full':
      return [
        { name: 'torso', verts: torso(), need: 0.5 },
        { name: 'thighs', verts: thighs(), need: 0.4 },
      ]
    case 'feet':
      // a sandal is a sole and a few straps
      return [{ name: 'feet', verts: pick((v) => leanOn(ref, v, [n.foot.L, n.foot.R]) >= 0.6), need: 0.1 }]
    case 'head':
      return [{ name: 'crown of the head', verts: crown(), need: 0.3 }]
    case 'hair':
      // thinning hair leaves the top of the head bare, keeping a horseshoe round the sides and back
      return [{ name: 'crown of the head', verts: crown(), need: 0.2 }]
    case 'back':
      // a scarf's tails cover less than a cape
      return [{ name: 'back', verts: pick((v) => leanOn(ref, v, [n.spine, n.chest, n.upperChest]) >= 0.5 && z(v) < (ref.rest[n.chest]?.[2] ?? 0)), need: 0.15 }]
    default:
      return []
  }
}

export interface FitReport {
  id: string
  slot: ItemSlot
  vertices: number
  triangles: number
  /** Triangles dropped from under the item's own outer parts. */
  buried: number
  /** Worst distance between a vertex and its binding evaluated back, metres. */
  bindError: number
  /** Share of the item's inner vertices (not on an open edge) facing out from more than 4 mm under the skin as modelled (the slot's dip for hair, beards and helmets); what hides the skin is then pushed out of it (pushOut), so the rest shows nothing through. */
  underSkin: number
  covered: number
  hidden: number
  particles: number
  /** Share of each core region covered. */
  coverage: number[]
  problems: string[]
}

export interface Fitted {
  file: ItemFile
  report: FitReport
}

/** Fit a mesh that already sits on the reference body. */
export function fitItem(input: RawItem, ref: Reference): Fitted {
  const { spec } = input
  // hair keeps its buried strands: they swing apart
  const hides = spec.hides ?? !['hair', 'beard'].includes(spec.slot)
  const { raw: pruned, buried } = hides ? unburied(input, ref) : { raw: input, buried: 0 }
  let raw = pruned
  const n = raw.positions.length / 3
  let normals = raw.normals ?? meshNormals(raw.positions, raw.index)
  const binding = bindPoints(raw.positions, ref.skin, ref.grid, BIND_REACH)
  let local = toLocal(binding, ref.skin, normals)
  const edge = boundaryVertices(raw.positions, raw.index)
  // as it was modelled, before anything is pushed out of the skin: a part deep under it is mis-sized, and reported
  const sunk = Float32Array.from(binding.lift)
  if (hides && pushOut(binding, raw.positions, raw.index, local, edge, BAND[spec.slot] ?? BAND_DEFAULT)) {
    raw = { ...raw, positions: evaluate(binding, ref.skin) }
    normals = meshNormals(raw.positions, raw.index)
    local = toLocal(binding, ref.skin, normals)
  }
  const back = evaluate(binding, ref.skin)
  let bindError = 0
  for (let v = 0; v < n; v++) bindError = Math.max(bindError, Math.hypot(back[v * 3] - raw.positions[v * 3], back[v * 3 + 1] - raw.positions[v * 3 + 1], back[v * 3 + 2] - raw.positions[v * 3 + 2]))
  const { covers, shell, hidden } = coversOf(ref, raw.positions, raw.index, hides, raw.hang)
  // footwear encloses the foot: every vertex of it is hidden, toes included, even where a toe cap modelled on another
  // body falls a little short of this one's toes (the body's toes came out through a boot's front otherwise)
  if (hides && spec.slot === 'feet') {
    const n = kitRigOf(ref.bones)
    const covered = new Set(covers)
    const hid = new Set(hidden)
    for (let v = 0; v < ref.shape.surface.count; v++) {
      if (!ref.shape.skin[v] || leanOn(ref, v, [n.foot.L, n.foot.R, ...n.feet]) < 0.5) continue
      if (!covered.has(v)) {
        covers.push(v)
        shell.push(Math.round(0.003 * 1e4), Math.round(0.006 * 1e4))
      }
      if (!hid.has(v)) hidden.push(v)
    }
  }
  const chains = raw.hang ? chainsOf(raw.positions, raw.index, raw.hang, spec.slot, ref, spec.stiff) : undefined
  // skin showing through: a vertex under the skin that faces out (a solid shell's inner side faces in, unseen)
  const dip = DIP[spec.slot] ?? 0.004
  let inner = 0
  let under = 0
  for (let v = 0; v < n; v++) {
    if (edge[v]) continue
    inner++
    // what pushOut moves out from the band is fine; a part twice as deep as the dip was modelled for another body
    if (sunk[v] < -(hides ? 2 * dip : dip) && local[v * 3 + 1] > 0) under++
  }
  const coveredSet = new Set(covers)
  const coverage = core(ref, spec.slot).map(({ name, verts, need }) => ({ name, share: verts.length ? verts.filter((v) => coveredSet.has(v)).length / verts.length : 1, need }))
  let cards = 0
  if (raw.uv) for (let t = 0; t < raw.index.length; t += 3) if (raw.uv[raw.index[t] * 2] > CARD_U) cards++
  const triangles = raw.index.length / 3 - cards
  const problems: string[] = []
  if (bindError > 0.001) problems.push(`binding error ${(bindError * 1000).toFixed(1)} mm`)
  if (inner && under / inner > 0.02) problems.push(`${((under / inner) * 100).toFixed(0)}% under the skin`)
  if (triangles > BUDGET[spec.slot]) problems.push(`${triangles} triangles, over the ${BUDGET[spec.slot]} budget`)
  if (cards > CARD_BUDGET) problems.push(`${cards} card triangles, over the ${CARD_BUDGET} budget`)
  coverage.forEach((c) => c.share < c.need && problems.push(`covers ${(c.share * 100).toFixed(0)}% of the ${c.name}, needs ${c.need * 100}%`))
  const meta: ItemMeta = {
    format: 'psyblr-wear',
    version: 1,
    id: spec.id,
    name: spec.name,
    slot: spec.slot,
    mode: 'surface',
    hides,
    channels: spec.channels,
    knobs: spec.knobs ?? [],
    covers,
    shell,
    ...(hides && hidden.length < covers.length ? { hidden } : {}),
    ...(chains ? { chains: chains.groups } : {}),
    ...(spec.hard ? { hard: true } : {}),
  }
  checkMeta(meta, ref.shape.surface.count)
  const item: SurfaceItem = surfaceItem(
    {
      extras: meta,
      index: raw.index,
      tri: binding.tri,
      st: binding.st,
      lift: binding.lift,
      normal: local,
      uv: raw.uv ?? new Float32Array(n * 2),
      rest: raw.positions,
      channel: raw.channel ?? new Uint8Array(n),
      ...(raw.len ? { len: raw.len } : {}),
      ...(chains ? { chain: chains.chain } : {}),
    },
    ref.shape.surface.count,
  )
  return {
    file: { meta, positions: raw.positions, normals, item, ...(raw.texture ? { texture: raw.texture } : {}) },
    report: {
      id: spec.id,
      slot: spec.slot,
      vertices: n,
      triangles,
      buried,
      bindError,
      underSkin: inner ? under / inner : 0,
      covered: covers.length,
      hidden: hides ? (meta.hidden ?? covers).length : 0,
      particles: chains?.particles ?? 0,
      coverage: coverage.map((c) => c.share),
      problems,
    },
  }
}

/** A field of the reference body read at each vertex of a fitted item (for the knobs' natural lengths in the sheet). */
export function fieldOnItem(ref: Reference, item: SurfaceItem, field: 'arm' | 'leg' | 'hem'): Float32Array {
  return fieldAt(ref.fields[field], item.binding.tri, item.binding.st)
}
