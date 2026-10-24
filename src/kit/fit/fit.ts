import { bindPoints, evaluate, toLocal } from '../wear/bind.js'
import { fieldAt } from '../wear/fields.js'
import { checkMeta, surfaceItem, type ItemChannel, type ItemMeta, type ItemSlot, type Knob, type SurfaceItem } from '../wear/item.js'
import { chainsOf } from './chains.js'
import type { V3 } from './ray.js'
import { TriangleBVH } from './ray.js'
import { leanOn, type Reference } from './reference.js'
import { weldPositions } from './weld.js'
import type { ItemFile } from './write.js'

/**
 * The fit pipeline: any garment, hairstyle or hat mesh, sitting on the reference body, into an item file that fits
 * every body. Blender's built-in items arrive already in place (tools/blender/wardrobe.py); generated ones are first
 * normalised, re-posed, clipped and pushed out (generated.ts). Both then go the same road:
 *
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
}

/** Triangles per item, by slot: a whole outfit stays light enough for twenty heroes. */
export const BUDGET: Record<ItemSlot, number> = { hair: 3200, beard: 1200, head: 2400, upper: 4200, lower: 3000, full: 6400, back: 3200, feet: 1800, face: 1200, hand: 1200, offhand: 1200 }

/** How far a cover reaches out from the skin, and how close an item must lie to hide what's under it. */
const REACH = 0.32
const TIGHT = 0.025
/** Layers of one item within this of each other count as one (a solid shell's two sides, a collar on a shirt). */
const RUN = 0.03
const START = 0.003
/** How far from the skin a vertex may bind: a gown's hem or a cloak's corner hangs well clear of the legs. */
const BIND_REACH = 0.8
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

/** The body vertices an item in each slot must mostly cover, and how much of them. */
function core(ref: Reference, slot: ItemSlot): { verts: number[]; need: number }[] {
  const V = ref.shape.surface.count
  const y = (v: number) => ref.shape.positions[v * 3 + 1]
  const z = (v: number) => ref.shape.positions[v * 3 + 2]
  const pick = (test: (v: number) => boolean) => Array.from({ length: V }, (_, v) => v).filter((v) => ref.shape.skin[v] && test(v))
  const torso = () => pick((v) => leanOn(ref, v, ['spine', 'chest', 'upper_chest']) >= 0.6 && ref.fields.hem[v] > 0.35 && ref.fields.hem[v] < 0.85)
  const thighs = () => pick((v) => leanOn(ref, v, ['thigh_L', 'thigh_R']) >= 0.6 && ref.fields.leg[v] < 0.4)
  const crown = () => pick((v) => leanOn(ref, v, ['head']) >= 0.95 && y(v) > (ref.rest.head?.[1] ?? 1.6) + 0.08)
  switch (slot) {
    case 'upper':
      return [{ verts: torso(), need: 0.6 }]
    case 'lower':
      return [{ verts: thighs(), need: 0.6 }]
    case 'full':
      return [
        { verts: torso(), need: 0.5 },
        { verts: thighs(), need: 0.4 },
      ]
    case 'feet':
      // a sandal is a sole and a few straps
      return [{ verts: pick((v) => leanOn(ref, v, ['foot_L', 'foot_R']) >= 0.6), need: 0.1 }]
    case 'head':
    case 'hair':
      return [{ verts: crown(), need: 0.3 }]
    case 'back':
      // a scarf's tails cover less than a cape
      return [{ verts: pick((v) => leanOn(ref, v, ['spine', 'chest', 'upper_chest']) >= 0.5 && z(v) < (ref.rest.chest?.[2] ?? 0)), need: 0.15 }]
    default:
      return []
  }
}

export interface FitReport {
  id: string
  slot: ItemSlot
  vertices: number
  triangles: number
  /** Worst distance between a vertex and its binding evaluated back, metres. */
  bindError: number
  /** Share of the item's inner vertices (not on an open edge) facing out from more than 4 mm under the skin (the slot's dip for hair, beards and helmets). */
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
export function fitItem(raw: RawItem, ref: Reference): Fitted {
  const { spec } = raw
  const n = raw.positions.length / 3
  const normals = raw.normals ?? meshNormals(raw.positions, raw.index)
  const binding = bindPoints(raw.positions, ref.skin, ref.grid, BIND_REACH)
  const local = toLocal(binding, ref.skin, normals)
  const back = evaluate(binding, ref.skin)
  let bindError = 0
  for (let v = 0; v < n; v++) bindError = Math.max(bindError, Math.hypot(back[v * 3] - raw.positions[v * 3], back[v * 3 + 1] - raw.positions[v * 3 + 1], back[v * 3 + 2] - raw.positions[v * 3 + 2]))
  const hides = spec.hides ?? !['hair', 'beard'].includes(spec.slot)
  const { covers, shell, hidden } = coversOf(ref, raw.positions, raw.index, hides, raw.hang)
  const chains = raw.hang ? chainsOf(raw.positions, raw.index, raw.hang, spec.slot, ref, spec.stiff) : undefined
  // skin showing through: a vertex under the skin that faces out (a solid shell's inner side faces in, unseen)
  const edge = boundaryVertices(raw.positions, raw.index)
  const dip = DIP[spec.slot] ?? 0.004
  let inner = 0
  let under = 0
  for (let v = 0; v < n; v++) {
    if (edge[v]) continue
    inner++
    if (binding.lift[v] < -dip && local[v * 3 + 1] > 0) under++
  }
  const coveredSet = new Set(covers)
  const coverage = core(ref, spec.slot).map(({ verts, need }) => ({ share: verts.length ? verts.filter((v) => coveredSet.has(v)).length / verts.length : 1, need }))
  const triangles = raw.index.length / 3
  const problems: string[] = []
  if (bindError > 0.001) problems.push(`binding error ${(bindError * 1000).toFixed(1)} mm`)
  if (inner && under / inner > 0.02) problems.push(`${((under / inner) * 100).toFixed(0)}% under the skin`)
  if (triangles > BUDGET[spec.slot]) problems.push(`${triangles} triangles, over the ${BUDGET[spec.slot]} budget`)
  coverage.forEach((c, i) => c.share < c.need && problems.push(`covers ${(c.share * 100).toFixed(0)}% of the ${spec.slot} region ${i + 1}, needs ${c.need * 100}%`))
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
