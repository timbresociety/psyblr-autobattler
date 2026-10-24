import { surfaceFrame } from './bind.js'
import { fieldAt, type BodyFields } from './fields.js'
import { FINISH_LOOK } from './finish.js'
import { TriangleBVH, type V3 } from './ray.js'
import { coverOf, type ChainGroup, type Cover, type Finish, type ItemSlot, type Knob, type SurfaceItem } from './item.js'
import type { BodyShape } from '../body/shape.js'
import { weldPositions } from './weld.js'

/**
 * Dressing a body: every worn item evaluated on the hero's own body, layered so nothing pokes through, skinned from
 * the body under it, coloured per channel, cut where the player cut it, and the skin and inner layers it covers
 * hidden. Renderer-free and deterministic; src/arena/client/wear turns the result into meshes.
 *
 * Layers run from the skin out. Each item sits in its slot's band: an outer item is pushed out over whatever lies
 * under it (a top over a waistband, boots over trouser legs), while hair and beards are pressed in under a hat (a cap
 * flattens hair; hair still hangs long below a kasa's brim). A lower garment cut looser than the top or the shoes over
 * it goes outside them instead: a skirt over a tucked-in top, a hakama over the gi, wide trousers over shoes.
 */

/** Slots from the skin out: a mask over the beard, under the fringe and the hat. Hand gear hangs on sockets, outside the layers. */
export const LAYERS: readonly ItemSlot[] = ['lower', 'feet', 'upper', 'full', 'back', 'beard', 'face', 'hair', 'head']
/** Clearance between one layer and the next, in metres. */
export const GAP = 0.003
/** Nothing is pressed closer to the skin than this. */
const MIN_LIFT = 0.0015
const PRESSED: ReadonlySet<ItemSlot> = new Set(['hair', 'beard'])
/** How much further out a lower garment must stand than the top or shoes over it to be worn outside them, in metres. */
const LOOSER = 0.01
/** Cloth this far from the skin starts draping from its neighbours, and drapes fully by LOOSE_TO. */
const LOOSE_FROM = 0.02
const LOOSE_TO = 0.08
/** What draped cloth keeps of the skin under it, so it still rises over a body's own bulges; cloth past HOLD_TO keeps none (bound that far out, the skin under it says little). */
const DRAPE_HOLD = 0.05
const HOLD_FROM = 0.2
const HOLD_TO = 0.3
const DRAPE_PASSES = 24

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

/** Where a cover stands, three quarters of the way out over the vertices it shares with another: a few far ones don't decide. */
function standing(cover: Cover, other: Cover): number {
  const out: number[] = []
  for (let v = 0; v < cover.outer.length; v++) if (covered(cover, v) && covered(other, v)) out.push(cover.outer[v])
  return out.length < 8 ? NaN : out.sort((a, b) => a - b)[Math.floor((out.length - 1) * 0.75)]
}

export function dress(input: DressInput): Dressed {
  const { body, fields } = input
  const V = body.surface.count
  // every item's cover, trimmed by its cuts
  const layered = input.worn.map((w) => {
    const cuts = cutsFor(w, fields)
    const cover = coverOf(w.item.meta, V)
    for (const cut of cuts) {
      if (!cut.body) continue
      for (let v = 0; v < V; v++) {
        if (!covered(cover, v) || kept(cut, cut.body[v])) continue
        cover.inner[v] = cover.outer[v] = NaN
        cover.hide[v] = 0
      }
    }
    return { w, cuts, cover, rank: rank(w.item.meta.slot) }
  })
  // a lower garment standing looser than the top or shoes over it goes outside them
  for (const lower of layered) {
    if (lower.w.item.meta.slot !== 'lower') continue
    for (const over of layered) {
      if (over.w.item.meta.slot !== 'upper' && over.w.item.meta.slot !== 'feet') continue
      if (standing(lower.cover, over.cover) - standing(over.cover, lower.cover) > LOOSER) lower.rank = Math.max(lower.rank, over.rank + 0.5)
    }
  }
  layered.sort((a, b) => a.rank - b.rank)
  const worn = layered.map((l) => l.w)
  const cuts = layered.map((l) => l.cuts)
  const covers: Cover[] = layered.map((l) => l.cover)
  const ranks = layered.map((l) => l.rank)
  const rigid = [...(input.rigid ?? [])]

  // lifts: pushed out over inner layers, pressed in under hats; each item's shell grows with its push
  const lifts = worn.map((w) => Float32Array.from(w.item.binding.lift))
  const floor = new Float32Array(V).fill(NaN)
  worn.forEach((w, i) => {
    const { tri, st } = w.item.binding
    const lift = lifts[i]
    const slot = w.item.meta.slot
    // the outer surface of everything inside this layer
    floor.fill(NaN)
    for (let j = 0; j < i; j++) {
      if (ranks[j] >= ranks[i]) continue
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

  // outermost first, so each item is pressed under the outer ones as they are finally dressed
  const items: DressedItem[] = new Array(worn.length)
  const shells: TriangleBVH[] = []
  for (let i = worn.length - 1; i >= 0; i--) {
    const w = worn[i]
    const over: { shell: TriangleBVH; cover: Cover }[] = []
    for (let j = i + 1; j < worn.length; j++)
      if (ranks[j] > ranks[i] && covers[j].hides && items[j].index.length) over.push({ shell: (shells[j] ??= new TriangleBVH(items[j].positions, items[j].index)), cover: covers[j] })
    let mesh = evaluateItem(w, lifts[i], body)
    // a pressed triangle can land under another sag nearby: look again, a few times at most
    for (let pass = 0; pass < 3 && over.length && press(w.item, lifts[i], mesh.positions, body, over, covers[i].hides ? -GAP : MIN_LIFT); pass++) mesh = evaluateItem(w, lifts[i], body)
    // a vertex is inside an outer layer when it lies over what that layer hides and beneath its inner surface
    const inside = new Uint8Array(mesh.count)
    const outers = [...covers.filter((_, j) => j > i && ranks[j] > ranks[i]), ...rigid.filter((c) => rank(c.slot) > ranks[i])].filter((c) => c.hides)
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
    items[i] = { ...rest, index: Uint32Array.from(index), id: w.item.meta.id, slot: w.item.meta.slot, ...(rest.chain && w.item.meta.chains ? { chains: w.item.meta.chains } : {}) }
  }

  // the body shows wherever no item hides all three corners of a triangle
  const hidden = new Uint8Array(V)
  for (const c of [...covers, ...rigid]) if (c.hides) for (let v = 0; v < V; v++) if (c.hide[v]) hidden[v] = 1
  const T = body.surface.triangles
  const shown: number[] = []
  for (let t = 0; t < T.length / 3; t++) if (!(hidden[T[t * 3]] && hidden[T[t * 3 + 1]] && hidden[T[t * 3 + 2]])) shown.push(t)
  return { body: Uint32Array.from(shown), items }
}

/**
 * Where an outer item still dips under this one. Its triangles span several of the body's, so on a curve (a hip, a
 * shoulder blade) one sags between its corners under the layer beneath it, where the shells above can't see. Looking
 * down toward the skin from GAP outside each vertex, and from the middle of each triangle and of its edges, whatever
 * outer surface lies in the way presses those vertices GAP under the deepest of it: a waistband tucks under a tee's
 * hem, a tee's shoulder under a cape. Only where an outer item covers the body is it looked for. Clothes may go down to
 * `lowest`, a little under the skin: the skin they hide isn't drawn, and the outer item shows there anyway. Returns
 * whether anything moved.
 */
function press(item: SurfaceItem, lift: Float32Array, positions: Float32Array, body: BodyShape, over: readonly { shell: TriangleBVH; cover: Cover }[], lowest: number): boolean {
  const { tri, st } = item.binding
  const N = body.normals
  const n = item.count
  // each vertex's way down to the skin, how long its unnormalised normal is, and which outer items cover its triangle
  const down = new Float32Array(n * 3)
  const scale = new Float32Array(n)
  const under = new Uint32Array(n)
  for (let k = 0; k < n; k++) {
    const a = tri[k * 3]
    const b = tri[k * 3 + 1]
    const c = tri[k * 3 + 2]
    const s = st[k * 2]
    const t = st[k * 2 + 1]
    let len = 0
    for (let d = 0; d < 3; d++) {
      const v = N[a * 3 + d] + s * (N[b * 3 + d] - N[a * 3 + d]) + t * (N[c * 3 + d] - N[a * 3 + d])
      down[k * 3 + d] = -v
      len += v * v
    }
    len = Math.sqrt(len) || 1
    scale[k] = len
    for (let d = 0; d < 3; d++) down[k * 3 + d] /= len
    over.forEach(({ cover }, j) => {
      if (covered(cover, a) || covered(cover, b) || covered(cover, c)) under[k] |= 1 << j
    })
  }
  const need = new Float32Array(n)
  const from: V3 = [0, 0, 0]
  const dir: V3 = [0, 0, 0]
  const look = (corners: readonly number[], weights: readonly number[]) => {
    let mask = 0
    for (const k of corners) mask |= under[k]
    if (!mask) return
    let len = 0
    for (let d = 0; d < 3; d++) {
      dir[d] = 0
      from[d] = 0
      corners.forEach((k, j) => {
        dir[d] += weights[j] * down[k * 3 + d]
        from[d] += weights[j] * positions[k * 3 + d]
      })
      len += dir[d] * dir[d]
    }
    len = Math.sqrt(len) || 1
    for (let d = 0; d < 3; d++) {
      dir[d] /= len
      from[d] -= dir[d] * GAP
    }
    // from GAP outside down to the skin, and a gap past it: a chord's middle needn't stand off the skin as its corners do
    let height = 0
    corners.forEach((k, j) => (height += weights[j] * lift[k] * scale[k]))
    const reach = Math.max(0, height) + 2 * GAP
    let deepest = 0
    over.forEach(({ shell }, j) => {
      if (!(mask & (1 << j))) return
      const hits = shell.hits(from, dir, 0, reach)
      if (hits.length) deepest = Math.max(deepest, hits[hits.length - 1].t)
    })
    if (deepest > 0) for (const k of corners) need[k] = Math.max(need[k], deepest)
  }
  for (let k = 0; k < n; k++) if (lift[k] > lowest) look([k], [1])
  const index = item.index
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]]
    look([a, b, c], [1 / 3, 1 / 3, 1 / 3])
    look([a, b], [0.5, 0.5])
    look([b, c], [0.5, 0.5])
    look([c, a], [0.5, 0.5])
  }
  let moved = false
  for (let k = 0; k < n; k++) {
    if (!need[k] || lift[k] <= lowest) continue
    lift[k] = Math.max(lowest, lift[k] - need[k] / scale[k])
    moved = true
  }
  return moved
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
  if (item.meta.hard) ride(joints, weights)
  drape(item, lift, positions, normals)
  return { count: n, positions, normals, uv: Float32Array.from(item.uv), joints, weights, color, finish, weave, index: item.index, ...(item.chain ? { chain: Float32Array.from(item.chain) } : {}) }
}

/** An item's vertices welded by where they sit on the reference, and each welded vertex's neighbours: the same on every body. */
const welds = new WeakMap<SurfaceItem, { id: Uint32Array; links: number[][] }>()

function weldOf(item: SurfaceItem, rest: Float32Array): { id: Uint32Array; links: number[][] } {
  const known = welds.get(item)
  if (known) return known
  const { id, count } = weldPositions(rest)
  const links: number[][] = Array.from({ length: count }, () => [])
  const link = (a: number, b: number) => a !== b && !links[a].includes(b) && (links[a].push(b), links[b].push(a))
  for (let t = 0; t < item.index.length; t += 3) {
    const [a, b, c] = [id[item.index[t]], id[item.index[t + 1]], id[item.index[t + 2]]]
    link(a, b)
    link(b, c)
    link(c, a)
  }
  const weld = { id, links }
  welds.set(item, weld)
  return weld
}

/** Every vertex onto the one bone the item leans on most, whole (a hard item: ItemMeta.hard). */
function ride(joints: Uint16Array, weights: Float32Array): void {
  const total = new Map<number, number>()
  for (let i = 0; i < weights.length; i++) if (weights[i] > 0) total.set(joints[i], (total.get(joints[i]) ?? 0) + weights[i])
  const bone = [...total.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0]?.[0] ?? 0
  for (let k = 0; k < weights.length; k += 4) {
    joints.set([bone, 0, 0, 0], k)
    weights.set([1, 0, 0, 0], k)
  }
}

/**
 * Cloth well clear of the skin (a robe's front between the knees, a hanging sleeve) is bound to whichever limb lies
 * nearest, so neighbours bound to different limbs part or cross on a body shaped unlike the reference. It drapes
 * instead: its move from where it sat on the reference becomes mostly the average of its neighbours' moves, the more so
 * the further it stands from the skin, while cloth close to the skin moves exactly with it. Its normals turn with the
 * draped surface as far as it drapes.
 */
function drape(item: SurfaceItem, lift: Float32Array, positions: Float32Array, normals: Float32Array): void {
  const rest = item.rest
  if (!rest) return
  const n = item.count
  const { id, links } = weldOf(item, rest)
  const count = links.length
  // how far each welded vertex drapes (0 to 1), and how freely (what it keeps of the skin under it aside)
  const ramp = (x: number, from: number, to: number) => {
    const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
    return t * t * (3 - 2 * t)
  }
  const share = new Float32Array(count)
  const free = new Float32Array(count)
  for (let k = 0; k < n; k++) {
    // a lift either side: cloth bound under a far limb's skin stands clear of the body too
    const off = Math.abs(lift[k])
    share[id[k]] = Math.max(share[id[k]], ramp(off, LOOSE_FROM, LOOSE_TO))
    free[id[k]] = Math.max(free[id[k]], ramp(off, LOOSE_FROM, LOOSE_TO) * (1 - DRAPE_HOLD * (1 - ramp(off, HOLD_FROM, HOLD_TO))))
  }
  if (!share.some((s) => s > 0)) return
  // each welded vertex's move on this body, then the loose ones' relaxed toward their neighbours'
  const bound = new Float32Array(count * 3)
  for (let k = 0; k < n; k++) for (let d = 0; d < 3; d++) bound[id[k] * 3 + d] = positions[k * 3 + d] - rest[k * 3 + d]
  const moved = Float32Array.from(bound)
  for (let pass = 0; pass < DRAPE_PASSES; pass++) {
    for (let w = 0; w < count; w++) {
      const f = free[w]
      const near = links[w]
      if (!f || !near.length) continue
      for (let d = 0; d < 3; d++) {
        let sum = 0
        for (const u of near) sum += moved[u * 3 + d]
        moved[w * 3 + d] = (1 - f) * bound[w * 3 + d] + (f * sum) / near.length
      }
    }
  }
  for (let k = 0; k < n; k++) if (share[id[k]] > 0) for (let d = 0; d < 3; d++) positions[k * 3 + d] = rest[k * 3 + d] + moved[id[k] * 3 + d]
  // the draped surface's own normals (area-weighted), turned to agree with the bound ones
  const face = new Float32Array(count * 3)
  for (let t = 0; t < item.index.length; t += 3) {
    const [a, b, c] = [item.index[t] * 3, item.index[t + 1] * 3, item.index[t + 2] * 3]
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    const fn = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    for (const v of [item.index[t], item.index[t + 1], item.index[t + 2]]) for (let d = 0; d < 3; d++) face[id[v] * 3 + d] += fn[d]
  }
  for (let k = 0; k < n; k++) {
    const s = share[id[k]]
    if (!s) continue
    const g = [face[id[k] * 3], face[id[k] * 3 + 1], face[id[k] * 3 + 2]]
    const gl = Math.hypot(g[0], g[1], g[2])
    if (!gl) continue
    const side = g[0] * normals[k * 3] + g[1] * normals[k * 3 + 1] + g[2] * normals[k * 3 + 2] < 0 ? -1 : 1
    const m = [0, 1, 2].map((d) => normals[k * 3 + d] * (1 - s) + ((side * g[d]) / gl) * s)
    const ml = Math.hypot(m[0], m[1], m[2]) || 1
    for (let d = 0; d < 3; d++) normals[k * 3 + d] = m[d] / ml
  }
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
