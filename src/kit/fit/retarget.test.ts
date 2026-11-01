import { beforeAll, describe, expect, it } from 'vitest'
import { TriangleBVH } from '../wear/ray.js'
import { fitItem, type RawItem } from './fit.js'
import { readReference, type Reference } from './reference.js'
import { refineRaw } from './refine-raw.js'
import { retargetRaw } from './retarget.js'

const pub = (path: string) => new URL(`../../../public${path}`, import.meta.url)
let legacy: Reference
let v2: Reference
beforeAll(async () => {
  legacy = await readReference(pub('/heroes/m-medium.glb'), pub('/heroes/m-medium.kit.json'))
  v2 = await readReference(pub('/heroes/v2/m-medium.glb'), pub('/heroes/v2/m-medium.kit.json'))
}, 60000)

/** A coarse tube round the left thigh on a body: eight sides, five rings, standing `lift` off the skin at each vertex. */
function tube(ref: Reference, lift: number): RawItem {
  const thigh = ref.rest[ref.bones.includes('Hips') ? 'LeftUpLeg' : 'thigh_L']
  const knee = ref.rest[ref.bones.includes('Hips') ? 'LeftLeg' : 'shin_L']
  const sides = 8
  const rings = 5
  const positions: number[] = []
  const index: number[] = []
  for (let r = 0; r < rings; r++) {
    const t = 0.15 + (0.7 * r) / (rings - 1)
    const cy = thigh[1] + (knee[1] - thigh[1]) * t
    const cx = thigh[0] + (knee[0] - thigh[0]) * t
    const cz = thigh[2] + (knee[2] - thigh[2]) * t
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2
      const dx = Math.cos(a)
      const dz = Math.sin(a)
      // out from the thigh's axis to the skin, then the lift
      const hit = ref.bvh.first([cx, cy, cz], [dx, 0, dz], 0, 0.3)
      const d = (hit?.t ?? 0.08) + lift
      positions.push(cx + dx * d, cy, cz + dz * d)
    }
  }
  for (let r = 0; r + 1 < rings; r++)
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s
      const b = r * sides + ((s + 1) % sides)
      const c = a + sides
      const d = b + sides
      index.push(a, c, b, b, c, d)
    }
  return { spec: { id: 'tube', name: 'Tube', slot: 'lower', channels: [{ name: 'cloth', color: '#333333', finish: 'cotton' }] }, positions: Float32Array.from(positions), index: Uint32Array.from(index) }
}

/** Skin vertices of the left thigh with no garment in front of them along their normal. */
function bare(ref: Reference, raw: RawItem): number {
  const bvh = new TriangleBVH(raw.positions, raw.index)
  const S = ref.shape.positions
  const N = ref.shape.normals
  const thigh = ref.rest[ref.bones.includes('Hips') ? 'LeftUpLeg' : 'thigh_L']
  const knee = ref.rest[ref.bones.includes('Hips') ? 'LeftLeg' : 'shin_L']
  let count = 0
  for (let v = 0; v < S.length / 3; v++) {
    if (!ref.shape.skin[v]) continue
    const y = S[v * 3 + 1]
    if (y > thigh[1] - 0.2 || y < knee[1] + 0.15 || S[v * 3] < 0.03) continue
    const n: [number, number, number] = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]]
    if (!bvh.first([S[v * 3] - n[0] * 0.003, y - n[1] * 0.003, S[v * 3 + 2] - n[2] * 0.003], n, 0, 0.3)) count++
  }
  return count
}

describe('carrying an item from the first body onto the Psyblr Human', () => {
  it('keeps every vertex at its lift over the new skin, and refined, the cloth follows the rounder thigh', () => {
    const coarse = tube(legacy, 0.008)
    // on the body it was made on, the tube covers the thigh (a vertex or so at a ring's edge aside)
    const made = bare(legacy, coarse)
    expect(made).toBeLessThanOrEqual(2)
    const carried = retargetRaw(coarse, legacy, v2)
    // a chord of eight sides cuts through the fuller thigh between its corners
    const before = bare(v2, carried)
    expect(before).toBeGreaterThan(made + 2)
    const refined = refineRaw(carried, v2)
    expect(refined.index.length).toBeGreaterThan(carried.index.length)
    expect(bare(v2, refined)).toBeLessThanOrEqual(made)
    // and it fits: nothing sunk, the thighs covered
    const { report } = fitItem(refined, v2)
    expect(report.problems.filter((p) => /under the skin/.test(p))).toEqual([])
  }, 120000)

  it('leaves hair alone and stops at the slot budget', () => {
    const hair = { ...tube(v2, 0.01), spec: { id: 'h', name: 'H', slot: 'hair' as const, channels: [{ name: 'hair', color: '#222222', finish: 'silk' as const }] } }
    expect(refineRaw(hair, v2)).toBe(hair)
    const twice = refineRaw(tube(v2, 0.01), v2, 0.001, 9)
    expect(twice.index.length / 3).toBeLessThanOrEqual(3000)
  }, 120000)
})
