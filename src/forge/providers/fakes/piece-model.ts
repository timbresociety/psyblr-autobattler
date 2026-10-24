import { readFile } from 'node:fs/promises'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import type { PieceKind, WearSlot } from '../../../charter/look.js'

/**
 * A plain stand-in model for each kind of piece, so the whole generation flow runs offline: a hat for the head, a
 * visor for the face, a blade for a hand, a disc for the off hand and a pack for the back. Modelled in socket space
 * (glTF axes: y up, the hero's front +z), all in one 'primary' material.
 */

export type Box = [number, number, number, number, number, number]

const SHAPES: Record<PieceKind, { boxes: Box[]; color: [number, number, number] }> = {
  head: { boxes: [[-0.15, -0.005, -0.16, 0.15, 0.01, 0.16], [-0.1, 0.01, -0.11, 0.1, 0.16, 0.11]], color: [0.75, 0.6, 0.3] },
  face: { boxes: [[-0.08, -0.015, -0.005, 0.08, 0.02, 0.012]], color: [0.2, 0.8, 0.9] },
  hand: { boxes: [[-0.012, -0.12, -0.014, 0.012, 0.08, 0.014], [-0.06, 0.08, -0.016, 0.06, 0.1, 0.016], [-0.004, 0.1, -0.02, 0.004, 0.85, 0.02]], color: [0.7, 0.72, 0.78] },
  offhand: { boxes: [[0.04, -0.28, -0.28, 0.08, 0.28, 0.28]], color: [0.6, 0.15, 0.15] },
  back: { boxes: [[-0.16, -0.2, -0.17, 0.16, 0.18, -0.02]], color: [0.35, 0.4, 0.5] },
}

/** A box's six faces as four corners each (any winding; each is turned to face out) with its normal. */
function boxFaces([x0, y0, z0, x1, y1, z1]: Box): { corners: number[][]; normal: number[] }[] {
  return [
    { corners: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], normal: [1, 0, 0] },
    { corners: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], normal: [-1, 0, 0] },
    { corners: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], normal: [0, 1, 0] },
    { corners: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], normal: [0, -1, 0] },
    { corners: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], normal: [0, 0, 1] },
    { corners: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], normal: [0, 0, -1] },
  ]
}

/** A model of boxes in one 'primary' material (the fakes' stand-ins, and test models). */
export async function boxesModel(boxes: Box[], color: [number, number, number], name = 'boxes'): Promise<Uint8Array> {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (const box of boxes) {
    for (const { corners, normal } of boxFaces(box)) {
      const start = positions.length / 3
      for (const c of corners) {
        positions.push(...c)
        normals.push(...normal)
      }
      const [p0, p1, p2] = corners
      const a = p1.map((v, i) => v - p0[i])
      const b = p2.map((v, i) => v - p0[i])
      const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
      const outward = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0
      indices.push(...(outward ? [start, start + 1, start + 2, start, start + 2, start + 3] : [start, start + 2, start + 1, start, start + 3, start + 2]))
    }
  }
  const doc = new Document()
  const buffer = doc.createBuffer()
  const material = doc.createMaterial('primary').setBaseColorFactor([...color, 1]).setRoughnessFactor(0.55).setMetallicFactor(0.1).setDoubleSided(true)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
    .setMaterial(material)
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim))
  doc.createScene('piece').addChild(node)
  return new NodeIO().writeBinary(doc)
}

export function placeholderPiece(kind: PieceKind): Promise<Uint8Array> {
  return boxesModel(SHAPES[kind].boxes, SHAPES[kind].color, `placeholder-${kind}`)
}

/** The built-in item each slot's stand-in garment is made from (vercel.json ships these with the functions). */
export const GARMENT_FROM: Record<WearSlot, string> = { head: 'beanie', upper: 'tee', lower: 'trousers', full: 'kimono', back: 'cape', feet: 'sneakers' }

/**
 * A stand-in garment for a wardrobe slot, the way a 3D generator hands one back: a built-in item's mesh at its own
 * scale and in its own place (1.7 times as big, off to one side), in one material whose texture runs from one colour
 * at the top to another at the bottom. The garment job fits it like a real one (src/forge/garment.ts), so the whole
 * flow runs offline, colour regions and all.
 */
export async function placeholderGarment(slot: WearSlot, [top, bottom]: [string, string]): Promise<Uint8Array> {
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const item = await io.readBinary(new Uint8Array(await readFile(new URL(`../../../../public/kit/wear/${GARMENT_FROM[slot]}.glb`, import.meta.url))))
  const from = item.getRoot().listMeshes()[0].listPrimitives()[0]
  const rest = from.getAttribute('POSITION')!.getArray()!
  let low = Infinity
  let high = -Infinity
  for (let k = 1; k < rest.length; k += 3) [low, high] = [Math.min(low, rest[k]), Math.max(high, rest[k])]
  const at = [0.4, -0.3, 1.2]
  const positions = Float32Array.from(rest, (v, k) => v * 1.7 + at[k % 3])
  // v runs down the garment, so the top colour lies over its top half
  const uv = Float32Array.from({ length: (rest.length / 3) * 2 }, (_, k) => (k % 2 ? (high - rest[(k >> 1) * 3 + 1]) / (high - low || 1) : 0.5))
  // the size the garment job reads a texture at, so the tones meet on a hard edge (src/forge/garment.ts)
  const size = 256
  const pixels = Buffer.alloc(size * size * 3)
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  for (let p = 0; p < size * size; p++) pixels.set(rgb(p < (size * size) / 2 ? top : bottom), p * 3)
  const png = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()
  const doc = new Document()
  const buffer = doc.createBuffer()
  const texture = doc.createTexture('stand-in').setImage(new Uint8Array(png)).setMimeType('image/png')
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(from.getIndices()!.getArray()!)).setBuffer(buffer))
    .setMaterial(doc.createMaterial('garment').setBaseColorTexture(texture).setRoughnessFactor(0.8))
  doc.createScene('garment').addChild(doc.createNode(`stand-in-${slot}`).setMesh(doc.createMesh(`stand-in-${slot}`).addPrimitive(prim)))
  return new NodeIO().writeBinary(doc)
}
