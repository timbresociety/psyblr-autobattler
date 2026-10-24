import { NodeIO, Primitive, type Document, type Texture } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { clearNodeTransform, dedup, flatten, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { WEAR_SLOTS, type WearSlot } from '../charter/look.js'
import { BUDGET, fitItem, type FitReport } from '../kit/fit/fit.js'
import { placeGenerated, type GeneratedMesh } from '../kit/fit/generated.js'
import type { Reference } from '../kit/fit/reference.js'
import { writeItem } from '../kit/fit/write.js'
import type { ItemMeta } from '../kit/wear/item.js'
import { countTriangles } from './arena-asset.js'

/**
 * A generated garment made into a wardrobe item (the wardrobe plan, step 9). What a 3D generator makes from a player's
 * words or picture is cut to its slot's triangle budget, then placed on the reference body and fitted like any
 * built-in item (src/kit/fit/), so one file fits all twelve bodies. Its texture ships at 1024 px WebP, and its colour
 * regions become its channels, so it recolours like a built-in. A garment that fails the fit's checks is refused, and
 * the job that made it charges nothing (src/server/pieces.ts).
 */

/** The slots a player can generate a garment for: everything worn over the body. Gear stays a piece. */
export const GARMENT_SLOTS = WEAR_SLOTS
export type GarmentSlot = WearSlot

/** What each slot's garment is, for the generator. */
const GARMENT: Record<GarmentSlot, string> = {
  head: 'headwear for an adult head',
  upper: 'a top for the torso and both arms',
  lower: 'a garment for the legs, from the waist down',
  full: 'a full-body outfit for the torso, both arms and both legs',
  back: 'something worn on the back',
  feet: 'a pair of shoes, side by side',
}

/**
 * The generator's prompt for a garment: the player's words, then what the fit needs to find it. The garment alone,
 * upright and facing front, with sleeves and legs where a body in an A-pose would hold them. The fit copes with a
 * mannequin, a T-pose and closed openings anyway; asking saves it work and triangles.
 */
export function garmentPrompt(slot: GarmentSlot, words: string): string {
  const pose = [slot === 'upper' || slot === 'full' ? 'sleeves angled down and out as on a body in an A-pose' : '', slot === 'lower' || slot === 'full' ? 'legs straight' : ''].filter(Boolean)
  return `${words}. ${GARMENT[slot]}, as a 3D garment on its own: no person, no mannequin, no stand or hanger. Upright and facing the front${pose.length ? `, ${pose.join(', ')}` : ''}, open where a body would pass through.`
}

/** Headwear rides the head whole (ItemMeta.hard) unless it's cloth that drapes. */
export function hardHeadwear(words: string): boolean {
  return !/\b(hoods?|hoodie|cowl|veil|scarf|bandana|turban|shawl|wrap)\b/i.test(words)
}

export const GARMENT_TEXTURE = 1024
/** The size the texture is read at for its colour regions. */
const SAMPLE = 256

export interface GarmentSpec {
  id: string
  name: string
  slot: GarmentSlot
  tags?: string[]
  hard?: boolean
}

export interface GarmentAsset {
  /** The item file (src/kit/wear/item.ts). */
  glb: Uint8Array
  meta: ItemMeta
  report: FitReport
}

const io = async () => {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
}

/** Every triangle of the model as one mesh, with its base colour texture when the whole model shares one. */
async function generatedMesh(doc: Document): Promise<GeneratedMesh> {
  const prims = doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .filter((p) => p.getMode() === Primitive.Mode.TRIANGLES && p.getAttribute('POSITION'))
  const positions: number[] = []
  const uv: number[] = []
  const index: number[] = []
  const el: number[] = []
  for (const p of prims) {
    const pos = p.getAttribute('POSITION')!
    const tex = p.getAttribute('TEXCOORD_0')
    const base = positions.length / 3
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el)
      positions.push(el[0], el[1], el[2])
      if (tex) {
        tex.getElement(i, el)
        uv.push(el[0], el[1])
      } else uv.push(0, 0)
    }
    const ind = p.getIndices()
    const count = ind ? ind.getCount() : pos.getCount()
    for (let k = 0; k < count; k++) index.push((ind ? ind.getScalar(k) : k) + base)
  }
  if (!index.length) throw new Error('the model has no triangles')
  const mesh: GeneratedMesh = { positions: Float32Array.from(positions), index: Uint32Array.from(index), uv: Float32Array.from(uv) }
  // one texture over the whole model, or none: UVs into different images can't share one item texture
  const textures = new Set<Texture | null>(prims.map((p) => p.getMaterial()?.getBaseColorTexture() ?? null))
  const [texture] = textures
  const image = textures.size === 1 && texture ? texture.getImage() : null
  if (image) {
    try {
      const { data, info } = await sharp(image).resize(SAMPLE, SAMPLE, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      mesh.pixels = { data, width: info.width, height: info.height }
      mesh.texture = new Uint8Array(await sharp(image).resize(GARMENT_TEXTURE, GARMENT_TEXTURE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer())
    } catch {
      // an image sharp can't read (a compressed GPU format): the garment ships in its channels' colours
    }
  }
  return mesh
}

/** The generator's model as a fitted wardrobe item, or an error saying why it can't be one. */
export async function garmentAsset(input: Uint8Array, spec: GarmentSpec, ref: Reference): Promise<GarmentAsset> {
  const reader = await io()
  const doc = await reader.readBinary(input)
  // one flat list of meshes in world space, so their vertices can be measured and moved together
  await doc.transform(flatten(), dedup(), prune())
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) clearNodeTransform(node)
  await doc.transform(weld())
  const budget = BUDGET[spec.slot]
  // cut to the budget before fitting: clipping (a mannequin, an inner wall) only takes more away
  for (const error of [0.01, 0.05]) {
    const n = countTriangles(doc)
    if (n <= budget) break
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget / n, error }))
  }
  const placed = placeGenerated(await generatedMesh(doc), spec, ref)
  const { file, report } = fitItem(placed.raw, ref)
  if (report.problems.length) throw new Error(`it doesn't fit: ${report.problems.join(', ')}`)
  return { glb: await writeItem(file), meta: file.meta, report }
}
