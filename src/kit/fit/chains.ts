import type { ChainGroup, ItemSlot } from '../wear/item.js'
import type { Reference } from './reference.js'
import { weldPositions } from '../wear/weld.js'

/**
 * Loose cloth into chains: the parts of an item that hang (a skirt below the hips, a cape, a kimono's sleeves, long
 * hair) become rows of short particle chains, each vertex hanging from the two nearest columns and levels. `hang`
 * says how freely each vertex hangs, 0 riding the body to 1 at a free hem; the builder paints it (Blender), or the
 * fit guesses it (a generated item).
 */

/** Particles per hero are budgeted: a whole outfit stays under 64 (see src/kit/physics). */
export const PARTICLES: Partial<Record<ItemSlot, number>> = { full: 28, lower: 20, upper: 12, back: 20, hair: 14, head: 6, beard: 4, face: 4 }
const STIFF: Partial<Record<ItemSlot, number>> = { hair: 0.55, beard: 0.7, head: 0.6, back: 0.25, full: 0.35, lower: 0.35, upper: 0.3, face: 0.5 }

/** How far apart columns and levels sit on the reference body, in metres. */
const COLUMN = 0.09
const LEVEL = 0.12

export interface Chains {
  /** Per vertex: group (-1 for none), column, level. */
  chain: Float32Array
  groups: ChainGroup[]
  particles: number
}

export function chainsOf(positions: Float32Array, index: Uint32Array, hang: ArrayLike<number>, slot: ItemSlot, ref: Reference, stiff?: number): Chains | undefined {
  const n = positions.length / 3
  const budget = PARTICLES[slot] ?? 0
  if (!budget) return undefined
  const { id, count } = weldPositions(positions)
  // welded hang: the most a copy of the vertex hangs
  const h = new Float32Array(count)
  for (let v = 0; v < n; v++) h[id[v]] = Math.max(h[id[v]], hang[v])
  // loose pieces: connected through triangles whose corners all hang
  const parent = Int32Array.from({ length: count }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [id[index[t]], id[index[t + 1]], id[index[t + 2]]]
    if (h[a] > 0 && h[b] > 0) parent[find(a)] = find(b)
    if (h[b] > 0 && h[c] > 0) parent[find(b)] = find(c)
    if (h[a] > 0 && h[c] > 0) parent[find(a)] = find(c)
  }
  const pieces = new Map<number, number[]>()
  for (let w = 0; w < count; w++) if (h[w] > 0) pieces.get(find(w))?.push(w) ?? pieces.set(find(w), [w])
  // a welded vertex's position: any of its copies
  const at = new Int32Array(count).fill(-1)
  for (let v = 0; v < n; v++) if (at[id[v]] < 0) at[id[v]] = v
  const P = (w: number, d: number) => positions[at[w] * 3 + d]
  const hips = ref.rest.hips ?? [0, 1, 0]
  type Piece = { verts: number[]; u: Float32Array; columns: number; levels: number; closed: boolean; drop: number }
  const found: Piece[] = []
  for (const verts of pieces.values()) {
    let lo = Infinity
    let hi = -Infinity
    for (const w of verts) {
      lo = Math.min(lo, P(w, 1))
      hi = Math.max(hi, P(w, 1))
    }
    // too small to swing: it rides the body
    if (verts.length < 6 || hi - lo < 0.04) continue
    const levels = Math.min(4, Math.max(1, Math.round((hi - lo) / LEVEL)))
    // across: round the body's axis when the piece wraps it (a skirt, a cape, hair down the back), else along its own
    // widest line (a sleeve, a tail)
    let cx = 0
    let cz = 0
    for (const w of verts) {
      cx += P(w, 0)
      cz += P(w, 2)
    }
    cx /= verts.length
    cz /= verts.length
    const angle = verts.map((w) => Math.atan2(P(w, 0) - hips[0], P(w, 2) - hips[2]))
    const radius = verts.reduce((acc, w) => acc + Math.hypot(P(w, 0) - hips[0], P(w, 2) - hips[2]), 0) / verts.length
    const sorted = [...angle].sort((a, b) => a - b)
    let gap = sorted[0] + 2 * Math.PI - sorted[sorted.length - 1]
    let gapEnd = sorted[0]
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] > gap) {
        gap = sorted[i] - sorted[i - 1]
        gapEnd = sorted[i]
      }
    }
    const around = Math.hypot(cx - hips[0], cz - hips[2]) < 0.3 && radius < 0.45
    const coverage = 2 * Math.PI - gap
    const u = new Float32Array(verts.length)
    let columns: number
    let closed = false
    if (around && coverage > 1.75 * Math.PI) {
      closed = true
      columns = Math.max(4, Math.round((2 * Math.PI * radius) / COLUMN))
      const start = sorted[0]
      verts.forEach((_, i) => (u[i] = ((((angle[i] - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)))
    } else if (around && coverage > 0.35 * Math.PI) {
      columns = Math.max(2, Math.round((coverage * radius) / COLUMN) + 1)
      verts.forEach((_, i) => (u[i] = (((angle[i] - gapEnd + 4 * Math.PI) % (2 * Math.PI)) / coverage)))
    } else {
      // the widest horizontal line through the piece
      let xx = 0
      let xz = 0
      let zz = 0
      for (const w of verts) {
        const x = P(w, 0) - cx
        const z = P(w, 2) - cz
        xx += x * x
        xz += x * z
        zz += z * z
      }
      const theta = 0.5 * Math.atan2(2 * xz, xx - zz)
      const ax = Math.cos(theta)
      const az = Math.sin(theta)
      const proj = verts.map((w) => (P(w, 0) - cx) * ax + (P(w, 2) - cz) * az)
      const min = Math.min(...proj)
      const max = Math.max(...proj)
      columns = Math.max(1, Math.round((max - min) / COLUMN) + 1)
      verts.forEach((_, i) => (u[i] = max > min ? (proj[i] - min) / (max - min) : 0.5))
    }
    found.push({ verts, u, columns: Math.min(32, columns), levels, closed, drop: hi - lo })
  }
  if (!found.length) return undefined
  // fit the budget: fewer columns first (but never fewer than a closed ring needs), then fewer levels
  const total = () => found.reduce((acc, p) => acc + p.columns * (p.levels + 1), 0)
  for (let guard = 0; total() > budget && guard < 200; guard++) {
    const widest = found.reduce((a, b) => (b.columns * (b.levels + 1) > a.columns * (a.levels + 1) ? b : a))
    if (widest.columns > (widest.closed ? 4 : 1)) widest.columns--
    else if (widest.levels > 1) widest.levels--
    else {
      // still over: drop the smallest piece altogether
      found.sort((a, b) => b.drop * b.columns - a.drop * a.columns)
      found.pop()
      if (!found.length) return undefined
    }
  }
  const chain = new Float32Array(n * 3).fill(0)
  for (let v = 0; v < n; v++) chain[v * 3] = -1
  const groups: ChainGroup[] = []
  const welded = new Map<number, { g: number; u: number; level: number }>()
  found.forEach((p, g) => {
    groups.push({ columns: p.columns, levels: p.levels, closed: p.closed, stiff: stiff ?? STIFF[slot] ?? 0.4 })
    p.verts.forEach((w, i) => welded.set(w, { g, u: p.closed ? p.u[i] * p.columns : p.u[i] * (p.columns - 1), level: Math.min(1, h[w]) * p.levels }))
  })
  for (let v = 0; v < n; v++) {
    const c = welded.get(id[v])
    if (!c) continue
    chain[v * 3] = c.g
    chain[v * 3 + 1] = c.u
    chain[v * 3 + 2] = c.level
  }
  return { chain, groups, particles: total() }
}
