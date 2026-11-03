import { NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { boxesModel, placeholderPiece } from './providers/fakes/piece-model.js'
import { PIECE_SIZE, pieceAsset } from './piece-asset.js'

async function measure(glb: Uint8Array) {
  const doc = await new NodeIO().readBinary(glb)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const v: number[] = []
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v)
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], v[a])
          max[a] = Math.max(max[a], v[a])
        }
      }
    }
  return { min, max, size: max.map((m, a) => m - min[a]) }
}

const close = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps

describe('a generated model made into a piece', () => {
  it('stands a weapon lying on its side up along the thumb, handle down in the palm', async () => {
    // an axe lying along x: a thin handle toward -x and a wide head at +x
    const axe = await boxesModel([[-0.4, -0.015, -0.015, 0.3, 0.015, 0.015], [0.2, -0.12, -0.01, 0.35, 0.12, 0.01]], [0.6, 0.6, 0.6])
    const { glb, triangles } = await pieceAsset(axe, 'hand')
    const m = await measure(glb)
    expect(close(m.size[1], PIECE_SIZE.hand)).toBe(true)
    expect(m.size[1]).toBeGreaterThan(m.size[0])
    // the wide head ends up at the top, and the grip sits 15% up from the handle's end
    expect(close(m.min[1], -0.15 * PIECE_SIZE.hand)).toBe(true)
    expect(m.max[1]).toBeGreaterThan(0.7)
    // its wide side runs along z, its thin side along x
    expect(m.size[2]).toBeGreaterThan(m.size[0])
    expect(triangles).toBeLessThanOrEqual(5000)
  })

  it('holds a shield at its middle with its face out from the left hand', async () => {
    const m = await measure((await pieceAsset(await placeholderPiece('offhand'), 'offhand')).glb)
    expect(m.size[0]).toBeLessThan(m.size[1])
    expect(close((m.min[0] + m.max[0]) / 2, 0.07)).toBe(true)
    expect(close((m.min[1] + m.max[1]) / 2, 0)).toBe(true)
  })
})
