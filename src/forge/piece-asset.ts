import { NodeIO, type Document, type mat4 } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { clearNodeTransform, dedup, flatten, prune, simplify, textureCompress, transformPrimitive, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import type { PieceKind } from '../charter/look.js'
import { countTriangles } from './arena-asset.js'

/**
 * A generated model made into a piece of gear (Phase D of the Forge plan): welded, cut to its slot's triangle budget,
 * its textures shrunk to 512 px WebP, then turned, sized and placed in socket space (glTF axes: y up, the hero's front
 * +z; see tools/blender/humanlib/sockets.py) so it hangs right on any body:
 * - a hand piece's length runs along +y with its handle (the thinner end) in the palm and its wide side along z
 * - an off-hand piece (a shield, a bow) is held at its middle, its flat side facing +x, out from the left hand
 * - a head piece sits down on the hat line, a face piece in front of the eyes, a back piece against the back
 * Generated models arrive upright, so only hand and off-hand pieces are turned.
 */

/** The most triangles a piece keeps, by kind. */
export const PIECE_BUDGET: Record<PieceKind, number> = { head: 4000, face: 2500, hand: 5000, offhand: 4000, back: 5000 }

/** The size a piece is scaled to, in metres: a hand piece's length, a hat's width, glasses across, and so on. */
export const PIECE_SIZE: Record<PieceKind, number> = { head: 0.26, face: 0.17, hand: 0.95, offhand: 0.62, back: 0.75 }

export const PIECE_TEXTURE = 512

export interface PieceAsset {
  glb: Uint8Array
  triangles: number
}

const io = async () => {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
}

type Vec3 = [number, number, number]

function positions(doc: Document): Vec3[] {
  const out: Vec3[] = []
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const v: number[] = []
      for (let i = 0; i < pos.getCount(); i++) out.push(pos.getElement(i, v).slice(0, 3) as Vec3)
    }
  return out
}

function bounds(points: Vec3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a])
      max[a] = Math.max(max[a], p[a])
    }
  return { min, max }
}

/** A column-major 4x4 matrix (glTF's layout) from three rows of a rotation, a uniform scale and a translation. */
function compose(rows: [Vec3, Vec3, Vec3], scale: number, t: Vec3): mat4 {
  const [r0, r1, r2] = rows
  return [r0[0] * scale, r1[0] * scale, r2[0] * scale, 0, r0[1] * scale, r1[1] * scale, r2[1] * scale, 0, r0[2] * scale, r1[2] * scale, r2[2] * scale, 0, t[0], t[1], t[2], 1]
}

const apply = (rows: [Vec3, Vec3, Vec3], p: Vec3): Vec3 => rows.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2]) as Vec3
const unit = (axis: number, sign = 1): Vec3 => [0, 1, 2].map((a) => (a === axis ? sign : 0)) as Vec3
const det = ([a, b, c]: [Vec3, Vec3, Vec3]) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])

/** Rows of a proper rotation taking the given source axes onto x, y and z (the x row flips if needed to keep it proper). */
function rotationOnto(x: number, y: number, z: number): [Vec3, Vec3, Vec3] {
  const rows: [Vec3, Vec3, Vec3] = [unit(x), unit(y), unit(z)]
  if (det(rows) < 0) rows[0] = unit(x, -1)
  return rows
}

/** The average spread across x and z of the points in a band of y: how thick the piece is there. */
function spread(points: Vec3[], y0: number, y1: number): number {
  const band = points.filter((p) => p[1] >= y0 && p[1] <= y1)
  if (!band.length) return 0
  const cx = band.reduce((s, p) => s + p[0], 0) / band.length
  const cz = band.reduce((s, p) => s + p[2], 0) / band.length
  return band.reduce((s, p) => s + Math.hypot(p[0] - cx, p[2] - cz), 0) / band.length
}

/** The transform that puts a piece of this kind in socket space, worked out from its vertices. */
export function placement(points: Vec3[], kind: PieceKind): mat4 {
  const { min, max } = bounds(points)
  const size = [0, 1, 2].map((a) => Math.max(max[a] - min[a], 1e-4))
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a])
  let rows: [Vec3, Vec3, Vec3] = [unit(0), unit(1), unit(2)]
  if (kind === 'hand') rows = rotationOnto(order[2], order[0], order[1])
  if (kind === 'offhand') rows = rotationOnto(order[2], order[0], order[1])
  let turned = points.map((p) => apply(rows, p))
  let b = bounds(turned)
  if (kind === 'hand') {
    // the handle is the thinner end: it goes down, into the palm
    const len = b.max[1] - b.min[1]
    if (spread(turned, b.min[1], b.min[1] + len * 0.15) > spread(turned, b.max[1] - len * 0.15, b.max[1])) {
      rows = [rows[0].map((v) => -v) as Vec3, rows[1].map((v) => -v) as Vec3, rows[2]]
      turned = points.map((p) => apply(rows, p))
      b = bounds(turned)
    }
  }
  const ext = [0, 1, 2].map((a) => Math.max(b.max[a] - b.min[a], 1e-4))
  const scale = PIECE_SIZE[kind] / (kind === 'head' ? Math.max(ext[0], ext[2]) : kind === 'face' ? ext[0] : Math.max(...ext))
  const mid = (a: number) => (b.min[a] + b.max[a]) / 2
  let t: Vec3
  switch (kind) {
    case 'hand': {
      // grip 15% up from the handle's end, centred on the handle
      const len = ext[1]
      const handle = turned.filter((p) => p[1] <= b.min[1] + len * 0.3)
      const hb = bounds(handle.length ? handle : turned)
      t = [-(hb.min[0] + hb.max[0]) / 2, -(b.min[1] + len * 0.15), -(hb.min[2] + hb.max[2]) / 2]
      break
    }
    case 'offhand':
      // held at its middle, a hand's width out from the palm
      t = [-mid(0) + 0.07 / scale, -mid(1), -mid(2)]
      break
    case 'head':
      // sunk a little onto the head
      t = [-mid(0), -b.min[1] - 0.03 / scale, -mid(2)]
      break
    case 'face':
      // its front just ahead of the lens plane, the rest reaching back toward the ears
      t = [-mid(0), -mid(1), -b.max[2] + 0.012 / scale]
      break
    case 'back':
      // pressed against the back, reaching behind (-z)
      t = [-mid(0), -mid(1), -b.max[2]]
      break
  }
  return compose(rows, scale, t.map((v) => v * scale) as Vec3)
}

export async function pieceAsset(input: Uint8Array, kind: PieceKind): Promise<PieceAsset> {
  const reader = await io()
  const doc = await reader.readBinary(input)
  // one flat list of meshes in world space, so their vertices can be measured and moved together
  await doc.transform(flatten(), dedup(), prune())
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node)
  await doc.transform(weld())
  const before = countTriangles(doc)
  if (before > PIECE_BUDGET[kind]) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: PIECE_BUDGET[kind] / before, error: 0.01 }))
  const matrix = placement(positions(doc), kind)
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) transformPrimitive(prim, matrix)
  if (doc.getRoot().listTextures().length) await doc.transform(textureCompress({ encoder: sharp, resize: [PIECE_TEXTURE, PIECE_TEXTURE], targetFormat: 'webp' }))
  await doc.transform(prune())
  return { glb: await reader.writeBinary(doc), triangles: countTriangles(doc) }
}
