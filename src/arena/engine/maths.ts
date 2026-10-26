/**
 * Deterministic maths for the engine and the AI (KTD1). Browsers may compute the platform sine, atan2, hypot, pow and
 * friends differently, which would break replays, so the engine uses only `+ - * /`, `Math.sqrt` (exact everywhere)
 * and the approximations below. Every function here is a fixed sequence of exact operations.
 */

export const PI = 3.141592653589793
export const TAU = 2 * PI
const HALF_PI = PI / 2

/** Wrap an angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  const turns = Math.floor((a + PI) / TAU)
  return a - turns * TAU
}

/** sin, accurate to about 1e-6 over any input: wrap, fold into [-PI/2, PI/2], then an odd polynomial. */
export function sin(a: number): number {
  let x = wrapAngle(a)
  if (x > HALF_PI) x = PI - x
  else if (x < -HALF_PI) x = -PI - x
  const x2 = x * x
  // Taylor terms through x^11 on [-PI/2, PI/2]
  return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - x2 / 110)))))
}

export const cos = (a: number) => sin(a + HALF_PI)

/** atan on [-1, 1], about 1e-5 accurate. */
function atanUnit(z: number): number {
  const z2 = z * z
  return z * (0.9998660 + z2 * (-0.3302995 + z2 * (0.1801410 + z2 * (-0.0851330 + z2 * 0.0208351))))
}

export function atan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0
  const ax = x < 0 ? -x : x
  const ay = y < 0 ? -y : y
  const r = ay > ax ? HALF_PI - atanUnit(ax / ay) : atanUnit(ay / ax)
  const q = x < 0 ? PI - r : r
  return y < 0 ? -q : q
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
export const lengthSq = (a: Vec3) => dot(a, a)
export const length = (a: Vec3) => Math.sqrt(lengthSq(a))
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b))

export function normalize(a: Vec3): Vec3 {
  const l = length(a)
  return l > 0 ? scale(a, 1 / l) : vec()
}

/** Unit direction from yaw (around y, 0 = +z) and pitch (up positive), both in radians. */
export function direction(yaw: number, pitch: number): Vec3 {
  const cp = cos(pitch)
  return { x: sin(yaw) * cp, y: sin(pitch), z: cos(yaw) * cp }
}

/** Yaw and pitch that point along `d`. */
export function yawPitch(d: Vec3): { yaw: number; pitch: number } {
  return { yaw: atan2(d.x, d.z), pitch: atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z)) }
}

/** Distance from point `p` to segment `a`-`b`. */
export function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a)
  const len = lengthSq(ab)
  const t = len > 0 ? clamp(dot(sub(p, a), ab) / len, 0, 1) : 0
  return distance(p, add(a, scale(ab, t)))
}

/**
 * Distance between segment `p0`-`p1` and a vertical capsule axis from `base` up `height` metres. Used for swept
 * projectile and beam hits: the closest approach of two segments, found by clamped projection.
 */
export function segmentToCapsuleAxis(p0: Vec3, p1: Vec3, base: Vec3, height: number): number {
  const top = { x: base.x, y: base.y + height, z: base.z }
  const d1 = sub(p1, p0)
  const d2 = sub(top, base)
  const r = sub(p0, base)
  const a = lengthSq(d1)
  const e = lengthSq(d2)
  const f = dot(d2, r)
  let s = 0
  let t = 0
  if (a <= 1e-12) {
    t = e > 0 ? clamp(f / e, 0, 1) : 0
  } else {
    const c = dot(d1, r)
    if (e <= 1e-12) {
      s = clamp(-c / a, 0, 1)
    } else {
      const b = dot(d1, d2)
      const denom = a * e - b * b
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom, 0, 1) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp(-c / a, 0, 1)
      } else if (t > 1) {
        t = 1
        s = clamp((b - c) / a, 0, 1)
      }
    }
  }
  return distance(add(p0, scale(d1, s)), add(base, scale(d2, t)))
}

/** Matches calls and the `**` operator the engine and the AI must not use; see the module comment. `/**` comments don't match. */
export const FORBIDDEN_MATHS = /Math\.(sin|cos|tan|atan2|atan|asin|acos|pow|exp|expm1|log|log2|log10|log1p|cbrt|hypot|sinh|cosh|tanh)\b|[\w)\]]\s*\*\*\s*[\w(-]/
