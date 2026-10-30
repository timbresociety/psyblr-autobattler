import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { DressedItem } from '../../../kit/wear/dress.js'
import { CARD_U } from '../../../kit/wear/item.js'
import { clothGeometry, withCards } from './dress-model.js'

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

  it("takes a print's channel out of its item's draw into one of its own, after the textured ones", () => {
    // the kimono's first two triangles are its body (channel 0), the last its obi (channel 1), which wears the print
    const kimono = part('kimono', 3, [0.2, 0.2, 0.6])
    const cloak = part('cloak', 1, [0.1, 0.1, 0.1])
    const channels = Uint8Array.from({ length: kimono.count }, (_, k) => (k < 6 ? 0 : 1))
    const pattern = { channels, channel: 1, print: { map: new THREE.Texture(), repeat: 4 } }
    const geo = clothGeometry([part('tee', 1, [1, 0, 0]), kimono, cloak], new Map([['cloak', print(cloak.count, [0.1, 0.1, 0.1])]]), new Map([['kimono', pattern]]))!
    expect(geo.groups).toEqual([
      { start: 0, count: 9, materialIndex: 0 },
      { start: 9, count: 3, materialIndex: 1 },
      { start: 12, count: 3, materialIndex: 2 },
    ])
    // the print's draw is the obi: the kimono's last three vertices, after the tee's three
    expect(Array.from(geo.getIndex()!.array.slice(12))).toEqual([3 + 6, 3 + 7, 3 + 8])
  })
})

describe('hair cards', () => {
  /** Hair: a shell triangle at its edge (weave 5), one inside it, then two card triangles (u past CARD_U). */
  function hair(): DressedItem {
    const h: DressedItem = { ...part('hair_swept', 4, [0.8, 0.8, 0.8]), slot: 'hair' }
    for (let v = 6; v < 12; v++) h.uv[v * 2] = 7.5
    h.weave.set([5, 5, 5, 5.99, 5.99, 5.99, 5.99, 5.99, 5.99, 5.99, 5.99, 5.99])
    h.positions.forEach((_, k) => (h.positions[k] = k))
    return h
  }

  it('are left off with their vertices where the shell alone is drawn', () => {
    const [shell] = withCards([hair()], false)
    expect(shell.count).toBe(6)
    expect(Array.from(shell.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(Array.from(shell.positions)).toEqual(Array.from({ length: 18 }, (_, k) => k))
    expect(Array.from(shell.uv).filter((_, k) => k % 2 === 0).every((u) => u < CARD_U)).toBe(true)
  })

  it('stay in a close look, the shell under them darkened but for its edge', () => {
    const [kept] = withCards([hair()], true)
    expect(kept.index.length).toBe(12)
    expect(kept.color[0]).toBeCloseTo(0.8)
    expect(kept.color[3 * 3]).toBeCloseTo(0.36)
    expect(kept.color[6 * 3]).toBeCloseTo(0.8)
  })

  it("move the shell's fringe on past 6, where the strands shader cuts its edge back clean, and leave the cards'", () => {
    const [kept] = withCards([hair()], true)
    expect(kept.weave[0]).toBeCloseTo(6)
    expect(kept.weave[3]).toBeCloseTo(6.99)
    expect(kept.weave[6]).toBeCloseTo(5.99)
  })

  it('leave an item without them as it was', () => {
    const tee = part('tee', 2, [1, 0, 0])
    expect(withCards([tee], false)[0]).toBe(tee)
    expect(withCards([tee], true)[0]).toBe(tee)
  })
})
