/**
 * Binding a point to a body's surface, and finding it again on another body. A bound point stores the welded
 * triangle under it, where on that triangle (s, t) and how far out along the surface's interpolated normal (lift):
 *
 *   p = a + s (b - a) + t (c - a) + lift (na + s (nb - na) + t (nc - na))
 *
 * The normal is interpolated without normalising, so the same formula evaluated on any body is smooth across
 * triangles: a kimono bound on the reference body follows every other body's shape, physique and face. Renderer-free;
 * the fit pipeline binds (src/kit/fit/), the game evaluates (src/kit/wear/dress.ts).
 */

export interface SurfaceShape {
  /** Welded positions, xyz. */
  positions: ArrayLike<number>
  /** Welded unit normals, xyz. */
  normals: ArrayLike<number>
  /** Welded triangles, three vertices each. */
  triangles: ArrayLike<number>
}

/** Per bound point: its triangle's three welded vertices, (s, t) on it, and its lift. */
export interface Binding {
  tri: Uint16Array
  st: Float32Array
  lift: Float32Array
}

type V3 = [number, number, number]

const get = (a: ArrayLike<number>, i: number): V3 => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** The closest point on triangle abc to p, as (s, t) with p ≈ a + s (b - a) + t (c - a) (Ericson, Real-Time Collision Detection). */
export function closestST(p: V3, a: V3, b: V3, c: V3): [number, number] {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return [0, 0]
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return [1, 0]
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return [d1 / (d1 - d3), 0]
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return [0, 1]
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return [0, d2 / (d2 - d6)]
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return [1 - w, w]
  }
  const denom = 1 / (va + vb + vc)
  return [vb * denom, vc * denom]
}

/** The point and (unnormalised) normal at (s, t, lift) over triangle (a, b, c) of a surface. */
function at(shape: SurfaceShape, ia: number, ib: number, ic: number, s: number, t: number, lift: number, out: Float32Array, o: number) {
  const P = shape.positions
  const N = shape.normals
  for (let k = 0; k < 3; k++) {
    const a = P[ia * 3 + k]
    const na = N[ia * 3 + k]
    const p = a + s * (P[ib * 3 + k] - a) + t * (P[ic * 3 + k] - a)
    const n = na + s * (N[ib * 3 + k] - na) + t * (N[ic * 3 + k] - na)
    out[o + k] = p + lift * n
  }
}

/**
 * Solve p = P(s, t) + lift N(s, t) over one triangle by Newton's method from the closest point. Returns s, t, lift
 * and how far outside the triangle (s, t) fell (0 inside).
 */
export function projectOnto(p: V3, a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3): { s: number; t: number; lift: number; outside: number } {
  const e1 = sub(b, a)
  const e2 = sub(c, a)
  const f1 = sub(nb, na)
  const f2 = sub(nc, na)
  let [s, t] = closestST(p, a, b, c)
  const n0: V3 = [na[0] + s * f1[0] + t * f2[0], na[1] + s * f1[1] + t * f2[1], na[2] + s * f1[2] + t * f2[2]]
  const p0: V3 = [a[0] + s * e1[0] + t * e2[0], a[1] + s * e1[1] + t * e2[1], a[2] + s * e1[2] + t * e2[2]]
  let lift = dot(sub(p, p0), n0) / Math.max(1e-9, dot(n0, n0))
  for (let it = 0; it < 8; it++) {
    const n: V3 = [na[0] + s * f1[0] + t * f2[0], na[1] + s * f1[1] + t * f2[1], na[2] + s * f1[2] + t * f2[2]]
    const F: V3 = [0, 1, 2].map((k) => a[k] + s * e1[k] + t * e2[k] + lift * n[k] - p[k]) as V3
    if (dot(F, F) < 1e-14) break
    const c1: V3 = [e1[0] + lift * f1[0], e1[1] + lift * f1[1], e1[2] + lift * f1[2]]
    const c2: V3 = [e2[0] + lift * f2[0], e2[1] + lift * f2[1], e2[2] + lift * f2[2]]
    const det = dot(c1, cross(c2, n))
    if (Math.abs(det) < 1e-14) break
    // Cramer's rule for J [ds dt dlift] = F, J's columns c1, c2, n
    const ds = dot(F, cross(c2, n)) / det
    const dt = dot(c1, cross(F, n)) / det
    const dl = dot(c1, cross(c2, F)) / det
    s -= ds
    t -= dt
    lift -= dl
  }
  const outside = Math.max(0, -s, -t, s + t - 1)
  return { s, t, lift, outside }
}

/**
 * A uniform grid over a surface's triangles, for finding the ones near a point. Cells hold every triangle whose
 * bounds (grown by `pad`) touch them.
 */
export class TriangleGrid {
  private cells = new Map<number, number[]>()
  private readonly inv: number

  constructor(
    readonly shape: SurfaceShape,
    readonly cell = 0.04,
    pad = 0.0,
  ) {
    this.inv = 1 / cell
    const T = shape.triangles
    const P = shape.positions
    for (let f = 0; f < T.length / 3; f++) {
      let lo: V3 = [Infinity, Infinity, Infinity]
      let hi: V3 = [-Infinity, -Infinity, -Infinity]
      for (let k = 0; k < 3; k++) {
        const v = T[f * 3 + k]
        for (let d = 0; d < 3; d++) {
          lo[d] = Math.min(lo[d], P[v * 3 + d])
          hi[d] = Math.max(hi[d], P[v * 3 + d])
        }
      }
      lo = lo.map((x) => Math.floor((x - pad) * this.inv)) as V3
      hi = hi.map((x) => Math.floor((x + pad) * this.inv)) as V3
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const key = this.key(x, y, z)
            const list = this.cells.get(key)
            if (list) list.push(f)
            else this.cells.set(key, [f])
          }
    }
  }

  private key(x: number, y: number, z: number) {
    return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)
  }

  /** Triangles in the cells within `radius` of p. */
  near(p: V3, radius: number): number[] {
    const out = new Set<number>()
    const r = Math.ceil(radius * this.inv)
    const cx = Math.floor(p[0] * this.inv)
    const cy = Math.floor(p[1] * this.inv)
    const cz = Math.floor(p[2] * this.inv)
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let z = cz - r; z <= cz + r; z++) for (const f of this.cells.get(this.key(x, y, z)) ?? []) out.add(f)
    return [...out]
  }
}

/**
 * Where bound point (s, t, lift) over a triangle lands once (s, t) is clamped onto the triangle: the lift that best
 * reaches p from there, and how far from p that still leaves it.
 */
function settle(p: V3, a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, s0: number, t0: number): { s: number; t: number; lift: number; residual: number } {
  let s = Math.min(1, Math.max(0, s0))
  let t = Math.min(1, Math.max(0, t0))
  if (s + t > 1) {
    const k = 1 / (s + t)
    s *= k
    t *= k
  }
  const q: V3 = [0, 1, 2].map((k) => a[k] + s * (b[k] - a[k]) + t * (c[k] - a[k])) as V3
  const n: V3 = [0, 1, 2].map((k) => na[k] + s * (nb[k] - na[k]) + t * (nc[k] - na[k])) as V3
  const lift = dot(sub(p, q), n) / Math.max(1e-12, dot(n, n))
  const e = [0, 1, 2].map((k) => q[k] + lift * n[k] - p[k])
  return { s, t, lift, residual: Math.hypot(e[0], e[1], e[2]) }
}

/**
 * Bind points (xyz) to a surface: for each, of the triangles nearby, the one that puts it back most exactly, nearest
 * the surface (a point between two fingers binds to the finger it's off, not through the other). `reach` bounds the
 * search (metres).
 */
export function bindPoints(points: ArrayLike<number>, shape: SurfaceShape, grid = new TriangleGrid(shape), reach = 0.4): Binding {
  const n = points.length / 3
  const tri = new Uint16Array(n * 3)
  const st = new Float32Array(n * 2)
  const lift = new Float32Array(n)
  const T = shape.triangles
  for (let i = 0; i < n; i++) {
    const p = get(points, i)
    let best: { f: number; s: number; t: number; lift: number; score: number } | undefined
    for (let radius = grid.cell; radius <= reach + 1e-9 && !best; radius *= 2) {
      for (const f of grid.near(p, radius)) {
        const ia = T[f * 3]
        const ib = T[f * 3 + 1]
        const ic = T[f * 3 + 2]
        const a = get(shape.positions, ia)
        const b = get(shape.positions, ib)
        const c = get(shape.positions, ic)
        const na = get(shape.normals, ia)
        const nb = get(shape.normals, ib)
        const nc = get(shape.normals, ic)
        const r = projectOnto(p, a, b, c, na, nb, nc)
        const q = settle(p, a, b, c, na, nb, nc, r.s, r.t)
        // a millimetre left over costs as much as a centimetre further out
        const score = q.residual * 10 + Math.abs(q.lift)
        if (!Number.isFinite(score)) continue
        if (!best || score < best.score) best = { f, s: q.s, t: q.t, lift: q.lift, score }
      }
      // a binding found in a small search might lose to a triangle just outside it: search once more, a step wider
      if (best && best.score > radius) best = undefined
    }
    if (!best) throw new Error(`no surface within ${reach} m of point ${i}`)
    tri.set([T[best.f * 3], T[best.f * 3 + 1], T[best.f * 3 + 2]], i * 3)
    st[i * 2] = best.s
    st[i * 2 + 1] = best.t
    lift[i] = best.lift
  }
  return { tri, st, lift }
}

/** Bound points evaluated on a surface: positions xyz (and `out` reused when given). */
export function evaluate(binding: Binding, shape: SurfaceShape, out = new Float32Array(binding.lift.length * 3)): Float32Array {
  const { tri, st, lift } = binding
  for (let i = 0; i < lift.length; i++) at(shape, tri[i * 3], tri[i * 3 + 1], tri[i * 3 + 2], st[i * 2], st[i * 2 + 1], lift[i], out, i * 3)
  return out
}

/**
 * The surface frame at bound point i: the triangle's first edge made perpendicular to the interpolated normal (u), the
 * unit normal (n), and u × n (w). Item normals are stored in this frame, so they turn with the body under them.
 */
export function surfaceFrame(binding: Binding, shape: SurfaceShape, i: number, out = new Float32Array(9)): Float32Array {
  const P = shape.positions
  const N = shape.normals
  const ia = binding.tri[i * 3] * 3
  const ib = binding.tri[i * 3 + 1] * 3
  const ic = binding.tri[i * 3 + 2] * 3
  const s = binding.st[i * 2]
  const t = binding.st[i * 2 + 1]
  let nx = N[ia] + s * (N[ib] - N[ia]) + t * (N[ic] - N[ia])
  let ny = N[ia + 1] + s * (N[ib + 1] - N[ia + 1]) + t * (N[ic + 1] - N[ia + 1])
  let nz = N[ia + 2] + s * (N[ib + 2] - N[ia + 2]) + t * (N[ic + 2] - N[ia + 2])
  const nl = Math.hypot(nx, ny, nz) || 1
  nx /= nl
  ny /= nl
  nz /= nl
  const ex = P[ib] - P[ia]
  const ey = P[ib + 1] - P[ia + 1]
  const ez = P[ib + 2] - P[ia + 2]
  const d = ex * nx + ey * ny + ez * nz
  let ux = ex - d * nx
  let uy = ey - d * ny
  let uz = ez - d * nz
  const ul = Math.hypot(ux, uy, uz) || 1
  ux /= ul
  uy /= ul
  uz /= ul
  out[0] = ux
  out[1] = uy
  out[2] = uz
  out[3] = nx
  out[4] = ny
  out[5] = nz
  out[6] = uy * nz - uz * ny
  out[7] = uz * nx - ux * nz
  out[8] = ux * ny - uy * nx
  return out
}

/** Vectors (xyz per bound point) into each point's surface frame on `shape`: what an item file stores for normals. */
export function toLocal(binding: Binding, shape: SurfaceShape, vectors: ArrayLike<number>, out = new Float32Array(vectors.length)): Float32Array {
  const f = new Float32Array(9)
  for (let i = 0; i < vectors.length / 3; i++) {
    surfaceFrame(binding, shape, i, f)
    const x = vectors[i * 3]
    const y = vectors[i * 3 + 1]
    const z = vectors[i * 3 + 2]
    out[i * 3] = x * f[0] + y * f[1] + z * f[2]
    out[i * 3 + 1] = x * f[3] + y * f[4] + z * f[5]
    out[i * 3 + 2] = x * f[6] + y * f[7] + z * f[8]
  }
  return out
}

/** The reverse of toLocal: vectors in each point's surface frame back out on `shape`. */
export function fromLocal(binding: Binding, shape: SurfaceShape, local: ArrayLike<number>, out = new Float32Array(local.length)): Float32Array {
  const f = new Float32Array(9)
  for (let i = 0; i < local.length / 3; i++) {
    surfaceFrame(binding, shape, i, f)
    const x = local[i * 3]
    const y = local[i * 3 + 1]
    const z = local[i * 3 + 2]
    out[i * 3] = x * f[0] + y * f[3] + z * f[6]
    out[i * 3 + 1] = x * f[1] + y * f[4] + z * f[7]
    out[i * 3 + 2] = x * f[2] + y * f[5] + z * f[8]
  }
  return out
}
