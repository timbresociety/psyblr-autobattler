import type { BodyShape } from '../body/shape.js'
import { TriangleBVH } from '../wear/ray.js'
import type { DressedItem } from '../wear/dress.js'

/**
 * Cloth as chains: what an outfit's loose parts (a skirt, a cape, a kimono's sleeves, long hair) do between frames.
 * The fit (src/kit/fit/chains.ts) gives each loose vertex a place in a grid of columns and levels; here every grid
 * point is a particle. Level 0 rides the body; the levels below swing (Verlet), held to their neighbours by links,
 * pulled gently back toward where the body carries their rest place, kept out of capsules round the body's bones and
 * no further in than the body or the layers under them allow. Nothing simulates a mesh: each moving particle is a bone, and the outfit's loose vertices are skinned to the
 * four particles round them, so the GPU does the rest.
 *
 * The rest shape already hangs under gravity, so gravity only acts as far as the body has tipped from its rest pose:
 * an upright hero's cloth sits as made, a hero lying down has it fall the other way. Renderer-free: the game feeds
 * each frame's bone matrices in and reads the particles' matrices out (src/arena/client/wear/cloth-model.ts).
 */

type V3 = [number, number, number]

/** A hero's budget of particles that move (a root rides the body): every loose item of an outfit shares it (chains.ts fits each item's share). */
export const MAX_PARTICLES = 64
/** Steps a second, near the camera; a far or off-screen hero steps at FAR_RATE. */
export const RATE = 60
export const FAR_RATE = 20
/** Passes over the links each step. */
const PASSES = 4
/** Velocity lost per 60 Hz step. */
const DRAG = 0.06
/** How far a particle moves back toward its carried rest place per 60 Hz step, from floppy (stiff 0) to firm (1). */
const PULL: [number, number] = [0.012, 0.12]
/** How far outside a capsule a particle keeps. */
const MARGIN = 0.012
/** How far outside the body or a layer worn under it the cloth keeps, how much of a vertex has to lean on a particle to count, and how far past the body's plane under a vertex its ray looks for the body. */
const LAYER_MARGIN = 0.002
const LEAN = 0.1
const LAYER_REACH = 0.02
/** How close to that layer cloth lies on it, how much of its slide along it each step takes back, and how far off it the cloth turns freely again. */
const CONTACT = 0.003
const GRIP = 0.5
const LIFTED = 0.03
const GRAVITY = 9.8
/** Calm steps before a still rig sleeps, and the motion (metres a step) that counts as still. */
const SLEEP_AFTER = 30
const STILL = 2e-4

/** A capsule round a bone, in the body's rest space: the segment a to b, radius r, carried by `bone`. */
export interface Capsule {
  bone: number
  a: V3
  b: V3
  r: number
}

export interface ClothRig {
  count: number
  /** Rest places, in the body's rest space. */
  rest: Float32Array
  /** 1 for a root (level 0), which rides the body. */
  pinned: Uint8Array
  /** The body's skin under each particle: four bones and weights, carrying its rest place. */
  joints: Uint16Array
  weights: Float32Array
  /** The particle a level up (-1 for a root), and the one a level down (-1 at the hem). */
  parent: Int32Array
  child: Int32Array
  /** Pairs of linked particles. A link keeps the length the body carries its two rest places at, not the rest pose's. */
  links: Uint16Array
  pull: Float32Array
  /** The furthest a particle may stray from its carried rest place. */
  reach: Float32Array
  /** Each particle's extra bone in the outfit's skeleton (-1 for a root). */
  bone: Int16Array
  bones: number
  capsules: Capsule[]
  /**
   * Per particle and capsule (count × capsules), the radius the particle keeps from it: the capsule's own, less where the
   * particle rests close, so cloth at rest is never pushed and a hem resting by the shin doesn't thin it for the rest.
   */
  room: Float32Array
  /**
   * Per particle, the way out from the body at its rest place (rest space, unit), and how far back in along it the
   * particle may swing before it meets the body or a layer worn under it: a skirt's hem over a shin, long hair over a
   * robe. Infinity where the cloth hangs clear of both (a cape's tail), and the capsules alone keep it out of the body.
   */
  out: Float32Array
  slack: Float32Array
}

export interface Cloth {
  rig: ClothRig
  /** The merged outfit's skin with the particles in: four bones and weights per vertex, the body's bones first. */
  skinIndex: Uint16Array
  skinWeight: Float32Array
}

export interface ClothInput {
  /** The outfit's items in the order they're merged into its one geometry: skin out, as dress() gives them. */
  items: readonly DressedItem[]
  body: BodyShape
  /** The skeleton's bone names, and each bone's rest place (the body's rest space). */
  bones: readonly string[]
  rest: (bone: string) => V3 | undefined
}

const SEGMENTS: [string, string][] = [
  ['hips', 'spine'],
  ['spine', 'chest'],
  ['chest', 'upper_chest'],
  ['upper_chest', 'neck'],
  ['upper_arm_L', 'forearm_L'],
  ['forearm_L', 'hand_L'],
  ['upper_arm_R', 'forearm_R'],
  ['forearm_R', 'hand_R'],
  ['thigh_L', 'shin_L'],
  ['shin_L', 'foot_L'],
  ['thigh_R', 'shin_R'],
  ['shin_R', 'foot_R'],
]

function segmentDistance(p: ArrayLike<number>, o: number, a: V3, b: V3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ap = [p[o] - a[0], p[o + 1] - a[1], p[o + 2] - a[2]]
  const t = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1)))
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t)
}

/** The four heaviest of a weighted set of bones, renormalised. */
function topFour(acc: Map<number, number>): [number[], number[]] {
  const top = [...acc].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const sum = top.reduce((s, [, w]) => s + w, 0) || 1
  const joints = [0, 0, 0, 0]
  const weights = [0, 0, 0, 0]
  top.forEach(([j, w], k) => {
    joints[k] = j
    weights[k] = w / sum
  })
  return [joints, weights]
}

/** How firmly a particle's skin keeps to the plain average of the vertices round it, against fitting them. */
const SKIN_PRIOR = 0.02

/**
 * The moving particles' skins, fit (least squares) so each loose vertex, blended from the particles round it, is carried
 * as its own skin would carry it, as near as the grid allows. A plain average lets a skirt's side, bound to one shin,
 * follow both legs halfway, and that leg comes through it. Every skin is kept a little toward its average, which also
 * settles a particle few vertices lean on. `average` is the vertices' skins summed by share, per particle.
 */
function fitSkins(average: Map<number, number>[], pinned: Uint8Array, cells: readonly ([number, number][] | undefined)[], own: (v: number) => Map<number, number>): Map<number, number>[] {
  const moving: number[] = []
  const at = new Int32Array(average.length).fill(-1)
  average.forEach((_, k) => {
    if (!pinned[k]) at[k] = moving.push(k) - 1
  })
  const m = moving.length
  if (!m) return average
  const A = new Float64Array(m * m)
  const rhs = new Map<number, Float64Array>()
  const column = (bone: number) => rhs.get(bone) ?? rhs.set(bone, new Float64Array(m)).get(bone)!
  cells.forEach((cell, v) => {
    const free = cell?.filter(([k, w]) => w > 0 && !pinned[k])
    if (!free?.length) return
    // the particles take what the roots leave: a root's share already rides the vertex's own skin
    const share = free.reduce((s, [, w]) => s + w, 0)
    for (const [a, wa] of free) for (const [b, wb] of free) A[at[a] * m + at[b]] += wa * wb
    for (const [bone, sw] of own(v)) {
      const r = column(bone)
      for (const [a, wa] of free) r[at[a]] += wa * share * sw
    }
  })
  let trace = 0
  for (let i = 0; i < m; i++) trace += A[i * m + i]
  const prior = SKIN_PRIOR * (trace / m || 1)
  moving.forEach((k, i) => {
    A[i * m + i] += prior
    const sum = [...average[k].values()].reduce((s, w) => s + w, 0) || 1
    for (const [bone, w] of average[k]) column(bone)[i] += (prior * w) / sum
  })
  // A is symmetric and positive definite (the prior sees to it): Cholesky once, then each bone's column
  const L = new Float64Array(m * m)
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * m + j]
      for (let q = 0; q < j; q++) s -= L[i * m + q] * L[j * m + q]
      L[i * m + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * m + j]
    }
  }
  const out = average.map((s, k) => (pinned[k] ? s : new Map<number, number>()))
  const y = new Float64Array(m)
  for (const [bone, r] of rhs) {
    for (let i = 0; i < m; i++) {
      let s = r[i]
      for (let q = 0; q < i; q++) s -= L[i * m + q] * y[q]
      y[i] = s / L[i * m + i]
    }
    for (let i = m - 1; i >= 0; i--) {
      let s = y[i]
      for (let q = i + 1; q < m; q++) s -= L[q * m + i] * y[q]
      y[i] = s / L[i * m + i]
      if (y[i] > 1e-4) out[moving[i]].set(bone, y[i])
    }
  }
  // a fit that came out all negative keeps the average
  for (const k of moving) if (!out[k].size) out[k] = average[k]
  return out
}

/** Capsules round the body's bones, sized from its own skin, so a heavy physique gets thicker ones. */
export function capsulesOf(body: BodyShape, bones: readonly string[], rest: (bone: string) => V3 | undefined): Capsule[] {
  const out: Capsule[] = []
  const V = body.surface.count
  const lead = new Int32Array(V).fill(-1)
  for (let v = 0; v < V; v++) {
    let best = -1
    let most = 0
    for (let k = 0; k < 4; k++) if (body.weights[v * 4 + k] > most) [best, most] = [body.joints[v * 4 + k], body.weights[v * 4 + k]]
    lead[v] = best
  }
  for (const [from, to] of SEGMENTS) {
    const bone = bones.indexOf(from)
    const a = rest(from)
    const b = rest(to)
    if (bone < 0 || !a || !b) continue
    const d: number[] = []
    for (let v = 0; v < V; v++) if (body.skin[v] && lead[v] === bone) d.push(segmentDistance(body.positions, v * 3, a, b))
    if (d.length < 6) continue
    d.sort((x, y) => x - y)
    // a quarter of the way up the skin's distances: inside the body all round, even where it's flattest
    const r = d[Math.floor(d.length * 0.25)]
    if (r > 0.01) out.push({ bone, a, b, r })
  }
  return out
}

/** The outfit's loose parts as one rig, or undefined when nothing hangs. */
export function buildCloth(input: ClothInput): Cloth | undefined {
  const { items, body } = input
  const total = items.reduce((n, i) => n + i.count, 0)
  const skinIndex = new Uint16Array(total * 4)
  const skinWeight = new Float32Array(total * 4)
  {
    let v = 0
    for (const item of items) {
      skinIndex.set(item.joints, v * 4)
      skinWeight.set(item.weights, v * 4)
      v += item.count
    }
  }
  // every group of every item, the biggest first, as many as the budget holds
  type Group = { item: number; offset: number; g: number; columns: number; levels: number; closed: boolean; stiff: number; base: number }
  const groups: Group[] = []
  {
    let offset = 0
    items.forEach((item, i) => {
      item.chains?.forEach((c, g) => groups.push({ item: i, offset, g, columns: c.columns, levels: c.levels, closed: c.closed, stiff: c.stiff, base: 0 }))
      offset += item.count
    })
  }
  groups.sort((a, b) => b.columns * (b.levels + 1) - a.columns * (a.levels + 1))
  const kept: Group[] = []
  let count = 0
  let moving = 0
  for (const g of groups) {
    if (moving + g.columns * g.levels > MAX_PARTICLES) continue
    g.base = count
    count += g.columns * (g.levels + 1)
    moving += g.columns * g.levels
    kept.push(g)
  }
  if (!kept.length) return undefined

  const rest = new Float32Array(count * 3)
  const mass = new Float32Array(count)
  const skin = Array.from({ length: count }, () => new Map<number, number>())
  const pinned = new Uint8Array(count)
  const parent = new Int32Array(count).fill(-1)
  const child = new Int32Array(count).fill(-1)
  const pull = new Float32Array(count)
  const links: number[] = []
  // where in its group's grid a vertex falls: the four particles round it, with their shares
  const cell = (g: Group, u: number, level: number): [number, number][] => {
    const C = g.columns
    let c0 = Math.floor(u)
    let fu = u - c0
    let c1: number
    if (g.closed) {
      c0 = ((c0 % C) + C) % C
      c1 = (c0 + 1) % C
    } else {
      c0 = Math.min(C - 1, Math.max(0, c0))
      c1 = Math.min(C - 1, c0 + 1)
      if (c1 === c0) fu = 0
    }
    let l0 = Math.min(g.levels, Math.max(0, Math.floor(level)))
    let fl = Math.min(1, Math.max(0, level - l0))
    if (l0 === g.levels) fl = 0
    const l1 = Math.min(g.levels, l0 + 1)
    const at = (c: number, l: number) => g.base + l * C + c
    return [
      [at(c0, l0), (1 - fu) * (1 - fl)],
      [at(c1, l0), fu * (1 - fl)],
      [at(c0, l1), (1 - fu) * fl],
      [at(c1, l1), fu * fl],
    ]
  }
  const byItem = new Map<string, Group>(kept.map((g) => [`${g.item}:${g.g}`, g]))
  const cells: ([number, number][] | undefined)[] = new Array(total)
  {
    let offset = 0
    items.forEach((item, i) => {
      if (item.chain)
        for (let v = 0; v < item.count; v++) {
          const g = byItem.get(`${i}:${item.chain[v * 3]}`)
          if (!g) continue
          const c = cell(g, item.chain[v * 3 + 1], item.chain[v * 3 + 2])
          cells[offset + v] = c
          for (const [k, w] of c) {
            if (w <= 0) continue
            mass[k] += w
            for (let d = 0; d < 3; d++) rest[k * 3 + d] += item.positions[v * 3 + d] * w
            for (let j = 0; j < 4; j++) {
              const b = item.joints[v * 4 + j]
              skin[k].set(b, (skin[k].get(b) ?? 0) + item.weights[v * 4 + j] * w)
            }
          }
        }
      offset += item.count
    })
  }
  for (let k = 0; k < count; k++) if (mass[k] > 0) for (let d = 0; d < 3; d++) rest[k * 3 + d] /= mass[k]
  // a grid point no vertex leans on takes after its filled neighbours
  for (const g of kept) {
    const C = g.columns
    for (let round = 0; round < C + g.levels; round++) {
      let empty = false
      for (let l = 0; l <= g.levels; l++)
        for (let c = 0; c < C; c++) {
          const k = g.base + l * C + c
          if (mass[k] > 0) continue
          const near = [l > 0 ? k - C : -1, l < g.levels ? k + C : -1, c > 0 ? k - 1 : g.closed ? k + C - 1 : -1, c < C - 1 ? k + 1 : g.closed ? k - C + 1 : -1].filter((n) => n >= 0 && mass[n] > 0)
          if (!near.length) {
            empty = true
            continue
          }
          for (let d = 0; d < 3; d++) rest[k * 3 + d] = near.reduce((s, n) => s + rest[n * 3 + d], 0) / near.length
          for (const n of near) for (const [b, w] of skin[n]) skin[k].set(b, (skin[k].get(b) ?? 0) + w)
          mass[k] = 1e-3
        }
      if (!empty) break
    }
  }
  for (const g of kept) {
    const C = g.columns
    for (let l = 0; l <= g.levels; l++)
      for (let c = 0; c < C; c++) {
        const k = g.base + l * C + c
        pull[k] = PULL[0] + (PULL[1] - PULL[0]) * g.stiff
        if (l === 0) {
          pinned[k] = 1
          continue
        }
        parent[k] = k - C
        child[k - C] = k
        links.push(k - C, k)
        if (c + 1 < C) links.push(k, k + 1)
        else if (g.closed && C > 2) links.push(k, k - C + 1)
      }
  }
  const fitted = fitSkins(skin, pinned, cells, (v) => {
    const own = new Map<number, number>()
    for (let j = 0; j < 4; j++) if (skinWeight[v * 4 + j] > 0) own.set(skinIndex[v * 4 + j], (own.get(skinIndex[v * 4 + j]) ?? 0) + skinWeight[v * 4 + j])
    return own
  })
  const joints = new Uint16Array(count * 4)
  const weights = new Float32Array(count * 4)
  for (let k = 0; k < count; k++) {
    const [j, w] = topFour(fitted[k])
    joints.set(j, k * 4)
    weights.set(w, k * 4)
  }
  // a particle strays at most most of the way its chain hangs from the root
  const reach = new Float32Array(count)
  for (let k = 0; k < count; k++) {
    let hang = 0
    for (let at = k; parent[at] >= 0; at = parent[at]) hang += Math.hypot(rest[at * 3] - rest[parent[at] * 3], rest[at * 3 + 1] - rest[parent[at] * 3 + 1], rest[at * 3 + 2] - rest[parent[at] * 3 + 2])
    reach[k] = hang * 0.8
  }
  const bone = new Int16Array(count).fill(-1)
  let bones = 0
  for (let k = 0; k < count; k++) if (!pinned[k]) bone[k] = bones++

  // each loose vertex on the particles round it; a root's share stays on the body's own bones under the vertex
  const B = input.bones.length
  for (let v = 0; v < total; v++) {
    const c = cells[v]
    if (!c) continue
    const acc = new Map<number, number>()
    for (const [k, w] of c) {
      if (w <= 0) continue
      if (pinned[k]) for (let j = 0; j < 4; j++) acc.set(skinIndex[v * 4 + j], (acc.get(skinIndex[v * 4 + j]) ?? 0) + skinWeight[v * 4 + j] * w)
      else acc.set(B + bone[k], (acc.get(B + bone[k]) ?? 0) + w)
    }
    const [j, w] = topFour(acc)
    skinIndex.set(j, v * 4)
    skinWeight.set(w, v * 4)
  }

  const capsules = capsulesOf(body, input.bones, input.rest)
  const room = new Float32Array(count * capsules.length)
  for (let k = 0; k < count; k++)
    if (!pinned[k]) capsules.forEach((c, i) => (room[k * capsules.length + i] = Math.min(c.r, segmentDistance(rest, k * 3, c.a, c.b) - MARGIN - 0.004)))
  const owner = new Int32Array(count)
  for (const g of kept) owner.fill(g.item, g.base, g.base + g.columns * (g.levels + 1))
  const rig: ClothRig = {
    count,
    rest,
    pinned,
    joints,
    weights,
    parent,
    child,
    links: Uint16Array.from(links),
    pull,
    reach,
    bone,
    bones,
    capsules,
    room,
    ...layersUnder(input, owner, bone, skinIndex, skinWeight, pinned),
  }
  return { rig, skinIndex, skinWeight }
}

/**
 * The room under each moving particle: how far in, along the body's normal under the cloth it carries, that cloth can
 * go before it meets the body or an item worn under it (one before it in the outfit). The capsules are only round the
 * bones, and thinned where cloth rests close, so they can't keep a skirt's hem off a striding shin or long hair out of a
 * kimono. The room is measured from the vertices, not the particle, since a particle is an average of cloth that curves
 * over the body and can sit inside what the cloth itself lies over; and the way out is theirs too, since where the neck
 * meets the shoulders the body under a particle can face another way than the body under the cloth it carries.
 */
function layersUnder(input: ClothInput, owner: Int32Array, bone: Int16Array, skinIndex: Uint16Array, skinWeight: Float32Array, pinned: Uint8Array): { out: Float32Array; slack: Float32Array } {
  const { items, body } = input
  const B = input.bones.length
  const count = pinned.length
  const out = new Float32Array(count * 3)
  const slack = new Float32Array(count).fill(Infinity)
  const particleOf = new Map<number, number>()
  for (let k = 0; k < count; k++) if (!pinned[k]) particleOf.set(bone[k], k)
  const owners = new Set(owner)
  const nearest = bodyNearest(body)
  const skin: number[] = []
  const tris = body.surface.triangles
  for (let t = 0; t < tris.length; t += 3) if (body.skin[tris[t]] && body.skin[tris[t + 1]] && body.skin[tris[t + 2]]) skin.push(tris[t], tris[t + 1], tris[t + 2])
  // each item with loose cloth: what leans on which particle, how much, and the body under it
  type Lean = { p: V3; under: number; k: number; w: number; layer: TriangleBVH }
  const leans: Lean[] = []
  let offset = 0
  items.forEach((item, i) => {
    if (owners.has(i)) {
      const inner = items.slice(0, i).filter((it) => it.index.length)
      const positions = new Float32Array(body.positions.length + inner.reduce((n, it) => n + it.count * 3, 0))
      positions.set(body.positions)
      const index = [...skin]
      let base = body.surface.count
      for (const it of inner) {
        positions.set(it.positions.subarray(0, it.count * 3), base * 3)
        for (const t of it.index) index.push(t + base)
        base += it.count
      }
      const layer = new TriangleBVH(positions, index)
      for (let v = 0; v < item.count; v++) {
        let under = -1
        for (let j = 0; j < 4; j++) {
          const b = skinIndex[(offset + v) * 4 + j]
          const w = skinWeight[(offset + v) * 4 + j]
          if (b < B || w < LEAN) continue
          const p: V3 = [item.positions[v * 3], item.positions[v * 3 + 1], item.positions[v * 3 + 2]]
          if (under < 0) under = nearest(p)
          leans.push({ p, under, k: particleOf.get(b - B)!, w, layer })
        }
      }
    }
    offset += item.count
  })
  // the way out: the body's normals under what the particle carries
  for (const { under, k, w } of leans) for (let d = 0; d < 3; d++) out[k * 3 + d] += body.normals[under * 3 + d] * w
  for (let k = 0; k < count; k++) {
    const l = Math.hypot(out[k * 3], out[k * 3 + 1], out[k * 3 + 2])
    if (l) for (let d = 0; d < 3; d++) out[k * 3 + d] /= l
  }
  // and in along it from each vertex, to whatever it meets first: the body itself at the furthest, so never its far side
  for (const { p, under, k, layer } of leans) {
    const n: V3 = [out[k * 3], out[k * 3 + 1], out[k * 3 + 2]]
    const depth = (p[0] - body.positions[under * 3]) * n[0] + (p[1] - body.positions[under * 3 + 1]) * n[1] + (p[2] - body.positions[under * 3 + 2]) * n[2]
    const hit = depth > 0 ? layer.first(p, [-n[0], -n[1], -n[2]], 0, depth + LAYER_REACH) : undefined
    if (hit) slack[k] = Math.min(slack[k], Math.max(0, hit.t - LAYER_MARGIN))
  }
  return { out, slack }
}

/** The body's nearest vertex to a point, from a grid of its vertices. */
function bodyNearest(body: BodyShape): (p: V3) => number {
  const CELL = 0.04
  const P = body.positions
  const cells = new Map<string, number[]>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  for (let v = 0; v < body.surface.count; v++) {
    const k = key(Math.floor(P[v * 3] / CELL), Math.floor(P[v * 3 + 1] / CELL), Math.floor(P[v * 3 + 2] / CELL))
    const cell = cells.get(k)
    if (cell) cell.push(v)
    else cells.set(k, [v])
  }
  return (p) => {
    const c = [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL)]
    let best = Infinity
    let at = 0
    // out ring by ring until a ring finds something and no nearer one could lie a ring further out
    for (let r = 0; r < 64; r++) {
      for (let x = -r; x <= r; x++)
        for (let y = -r; y <= r; y++)
          for (let z = -r; z <= r; z++) {
            if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue
            for (const v of cells.get(key(c[0] + x, c[1] + y, c[2] + z)) ?? []) {
              const d = (P[v * 3] - p[0]) ** 2 + (P[v * 3 + 1] - p[1]) ** 2 + (P[v * 3 + 2] - p[2]) ** 2
              if (d < best) {
                best = d
                at = v
              }
            }
          }
      if (best <= (r * CELL) ** 2) break
    }
    return at
  }
}

export interface ClothState {
  /** Where each particle is, and was a step ago (world space). */
  x: Float32Array
  prev: Float32Array
  /** Where the body carries each particle's rest place this frame, and that carry's linear part (column-major 3x3). */
  target: Float32Array
  frame: Float32Array
  /** Each moving particle's skin matrix (column-major 4x4): the body's rest space to world. */
  matrices: Float32Array
  /** Each link's length this step, as the body carries it. */
  span: Float32Array
  /** Time not yet stepped. */
  acc: number
  calm: number
  started: boolean
  sleeping: boolean
}

export function clothState(rig: ClothRig): ClothState {
  return {
    x: new Float32Array(rig.count * 3),
    prev: new Float32Array(rig.count * 3),
    target: new Float32Array(rig.count * 3),
    frame: new Float32Array(rig.count * 9),
    matrices: new Float32Array(rig.bones * 16),
    span: new Float32Array(rig.links.length / 2),
    acc: 0,
    calm: 0,
    started: false,
    sleeping: false,
  }
}

/** Each particle's rest place as the body carries it now: its skin's bone matrices, blended. */
function carry(rig: ClothRig, state: ClothState, pose: ArrayLike<number>) {
  const { rest, joints, weights } = rig
  const { target, frame } = state
  const m = new Float64Array(12)
  for (let k = 0; k < rig.count; k++) {
    m.fill(0)
    for (let j = 0; j < 4; j++) {
      const w = weights[k * 4 + j]
      if (!w) continue
      const o = joints[k * 4 + j] * 16
      // the 3x4 that matters: columns 0..2 and the translation
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 3 + r] += pose[o + c * 4 + r] * w
      for (let r = 0; r < 3; r++) m[9 + r] += pose[o + 12 + r] * w
    }
    const x = rest[k * 3]
    const y = rest[k * 3 + 1]
    const z = rest[k * 3 + 2]
    for (let r = 0; r < 3; r++) target[k * 3 + r] = m[r] * x + m[3 + r] * y + m[6 + r] * z + m[9 + r]
    for (let i = 0; i < 9; i++) frame[k * 9 + i] = m[i]
  }
}

/** How big the hero is drawn: the length of a carried rest frame's first column. */
function scaleOf(state: ClothState): number {
  const f = state.frame
  return Math.hypot(f[0], f[1], f[2]) || 1
}

/**
 * One frame. `pose` holds each body bone's skin matrix (the body's rest space to world, column-major, 16 numbers a
 * bone); `rate` is the steps a second this hero gets. The roots ride the body every frame; the rest step at `rate`.
 * Afterwards state.matrices holds each moving particle's skin matrix.
 */
export function stepCloth(rig: ClothRig, state: ClothState, pose: ArrayLike<number>, dt: number, rate = RATE): void {
  const { x, prev, target } = state
  const { pinned } = rig
  carry(rig, state, pose)
  const s = scaleOf(state)
  let moved = 0
  for (let k = 0; k < rig.count; k++) {
    if (!pinned[k]) continue
    moved = Math.max(moved, Math.hypot(target[k * 3] - x[k * 3], target[k * 3 + 1] - x[k * 3 + 1], target[k * 3 + 2] - x[k * 3 + 2]))
  }
  // first frame, or a jump no cloth could follow (a respawn): start from rest
  if (!state.started || moved > 1.5 * s) {
    x.set(target)
    prev.set(target)
    state.started = true
    state.acc = 0
    state.calm = 0
    state.sleeping = false
    matrices(rig, state)
    return
  }
  for (let k = 0; k < rig.count; k++) {
    if (!pinned[k]) continue
    for (let d = 0; d < 3; d++) x[k * 3 + d] = prev[k * 3 + d] = target[k * 3 + d]
  }
  if (moved >= STILL * s) state.calm = 0
  if (state.sleeping && moved < STILL * s) return
  state.sleeping = false
  state.acc += dt
  const h = 1 / rate
  let steps = 0
  while (state.acc >= h && steps < 3) {
    solve(rig, state, h, pose, s)
    state.acc -= h
    steps++
  }
  if (steps === 3) state.acc = 0
  if (steps) matrices(rig, state)
}

/** The cloth at rest wherever the body carries it, nothing swinging: a bust, a still preview, reduced motion. */
export function restCloth(rig: ClothRig, state: ClothState, pose: ArrayLike<number>): void {
  carry(rig, state, pose)
  state.x.set(state.target)
  state.prev.set(state.target)
  state.started = true
  state.acc = 0
  matrices(rig, state)
}

function solve(rig: ClothRig, state: ClothState, h: number, pose: ArrayLike<number>, s: number) {
  const { x, prev, target, frame, span } = state
  const { pinned, pull, links, reach, out, slack, room } = rig
  const ticks = h * 60
  const keep = Math.pow(1 - DRAG, ticks)
  for (let k = 0; k < rig.count; k++) {
    if (pinned[k]) continue
    const o = k * 3
    // gravity as far as the body has tipped: the world's, less the rest pose's as the body carries it
    const f = k * 9
    const gx = (frame[f + 3] / s) * GRAVITY
    const gy = -GRAVITY + (frame[f + 4] / s) * GRAVITY
    const gz = (frame[f + 5] / s) * GRAVITY
    const p = 1 - Math.pow(1 - pull[k], ticks)
    for (let d = 0; d < 3; d++) {
      const v = (x[o + d] - prev[o + d]) * keep
      prev[o + d] = x[o + d]
      x[o + d] += v + (d === 0 ? gx : d === 1 ? gy : gz) * h * h
      x[o + d] += (target[o + d] - x[o + d]) * p
    }
  }
  // links keep the lengths the body carries them at, not the rest pose's: a skirt stretches over a stride as its skin
  // would carry it, where a ring holding its rest girth lets a leg through
  for (let i = 0; i < span.length; i++) {
    const a = links[i * 2] * 3
    const b = links[i * 2 + 1] * 3
    span[i] = Math.hypot(target[b] - target[a], target[b + 1] - target[a + 1], target[b + 2] - target[a + 2])
  }
  for (let pass = 0; pass < PASSES; pass++)
    for (let i = 0; i < span.length; i++) {
      const a = links[i * 2]
      const b = links[i * 2 + 1]
      const dx = x[b * 3] - x[a * 3]
      const dy = x[b * 3 + 1] - x[a * 3 + 1]
      const dz = x[b * 3 + 2] - x[a * 3 + 2]
      const len = Math.hypot(dx, dy, dz) || 1e-9
      const diff = (len - span[i]) / len
      const wa = pinned[a] ? 0 : pinned[b] ? 1 : 0.5
      const wb = pinned[b] ? 0 : pinned[a] ? 1 : 0.5
      x[a * 3] += dx * diff * wa
      x[a * 3 + 1] += dy * diff * wa
      x[a * 3 + 2] += dz * diff * wa
      x[b * 3] -= dx * diff * wb
      x[b * 3 + 1] -= dy * diff * wb
      x[b * 3 + 2] -= dz * diff * wb
    }
  // out of the body's capsules, and never further from the carried rest place than the chain could swing
  const caps = rig.capsules.map((c) => {
    const o = c.bone * 16
    const at = (p: V3): V3 => [0, 1, 2].map((r) => pose[o + r] * p[0] + pose[o + 4 + r] * p[1] + pose[o + 8 + r] * p[2] + pose[o + 12 + r]) as V3
    return { a: at(c.a), b: at(c.b) }
  })
  for (let k = 0; k < rig.count; k++) {
    if (pinned[k]) continue
    const o = k * 3
    caps.forEach((c, i) => {
      const keep = room[k * caps.length + i]
      if (keep <= 0) return
      const r = keep * s + MARGIN
      const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]]
      const ap = [x[o] - c.a[0], x[o + 1] - c.a[1], x[o + 2] - c.a[2]]
      const t = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1)))
      const off = [ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t]
      const d = Math.hypot(off[0], off[1], off[2])
      if (d >= r || d < 1e-6) return
      for (let j = 0; j < 3; j++) x[o + j] += (off[j] / d) * (r - d)
    })
    // no further in than the layers worn under it allow, along the way out as the body carries it; and what lies on a
    // layer is held there, not slid off it by gravity or a sway, though it's free to lift away
    if (slack[k] < Infinity) {
      const f = k * 9
      const n = [0, 1, 2].map((r) => frame[f + r] * out[o] + frame[f + 3 + r] * out[o + 1] + frame[f + 6 + r] * out[o + 2])
      const nl = Math.hypot(n[0], n[1], n[2]) || 1
      for (let i = 0; i < 3; i++) n[i] /= nl
      let along = (x[o] - target[o]) * n[0] + (x[o + 1] - target[o + 1]) * n[1] + (x[o + 2] - target[o + 2]) * n[2]
      if (along + slack[k] * s < 0) {
        for (let i = 0; i < 3; i++) x[o + i] -= n[i] * (along + slack[k] * s)
        along = -slack[k] * s
      }
      if (along + slack[k] * s < CONTACT * s) for (let i = 0; i < 3; i++) x[o + i] -= (x[o + i] - target[o + i] - n[i] * along) * GRIP
    }
    const dx = x[o] - target[o]
    const dy = x[o + 1] - target[o + 1]
    const dz = x[o + 2] - target[o + 2]
    const far = Math.hypot(dx, dy, dz)
    const most = reach[k] * s
    if (far > most) {
      x[o] = target[o] + (dx * most) / far
      x[o + 1] = target[o + 1] + (dy * most) / far
      x[o + 2] = target[o + 2] + (dz * most) / far
    }
  }
  // still when nothing moved this step, and the body under it hasn't either (stepCloth resets the count)
  let fastest = 0
  for (let k = 0; k < rig.count; k++) if (!pinned[k]) fastest = Math.max(fastest, Math.hypot(x[k * 3] - prev[k * 3], x[k * 3 + 1] - prev[k * 3 + 1], x[k * 3 + 2] - prev[k * 3 + 2]))
  state.calm = fastest < STILL * s ? state.calm + 1 : 0
  if (state.calm >= SLEEP_AFTER) state.sleeping = true
}

/** How far particle k has lifted off the layer worn under it: 0 lying on it, 1 well clear (or with nothing under it). */
function lifted(rig: ClothRig, state: ClothState, k: number, s: number): number {
  if (rig.slack[k] === Infinity) return 1
  const { x, target, frame } = state
  const { out } = rig
  const o = k * 3
  const f = k * 9
  const n = [0, 1, 2].map((r) => frame[f + r] * out[o] + frame[f + 3 + r] * out[o + 1] + frame[f + 6 + r] * out[o + 2])
  const l = Math.hypot(n[0], n[1], n[2]) || 1
  const gap = ((x[o] - target[o]) * n[0] + (x[o + 1] - target[o + 1]) * n[1] + (x[o + 2] - target[o + 2]) * n[2]) / l + rig.slack[k] * s
  const t = Math.min(1, Math.max(0, (gap - CONTACT * s) / ((LIFTED - CONTACT) * s)))
  return t * t * (3 - 2 * t)
}

/**
 * Each moving particle's skin matrix: the body's carry at its rest place, turned by however the cloth's run through it
 * (from the particle above to the one below, or from the one above at the hem) has swung from where the body carries
 * that run, and moved to where it is. The run, not the link above alone: cloth either side of a bend leans on the
 * particle, and the link above would carry the cloth below on past the bend. At rest that is the carry itself, so the
 * cloth sits as made in any pose, not just one where every bone moves alike. Cloth lying on a layer worn under it
 * doesn't turn against that layer, any more than a sheet on a bed does; it turns freely again as it lifts away.
 */
function matrices(rig: ClothRig, state: ClothState) {
  const { x, target, frame, matrices: out } = state
  const { rest, parent, child, bone } = rig
  const s = scaleOf(state)
  for (let k = 0; k < rig.count; k++) {
    const p = parent[k]
    if (p < 0) continue
    // the run as the body carries it, and the run as it is
    const e = child[k] < 0 ? k : child[k]
    const a = [target[e * 3] - target[p * 3], target[e * 3 + 1] - target[p * 3 + 1], target[e * 3 + 2] - target[p * 3 + 2]]
    const b = [x[e * 3] - x[p * 3], x[e * 3 + 1] - x[p * 3 + 1], x[e * 3 + 2] - x[p * 3 + 2]]
    const q = turnBetween(a, b, lifted(rig, state, k, s))
    const f = k * 9
    const o = bone[k] * 16
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) out[o + c * 4 + r] = q[r] * frame[f + c * 3] + q[3 + r] * frame[f + c * 3 + 1] + q[6 + r] * frame[f + c * 3 + 2]
      out[o + c * 4 + 3] = 0
    }
    for (let r = 0; r < 3; r++) out[o + 12 + r] = x[k * 3 + r] - (out[o + r] * rest[k * 3] + out[o + 4 + r] * rest[k * 3 + 1] + out[o + 8 + r] * rest[k * 3 + 2])
    out[o + 15] = 1
  }
}

/** The least turn taking direction a to direction b, or `amount` of it, as a column-major 3x3 (none for a degenerate pair). */
function turnBetween(a: number[], b: number[], amount = 1): number[] {
  const la = Math.hypot(a[0], a[1], a[2])
  const lb = Math.hypot(b[0], b[1], b[2])
  if (la < 1e-9 || lb < 1e-9 || amount <= 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const u = [a[0] / la, a[1] / la, a[2] / la]
  const v = [b[0] / lb, b[1] / lb, b[2] / lb]
  const k = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const full = Math.hypot(k[0], k[1], k[2])
  if (full < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const angle = Math.atan2(full, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) * Math.min(1, amount)
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const n = [k[0] / full, k[1] / full, k[2] / full]
  const t = 1 - cos
  // Rodrigues, column-major
  return [
    cos + n[0] * n[0] * t,
    n[1] * n[0] * t + n[2] * sin,
    n[2] * n[0] * t - n[1] * sin,
    n[0] * n[1] * t - n[2] * sin,
    cos + n[1] * n[1] * t,
    n[2] * n[1] * t + n[0] * sin,
    n[0] * n[2] * t + n[1] * sin,
    n[1] * n[2] * t - n[0] * sin,
    cos + n[2] * n[2] * t,
  ]
}
