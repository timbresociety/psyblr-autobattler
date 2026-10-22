import type { Vec3 } from './maths'

/**
 * Cover (R1, R25): the ruins heroes hide behind. Every piece is engine geometry, so the renderer draws exactly what
 * blocks: an axis-aligned block (walls, fallen columns, barricades, lintels) or an upright cylinder (columns). A piece
 * spans `base`..`top` in height; flying over it, or under a lintel, clears it. Breakable pieces have health and are
 * gone once it reaches zero. Pure arithmetic, so it stays deterministic (KTD1).
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
  /** What the renderer builds here; the engine ignores it. */
  look: 'wall' | 'column' | 'fallen' | 'barricade' | 'lintel' | 'plinth'
}

/** One piece's state in a match: its health, or -1 for unbreakable; 0 means broken and gone. */
export type CoverHealth = number

/** The broken Roman ruins (R25): near-mirror halves, a low fallen column across the middle, barricades to break. */
export const RUINS: readonly CoverPiece[] = (() => {
  const pieces: CoverPiece[] = []
  const block = (x: number, z: number, hx: number, hz: number, top: number, look: CoverPiece['look'], health?: number, base = 0) =>
    pieces.push({ shape: { kind: 'block', x, z, hx, hz }, base, top, look, ...(health ? { health } : {}) })
  const column = (x: number, z: number, r: number, top: number, look: CoverPiece['look'] = 'column') => pieces.push({ shape: { kind: 'column', x, z, r }, base: 0, top, look })
  // the middle: a toppled column to duck behind, flanked by standing columns and two barricades
  block(0, 0, 3.6, 0.6, 1.3, 'fallen')
  for (const s of [-1, 1]) {
    column(9 * s, 2.6 * s, 0.9, 7.5)
    column(9.5 * s, -2.4 * s, 0.85, 4.2)
    column(19 * s, 0.6 * s, 1, 3.2)
    block(14 * s, 0, 1.7, 0.45, 2.3, 'barricade', 1400)
  }
  // each half, mirrored through the middle with small differences (Dire and Radiant, R1)
  for (const side of [-1, 1]) {
    const z = (v: number) => v * side
    const nudge = side > 0 ? 1.5 : 0
    block(-21 + nudge, z(8.5), 5, 0.55, 3.4, 'wall')
    block(21, z(9.5) + side * 0.5, 4, 0.55, 2.8, 'wall')
    block(-7 - nudge, z(19), 0.55, 2.8, 3.1, 'wall')
    block(8, z(20), 0.55, 2.4, 2.6, 'wall')
    block(-12, z(5), 1.8, 0.45, 2.2, 'barricade', 1200)
    block(12 + nudge, z(5.5), 1.8, 0.45, 2.2, 'barricade', 1200)
    block(0, z(7.5), 2, 0.45, 2.2, 'barricade', 1200)
    // an arch: two columns and a lintel overhead that a hero can walk under
    column(-2.2, z(23), 0.75, 6.2)
    column(2.2, z(23), 0.75, 6.2)
    block(0, z(23), 3, 0.8, 7, 'lintel', undefined, 5.6)
    // colonnade ruins along the flanks
    column(-31 + nudge, z(12), 1, 8)
    column(-28, z(18), 0.8, 5)
    column(31, z(14), 1, 7)
    column(27 - nudge, z(21), 0.9, 3)
    block(-33, z(25), 3.5, 2.5, 1.6, 'plinth')
    block(34, z(3), 2.5, 3.5, 1.6, 'plinth')
  }
  return pieces
})()

export const initialCoverHealth = (pieces: readonly CoverPiece[]): CoverHealth[] => pieces.map((p) => p.health ?? -1)

const standing = (health: readonly CoverHealth[], i: number) => health[i] !== 0

/**
 * Where segment a→b, thickened by `radius`, first enters a standing piece: the fraction along the segment and the
 * piece's index, or undefined when the path is clear.
 */
export function coverHit(pieces: readonly CoverPiece[], health: readonly CoverHealth[], a: Vec3, b: Vec3, radius = 0): { t: number; index: number } | undefined {
  let best: { t: number; index: number } | undefined
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  // the segment's box, to skip far pieces before any exact test
  const minX = Math.min(a.x, b.x) - radius
  const maxX = Math.max(a.x, b.x) + radius
  const minZ = Math.min(a.z, b.z) - radius
  const maxZ = Math.max(a.z, b.z) + radius
  const minY = Math.min(a.y, b.y) - radius
  const maxY = Math.max(a.y, b.y) + radius
  for (let i = 0; i < pieces.length; i++) {
    if (!standing(health, i)) continue
    const p = pieces[i]
    if (maxY < p.base || minY > p.top) continue
    const sh = p.shape
    const ex = sh.kind === 'block' ? sh.hx : sh.r
    const ez = sh.kind === 'block' ? sh.hz : sh.r
    if (maxX < sh.x - ex || minX > sh.x + ex || maxZ < sh.z - ez || minZ > sh.z + ez) continue
    let t0 = 0
    let t1 = 1
    // the height slab, shared by both shapes
    const slab = (start: number, d: number, lo: number, hi: number) => {
      if (d === 0) return start >= lo && start <= hi
      let u = (lo - start) / d
      let v = (hi - start) / d
      if (u > v) [u, v] = [v, u]
      if (u > t0) t0 = u
      if (v < t1) t1 = v
      return t0 <= t1
    }
    if (!slab(a.y, dy, p.base - radius, p.top + radius)) continue
    const s = p.shape
    if (s.kind === 'block') {
      if (!slab(a.x, dx, s.x - s.hx - radius, s.x + s.hx + radius)) continue
      if (!slab(a.z, dz, s.z - s.hz - radius, s.z + s.hz + radius)) continue
    } else {
      // a circle in the ground plane: solve |a + t·d − c| = r for the entry and exit fractions
      const r = s.r + radius
      const fx = a.x - s.x
      const fz = a.z - s.z
      const qa = dx * dx + dz * dz
      const qb = 2 * (fx * dx + fz * dz)
      const qc = fx * fx + fz * fz - r * r
      if (qa === 0) {
        if (qc > 0) continue
      } else {
        const disc = qb * qb - 4 * qa * qc
        if (disc < 0) continue
        const root = Math.sqrt(disc)
        const u = (-qb - root) / (2 * qa)
        const v = (-qb + root) / (2 * qa)
        if (u > t0) t0 = u
        if (v < t1) t1 = v
        if (t0 > t1) continue
      }
    }
    if (t0 <= t1 && t0 <= 1 && t1 >= 0 && (!best || t0 < best.t)) best = { t: Math.max(0, t0), index: i }
  }
  return best
}

/** True when nothing standing blocks the straight line from a to b. */
export const clearLine = (pieces: readonly CoverPiece[], health: readonly CoverHealth[], a: Vec3, b: Vec3) => !coverHit(pieces, health, a, b)

/**
 * Push a hero's body (an upright capsule of `radius` and `height`) out of every standing piece it overlaps, sliding
 * along walls rather than stopping dead. Returns whether it touched anything.
 */
export function pushOut(pieces: readonly CoverPiece[], health: readonly CoverHealth[], p: Vec3, radius: number, height: number): boolean {
  let touched = false
  for (let i = 0; i < pieces.length; i++) {
    if (!standing(health, i)) continue
    const piece = pieces[i]
    if (p.y >= piece.top || p.y + height <= piece.base) continue
    const s = piece.shape
    if (s.kind === 'block') {
      const cx = Math.max(s.x - s.hx, Math.min(p.x, s.x + s.hx))
      const cz = Math.max(s.z - s.hz, Math.min(p.z, s.z + s.hz))
      const ox = p.x - cx
      const oz = p.z - cz
      const d2 = ox * ox + oz * oz
      if (d2 >= radius * radius) continue
      touched = true
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2)
        p.x = cx + (ox / d) * radius
        p.z = cz + (oz / d) * radius
      } else {
        // the centre is inside the block: leave by the nearest face
        const exits = [s.x + s.hx - p.x, p.x - (s.x - s.hx), s.z + s.hz - p.z, p.z - (s.z - s.hz)]
        const k = exits.indexOf(Math.min(...exits))
        if (k === 0) p.x = s.x + s.hx + radius
        else if (k === 1) p.x = s.x - s.hx - radius
        else if (k === 2) p.z = s.z + s.hz + radius
        else p.z = s.z - s.hz - radius
      }
    } else {
      const ox = p.x - s.x
      const oz = p.z - s.z
      const min = s.r + radius
      const d2 = ox * ox + oz * oz
      if (d2 >= min * min) continue
      touched = true
      const d = Math.sqrt(d2)
      if (d > 1e-9) {
        p.x = s.x + (ox / d) * min
        p.z = s.z + (oz / d) * min
      } else p.x = s.x + min
    }
  }
  return touched
}

/** The pieces a disc of `radius` around `at` overlaps, for area attacks that wear barriers down. */
export function coverInDisc(pieces: readonly CoverPiece[], health: readonly CoverHealth[], at: Vec3, radius: number): number[] {
  const out: number[] = []
  for (let i = 0; i < pieces.length; i++) {
    if (!standing(health, i)) continue
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
