import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { reorder, weld } from '@gltf-transform/functions'
import { encodeToKTX2 } from 'ktx2-encoder'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

/**
 * Pack the House that tools/blender/house.py baked into what the game loads (docs/ENGINE.md, step 4): geometry welded
 * and meshopt-compressed (as floats), the lightmap as KTX2 (UASTC, so its soft gradients don't block up, zstd-supercompressed, with
 * mipmaps for the far floor).
 *
 *     npx tsx tools/blender/house-pack.ts [build dir] [public dir]
 */
const from = process.argv[2] ?? join(import.meta.dirname, 'build')
const to = process.argv[3] ?? join(import.meta.dirname, '..', '..', 'public', 'maps', 'house')
mkdirSync(to, { recursive: true })

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
const raw = readFileSync(join(from, 'house.glb'))
const doc = await io.readBinary(raw)
await doc.transform(weld())
// compressed but not quantized: three-component 16-bit positions and normals are no vertex format WebGPU has, and
// float lightmap UVs keep the light exactly where it was baked
await doc.transform(reorder({ encoder: MeshoptEncoder }))
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
const glb = await io.writeBinary(doc)
writeFileSync(join(to, 'house.glb'), glb)

const png = readFileSync(join(from, 'lightmap.png'))
const decode = async (buffer: Uint8Array) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}
const ktx2 = await encodeToKTX2(new Uint8Array(png), { isUASTC: true, needSupercompression: true, generateMipmap: true, isPerceptual: true, enableRDO: true, rdoQualityLevel: 1, imageDecoder: decode })
writeFileSync(join(to, 'lightmap.ktx2'), ktx2)
const kb = (n: number) => `${Math.round(n / 1024)} KB`
console.log(`house.glb ${kb(raw.length)} -> ${kb(glb.length)}; lightmap ${kb(png.length)} png -> ${kb(ktx2.length)} ktx2`)
