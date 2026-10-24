/**
 * The face basis (public/kit/face-basis.bin, from tools/blender/human.py --face-basis): how each of the face fit's
 * MakeHuman target groups moves the welded vertices of a body. A fitted face is the body plus each group's weight
 * times its deltas, so the game shapes any body's head to a photo the way Blender shaped the starters' heads to
 * their portraits.
 *
 * File layout, little-endian: 'PFB1', u32 welded vertices, u16 groups, then per group u32 n, u16[n] welded vertices
 * and i16[3n] deltas in hundredths of a millimetre, glTF axes. face-basis.json names the groups and binds the
 * MediaPipe landmarks to the surface.
 */
export interface FaceGroup {
  ids: Uint16Array
  /** x, y, z per id, in metres on the reference body. */
  deltas: Float32Array
}

export interface FaceBasis {
  vertices: number
  groups: FaceGroup[]
}

/** face-basis.json: the groups in file order, the reference body's face scale, and each landmark on the surface. */
export interface FaceBasisMeta {
  version: 1
  vertices: number
  faceScale: number
  groups: string[]
  /** Per MediaPipe landmark: three welded vertices and their barycentric weights, or null where none was found. */
  landmarks: ([number, number, number, number, number, number] | null)[]
}

const UNIT = 1e-5

export function parseFaceBasis(buf: ArrayBuffer): FaceBasis {
  const view = new DataView(buf)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'PFB1') throw new Error(`not a face basis (${magic})`)
  const vertices = view.getUint32(4, true)
  const count = view.getUint16(8, true)
  const groups: FaceGroup[] = []
  let at = 10
  for (let g = 0; g < count; g++) {
    const n = view.getUint32(at, true)
    at += 4
    const ids = new Uint16Array(n)
    for (let i = 0; i < n; i++) ids[i] = view.getUint16(at + i * 2, true)
    at += n * 2
    const deltas = new Float32Array(n * 3)
    for (let i = 0; i < n * 3; i++) deltas[i] = view.getInt16(at + i * 2, true) * UNIT
    at += n * 6
    groups.push({ ids, deltas })
  }
  return { vertices, groups }
}

/**
 * Add a face to welded positions (in place): each group's deltas times its weight, scaled from the reference body to
 * this one (`scale`, its faceScale over the reference's).
 */
export function applyFace(basis: FaceBasis, weights: ArrayLike<number>, scale: number, positions: Float32Array): Float32Array {
  basis.groups.forEach((g, gi) => {
    const w = (weights[gi] ?? 0) * scale
    if (!w) return
    for (let i = 0; i < g.ids.length; i++) {
      const v = g.ids[i] * 3
      positions[v] += g.deltas[i * 3] * w
      positions[v + 1] += g.deltas[i * 3 + 1] * w
      positions[v + 2] += g.deltas[i * 3 + 2] * w
    }
  })
  return positions
}

/** A landmark's position on welded positions, from its binding; undefined where the landmark has none. */
export function landmarkAt(bind: FaceBasisMeta['landmarks'][number], positions: ArrayLike<number>): [number, number, number] | undefined {
  if (!bind) return undefined
  const [a, b, c, u, v, w] = bind
  return [0, 1, 2].map((k) => positions[a * 3 + k] * u + positions[b * 3 + k] * v + positions[c * 3 + k] * w) as [number, number, number]
}
