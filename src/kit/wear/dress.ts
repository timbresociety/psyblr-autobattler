import { surfaceFrame } from './bind.js'
import { fieldAt, type BodyFields } from './fields.js'
import { FINISH_LOOK } from './finish.js'
import { coverOf, type ChainGroup, type Cover, type Finish, type ItemSlot, type Knob, type SurfaceItem } from './item.js'
import type { BodyShape } from '../body/shape.js'

/**
 * Dressing a body: every worn item evaluated on the hero's own body, layered so nothing pokes through, skinned from
 * the body under it, coloured per channel, cut where the player cut it, and the skin and inner layers it covers
 * hidden. Renderer-free and deterministic; src/arena/client/wear turns the result into meshes.
 *
 * Layers run from the skin out. Each item sits in its slot's band: an outer item is pushed out over whatever lies
 * under it (a top over a waistband, boots over trouser legs), while hair and beards are pressed in under a hat (a cap
 * flattens hair; hair still hangs long below a kasa's brim).
 */

/** Slots from the skin out. Face and hand gear hang on sockets, outside the layers. */
export const LAYERS: readonly ItemSlot[] = ['lower', 'feet', 'upper', 'full', 'back', 'beard', 'hair', 'head']
/** Clearance between one layer and the next, in metres. */
export const GAP = 0.003
/** Nothing is pressed closer to the skin than this. */
const MIN_LIFT = 0.0015
const PRESSED: ReadonlySet<ItemSlot> = new Set(['hair', 'beard'])

const rank = (slot: ItemSlot) => {
  const r = LAYERS.indexOf(slot)
  return r < 0 ? LAYERS.length : r
}

/** An item as one hero wears it. */
export interface Worn {
  item: SurfaceItem
  /** Linear RGB per channel. */
  colors: readonly (readonly [number, number, number])[]
  finishes: readonly Finish[]
  /** 0 (shortest) to 1 (as made), for the knobs the item allows. */
  knobs?: Partial<Record<Knob, number>>
}

export interface DressInput {
  body: BodyShape
  /** Needed for the sleeve, hem and leg knobs. */
  fields?: BodyFields
  worn: readonly Worn[]
  /** Covers from rigid items (a hat): they press hair and hide what they cover, with no vertices of their own here. */
  rigid?: readonly Cover[]
}

/** An item's mesh on this body, in the body's rest pose and skinned to its bones. */
export interface DressedItem {
  id: string
  slot: ItemSlot
  count: number
  positions: Float32Array
  normals: Float32Array
  uv: Float32Array
  joints: Uint16Array
  weights: Float32Array
  /** Linear RGB per vertex. */
  color: Float32Array
  /** Roughness, metalness, sheen and glow per vertex. */
  finish: Float32Array
  weave: Float32Array
  index: Uint32Array
  /** Loose cloth: per vertex its chain group (-1 for none), column and level, and the item's groups. */
  chain?: Float32Array
  chains?: readonly ChainGroup[]
}

export interface Dressed {
  /** The body's triangles left showing, by number: triangle t is the file's index entries 3t to 3t + 2. */
  body: Uint32Array
  items: DressedItem[]
}

/** How each knob cuts: which field, which side is kept, and where 0 on the knob lands. */
const CUTS: Record<Knob, { field: 'arm' | 'leg' | 'hem' | 'len'; keep: 'below' | 'above'; shortest: number }> = {
  sleeve: { field: 'arm', keep: 'below', shortest: 0.04 },
  leg: { field: 'leg', keep: 'below', shortest: 0.1 },
  hem: { field: 'hem', keep: 'above', shortest: 0.72 },
  length: { field: 'len', keep: 'below', shortest: 0.15 },
}

interface Cut {
  /** Per item vertex. */
  values: Float32Array
  threshold: number
  keep: 'below' | 'above'
  /** Per body vertex, for trimming the cover; absent for an item's own field. */
  body?: Float32Array
}

const kept = (cut: Cut, v: number) => (cut.keep === 'below' ? v <= cut.threshold : v >= cut.threshold)

function cutsFor(w: Worn, fields: BodyFields | undefined): Cut[] {
  const out: Cut[] = []
  const { item } = w
  for (const knob of item.meta.knobs) {
    const k = w.knobs?.[knob]
    if (k === undefined || k >= 1) continue
    const spec = CUTS[knob]
    let values: Float32Array
    let body: Float32Array | undefined
    if (spec.field === 'len') {
      if (!item.len) continue
      values = item.len
    } else {
      if (!fields) continue
      body = fields[spec.field]
      values = fieldAt(body, item.binding.tri, item.binding.st)
    }
    let natural = spec.keep === 'below' ? -Infinity : Infinity
    for (const v of values) natural = spec.keep === 'below' ? Math.max(natural, v) : Math.min(natural, v)
    const t = Math.min(1, Math.max(0, k))
    out.push({ values, threshold: spec.shortest + (natural - spec.shortest) * t, keep: spec.keep, ...(body ? { body } : {}) })
  }
  return out
}

/** A cover's value at a bound point: interpolated where all three corners have one, else the extreme of those that do. */
function coverAt(field: Float32Array, a: number, b: number, c: number, s: number, t: number, extreme: 'max' | 'min'): number {
  const fa = field[a]
  const fb = field[b]
  const fc = field[c]
  const ha = fa === fa
  const hb = fb === fb
  const hc = fc === fc
  if (ha && hb && hc) return fa * (1 - s - t) + fb * s + fc * t
  if (!ha && !hb && !hc) return NaN
  const pick = extreme === 'max' ? Math.max : Math.min
  return pick(ha ? fa : extreme === 'max' ? -Infinity : Infinity, hb ? fb : extreme === 'max' ? -Infinity : Infinity, hc ? fc : extreme === 'max' ? -Infinity : Infinity)
}

const covered = (cover: Cover, v: number) => cover.inner[v] === cover.inner[v]

export function dress(input: DressInput): Dressed {
  const { body, fields } = input
  const V = body.surface.count
  const worn = [...input.worn].sort((a, b) => rank(a.item.meta.slot) - rank(b.item.meta.slot))
  const cuts = worn.map((w) => cutsFor(w, fields))

  // every item's cover, trimmed by its cuts
  const covers: Cover[] = worn.map((w, i) => {
    const cover = coverOf(w.item.meta, V)
    for (const cut of cuts[i]) {
      if (!cut.body) continue
      for (let v = 0; v < V; v++) {
        if (!covered(cover, v) || kept(cut, cut.body[v])) continue
        cover.inner[v] = cover.outer[v] = NaN
        cover.hide[v] = 0
      }
    }
    return cover
  })
  const rigid = [...(input.rigid ?? [])]

  // lifts: pushed out over inner layers, pressed in under hats; each item's shell grows with its push
  const lifts = worn.map((w) => Float32Array.from(w.item.binding.lift))
  const floor = new Float32Array(V).fill(NaN)
  worn.forEach((w, i) => {
    const { tri, st } = w.item.binding
    const lift = lifts[i]
    const slot = w.item.meta.slot
    const r = rank(slot)
    // the outer surface of everything inside this layer
    floor.fill(NaN)
    for (let j = 0; j < i; j++) {
      if (rank(worn[j].item.meta.slot) >= r) continue
      const o = covers[j].outer
      for (let v = 0; v < V; v++) if (o[v] === o[v] && !(floor[v] >= o[v])) floor[v] = o[v]
    }
    const presses = PRESSED.has(slot) ? [...covers.slice(i + 1), ...rigid].filter((c) => c.slot === 'head') : []
    for (let k = 0; k < lift.length; k++) {
      const a = tri[k * 3]
      const b = tri[k * 3 + 1]
      const c = tri[k * 3 + 2]
      const s = st[k * 2]
      const t = st[k * 2 + 1]
      const under = coverAt(floor, a, b, c, s, t, 'max')
      if (under === under && lift[k] < under + GAP) lift[k] = under + GAP
      for (const hat of presses) {
        const ceiling = coverAt(hat.inner, a, b, c, s, t, 'min')
        if (ceiling === ceiling && lift[k] > ceiling - GAP) lift[k] = Math.max(MIN_LIFT, ceiling - GAP)
      }
    }
    const own = covers[i]
    for (let v = 0; v < V; v++) {
      if (!covered(own, v) || floor[v] !== floor[v]) continue
      own.inner[v] = Math.max(own.inner[v], floor[v] + GAP)
      own.outer[v] = Math.max(own.outer[v], floor[v] + GAP)
    }
  })

  const items: DressedItem[] = worn.map((w, i) => {
    const mesh = evaluateItem(w, lifts[i], body)
    // a vertex is inside an outer layer when it lies over what that layer hides and beneath its inner surface
    const inside = new Uint8Array(mesh.count)
    const outers = [...covers.filter((_, j) => j > i && rank(worn[j].item.meta.slot) > rank(w.item.meta.slot)), ...rigid.filter((c) => rank(c.slot) > rank(w.item.meta.slot))].filter((c) => c.hides)
    if (outers.length) {
      const { tri, st } = w.item.binding
      for (let k = 0; k < mesh.count; k++) {
        const a = tri[k * 3]
        const b = tri[k * 3 + 1]
        const c = tri[k * 3 + 2]
        for (const o of outers) {
          if (!o.hide[a] || !o.hide[b] || !o.hide[c]) continue
          const ceiling = coverAt(o.inner, a, b, c, st[k * 2], st[k * 2 + 1], 'min')
          if (lifts[i][k] < ceiling) {
            inside[k] = 1
            break
          }
        }
      }
    }
    let out: Mesh = { ...mesh, inside, fields: cuts[i].map((c) => c.values) }
    cuts[i].forEach((cut, c) => (out = clip(out, cut, c, w.item.meta.chains)))
    const index: number[] = []
    for (let t = 0; t < out.index.length; t += 3) {
      const a = out.index[t]
      const b = out.index[t + 1]
      const c = out.index[t + 2]
      if (!(out.inside[a] && out.inside[b] && out.inside[c])) index.push(a, b, c)
    }
    const { inside: _inside, fields: _fields, ...rest } = out
    return { ...rest, index: Uint32Array.from(index), id: w.item.meta.id, slot: w.item.meta.slot, ...(rest.chain && w.item.meta.chains ? { chains: w.item.meta.chains } : {}) }
  })

  // the body shows wherever no item hides all three corners of a triangle
  const hidden = new Uint8Array(V)
  for (const c of [...covers, ...rigid]) if (c.hides) for (let v = 0; v < V; v++) if (c.hide[v]) hidden[v] = 1
  const T = body.surface.triangles
  const shown: number[] = []
  for (let t = 0; t < T.length / 3; t++) if (!(hidden[T[t * 3]] && hidden[T[t * 3 + 1]] && hidden[T[t * 3 + 2]])) shown.push(t)
  return { body: Uint32Array.from(shown), items }
}

/** An item's mesh mid-dress: whether each vertex is inside an outer layer, and each cut's field per vertex. */
type Mesh = Omit<DressedItem, 'id' | 'slot' | 'chains'> & { inside: Uint8Array; fields: Float32Array[] }

/** An item on this body: positions at its lifts, normals turned with the surface, skin blended from the triangle. */
function evaluateItem(w: Worn, lift: Float32Array, body: BodyShape): Omit<Mesh, 'inside' | 'fields'> {
  const { item } = w
  const n = item.count
  const { tri, st } = item.binding
  const P = body.positions
  const N = body.normals
  const positions = new Float32Array(n * 3)
  const normals = new Float32Array(n * 3)
  const joints = new Uint16Array(n * 4)
  const weights = new Float32Array(n * 4)
  const color = new Float32Array(n * 3)
  const finish = new Float32Array(n * 4)
  const weave = new Float32Array(n)
  const frame = new Float32Array(9)
  const shape = { positions: P, normals: N, triangles: body.surface.triangles }
  const bones = new Map<number, number>()
  for (let k = 0; k < n; k++) {
    const a = tri[k * 3]
    const b = tri[k * 3 + 1]
    const c = tri[k * 3 + 2]
    const s = st[k * 2]
    const t = st[k * 2 + 1]
    for (let d = 0; d < 3; d++) {
      const pa = P[a * 3 + d]
      const na = N[a * 3 + d]
      positions[k * 3 + d] = pa + s * (P[b * 3 + d] - pa) + t * (P[c * 3 + d] - pa) + lift[k] * (na + s * (N[b * 3 + d] - na) + t * (N[c * 3 + d] - na))
    }
    surfaceFrame(item.binding, shape, k, frame)
    const x = item.normal[k * 3]
    const y = item.normal[k * 3 + 1]
    const z = item.normal[k * 3 + 2]
    let nx = x * frame[0] + y * frame[3] + z * frame[6]
    let ny = x * frame[1] + y * frame[4] + z * frame[7]
    let nz = x * frame[2] + y * frame[5] + z * frame[8]
    const len = Math.hypot(nx, ny, nz) || 1
    normals[k * 3] = nx / len
    normals[k * 3 + 1] = ny / len
    normals[k * 3 + 2] = nz / len
    // skin: the corners' bones, weighted by where the vertex sits; the four heaviest stay
    bones.clear()
    const corner = [a, b, c]
    const bary = [1 - s - t, s, t]
    for (let q = 0; q < 3; q++) {
      for (let j = 0; j < 4; j++) {
        const wgt = body.weights[corner[q] * 4 + j] * bary[q]
        if (wgt > 0) bones.set(body.joints[corner[q] * 4 + j], (bones.get(body.joints[corner[q] * 4 + j]) ?? 0) + wgt)
      }
    }
    const top = [...bones.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, 4)
    const sum = top.reduce((acc, [, wgt]) => acc + wgt, 0) || 1
    top.forEach(([bone, wgt], j) => {
      joints[k * 4 + j] = bone
      weights[k * 4 + j] = wgt / sum
    })
    if (!top.length) weights[k * 4] = 1
    const ch = item.channel[k]
    const rgb = w.colors[ch] ?? [0.5, 0.5, 0.5]
    color.set(rgb, k * 3)
    const look = FINISH_LOOK[w.finishes[ch] ?? item.meta.channels[ch]?.finish ?? 'cotton']
    finish.set([look.roughness, look.metalness, look.sheen, look.glow], k * 4)
    weave[k] = look.weave
  }
  return { count: n, positions, normals, uv: Float32Array.from(item.uv), joints, weights, color, finish, weave, index: item.index, ...(item.chain ? { chain: Float32Array.from(item.chain) } : {}) }
}

/**
 * Cut a mesh where cut `which`'s field crosses its threshold, keeping one side. Triangles across the line are clipped,
 * with the new vertices shared along each crossed edge so the cut has no cracks; everything on a new vertex is blended
 * from its edge (the skin by merging both ends' bones), the other cuts' fields included.
 */
function clip(mesh: Mesh, cut: Cut, which: number, groups?: readonly ChainGroup[]): Mesh {
  const field = mesh.fields[which]
  const keep = (v: number) => kept(cut, field[v])
  const sizes = { positions: 3, normals: 3, uv: 2, color: 3, finish: 4, weave: 1 } as const
  type Key = keyof typeof sizes
  const keys = Object.keys(sizes) as Key[]
  const data = Object.fromEntries(keys.map((k) => [k, Array.from(mesh[k])])) as Record<Key, number[]>
  const fields = mesh.fields.map((f) => Array.from(f))
  const joints = Array.from(mesh.joints)
  const weights = Array.from(mesh.weights)
  const inside = Array.from(mesh.inside)
  const chain = mesh.chain ? Array.from(mesh.chain) : undefined
  const edges = new Map<string, number>()
  let count = mesh.count
  const between = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`
    const known = edges.get(key)
    if (known !== undefined) return known
    const t = field[a] === field[b] ? 0.5 : (cut.threshold - field[a]) / (field[b] - field[a])
    for (const k of keys) {
      const size = sizes[k]
      const arr = data[k]
      for (let d = 0; d < size; d++) arr.push(arr[a * size + d] + (arr[b * size + d] - arr[a * size + d]) * t)
    }
    for (const f of fields) f.push(f[a] + (f[b] - f[a]) * t)
    const nrm = count * 3
    const len = Math.hypot(data.normals[nrm], data.normals[nrm + 1], data.normals[nrm + 2]) || 1
    for (let d = 0; d < 3; d++) data.normals[nrm + d] /= len
    const bones = new Map<number, number>()
    for (const [v, f] of [
      [a, 1 - t],
      [b, t],
    ] as const)
      for (let j = 0; j < 4; j++) if (weights[v * 4 + j] > 0) bones.set(joints[v * 4 + j], (bones.get(joints[v * 4 + j]) ?? 0) + weights[v * 4 + j] * f)
    const top = [...bones.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, 4)
    const sum = top.reduce((acc, [, wgt]) => acc + wgt, 0) || 1
    for (let j = 0; j < 4; j++) {
      joints.push(top[j]?.[0] ?? 0)
      weights.push(top[j] ? top[j][1] / sum : 0)
    }
    // the kept end decides whether the new vertex is inside an outer layer, and which chain it hangs from
    const near = keep(a) ? a : b
    inside.push(inside[near])
    if (chain) {
      const g = chain[near * 3]
      if (g >= 0 && chain[a * 3] === chain[b * 3]) {
        const ua = chain[a * 3 + 1]
        let ub = chain[b * 3 + 1]
        // round a closed group the short way
        const period = groups?.[g]?.closed ? groups[g].columns : 0
        if (period && Math.abs(ub - ua) > period / 2) ub += ub < ua ? period : -period
        let u = ua + (ub - ua) * t
        if (period) u = ((u % period) + period) % period
        chain.push(g, u, chain[a * 3 + 2] + (chain[b * 3 + 2] - chain[a * 3 + 2]) * t)
      } else chain.push(chain[near * 3], chain[near * 3 + 1], chain[near * 3 + 2])
    }
    edges.set(key, count)
    return count++
  }
  const index: number[] = []
  for (let t = 0; t < mesh.index.length; t += 3) {
    const tri = [mesh.index[t], mesh.index[t + 1], mesh.index[t + 2]]
    const ins = tri.map(keep)
    const n = ins.filter(Boolean).length
    if (n === 3) index.push(...tri)
    else if (n === 1) {
      // one corner kept: a smaller triangle at that corner
      const k = ins.indexOf(true)
      const a = tri[k]
      index.push(a, between(a, tri[(k + 1) % 3]), between(a, tri[(k + 2) % 3]))
    } else if (n === 2) {
      // two kept: a quad, as two triangles
      const k = ins.indexOf(false)
      const a = tri[(k + 1) % 3]
      const b = tri[(k + 2) % 3]
      const bc = between(b, tri[k])
      const ac = between(a, tri[k])
      index.push(a, b, bc, a, bc, ac)
    }
  }
  return {
    count,
    positions: Float32Array.from(data.positions),
    normals: Float32Array.from(data.normals),
    uv: Float32Array.from(data.uv),
    color: Float32Array.from(data.color),
    finish: Float32Array.from(data.finish),
    weave: Float32Array.from(data.weave),
    joints: Uint16Array.from(joints),
    weights: Float32Array.from(weights),
    inside: Uint8Array.from(inside),
    fields: fields.map((f) => Float32Array.from(f)),
    index: Uint32Array.from(index),
    ...(chain ? { chain: Float32Array.from(chain) } : {}),
  }
}
