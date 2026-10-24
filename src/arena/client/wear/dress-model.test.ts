import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { DressedItem } from '../../../kit/wear/dress.js'
import { clothGeometry } from './dress-model.js'

/** A dressed item of `triangles` separate triangles, every vertex in one colour. */
function part(id: string, triangles: number, color: [number, number, number]): DressedItem {
  const count = triangles * 3
  return {
    id,
    slot: 'upper',
    count,
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    uv: new Float32Array(count * 2),
    joints: new Uint16Array(count * 4),
    weights: new Float32Array(count * 4),
    color: Float32Array.from({ length: count * 3 }, (_, k) => color[k % 3]),
    finish: new Float32Array(count * 4),
    weave: new Float32Array(count),
    index: Uint32Array.from({ length: count }, (_, k) => k),
  }
}

const print = (count: number, base: [number, number, number]) => ({ texture: new THREE.Texture(), base: Float32Array.from({ length: count * 3 }, (_, k) => base[k % 3]) })

describe("an outfit's one geometry", () => {
  it('is one draw while nothing has its own texture', () => {
    const geo = clothGeometry([part('tee', 2, [1, 0, 0]), part('jeans', 3, [0, 0, 1])])!
    expect(geo.groups).toEqual([])
    expect(geo.getAttribute('_base')).toBeUndefined()
  })

  it('draws the plain items together, then each textured item in a group of its own', () => {
    const kimono = part('kimono', 4, [0.2, 0.2, 0.6])
    const cloak = part('cloak', 1, [0.1, 0.1, 0.1])
    const prints = new Map([
      ['kimono', print(kimono.count, [0.5, 0.1, 0.1])],
      ['cloak', print(cloak.count, [0.1, 0.1, 0.1])],
    ])
    const geo = clothGeometry([part('tee', 2, [1, 0, 0]), part('geta', 1, [0, 1, 0]), kimono, cloak], prints)!
    expect(geo.groups).toEqual([
      { start: 0, count: 9, materialIndex: 0 },
      { start: 9, count: 12, materialIndex: 1 },
      { start: 21, count: 3, materialIndex: 2 },
    ])
    // a textured item's vertices carry its channels' own colours; the plain ones just their own
    const base = geo.getAttribute('_base')
    expect([base.getX(0), base.getY(0), base.getZ(0)]).toEqual([1, 0, 0])
    expect([base.getX(9), base.getY(9), base.getZ(9)].map((v) => +v.toFixed(3))).toEqual([0.5, 0.1, 0.1])
  })

  it('gives a lone textured item its own material, after the unused plain one', () => {
    const kimono = part('kimono', 2, [0.2, 0.2, 0.6])
    const geo = clothGeometry([kimono], new Map([['kimono', print(kimono.count, [0.2, 0.2, 0.6])]]))!
    expect(geo.groups).toEqual([{ start: 0, count: 6, materialIndex: 1 }])
  })
})
