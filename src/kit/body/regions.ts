import { bodyDirection, type Region, type Side } from '../rig/metarig.js'

/**
 * Where things are on a body, measured off its own skin (GAME.md §9.2–9.5): how thick a limb is at a point (its girth),
 * where the breasts, buttocks and belly sit, and smooth per-vertex masks over a region. The metarig's helpers are placed
 * and weighted from these, and the Volume dials (physique.ts) swell or slim the same regions, so a muscle helper always
 * moves the skin its dial shaped. Renderer-free; positions are welded (shape.ts), glTF axes (+z forward, +x left).
 */

export type Vec3 = [number, number, number]

/** A body's skeleton at rest, as much as the measurements need: each joint's position by bone name, and the skin's bone order. */
export interface Skeleton {
  bones: readonly string[]
  rest: Readonly<Record<string, Vec3>>
}

/** The skin the measurements read: welded positions, normals and four bones and weights a vertex. */
export interface Skin {
  positions: ArrayLike<number>
  normals?: ArrayLike<number>
  joints: ArrayLike<number>
  weights: ArrayLike<number>
  /** 1 where the vertex is skin (not an eye): only skin is measured or moved. */
  skin?: ArrayLike<number>
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const at = (p: ArrayLike<number>, i: number): Vec3 => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]

/** How much of vertex `i`'s weight goes to any of `bones` (indices into the skin's bone order). */
export function share(skin: Skin, i: number, bones: ReadonlySet<number>): number {
  let s = 0
  for (let k = 0; k < 4; k++) if (bones.has(skin.joints[i * 4 + k])) s += skin.weights[i * 4 + k]
  return s
}

export function boneSet(skeleton: Skeleton, names: readonly string[]): Set<number> {
  return new Set(names.map((n) => skeleton.bones.indexOf(n)).filter((i) => i >= 0))
}

/**
 * The body's radius around the segment from joint `from` to joint `to`, `along` of the way: the median distance from
 * the segment's line of the skin weighted mostly to `bones` within a tenth of the segment's length of that point. A
 * torso point (Spine2 toward an arm) reads the chest's half-depth; a limb point its own radius.
 */
export function girth(skin: Skin, skeleton: Skeleton, from: string, to: string, along: number, bones: readonly string[] = [from]): number {
  const a = skeleton.rest[from]
  const b = skeleton.rest[to]
  const axis = sub(b, a)
  const length = len(axis) || 1
  const u: Vec3 = [axis[0] / length, axis[1] / length, axis[2] / length]
  const set = boneSet(skeleton, bones)
  const dists: number[] = []
  const n = skin.positions.length / 3
  const band = Math.max(0.03, length * 0.1)
  for (let i = 0; i < n; i++) {
    if (skin.skin && !skin.skin[i]) continue
    if (share(skin, i, set) < 0.5) continue
    const d = sub(at(skin.positions, i), a)
    const t = dot(d, u)
    if (Math.abs(t - along * length) > band) continue
    const perp: Vec3 = [d[0] - u[0] * t, d[1] - u[1] * t, d[2] - u[2] * t]
    dists.push(len(perp))
  }
  if (!dists.length) return 0.05
  dists.sort((x, y) => x - y)
  return dists[dists.length >> 1]
}

/** A point on the body's surface: `at`, and the radius of the bump around it. */
export interface Landmark {
  at: Vec3
  radius: number
}

/**
 * The front-most (or back-most) bump of the skin weighted to `bones`, on one side (or down the middle), between two
 * heights: a breast or pec, a buttock, the belly. Each vertex scores by how far it stands out that way; the landmark is
 * the score-weighted centre of the top tenth, and its radius their spread.
 */
export function bump(skin: Skin, skeleton: Skeleton, bones: readonly string[], low: number, high: number, way: 1 | -1, side?: Side): Landmark | undefined {
  const set = boneSet(skeleton, bones)
  const n = skin.positions.length / 3
  const picks: { p: Vec3; s: number }[] = []
  for (let i = 0; i < n; i++) {
    if (skin.skin && !skin.skin[i]) continue
    if (share(skin, i, set) < 0.3) continue
    const p = at(skin.positions, i)
    if (p[1] < low || p[1] > high) continue
    if (side === 'Left' && p[0] < 0.02) continue
    if (side === 'Right' && p[0] > -0.02) continue
    if (!side && Math.abs(p[0]) > 0.06) continue
    // on a side, a little credit for sitting out from the middle: the sternum and the cleft stand out as far as the
    // breast or buttock does, but aren't its centre
    picks.push({ p, s: p[2] * way + (side ? Math.abs(p[0]) * 0.35 : 0) })
  }
  if (picks.length < 4) return undefined
  picks.sort((a, b) => b.s - a.s)
  const top = picks.slice(0, Math.max(4, Math.ceil(picks.length / 10)))
  const min = top[top.length - 1].s
  let w = 0
  const c: Vec3 = [0, 0, 0]
  for (const { p, s } of top) {
    const k = s - min + 1e-4
    w += k
    c[0] += p[0] * k
    c[1] += p[1] * k
    c[2] += p[2] * k
  }
  c[0] /= w
  c[1] /= w
  c[2] /= w
  // the bump's radius: how far the front tenth spreads across the body (its height and width), at least 4 cm
  let spread = 0
  for (const { p } of top) spread = Math.max(spread, Math.hypot(p[0] - c[0], p[1] - c[1]))
  // standing out `way`, the bump's centre of mass sits a little inside the skin
  return { at: [c[0], c[1], c[2] - way * spread * 0.35], radius: Math.max(0.04, spread * 1.6) }
}

/** The breasts (pecs on a male body), buttocks and belly of a body at rest. */
export interface BodyLandmarks {
  breast: Partial<Record<Side, Landmark>>
  glute: Partial<Record<Side, Landmark>>
  belly?: Landmark
}

export function bodyLandmarks(skin: Skin, skeleton: Skeleton): BodyLandmarks {
  const y = (b: string) => skeleton.rest[b][1]
  const chestLow = y('Spine1') + (y('Spine2') - y('Spine1')) * 0.3
  const chestHigh = y('Spine2') + (y('Neck') - y('Spine2')) * 0.5
  const seatLow = y('LeftUpLeg') - (y('LeftUpLeg') - y('LeftLeg')) * 0.25
  const seatHigh = y('Hips') + (y('Spine') - y('Hips')) * 0.5
  const out: BodyLandmarks = { breast: {}, glute: {} }
  // the bump's front tenth is its tip; the mound around it reaches further, at least these radii
  const atLeast = (l: Landmark | undefined, r: number) => l && { at: l.at, radius: Math.max(l.radius, r) }
  for (const side of ['Left', 'Right'] as const) {
    out.breast[side] = atLeast(bump(skin, skeleton, ['Spine2', 'Spine1'], chestLow, chestHigh, 1, side), 0.08)
    out.glute[side] = atLeast(bump(skin, skeleton, ['Hips', `${side}UpLeg`], seatLow, seatHigh, -1, side), 0.11)
  }
  out.belly = atLeast(bump(skin, skeleton, ['Spine', 'Hips', 'Spine1'], y('Hips'), y('Spine1'), 1), 0.12)
  return out
}

/** Smooth step from 1 at the centre to 0 at `radius`, flat near the middle: (1 - r²)². */
export const falloff = (d: number, radius: number) => {
  if (d >= radius) return 0
  const r = d / radius
  return (1 - r * r) * (1 - r * r)
}

/**
 * A region's mask: for each vertex, how much of it the region holds, 0 to 1. The share of its weight on the region's
 * bones, times a falloff from `centre` over `radius` metres, times how squarely the vertex's outward direction from
 * `centre` faces the region's `facing` (when it has one), softly.
 */
export function regionMask(skin: Skin, skeleton: Skeleton, region: Region, centre: Vec3, radius: number, side?: Side): Float32Array {
  const set = boneSet(skeleton, region.bones)
  const n = skin.positions.length / 3
  const out = new Float32Array(n)
  const facing = region.facing ? bodyDirection(region.facing, side) : undefined
  const fl = facing ? len(facing) || 1 : 1
  for (let i = 0; i < n; i++) {
    if (skin.skin && !skin.skin[i]) continue
    const s = share(skin, i, set)
    if (s <= 0) continue
    const p = at(skin.positions, i)
    const d = sub(p, centre)
    const dist = len(d)
    const f = falloff(dist, radius)
    if (!f) continue
    let face = 1
    if (facing) {
      // from the region's own side: 1 squarely facing, 0 at a right angle and beyond. Measured from a point set back
      // half the radius behind the centre, so the skin right at the centre (a nipple, a navel) reads one way, not
      // every way at once
      const back: Vec3 = [d[0] + (facing[0] / fl) * radius * 0.5, d[1] + (facing[1] / fl) * radius * 0.5, d[2] + (facing[2] / fl) * radius * 0.5]
      const bl = len(back)
      const c = bl > 1e-6 ? dot(back, facing) / (bl * fl) : 1
      face = Math.min(1, Math.max(0, c * 1.5 + 0.25))
    }
    out[i] = Math.min(1, s * f * face)
  }
  return out
}

/** Where a placement puts a point at rest: between two joints, then out by girths in body directions. */
export function placeAt(skeleton: Skeleton, from: string, to: string, along: number, out: readonly [number, number, number], g: number, side?: Side): Vec3 {
  const p = lerp(skeleton.rest[from], skeleton.rest[to], along)
  const d = bodyDirection(out, side)
  return [p[0] + d[0] * g, p[1] + d[1] * g, p[2] + d[2] * g]
}
