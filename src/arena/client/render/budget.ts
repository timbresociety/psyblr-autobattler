import type * as THREE from 'three'

/** GAME.md §10's frame budgets on the MacBook Air M1. Draws and triangles count every pass: the shadows' too. */
export const BUDGET = { triangles: 1_500_000, drawCalls: 300, textureMb: 512 } as const

export interface BudgetSample {
  triangles: number
  drawCalls: number
  textureMb: number
}

/** What a frame spends over the budget, one line each; empty when it is within all of them. */
export function overBudget(s: BudgetSample): string[] {
  const out: string[] = []
  if (s.triangles > BUDGET.triangles) out.push(`${(s.triangles / 1e6).toFixed(2)} M triangles, over ${BUDGET.triangles / 1e6} M`)
  if (s.drawCalls > BUDGET.drawCalls) out.push(`${s.drawCalls} draw calls, over ${BUDGET.drawCalls}`)
  if (s.textureMb > BUDGET.textureMb) out.push(`${Math.round(s.textureMb)} MB of textures, over ${BUDGET.textureMb} MB`)
  return out
}

/** Bytes a texel takes on the GPU, by three's type and format constants; four 8-bit channels unless told otherwise. */
function texelBytes(t: THREE.Texture): number {
  const channels = t.format === 1028 /* RedFormat */ ? 1 : t.format === 1030 /* RGFormat */ ? 2 : 4
  const size = t.type === 1015 /* FloatType */ ? 4 : t.type === 1016 /* HalfFloatType */ ? 2 : 1
  return channels * size
}

/** One texture's GPU bytes: its compressed mip data as stored, else its texels with a third more for mipmaps. */
export function bytesOf(t: THREE.Texture): number {
  const compressed = t as THREE.CompressedTexture
  if (compressed.isCompressedTexture && compressed.mipmaps?.length) return compressed.mipmaps.reduce((n, m) => n + ((m as { data?: ArrayBufferView }).data?.byteLength ?? 0), 0)
  const image = t.image as { width?: number; height?: number; depth?: number } | undefined
  if (!image?.width || !image.height) return 0
  const layers = (t as THREE.Data3DTexture).isData3DTexture || (t as THREE.DataArrayTexture).isDataArrayTexture ? (image.depth ?? 1) : (t as THREE.CubeTexture).isCubeTexture ? 6 : 1
  const mips = t.generateMipmaps && t.minFilter !== 1003 && t.minFilter !== 1006 ? 4 / 3 : 1
  return image.width * image.height * layers * texelBytes(t) * mips
}

/**
 * An estimate of the GPU memory held by every texture the scene's materials, background and environment use, in MB.
 * Each texture counts once however many materials share it; render targets are not counted.
 */
export function textureMb(scene: THREE.Scene): number {
  const seen = new Set<THREE.Texture>()
  const take = (v: unknown) => {
    if (v && (v as THREE.Texture).isTexture) seen.add(v as THREE.Texture)
  }
  take(scene.background)
  take(scene.environment)
  scene.traverse((o) => {
    const material = (o as THREE.Mesh).material
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) for (const v of Object.values(m)) take(v)
  })
  let bytes = 0
  for (const t of seen) bytes += bytesOf(t)
  return bytes / 2 ** 20
}
