import { NodeIO } from '@gltf-transform/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { WEAR_SLOTS } from '../charter/look.js'
import { BUDGET } from '../kit/fit/fit.js'
import { readReference, type Reference } from '../kit/fit/reference.js'
import { readItemFile } from '../kit/fit/write.js'
import { garmentAsset, garmentPrompt, hardHeadwear } from './garment.js'
import { placeholderGarment, placeholderPiece } from './providers/fakes/piece-model.js'

/**
 * A generated garment becomes a wardrobe item through the same fit as a built-in one. The fake provider's stand-ins
 * are built-in items as a generator would hand them back (their own scale and place, one textured material), so these
 * run the whole road offline: cut to budget, placed, fitted, its texture's colours made into channels.
 */

const pub = (path: string) => new URL(`../../public${path}`, import.meta.url)
const TONES: [string, string] = ['#3b2f6b', '#6b5a2f']
let ref: Reference

beforeAll(async () => {
  ref = await readReference(pub('/heroes/m-medium.glb'), pub('/heroes/m-medium.kit.json'))
})

/** Every triangle of a model split in four, at its edges' midpoints: the same garment, four times the triangles. */
async function subdivided(glb: Uint8Array): Promise<Uint8Array> {
  const io = new NodeIO()
  const doc = await io.readBinary(glb)
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
  const position = prim.getAttribute('POSITION')!
  const uv = prim.getAttribute('TEXCOORD_0')!
  const P = Array.from(position.getArray()!)
  const T = Array.from(uv.getArray()!)
  const index = Array.from(prim.getIndices()!.getArray()!)
  const middles = new Map<string, number>()
  const middle = (a: number, b: number) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    let m = middles.get(key)
    if (m === undefined) {
      m = P.length / 3
      for (let d = 0; d < 3; d++) P.push((P[a * 3 + d] + P[b * 3 + d]) / 2)
      for (let d = 0; d < 2; d++) T.push((T[a * 2 + d] + T[b * 2 + d]) / 2)
      middles.set(key, m)
    }
    return m
  }
  const split: number[] = []
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = index.slice(t, t + 3)
    const [ab, bc, ca] = [middle(a, b), middle(b, c), middle(c, a)]
    split.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
  }
  position.setArray(Float32Array.from(P))
  uv.setArray(Float32Array.from(T))
  prim.getIndices()!.setArray(Uint32Array.from(split))
  return io.writeBinary(doc)
}

describe('a garment prompt', () => {
  it('asks for the garment alone, upright, posed for its slot and open where a body goes', () => {
    const kimono = garmentPrompt('full', 'a navy kimono with a gold obi')
    expect(kimono.startsWith('a navy kimono with a gold obi. a full-body outfit')).toBe(true)
    expect(kimono).toMatch(/no person, no mannequin/)
    expect(kimono).toMatch(/A-pose.*legs straight/)
    expect(kimono).toMatch(/open where a body would pass through/)
    expect(garmentPrompt('feet', 'geta')).not.toMatch(/A-pose|legs straight/)
  })

  it('lets cloth headwear drape and keeps the rest of it hard', () => {
    expect(hardHeadwear('a wide straw kasa')).toBe(true)
    expect(hardHeadwear('a red hood')).toBe(false)
    expect(hardHeadwear('a silk turban')).toBe(false)
  })
})

describe('making a generated model into a wardrobe item', () => {
  it.each(WEAR_SLOTS)('fits the %s stand-in in its budget, with its two tones as channels', async (slot) => {
    const garment = await garmentAsset(await placeholderGarment(slot, TONES), { id: `gen-${slot}`, name: slot, slot, hard: slot === 'head' }, ref)
    expect(garment.meta).toMatchObject({ id: `gen-${slot}`, slot, mode: 'surface', ...(slot === 'head' ? { hard: true } : {}) })
    expect(garment.report.problems).toEqual([])
    expect(garment.report.triangles).toBeLessThanOrEqual(BUDGET[slot])
    expect(garment.meta.channels.map((c) => c.color).sort()).toEqual([...TONES].sort())
    // the file reads back as an item, its texture inside
    const file = await readItemFile(garment.glb, ref.shape.surface.count)
    expect(file.meta.id).toBe(`gen-${slot}`)
    expect(file.texture?.length).toBeGreaterThan(0)
  })

  it('cuts a model over its budget down to it before fitting', async () => {
    const dense = await subdivided(await placeholderGarment('full', TONES))
    const garment = await garmentAsset(dense, { id: 'gen-dense', name: 'dense', slot: 'full' }, ref)
    expect(garment.report.problems).toEqual([])
    expect(garment.report.triangles).toBeLessThanOrEqual(BUDGET.full)
  })

  it("refuses a model that isn't a garment for its slot", async () => {
    await expect(garmentAsset(await placeholderPiece('offhand'), { id: 'gen-disc', name: 'disc', slot: 'upper' }, ref)).rejects.toThrow(/doesn't fit: covers \d+% of the torso/)
  })
})
