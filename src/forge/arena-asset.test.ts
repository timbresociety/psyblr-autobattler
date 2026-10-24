import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { ARENA_BUDGET, arenaAsset } from './arena-asset.js'

const png = async (side: number, rgb: [number, number, number]) =>
  new Uint8Array(await sharp({ create: { width: side, height: side, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer())

/** A grid mesh with `triangles` triangles and, optionally, colour, normal, roughness/metal and occlusion textures. */
async function fixture(triangles: number, textureSide?: number): Promise<Uint8Array> {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const quads = Math.ceil(triangles / 2)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let q = 0; q < quads; q++) {
    const x = q % 100
    const y = Math.floor(q / 100)
    const base = positions.length / 3
    positions.push(x, y, 0, x + 1, y, 0, x, y + 1, 0, x + 1, y + 1, 0)
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1)
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices.slice(0, triangles * 3))).setBuffer(buffer))
  const material = doc.createMaterial('body')
  if (textureSide) {
    const tex = async (name: string, rgb: [number, number, number]) => doc.createTexture(name).setImage(await png(textureSide, rgb)).setMimeType('image/png')
    material
      .setBaseColorTexture(await tex('color', [200, 120, 60]))
      .setNormalTexture(await tex('normal', [128, 128, 255]))
      .setMetallicRoughnessTexture(await tex('mr', [0, 180, 20]))
      .setOcclusionTexture(await tex('ao', [230, 0, 0]))
  }
  prim.setMaterial(material)
  doc.createScene().addChild(doc.createNode('hero').setMesh(doc.createMesh('hero').addPrimitive(prim)))
  return new NodeIO().writeBinary(doc)
}

const read = async (glb: Uint8Array) => {
  await MeshoptDecoder.ready
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(glb)
}

describe('arena hero asset (U2)', () => {
  it('passes an in-budget hero through, downscaling a 4K texture to 2K and 1K, and packs occlusion into one texture', async () => {
    const result = await arenaAsset(await fixture(7000, 4096), { textureFormat: 'webp' })
    if (!result.ok) throw new Error('expected ok')
    expect(result.report.triangles).toBe(7000)
    expect(result.report.focus.maxTexture).toBe(ARENA_BUDGET.focusTexture)
    expect(result.report.other.maxTexture).toBe(ARENA_BUDGET.otherTexture)
    const doc = await read(result.other)
    const material = doc.getRoot().listMaterials()[0]
    expect(material.getOcclusionTexture()).toBe(material.getMetallicRoughnessTexture())
    expect(doc.getRoot().listTextures().every((t) => t.getMimeType() === 'image/webp')).toBe(true)
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain('EXT_meshopt_compression')
  }, 120_000)

  it('reports a hero over 8,000 triangles instead of accepting it', async () => {
    expect(await arenaAsset(await fixture(9000))).toEqual({ ok: false, reason: 'over-budget', triangles: 9000 })
  })

  it('still produces a valid arena hero with a flat material when there are no textures', async () => {
    const result = await arenaAsset(await fixture(500))
    if (!result.ok) throw new Error('expected ok')
    const doc = await read(result.focus)
    expect(doc.getRoot().listMaterials()).toHaveLength(1)
    expect(doc.getRoot().listTextures()).toHaveLength(0)
  })

  it('encodes every texture to KTX2 by default', async () => {
    const result = await arenaAsset(await fixture(500, 256))
    if (!result.ok) throw new Error('expected ok')
    const doc = await read(result.focus)
    expect(doc.getRoot().listTextures().length).toBe(3)
    expect(doc.getRoot().listTextures().every((t) => t.getMimeType() === 'image/ktx2')).toBe(true)
  }, 120_000)
})
