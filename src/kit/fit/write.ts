import { Document, NodeIO, type TypedArray } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { readFileSync } from 'node:fs'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { surfaceItem, type ItemMeta, type SurfaceItem } from '../wear/item.js'

/**
 * Item files (see src/kit/wear/item.ts for the layout): written by the fit pipeline, read back by tests and tools.
 * The mesh is stored as it sits on the reference body, so any glTF viewer shows the item; the bindings ride along as
 * custom attributes and the metadata as the primitive's extras. Geometry is meshopt-compressed (lossless here: no
 * quantisation, since the bindings must come back exact).
 */

export interface ItemFile {
  meta: ItemMeta
  /** On the reference body. */
  positions: Float32Array
  normals: Float32Array
  item: SurfaceItem
  /** Encoded image (WebP) for an item with its own texture (a generated one). */
  texture?: Uint8Array
}

let io: Promise<NodeIO> | undefined
const nodeIO = () =>
  (io ??= Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]).then(() =>
    new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder }),
  ))

export async function writeItem(file: ItemFile): Promise<Uint8Array> {
  const { item, meta } = file
  const doc = new Document()
  const buffer = doc.createBuffer()
  const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3', array: Float32Array | Uint16Array | Uint32Array) => doc.createAccessor().setType(type).setArray(array.slice() as TypedArray).setBuffer(buffer)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', file.positions))
    .setAttribute('NORMAL', acc('VEC3', file.normals))
    .setAttribute('TEXCOORD_0', acc('VEC2', item.uv))
    .setAttribute('_TRI', acc('VEC3', Float32Array.from(item.binding.tri)))
    .setAttribute('_ST', acc('VEC2', item.binding.st))
    .setAttribute('_LIFT', acc('SCALAR', item.binding.lift))
    .setAttribute('_NLOCAL', acc('VEC3', item.normal))
    .setAttribute('_CHANNEL', acc('SCALAR', Float32Array.from(item.channel)))
    .setIndices(acc('SCALAR', item.count > 65535 ? Uint32Array.from(item.index) : Uint16Array.from(item.index)))
  if (item.len) prim.setAttribute('_LEN', acc('SCALAR', item.len))
  prim.setExtras(meta as unknown as Record<string, unknown>)
  // a plain material in the first channel's colour, so the file reads in any viewer
  const hex = parseInt(meta.channels[0].color.slice(1), 16)
  const srgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => Math.pow(c / 255, 2.2))
  const material = doc.createMaterial(meta.id).setBaseColorFactor([srgb[0], srgb[1], srgb[2], 1]).setRoughnessFactor(0.8).setMetallicFactor(0).setDoubleSided(true)
  if (file.texture) material.setBaseColorTexture(doc.createTexture('texture').setImage(file.texture).setMimeType('image/webp'))
  prim.setMaterial(material)
  const mesh = doc.createMesh(meta.id).addPrimitive(prim)
  doc.createScene().addChild(doc.createNode(meta.id).setMesh(mesh))
  // QUANTIZE without a quantize() pass leaves every accessor unfiltered: lossless
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  return (await nodeIO()).writeBinary(doc)
}

/** An item file read back: its metadata, its mesh on the reference body, and the item the game dresses with. */
export async function readItemFile(source: string | URL | Uint8Array, vertices: number): Promise<ItemFile> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(readFileSync(source))
  const doc = await (await nodeIO()).readBinary(bytes)
  const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0]
  if (!prim) throw new Error('item file has no mesh')
  const get = (semantic: string) => prim.getAttribute(semantic)?.getArray() ?? undefined
  const need = (semantic: string) => {
    const a = get(semantic)
    if (!a) throw new Error(`item file has no ${semantic}`)
    return a
  }
  const channel = get('_CHANNEL')
  const len = get('_LEN')
  const item = surfaceItem(
    {
      extras: prim.getExtras(),
      index: prim.getIndices()!.getArray()!,
      tri: need('_TRI'),
      st: need('_ST'),
      lift: need('_LIFT'),
      normal: need('_NLOCAL'),
      uv: need('TEXCOORD_0'),
      ...(channel ? { channel } : {}),
      ...(len ? { len } : {}),
    },
    vertices,
  )
  const texture = prim.getMaterial()?.getBaseColorTexture()?.getImage() ?? undefined
  return { meta: item.meta, positions: Float32Array.from(need('POSITION')), normals: Float32Array.from(need('NORMAL')), item, ...(texture ? { texture } : {}) }
}
