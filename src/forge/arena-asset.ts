import { NodeIO, type Document, type Texture } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { cloneDocument, meshopt, textureCompress, weld } from '@gltf-transform/functions'
import { ktx2 } from 'ktx2-encoder/gltf-transform'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

/**
 * The arena hero (R24, R35, KTD10): turn a rigged hero GLB into the two arena versions the game loads, a 2K one for
 * the heroes in focus and a 1K one for the rest. Geometry is welded and meshopt-compressed; ambient occlusion is packed
 * into the roughness/metal texture; textures become KTX2 through a WebAssembly Basis encoder, so it runs inside a
 * Vercel function with no native tools. `textureFormat: 'webp'` is the fallback when KTX2 does not fit the function.
 */

export const ARENA_BUDGET = { maxTriangles: 8000, focusTexture: 2048, otherTexture: 1024 } as const

export type ArenaTextureFormat = 'ktx2' | 'webp'

export interface ArenaAssetReport {
  triangles: number
  textureFormat: ArenaTextureFormat
  /** Largest texture side and byte size of each output. */
  focus: { maxTexture: number; bytes: number }
  other: { maxTexture: number; bytes: number }
}

export type ArenaAssetResult = { ok: true; focus: Uint8Array; other: Uint8Array; report: ArenaAssetReport } | { ok: false; reason: 'over-budget'; triangles: number }

const io = async () => {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
}

export function countTriangles(doc: Document): number {
  let total = 0
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue
      const indices = prim.getIndices()
      total += (indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0)) / 3
    }
  return total
}

const decode = async (buffer: Uint8Array) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

/** glTF reads occlusion from red and roughness/metal from green/blue, so one texture can serve both slots. */
async function packOcclusion(doc: Document) {
  for (const material of doc.getRoot().listMaterials()) {
    const ao = material.getOcclusionTexture()
    const mr = material.getMetallicRoughnessTexture()
    if (!ao || !mr || ao === mr) continue
    const mrImage = sharp(mr.getImage()!)
    const { width, height } = await mrImage.metadata()
    const aoRed = await sharp(ao.getImage()!).resize(width, height).extractChannel(0).raw().toBuffer()
    const [, g, b] = await Promise.all(([0, 1, 2] as const).map((c) => mrImage.clone().extractChannel(c).raw().toBuffer()))
    const packed = await sharp(aoRed, { raw: { width: width!, height: height!, channels: 1 } })
      .joinChannel([g, b], { raw: { width: width!, height: height!, channels: 1 } })
      .png()
      .toBuffer()
    const orm: Texture = doc.createTexture(`${mr.getName() || 'orm'}-orm`).setImage(new Uint8Array(packed)).setMimeType('image/png')
    material.setMetallicRoughnessTexture(orm).setOcclusionTexture(orm)
  }
  for (const texture of doc.getRoot().listTextures()) if (!texture.listParents().some((p) => p.propertyType !== 'Root')) texture.dispose()
}

async function maxTexture(doc: Document): Promise<number> {
  let max = 0
  for (const t of doc.getRoot().listTextures()) {
    const size = t.getSize()
    if (size) max = Math.max(max, size[0], size[1])
  }
  return max
}

async function variant(base: Document, side: number, format: ArenaTextureFormat): Promise<Uint8Array> {
  const doc = cloneDocument(base)
  await doc.transform(textureCompress({ encoder: sharp, resize: [side, side], ...(format === 'webp' ? { targetFormat: 'webp' as const } : {}) }))
  if (format === 'ktx2') {
    // normal maps keep detail in UASTC; colour and the packed occlusion/roughness/metal use the smaller ETC1S
    await doc.transform(ktx2({ slots: /normalTexture/, isUASTC: true, isNormalMap: true, generateMipmap: true, imageDecoder: decode }))
    await doc.transform(ktx2({ slots: /^(?!normalTexture).*/, isUASTC: false, generateMipmap: true, imageDecoder: decode }))
    const failed = doc.getRoot().listTextures().filter((t) => t.getMimeType() !== 'image/ktx2')
    if (failed.length) throw new Error(`KTX2 encoding failed for ${failed.length} texture(s)`)
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  return (await io()).writeBinary(doc)
}

export async function arenaAsset(glb: Uint8Array, options: { textureFormat?: ArenaTextureFormat } = {}): Promise<ArenaAssetResult> {
  const format = options.textureFormat ?? 'ktx2'
  const doc = await (await io()).readBinary(glb)
  await doc.transform(weld())
  const triangles = countTriangles(doc)
  if (triangles > ARENA_BUDGET.maxTriangles) return { ok: false, reason: 'over-budget', triangles }
  await packOcclusion(doc)
  const focus = await variant(doc, ARENA_BUDGET.focusTexture, format)
  const other = await variant(doc, ARENA_BUDGET.otherTexture, format)
  const sizes = async (bytes: Uint8Array) => {
    // KTX2 images report no size to gltf-transform, so measure on the pre-encode resize
    if (format === 'ktx2') return Math.min(await maxTexture(doc), bytes === focus ? ARENA_BUDGET.focusTexture : ARENA_BUDGET.otherTexture)
    return maxTexture(await (await io()).readBinary(bytes))
  }
  return {
    ok: true,
    focus,
    other,
    report: { triangles, textureFormat: format, focus: { maxTexture: await sizes(focus), bytes: focus.byteLength }, other: { maxTexture: await sizes(other), bytes: other.byteLength } },
  }
}
