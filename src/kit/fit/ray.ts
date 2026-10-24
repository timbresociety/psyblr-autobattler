/**
 * Rays against triangle meshes for the fit pipeline: which body vertices an item lies over (and how far out), whether
 * a point sits inside the body, and where a ray first meets a surface. A plain bounding-volume hierarchy, built once
 * per mesh.
 */

export type V3 = [number, number, number]

export interface Hit {
  t: number
  triangle: number
  /** Barycentric weights of the triangle's second and third corners. */
  u: number
  v: number
}

const LEAF = 4

export class TriangleBVH {
  readonly positions: ArrayLike<number>
  readonly index: ArrayLike<number>
  /** Per node: min xyz, max xyz. */
  private readonly box: Float32Array
  /** Per node: its children (-1 for a leaf), and a leaf's range in `order`. */
  private readonly left: Int32Array
  private readonly right: Int32Array
  private readonly start: Int32Array
  private readonly count: Int32Array
  private readonly order: Uint32Array
  private nodes = 0

  constructor(positions: ArrayLike<number>, index: ArrayLike<number>) {
    this.positions = positions
    this.index = index
    const n = index.length / 3
    this.order = Uint32Array.from({ length: n }, (_, i) => i)
    // a binary tree over n triangles has at most 2n - 1 nodes
    const max = Math.max(1, 2 * n)
    this.box = new Float32Array(max * 6)
    this.left = new Int32Array(max)
    this.right = new Int32Array(max)
    this.start = new Int32Array(max)
    this.count = new Int32Array(max)
    const centre = new Float32Array(n * 3)
    for (let t = 0; t < n; t++) {
      for (let d = 0; d < 3; d++) {
        centre[t * 3 + d] = (positions[index[t * 3] * 3 + d] + positions[index[t * 3 + 1] * 3 + d] + positions[index[t * 3 + 2] * 3 + d]) / 3
      }
    }
    if (n) this.build(0, n, centre)
  }

  private build(from: number, to: number, centre: Float32Array): number {
    const node = this.nodes++
    const P = this.positions
    const I = this.index
    const b = this.box
    b.fill(Infinity, node * 6, node * 6 + 3)
    b.fill(-Infinity, node * 6 + 3, node * 6 + 6)
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = from; i < to; i++) {
      const t = this.order[i]
      for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k] * 3
        for (let d = 0; d < 3; d++) {
          b[node * 6 + d] = Math.min(b[node * 6 + d], P[v + d])
          b[node * 6 + 3 + d] = Math.max(b[node * 6 + 3 + d], P[v + d])
        }
      }
      for (let d = 0; d < 3; d++) {
        lo[d] = Math.min(lo[d], centre[t * 3 + d])
        hi[d] = Math.max(hi[d], centre[t * 3 + d])
      }
    }
    if (to - from <= LEAF) {
      this.left[node] = -1
      this.start[node] = from
      this.count[node] = to - from
      return node
    }
    // split the triangles' centres at the middle of their longest side
    const axis = hi[0] - lo[0] >= hi[1] - lo[1] && hi[0] - lo[0] >= hi[2] - lo[2] ? 0 : hi[1] - lo[1] >= hi[2] - lo[2] ? 1 : 2
    const mid = (lo[axis] + hi[axis]) / 2
    let split = from
    for (let i = from; i < to; i++) {
      if (centre[this.order[i] * 3 + axis] < mid) {
        const tmp = this.order[i]
        this.order[i] = this.order[split]
        this.order[split] = tmp
        split++
      }
    }
    if (split === from || split === to) split = (from + to) >> 1
    this.left[node] = this.build(from, split, centre)
    this.right[node] = this.build(split, to, centre)
    return node
  }

  private rayBox(node: number, o: V3, inv: V3, tmax: number): boolean {
    const b = this.box
    let t0 = 0
    let t1 = tmax
    for (let d = 0; d < 3; d++) {
      let near = (b[node * 6 + d] - o[d]) * inv[d]
      let far = (b[node * 6 + 3 + d] - o[d]) * inv[d]
      if (near > far) [near, far] = [far, near]
      // NaN (a zero direction on a slab the origin sits on) leaves the slab open
      if (near > t0) t0 = near
      if (far < t1) t1 = far
      if (t0 > t1) return false
    }
    return true
  }

  /** Every place the ray o + t d (|d| = 1) crosses the mesh with tmin < t <= tmax, nearest first; both sides count. */
  hits(o: V3, d: V3, tmin: number, tmax: number): Hit[] {
    const out: Hit[] = []
    if (!this.nodes) return out
    const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]]
    const stack = [0]
    const P = this.positions
    const I = this.index
    while (stack.length) {
      const node = stack.pop()!
      if (!this.rayBox(node, o, inv, tmax)) continue
      const l = this.left[node]
      if (l >= 0) {
        stack.push(l, this.right[node])
        continue
      }
      for (let i = this.start[node]; i < this.start[node] + this.count[node]; i++) {
        const tri = this.order[i]
        const a = I[tri * 3] * 3
        const b = I[tri * 3 + 1] * 3
        const c = I[tri * 3 + 2] * 3
        // Möller–Trumbore
        const e1x = P[b] - P[a]
        const e1y = P[b + 1] - P[a + 1]
        const e1z = P[b + 2] - P[a + 2]
        const e2x = P[c] - P[a]
        const e2y = P[c + 1] - P[a + 1]
        const e2z = P[c + 2] - P[a + 2]
        const px = d[1] * e2z - d[2] * e2y
        const py = d[2] * e2x - d[0] * e2z
        const pz = d[0] * e2y - d[1] * e2x
        const det = e1x * px + e1y * py + e1z * pz
        if (Math.abs(det) < 1e-12) continue
        const id = 1 / det
        const tx = o[0] - P[a]
        const ty = o[1] - P[a + 1]
        const tz = o[2] - P[a + 2]
        const u = (tx * px + ty * py + tz * pz) * id
        if (u < 0 || u > 1) continue
        const qx = ty * e1z - tz * e1y
        const qy = tz * e1x - tx * e1z
        const qz = tx * e1y - ty * e1x
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * id
        if (v < 0 || u + v > 1) continue
        const t = (e2x * qx + e2y * qy + e2z * qz) * id
        if (t > tmin && t <= tmax) out.push({ t, triangle: tri, u, v })
      }
    }
    return out.sort((p, q) => p.t - q.t)
  }

  /** The first hit at or beyond tmin, if any within tmax. */
  first(o: V3, d: V3, tmin: number, tmax: number): Hit | undefined {
    return this.hits(o, d, tmin, tmax)[0]
  }

  /**
   * Whether p lies inside the (closed or nearly closed) mesh: a ray in each of a few directions, counting crossings;
   * the majority wins, so a gap or two in the mesh doesn't decide it.
   */
  inside(p: V3, reach = 3): boolean {
    let votes = 0
    for (const d of PROBES) if (this.hits(p, d, 0, reach).length % 2 === 1) votes++
    return votes * 2 > PROBES.length
  }
}

// skewed off every axis and diagonal, so a probe never runs exactly along an edge between two triangles (where it
// would count one crossing twice)
const PROBES: V3[] = [
  [0.6, 0.48, 0.64],
  [-0.64, 0.6, -0.48],
  [0.48, -0.64, -0.6],
  [-0.36, -0.48, 0.8],
  [0.8, 0.36, -0.48],
]
