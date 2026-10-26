/**
 * The surface every body shares. All twelve bodies are built on one proxy with one stored refinement
 * (tools/blender/humanlib/topology.json), so they have the same vertices joined into the same triangles. The exporter
 * splits a vertex wherever its UVs part and orders the copies by value, differently on every body, so each file
 * vertex carries `_VID`: its index in the welded mesh. Anything bound to a body (wardrobe items, face landmarks, the
 * face basis) is indexed by welded vertex, which means the same point on every body.
 */
export interface BodySurface {
  /** Welded vertices. */
  count: number
  /** File vertex to welded vertex. */
  vid: Uint32Array
  /** Welded triangles: three welded vertices each, wound as in the file. */
  triangles: Uint32Array
}

export function weldSurface(vid: ArrayLike<number>, index: ArrayLike<number>): BodySurface {
  const ids = Uint32Array.from(vid, (v) => Math.round(v))
  let count = 0
  for (const v of ids) if (v + 1 > count) count = v + 1
  const triangles = new Uint32Array(index.length)
  for (let i = 0; i < index.length; i++) triangles[i] = ids[index[i]]
  return { count, vid: ids, triangles }
}

/** Per-welded-vertex values from per-file-vertex ones (`size` numbers each); every copy of a vertex holds the same. */
export function weldValues(surface: BodySurface, values: ArrayLike<number>, size: number): Float32Array {
  const out = new Float32Array(surface.count * size)
  for (let i = 0; i < surface.vid.length; i++) {
    const w = surface.vid[i] * size
    for (let k = 0; k < size; k++) out[w + k] = values[i * size + k]
  }
  return out
}

/** Per-file-vertex values from per-welded-vertex ones: the reverse of weldValues. */
export function splitValues(surface: BodySurface, welded: ArrayLike<number>, size: number, out = new Float32Array(surface.vid.length * size)): Float32Array {
  for (let i = 0; i < surface.vid.length; i++) {
    const w = surface.vid[i] * size
    for (let k = 0; k < size; k++) out[i * size + k] = welded[w + k]
  }
  return out
}

/** Area-weighted normals over the welded triangles, so a UV seam never shows as a crease. */
export function weldedNormals(surface: BodySurface, positions: ArrayLike<number>): Float32Array {
  const n = new Float32Array(surface.count * 3)
  const t = surface.triangles
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3
    const b = t[i + 1] * 3
    const c = t[i + 2] * 3
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    // the cross product's length is twice the area, so bigger triangles count for more
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const v of [a, b, c]) {
      n[v] += nx
      n[v + 1] += ny
      n[v + 2] += nz
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= len
    n[i + 1] /= len
    n[i + 2] /= len
  }
  return n
}

/** Each welded triangle as a key that doesn't depend on which corner it starts from: for comparing topologies. */
export function triangleKeys(surface: BodySurface): string[] {
  const t = surface.triangles
  const out: string[] = []
  for (let i = 0; i < t.length; i += 3) {
    const tri = [t[i], t[i + 1], t[i + 2]]
    const k = tri.indexOf(Math.min(...tri))
    out.push(`${tri[k]},${tri[(k + 1) % 3]},${tri[(k + 2) % 3]}`)
  }
  return out
}
