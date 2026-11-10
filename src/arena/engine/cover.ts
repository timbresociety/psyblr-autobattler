import { ENGINE } from './calibration.js'
import { GRIDS } from './grid.js'
import { cos, sin, type Vec3 } from './maths.js'

/**
 * Cover (R1, R25): the ruins heroes hide behind. Every piece is engine geometry, so the renderer draws exactly what
 * blocks: an axis-aligned block (walls, fallen columns, barricades, lintels) or an upright cylinder (columns). A piece
 * spans `base`..`top` in height; jumping over it, or walking under an arch, clears it, and a hero can stand on top.
 * Breakable pieces have health and are gone once it reaches zero. Pure arithmetic, so it stays deterministic (KTD1).
 */

export type CoverShape =
  | { kind: 'block'; x: number; z: number; hx: number; hz: number }
  | { kind: 'column'; x: number; z: number; r: number }

export interface CoverPiece {
  shape: CoverShape
  /** Height of the bottom face; 0 stands on the ground. */
  base: number
  top: number
  /** Health of a breakable barrier; absent means it cannot be broken. */
  health?: number
  /**
   * A ramp (a block only): its top slopes from `low` at one end up to `top` at the `rise` end, so a hero walks up it
   * from the low end, and its sides are as high as the slope where they stand (GAME.md §8 card ramps, stairs).
   */
  slope?: { rise: 'x+' | 'x-' | 'z+' | 'z-'; low: number }
  /** What the renderer builds here; the engine ignores it. */
  look: 'wall' | 'column' | 'fallen' | 'barricade' | 'lintel' | 'plinth' | 'pillar' | 'pier' | 'arch' | 'terrace' | 'step' | 'grey' | 'ramp' | 'chip' | 'rail' | 'glass' | 'card'
}

/**
 * A zipline or a rail (GAME.md §7): a straight line from `a` to `b` a hero rides fast either way. A zipline is hung
 * from (the hero's hands grip it, its feet dangle below); a rail is stood on.
 */
export interface MapLine {
  kind: 'zip' | 'rail'
  a: Vec3
  b: Vec3
}

/** The height of a piece's top above (x, z): its top, or a ramp's slope there (clamped to its ends). */
export function surfaceAt(piece: CoverPiece, x: number, z: number): number {
  const sl = piece.slope
  if (!sl || piece.shape.kind !== 'block') return piece.top
  const s = piece.shape
  const alongX = sl.rise[0] === 'x'
  const half = alongX ? s.hx : s.hz
  const c = alongX ? x - s.x : z - s.z
  const u = Math.max(0, Math.min(1, ((sl.rise[1] === '+' ? c : -c) + half) / (2 * half)))
  return sl.low + (piece.top - sl.low) * u
}

const extents = new WeakMap<readonly CoverPiece[], { halfWidth: number; halfLength: number }>()

/**
 * How far a map reaches from its middle: as far as its pieces go, and never less than the arena (the House of Instinct's
 * concourse takes it past the old bounds; the ruins sit inside them).
 */
export function arenaExtent(pieces: readonly CoverPiece[] | undefined): { halfWidth: number; halfLength: number } {
  const { halfWidth, halfLength } = ENGINE.arena
  if (!pieces) return { halfWidth, halfLength }
  let e = extents.get(pieces)
  if (!e) {
    e = { halfWidth, halfLength }
    for (const p of pieces) {
      const s = p.shape
      e.halfWidth = Math.max(e.halfWidth, Math.abs(s.x) + (s.kind === 'block' ? s.hx : s.r))
      e.halfLength = Math.max(e.halfLength, Math.abs(s.z) + (s.kind === 'block' ? s.hz : s.r))
    }
    extents.set(pieces, e)
  }
  return e
}

/** One piece's state in a match: its health, or -1 for unbreakable; 0 means broken and gone. */
export type CoverHealth = number

/**
 * The valley ruins (R25; Forge goal, phase 2): a broken courtyard at the foot of the mountains, 112 by 84 m, in
 * near-mirror halves. A low dais holds the middle under four broken pillars; colonnades flank it; each half has a great
 * arch in a broken wall, low walls to jump, and a raised terrace on one flank reached by steps, for a shot from above.
 * Anything at or under 0.4 m is stepped onto; a 1.4 m jump clears a low wall, a second jump the rest.
 */
export const RUINS: readonly CoverPiece[] = (() => {
  const pieces: CoverPiece[] = []
  const block = (x: number, z: number, hx: number, hz: number, top: number, look: CoverPiece['look'], health?: number, base = 0) =>
    pieces.push({ shape: { kind: 'block', x, z, hx, hz }, base, top, look, ...(health ? { health } : {}) })
  const pillar = (x: number, z: number, top: number, half = 0.65) => block(x, z, half, half, top, 'pillar')
  const column = (x: number, z: number, r: number, top: number) => pieces.push({ shape: { kind: 'column', x, z, r }, base: 0, top, look: 'column' })
  // the middle: a dais a step high, a toppled pillar across it to duck behind, broken pillars at its corners
  block(0, 0, 6, 4, 0.4, 'terrace')
  block(0, 0, 3.2, 0.6, 1.5, 'fallen')
  pillar(-5, -3.2, 4.6)
  pillar(5, -3.2, 2.4)
  pillar(-5, 3.2, 2.6)
  pillar(5, 3.2, 5.8)
  for (const s of [-1, 1]) {
    // barricades either side of the dais, and colonnades along the flanks, some pillars broken low enough to jump
    block(11 * s, 0, 0.45, 1.8, 2.2, 'barricade', 1400)
    for (const [z, top] of [[-12, 6.8], [-6, 1.3], [0, 7.4], [6, 3.1], [12, 1.4]] as const) pillar(17 * s, z * s, top)
  }
  // each half, mirrored through the middle with small differences (Dire and Radiant, R1)
  for (const side of [-1, 1]) {
    const z = (v: number) => v * side
    const nudge = side > 0 ? 1.5 : 0
    block(0, z(9), 2, 0.45, 2.2, 'barricade', 1200)
    block(-15, z(8) + nudge, 1.8, 0.45, 2.2, 'barricade', 1200)
    block(15 - nudge, z(9), 1.8, 0.45, 2.2, 'barricade', 1200)
    // low walls in the field: a jump clears them
    block(-9 - nudge, z(16), 3.5, 0.5, 1.2, 'wall')
    block(10, z(17.5), 3, 0.5, 1.5, 'wall')
    block(-25, z(14), 0.5, 3, 1.3, 'wall')
    block(27 + nudge, z(13), 0.5, 3.5, 1.6, 'wall')
    // the great arch in a broken wall: walk through it or round the ends, never over
    block(-3.4, z(24), 1.1, 1.1, 8.6, 'pier')
    block(3.4, z(24), 1.1, 1.1, 8.6, 'pier')
    block(0, z(24), 4.5, 1.1, 9.6, 'arch', undefined, 6.4)
    block(-8.6, z(24), 4.1, 0.6, 3.4, 'wall')
    block(8.6, z(24) + side * 0.3, 4.1, 0.6, 2.6, 'wall')
    // a raised terrace on one flank, three steps up from the field, a parapet along its edge and a colonnade on it
    const tx = side > 0 ? 1 : -1
    const tz = 14
    block(42 * tx, z(tz), 8, 7, 1.2, 'terrace')
    block(33.5 * tx, z(tz + 3), 0.5, 2.5, 0.8, 'step')
    block(32.5 * tx, z(tz + 3), 0.5, 2.5, 0.4, 'step')
    block(34.4 * tx, z(tz - 4), 0.4, 2.6, 2.2, 'wall')
    pillar(47 * tx, z(tz - 5), 7.6, 0.7)
    pillar(47 * tx, z(tz), 3.4, 0.7)
    pillar(47 * tx, z(tz + 5), 6.4, 0.7)
    // on the other flank, a ruined round temple: a ring of columns, some fallen to stumps
    const cx = -38 * tx
    const cz = z(tz + 4)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3
      column(cx + 6.5 * sin(a), cz + 6.5 * cos(a), 0.75, [7.2, 1.2, 5.5, 2.6, 6.8, 1.0][k])
    }
    block(cx, cz, 2.6, 2.6, 0.8, 'plinth')
    // the back: a broken gatehouse wall, tall pillars, a fallen one and a plinth near where each side musters
    block(-15, z(33), 3, 0.6, 2.6, 'wall')
    block(17, z(34), 0.6, 3, 3, 'wall')
    pillar(-6, z(37), 7)
    pillar(6 + nudge, z(37), 4.2)
    block(3, z(30.5), 2.6, 0.55, 1.1, 'fallen')
    block(-33, z(36), 3, 2.5, 1.6, 'plinth')
    block(34 - nudge, z(37), 2.5, 2.5, 1.6, 'plinth')
  }
  return pieces
})()

export const initialCoverHealth = (pieces: readonly CoverPiece[]): CoverHealth[] => pieces.map((p) => p.health ?? -1)

/** Each piece's footprint box and height, computed once per layout so the hot loops reject far pieces cheaply. */
interface Bounds {
  minX: Float64Array
  maxX: Float64Array
  minZ: Float64Array
  maxZ: Float64Array
}
const boundsCache = new WeakMap<readonly CoverPiece[], Bounds>()
function boundsOf(pieces: readonly CoverPiece[]): Bounds {
  let b = boundsCache.get(pieces)
  if (b) return b
  const n = pieces.length
  b = { minX: new Float64Array(n), maxX: new Float64Array(n), minZ: new Float64Array(n), maxZ: new Float64Array(n) }
  for (let i = 0; i < n; i++) {
    const s = pieces[i].shape
    const ex = s.kind === 'block' ? s.hx : s.r
    const ez = s.kind === 'block' ? s.hz : s.r
    b.minX[i] = s.x - ex
    b.maxX[i] = s.x + ex
    b.minZ[i] = s.z - ez
    b.maxZ[i] = s.z + ez
  }
  boundsCache.set(pieces, b)
  return b
}

/**
 * The spatial grid for hit queries (GAME.md §10): the pieces filed by footprint in square cells, built once per layout.
 * A query takes the pieces in the cells its box covers, in index order, so it finds exactly what a full scan would.
 */
const CELL = 6
interface Grid {
  x0: number
  z0: number
  nx: number
  nz: number
  cells: Int32Array[]
  seen: Uint32Array
  stamp: number
}
const gridCache = new WeakMap<readonly CoverPiece[], Grid>()
function gridOf(pieces: readonly CoverPiece[]): Grid {
  let g = gridCache.get(pieces)
  if (g) return g
  const b = boundsOf(pieces)
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < pieces.length; i++) {
    x0 = Math.min(x0, b.minX[i])
    z0 = Math.min(z0, b.minZ[i])
    x1 = Math.max(x1, b.maxX[i])
    z1 = Math.max(z1, b.maxZ[i])
  }
  if (!pieces.length) x0 = z0 = x1 = z1 = 0
  const nx = Math.max(1, Math.ceil((x1 - x0) / CELL))
  const nz = Math.max(1, Math.ceil((z1 - z0) / CELL))
  const lists: number[][] = Array.from({ length: nx * nz }, () => [])
  const cx = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / CELL)))
  const cz = (z: number) => Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / CELL)))
  for (let i = 0; i < pieces.length; i++)
    for (let ix = cx(b.minX[i]); ix <= cx(b.maxX[i]); ix++) for (let iz = cz(b.minZ[i]); iz <= cz(b.maxZ[i]); iz++) lists[iz * nx + ix].push(i)
  g = { x0, z0, nx, nz, cells: lists.map((l) => Int32Array.from(l)), seen: new Uint32Array(pieces.length), stamp: 0 }
  gridCache.set(pieces, g)
  return g
}
const scratch: number[] = []
/** The pieces whose cells a box overlaps, ascending; undefined means "all of them" (no grid, or a box so wide a scan is as quick). */
function candidates(pieces: readonly CoverPiece[], minX: number, maxX: number, minZ: number, maxZ: number): ArrayLike<number> | undefined {
  if (!GRIDS.on || pieces.length < 32) return undefined
  const g = gridOf(pieces)
  const ax = Math.min(g.nx - 1, Math.max(0, Math.floor((minX - g.x0) / CELL)))
  const bx = Math.min(g.nx - 1, Math.max(0, Math.floor((maxX - g.x0) / CELL)))
  const az = Math.min(g.nz - 1, Math.max(0, Math.floor((minZ - g.z0) / CELL)))
  const bz = Math.min(g.nz - 1, Math.max(0, Math.floor((maxZ - g.z0) / CELL)))
  if (ax === bx && az === bz) return g.cells[az * g.nx + ax]
  if ((bx - ax + 1) * (bz - az + 1) > 24) return undefined
  if (++g.stamp === 0xffffffff) (g.seen.fill(0), (g.stamp = 1))
  scratch.length = 0
  for (let iz = az; iz <= bz; iz++)
    for (let ix = ax; ix <= bx; ix++) {
      const cell = g.cells[iz * g.nx + ix]
      for (let k = 0; k < cell.length; k++) {
        const i = cell[k]
        if (g.seen[i] !== g.stamp) {
          g.seen[i] = g.stamp
          scratch.push(i)
        }
      }
    }
  return scratch.sort((a, b) => a - b)
}

/** Clip the fraction window [t0, t1] to where `start + t·d` lies within [lo, hi]; returns the new window or false. */
function clip(start: number, d: number, lo: number, hi: number, w: [number, number]): boolean {
  if (d === 0) return start >= lo && start <= hi
  let u = (lo - start) / d
  let v = (hi - start) / d
  if (u > v) {
    const t = u
    u = v
    v = t
  }
  if (u > w[0]) w[0] = u
  if (v < w[1]) w[1] = v
  return w[0] <= w[1]
}

/**
 * The fraction along a→b (direction d) where it, thickened by `radius`, enters piece `p`; negative when it starts
 * already inside, undefined when it never touches it within the segment.
 */
function entry(p: CoverPiece, a: Vec3, dx: number, dy: number, dz: number, radius: number, w: [number, number]): number | undefined {
  w[0] = -Infinity
  w[1] = Infinity
  if (!clip(a.y, dy, p.base - radius, p.top + radius, w)) return undefined
  const s = p.shape
  if (s.kind === 'block') {
    if (!clip(a.x, dx, s.x - s.hx - radius, s.x + s.hx + radius, w)) return undefined
    if (!clip(a.z, dz, s.z - s.hz - radius, s.z + s.hz + radius, w)) return undefined
    const sl = p.slope
    if (sl) {
      // under the slope: y <= low + k·(c − c_low) along the rise, a half-space the segment must also be in
      const alongX = sl.rise[0] === 'x'
      const sign = sl.rise[1] === '+' ? 1 : -1
      const half = alongX ? s.hx : s.hz
      const k = ((p.top - sl.low) / (2 * half)) * sign
      const lowEdge = (alongX ? s.x : s.z) - sign * half
      const g0 = a.y - sl.low - k * ((alongX ? a.x : a.z) - lowEdge) - radius
      const gd = dy - k * (alongX ? dx : dz)
      if (gd === 0) {
        if (g0 > 0) return undefined
      } else {
        const t = -g0 / gd
        if (gd > 0) w[1] = Math.min(w[1], t)
        else w[0] = Math.max(w[0], t)
        if (w[0] > w[1]) return undefined
      }
    }
  } else {
    // a circle in the ground plane: solve |a + t·d − c| = r for the entry and exit fractions
    const r = s.r + radius
    const fx = a.x - s.x
    const fz = a.z - s.z
    const qa = dx * dx + dz * dz
    const qb = 2 * (fx * dx + fz * dz)
    const qc = fx * fx + fz * fz - r * r
    if (qa === 0) {
      if (qc > 0) return undefined
    } else {
      const disc = qb * qb - 4 * qa * qc
      if (disc < 0) return undefined
      const root = Math.sqrt(disc)
      const u = (-qb - root) / (2 * qa)
      const v = (-qb + root) / (2 * qa)
      if (u > w[0]) w[0] = u
      if (v < w[1]) w[1] = v
      if (w[0] > w[1]) return undefined
    }
  }
  if (w[0] > 1 || w[1] < 0) return undefined
  return w[0]
}

/**
 * Where segment a→b, thickened by `radius`, first enters a standing piece: the fraction along the segment and the
 * piece's index, or undefined when the path is clear. A segment that starts in a piece's thickened shell but outside
 * the stone itself (a body pressed flat against a wall) is tested against the bare stone instead, so moving, dashing
 * or shooting away from a wall stays free while shooting into it still stops at it.
 */
export function coverHit(pieces: readonly CoverPiece[], health: readonly CoverHealth[], a: Vec3, b: Vec3, radius = 0): { t: number; index: number } | undefined {
  const bounds = boundsOf(pieces)
  let bestT = 2
  let bestIndex = -1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  // the segment's own box, to skip far pieces before any exact test
  const minX = (dx < 0 ? b.x : a.x) - radius
  const maxX = (dx < 0 ? a.x : b.x) + radius
  const minZ = (dz < 0 ? b.z : a.z) - radius
  const maxZ = (dz < 0 ? a.z : b.z) + radius
  const minY = (dy < 0 ? b.y : a.y) - radius
  const maxY = (dy < 0 ? a.y : b.y) + radius
  const w: [number, number] = [0, 1]
  const list = candidates(pieces, minX, maxX, minZ, maxZ)
  const n = list ? list.length : pieces.length
  for (let k = 0; k < n; k++) {
    const i = list ? list[k] : k
    if (health[i] === 0) continue
    if (maxX < bounds.minX[i] || minX > bounds.maxX[i] || maxZ < bounds.minZ[i] || minZ > bounds.maxZ[i]) continue
    const p = pieces[i]
    if (maxY < p.base || minY > p.top) continue
    let t = entry(p, a, dx, dy, dz, radius, w)
    if (t === undefined) continue
    if (t <= 0 && radius > 0) {
      t = entry(p, a, dx, dy, dz, 0, w)
      if (t === undefined) continue
    }
    if (t < bestT) {
      bestT = t
      bestIndex = i
    }
  }
  return bestIndex < 0 ? undefined : { t: Math.max(0, bestT), index: bestIndex }
}

/** True when nothing standing blocks the straight line from a to b. */
export const clearLine = (pieces: readonly CoverPiece[], health: readonly CoverHealth[], a: Vec3, b: Vec3) => !coverHit(pieces, health, a, b)

/**
 * Push a hero's body (an upright capsule of `radius` and `height`) out of every standing piece it overlaps, sliding
 * along walls rather than stopping dead. A piece whose top is no more than `clearance` above the feet doesn't push:
 * the hero walks onto it, and steps up once its centre is over it. A piece overhead (its underside above the feet) with
 * the body's centre under it is a ceiling and doesn't push either: keepOut pushes the body down under it, instead of it
 * being thrown out sideways through the ceiling's nearest edge, into whatever wall stands there. Returns
 * whether it touched anything; the index of each piece touched goes into `hits` when given.
 */
export function pushOut(pieces: readonly CoverPiece[], health: readonly CoverHealth[], p: Vec3, radius: number, height: number, clearance = 0, hits?: number[]): boolean {
  const bounds = boundsOf(pieces)
  let touched = false
  // the body moves as each piece pushes it, so the cells are taken a metre wider than it; a push that carries it out
  // of that box (out through the far side of a block) finishes the loop as a full scan
  const [x0, x1, z0, z1] = [p.x - 1, p.x + 1, p.z - 1, p.z + 1]
  let list = candidates(pieces, x0 - radius, x1 + radius, z0 - radius, z1 + radius)
  let n = list ? list.length : pieces.length
  let last = -1
  for (let k = 0; k < n; k++) {
    const i = list ? list[k] : k
    if (list && (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1)) {
      // on from just after the last piece looked at, as a scan would have gone
      list = undefined
      n = pieces.length
      k = last
      continue
    }
    last = i
    if (health[i] === 0) continue
    if (p.x + radius < bounds.minX[i] || p.x - radius > bounds.maxX[i] || p.z + radius < bounds.minZ[i] || p.z - radius > bounds.maxZ[i]) continue
    const piece = pieces[i]
    if (p.y + clearance >= piece.top || p.y + height <= piece.base) continue
    const s = piece.shape
    // its underside is above the feet: whatever of the body is in it came from below
    const overhead = piece.base > p.y
    if (s.kind === 'block') {
      const under = Math.abs(p.x - s.x) <= s.hx && Math.abs(p.z - s.z) <= s.hz
      if (overhead && under) continue
      // a body over a ramp stands on its slope wherever it is on it (a blink or a throw can put the feet under it):
      // only its sides push a body coming from beside it
      if (piece.slope && under) {
        const surface = surfaceAt(piece, p.x, p.z)
        if (p.y + clearance >= surface) continue
        // in the wedge below the slope, it touched the ramp
        p.y = surface
        touched = true
        hits?.push(i)
        continue
      }
      const cx = Math.max(s.x - s.hx, Math.min(p.x, s.x + s.hx))
      const cz = Math.max(s.z - s.hz, Math.min(p.z, s.z + s.hz))
      // a ramp only pushes where its slope is too high to step onto
      if (piece.slope && p.y + clearance >= surfaceAt(piece, cx, cz)) continue
      const ox = p.x - cx
      const oz = p.z - cz
      const d2 = ox * ox + oz * oz
      if (d2 >= radius * radius) continue
      touched = true
      hits?.push(i)
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2)
        p.x = cx + (ox / d) * radius
        p.z = cz + (oz / d) * radius
      } else {
        // the centre is inside the block: leave by the nearest face that doesn't put it inside another piece
        const exits: [number, number, number][] = [
          [s.x + s.hx - p.x, s.x + s.hx + radius, p.z],
          [p.x - (s.x - s.hx), s.x - s.hx - radius, p.z],
          [s.z + s.hz - p.z, p.x, s.z + s.hz + radius],
          [p.z - (s.z - s.hz), p.x, s.z - s.hz - radius],
        ]
        exits.sort((a, b) => a[0] - b[0])
        const out = exits.find(([, x, z]) => !solidAt(pieces, health, i, x, p.y, z, height, clearance)) ?? exits[0]
        p.x = out[1]
        p.z = out[2]
      }
    } else {
      const ox = p.x - s.x
      const oz = p.z - s.z
      const min = s.r + radius
      const d2 = ox * ox + oz * oz
      if (d2 >= min * min || (overhead && d2 <= s.r * s.r)) continue
      touched = true
      hits?.push(i)
      const d = Math.sqrt(d2)
      if (d > 1e-9) {
        p.x = s.x + (ox / d) * min
        p.z = s.z + (oz / d) * min
      } else p.x = s.x + min
    }
  }
  return touched
}

/** Whether a body standing at (x, y, z) would have its centre inside a standing piece other than `skip`. */
function solidAt(pieces: readonly CoverPiece[], health: readonly CoverHealth[], skip: number, x: number, y: number, z: number, height: number, clearance: number): boolean {
  const list = candidates(pieces, x, x, z, z)
  const n = list ? list.length : pieces.length
  for (let k = 0; k < n; k++) {
    const i = list ? list[k] : k
    const piece = pieces[i]
    if (i === skip || health[i] === 0 || y + clearance >= piece.top || y + height <= piece.base || piece.base > y) continue
    const s = piece.shape
    const inside = s.kind === 'block' ? Math.abs(x - s.x) <= s.hx && Math.abs(z - s.z) <= s.hz : (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) <= s.r * s.r
    if (inside && !piece.slope) return true
  }
  return false
}

/**
 * What a hero at `p` stands on (Forge goal, phase 2): the highest top of a standing piece under its centre that's no
 * higher than `reach`, or the ground (0). A hero on top of a wall stands on it; one under a lintel stands on the ground.
 */
export function floorUnder(pieces: readonly CoverPiece[], health: readonly CoverHealth[], p: Vec3, reach: number): number {
  const bounds = boundsOf(pieces)
  let floor = 0
  const list = candidates(pieces, p.x, p.x, p.z, p.z)
  const n = list ? list.length : pieces.length
  for (let k = 0; k < n; k++) {
    const i = list ? list[k] : k
    const piece = pieces[i]
    if (health[i] === 0 || piece.top <= floor || (piece.slope ? piece.slope.low > reach : piece.top > reach)) continue
    if (p.x < bounds.minX[i] || p.x > bounds.maxX[i] || p.z < bounds.minZ[i] || p.z > bounds.maxZ[i]) continue
    const s = piece.shape
    const over = s.kind === 'block' ? Math.abs(p.x - s.x) <= s.hx && Math.abs(p.z - s.z) <= s.hz : (p.x - s.x) * (p.x - s.x) + (p.z - s.z) * (p.z - s.z) <= s.r * s.r
    if (!over) continue
    const top = piece.slope ? surfaceAt(piece, p.x, p.z) : piece.top
    if (top > floor && top <= reach) floor = top
  }
  return floor
}

/** The standing column whose rim runs by (x, z) at the height `top`, or undefined on a straight edge. */
export function roundTop(pieces: readonly CoverPiece[], health: readonly CoverHealth[], x: number, z: number, top: number) {
  for (let i = 0; i < pieces.length; i++) {
    const s = pieces[i].shape
    if (s.kind === 'column' && health[i] !== 0 && Math.abs(pieces[i].top - top) < 1e-3 && Math.abs(Math.sqrt((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z)) - s.r) < 0.2) return s
  }
  return undefined
}

/**
 * The lowest underside of a standing piece over a disc of `radius` at `p` that a head rising from `from` to `to`
 * passes, or undefined: a deck or a tunnel roof a jump bumps into.
 */
export function ceilingOver(pieces: readonly CoverPiece[], health: readonly CoverHealth[], p: Vec3, radius: number, from: number, to: number): number | undefined {
  const bounds = boundsOf(pieces)
  let roof: number | undefined
  const list = candidates(pieces, p.x - radius, p.x + radius, p.z - radius, p.z + radius)
  const n = list ? list.length : pieces.length
  for (let k = 0; k < n; k++) {
    const i = list ? list[k] : k
    const piece = pieces[i]
    if (health[i] === 0 || piece.base <= 0 || piece.base < from - 1e-6 || piece.base > to) continue
    if (p.x + radius < bounds.minX[i] || p.x - radius > bounds.maxX[i] || p.z + radius < bounds.minZ[i] || p.z - radius > bounds.maxZ[i]) continue
    const s = piece.shape
    const over =
      s.kind === 'block'
        ? Math.abs(p.x - s.x) <= s.hx + radius && Math.abs(p.z - s.z) <= s.hz + radius
        : (p.x - s.x) * (p.x - s.x) + (p.z - s.z) * (p.z - s.z) <= (s.r + radius) * (s.r + radius)
    if (over && (roof === undefined || piece.base < roof)) roof = piece.base
  }
  return roof
}

/** The pieces a disc of `radius` around `at` overlaps, for area attacks that wear barriers down. */
export function coverInDisc(pieces: readonly CoverPiece[], health: readonly CoverHealth[], at: Vec3, radius: number): number[] {
  const out: number[] = []
  for (let i = 0; i < pieces.length; i++) {
    if (health[i] === 0) continue
    const piece = pieces[i]
    if (at.y > piece.top + radius || at.y < piece.base - radius) continue
    const s = piece.shape
    const near =
      s.kind === 'block'
        ? (() => {
            const cx = Math.max(s.x - s.hx, Math.min(at.x, s.x + s.hx)) - at.x
            const cz = Math.max(s.z - s.hz, Math.min(at.z, s.z + s.hz)) - at.z
            return cx * cx + cz * cz <= radius * radius
          })()
        : (at.x - s.x) * (at.x - s.x) + (at.z - s.z) * (at.z - s.z) <= (s.r + radius) * (s.r + radius)
    if (near) out.push(i)
  }
  return out
}
