import { MAX_PARTICLES, RATE } from './cloth.js'

/**
 * Tails on chains: a nine-tails form's tails of energy. Each tail is a chain of particles from a root at the hero's
 * lower back. The chain swings behind the hero as it moves (Verlet), with each link held at its length and every
 * point pulled gently toward a rest shape that fans out behind and curls up. The tails keep out of the column the
 * body stands in. Renderer-free: the effect player feeds in the root and the facing each frame, then draws a ribbon
 * down every chain. Nine tails of six points is 45 moving particles, inside a hero's budget (cloth.ts).
 */

type V3 = [number, number, number]

export interface Tails {
  count: number
  /** Points down each tail, its root included. */
  points: number
  /** A tail's length in metres at scale 1. */
  length: number
  pos: Float32Array
  prev: Float32Array
  /** Time not yet stepped, so the chains step at a fixed rate whatever the frame rate. */
  carry: number
}

/** Velocity kept per step, and how far each point moves back toward its rest place per step. */
const KEEP = 0.9
const PULL = 0.06
/** Passes over the links each step. */
const PASSES = 3
/** The fan behind the hero, edge to edge, and how far each tail curls up from its root to its tip. */
const FAN = (150 * Math.PI) / 180
const RISE: [number, number] = [0.15, 1.15]

export function createTails(count = 9, points = 6, length = 1.4): Tails {
  if (count * (points - 1) > MAX_PARTICLES) throw new Error(`${count} tails of ${points} points is over a hero's ${MAX_PARTICLES} particles`)
  return { count, points, length, pos: new Float32Array(count * points * 3), prev: new Float32Array(count * points * 3), carry: 0 }
}

/** Point `i` of tail `t` at rest, for a root facing `yaw` (0 looks along +z), with tails `scale` times their length. */
export function restPoint(tails: Tails, t: number, i: number, root: V3, yaw: number, scale: number, out: V3 = [0, 0, 0]): V3 {
  const { count, points, length } = tails
  const spread = count > 1 ? (t / (count - 1) - 0.5) * FAN : 0
  // the fan opens behind: yaw + π points backward
  const heading = yaw + Math.PI + spread
  const seg = (length * scale) / (points - 1)
  let [x, y, z] = root
  for (let k = 1; k <= i; k++) {
    const rise = RISE[0] + (RISE[1] - RISE[0]) * (k / (points - 1))
    x += Math.sin(heading) * Math.cos(rise) * seg
    y += Math.sin(rise) * seg
    z += Math.cos(heading) * Math.cos(rise) * seg
  }
  out[0] = x
  out[1] = y
  out[2] = z
  return out
}

/** Put every tail at rest, as they appear. */
export function placeTails(tails: Tails, root: V3, yaw: number, scale: number) {
  const p: V3 = [0, 0, 0]
  for (let t = 0; t < tails.count; t++)
    for (let i = 0; i < tails.points; i++) {
      restPoint(tails, t, i, root, yaw, scale, p)
      tails.pos.set(p, (t * tails.points + i) * 3)
      tails.prev.set(p, (t * tails.points + i) * 3)
    }
  tails.carry = 0
}

/**
 * Advance the tails by `dt` seconds for a root at `root` facing `yaw`. `body` is the radius of the column the hero
 * stands in, centred `ahead` metres in front of the root (the root sits on its back).
 */
export function stepTails(tails: Tails, root: V3, yaw: number, scale: number, dt: number, body = 0, ahead = 0) {
  const h = 1 / RATE
  tails.carry = Math.min(tails.carry + dt, h * 4)
  const { pos, prev, points } = tails
  const seg = (tails.length * scale) / (points - 1)
  const rest: V3 = [0, 0, 0]
  const cx = root[0] + Math.sin(yaw) * ahead
  const cz = root[2] + Math.cos(yaw) * ahead
  while (tails.carry >= h) {
    tails.carry -= h
    for (let t = 0; t < tails.count; t++) {
      const base = t * points * 3
      pos.set(root, base)
      prev.set(root, base)
      for (let i = 1; i < points; i++) {
        const v = base + i * 3
        restPoint(tails, t, i, root, yaw, scale, rest)
        for (let a = 0; a < 3; a++) {
          const next = pos[v + a] + (pos[v + a] - prev[v + a]) * KEEP
          prev[v + a] = pos[v + a]
          pos[v + a] = next + (rest[a] - next) * PULL
        }
      }
      // each link back to its length, root outward, so a tail follows its root like a whip
      for (let pass = 0; pass < PASSES; pass++)
        for (let i = 1; i < points; i++) {
          const v = base + i * 3
          const u = v - 3
          const dx = pos[v] - pos[u]
          const dy = pos[v + 1] - pos[u + 1]
          const dz = pos[v + 2] - pos[u + 2]
          const d = Math.hypot(dx, dy, dz) || 1e-6
          const k = seg / d
          pos[v] = pos[u] + dx * k
          pos[v + 1] = pos[u + 1] + dy * k
          pos[v + 2] = pos[u + 2] + dz * k
          if (body > 0) {
            const ox = pos[v] - cx
            const oz = pos[v + 2] - cz
            const r = Math.hypot(ox, oz)
            if (r < body) {
              const s = r > 1e-6 ? body / r : 1
              pos[v] = cx + (r > 1e-6 ? ox : -Math.sin(yaw)) * s
              pos[v + 2] = cz + (r > 1e-6 ? oz : -Math.cos(yaw)) * s
            }
          }
        }
    }
  }
}

/** A point along tail `t` at `u` (0 at the root, 1 at the tip), smoothed between its particles (Catmull-Rom). */
export function tailPoint(tails: Tails, t: number, u: number, out: { x: number; y: number; z: number }) {
  const { pos, points } = tails
  const f = Math.min(Math.max(u, 0), 1) * (points - 1)
  const i = Math.min(Math.floor(f), points - 2)
  const s = f - i
  const at = (k: number, a: number) => pos[(t * points + Math.min(Math.max(k, 0), points - 1)) * 3 + a]
  const c = (a: number) => {
    const p0 = at(i - 1, a)
    const p1 = at(i, a)
    const p2 = at(i + 1, a)
    const p3 = at(i + 2, a)
    return 0.5 * (2 * p1 + (p2 - p0) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (3 * p1 - p0 - 3 * p2 + p3) * s * s * s)
  }
  out.x = c(0)
  out.y = c(1)
  out.z = c(2)
  return out
}
