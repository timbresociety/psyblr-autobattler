import { beforeAll, describe, expect, it } from 'vitest'
import { bindPoints, evaluate } from '../wear/bind.js'
import { chainsOf, PARTICLES } from './chains.js'
import { BUDGET, fitItem, unburied, type RawItem } from './fit.js'
import { TriangleBVH } from '../wear/ray.js'
import { leanOn, readReference, type Reference } from './reference.js'
import { shellItem } from './shell.js'
import { weldPositions } from '../wear/weld.js'
import { readItemFile, writeItem } from './write.js'

const pub = (path: string) => new URL(`../../../public${path}`, import.meta.url)
let ref: Reference

beforeAll(async () => {
  ref = await readReference(pub('/heroes/m-medium.glb'), pub('/heroes/m-medium.kit.json'))
})

const spec = (id: string, slot: RawItem['spec']['slot']): RawItem['spec'] => ({ id, name: id, slot, channels: [{ name: 'cloth', color: '#334455', finish: 'cotton' }] })

/** A skin-tight shell over the welded vertices `select` picks, `lift` metres out. */
function shell(id: string, slot: RawItem['spec']['slot'], select: (v: number) => boolean, lift: number): RawItem {
  const s = shellItem(ref.shape, { id, slot, select, lift })
  return { spec: spec(id, slot), positions: s.positions, index: s.index, uv: s.uv }
}

/** Items joined into one, as an item's parts are. */
function joined(id: string, ...parts: RawItem[]): RawItem {
  const positions: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (const p of parts) {
    const base = positions.length / 3
    positions.push(...p.positions)
    uv.push(...(p.uv ?? new Float32Array((p.positions.length / 3) * 2)))
    index.push(...Array.from(p.index, (v) => v + base))
  }
  return { spec: spec(id, parts[0].spec.slot), positions: Float32Array.from(positions), uv: Float32Array.from(uv), index: Uint32Array.from(index) }
}

/** A skirt round the hips: rings from the waist down, the top ring riding the body and the rest hanging. */
function skirt(rings = 8, segs = 24, radius = 0.22, drop = 0.5): RawItem {
  const hips = ref.rest.hips
  const positions: number[] = []
  const hang: number[] = []
  const index: number[] = []
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < segs; k++) {
      const a = (2 * Math.PI * k) / segs
      positions.push(hips[0] + Math.sin(a) * (radius + 0.03 * (r / rings)), hips[1] + 0.05 - (drop * r) / (rings - 1), hips[2] + Math.cos(a) * (radius + 0.03 * (r / rings)))
      hang.push(r / (rings - 1))
    }
  }
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < segs; k++) {
      const a = r * segs + k
      const b = r * segs + ((k + 1) % segs)
      index.push(a, b, b + segs, a, b + segs, a + segs)
    }
  }
  return { spec: spec('skirt', 'lower'), positions: Float32Array.from(positions), index: Uint32Array.from(index), hang: Float32Array.from(hang) }
}

describe('ray casting', () => {
  it('finds every crossing along a ray, nearest first, and knows inside from out', () => {
    // two unit squares facing each other at z = 1 and z = 2, and a unit cube
    const quad = (z: number) => [0, 0, z, 1, 0, z, 1, 1, z, 0, 1, z]
    const positions = Float32Array.from([...quad(1), ...quad(2)])
    const bvh = new TriangleBVH(positions, Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]))
    const hits = bvh.hits([0.3, 0.4, 0], [0, 0, 1], 0, 10)
    expect(hits.map((h) => h.t)).toEqual([1, 2].map((t) => expect.closeTo(t, 6)))
    expect(bvh.first([0.3, 0.4, 0], [0, 0, 1], 0, 10)?.t).toBeCloseTo(1, 6)
    expect(bvh.first([0.3, 0.4, 3], [0, 0, 1], 0, 10)).toBeUndefined()
    const c = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]
    const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]
    const cube = new TriangleBVH(Float32Array.from(c), Uint32Array.from(faces))
    expect(cube.inside([0.5, 0.5, 0.5])).toBe(true)
    expect(cube.inside([1.5, 0.5, 0.5])).toBe(false)
  })

  it('welds a mesh split along its seams', () => {
    const { id, count } = weldPositions([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1e-7])
    expect(count).toBe(2)
    expect(Array.from(id)).toEqual([0, 1, 0, 1])
  })
})

describe('fitting', () => {
  it("binds points well clear of the skin exactly: a gown's hem, a shoe's toe", () => {
    const { positions: P, normals: N } = ref.shape
    const legs = Array.from({ length: ref.shape.surface.count }, (_, v) => v).filter((v) => ref.shape.skin[v] && leanOn(ref, v, ['foot_L', 'shin_R', 'thigh_L']) >= 0.9)
    const points: number[] = []
    for (const v of legs.filter((_, i) => i % 9 === 0)) for (const off of [0.05, 0.15, 0.3]) for (let d = 0; d < 3; d++) points.push(P[v * 3 + d] + N[v * 3 + d] * off)
    expect(points.length).toBeGreaterThan(60)
    const back = evaluate(bindPoints(Float32Array.from(points), ref.skin, ref.grid, 0.8), ref.skin)
    let worst = 0
    for (let i = 0; i < points.length; i++) worst = Math.max(worst, Math.abs(back[i] - points[i]))
    expect(worst).toBeLessThan(1e-4)
  })

  it('binds a shell grown off the torso, covers the torso at its lift, and hides it', () => {
    const torso = (v: number) => ref.shape.skin[v] === 1 && leanOn(ref, v, ['spine', 'chest', 'upper_chest']) >= 0.5
    const { file, report } = fitItem(shell('vest', 'upper', torso, 0.008), ref)
    expect(report.problems).toEqual([])
    expect(report.bindError).toBeLessThan(1e-3)
    expect(report.underSkin).toBe(0)
    const covered = new Set(file.meta.covers)
    let selected = 0
    let found = 0
    for (let v = 0; v < ref.shape.surface.count; v++) {
      if (!torso(v)) continue
      selected++
      if (covered.has(v)) found++
    }
    // all but the ring along the shell's own open edge
    expect(found / selected).toBeGreaterThan(0.85)
    // the shell lies 8 mm out where it covers (tenths of a millimetre), and a tight shell hides what it covers, all
    // but where a ray grazes its open edge
    const inner = file.meta.shell.filter((_, i) => i % 2 === 0).sort((a, b) => a - b)
    expect(inner[inner.length >> 1]).toBeGreaterThan(70)
    expect(inner[inner.length >> 1]).toBeLessThan(90)
    expect((file.meta.hidden ?? file.meta.covers).length).toBeGreaterThan(file.meta.covers.length * 0.97)
    // and nothing it covers lies across a gap: an arm doesn't take cover from the vest on the torso
    const P = ref.shape.positions
    expect(file.meta.covers.filter((v) => Math.abs(P[v * 3]) > 0.25 && P[v * 3 + 1] < 1.3)).toEqual([])
  })

  it('turns hanging cloth into chains within the slot budget, and hides only where the cloth lies close', () => {
    const raw = skirt()
    const chains = chainsOf(raw.positions, raw.index, raw.hang!, 'lower', ref)!
    expect(chains.groups).toHaveLength(1)
    expect(chains.groups[0].closed).toBe(true)
    expect(chains.groups[0].columns).toBeGreaterThanOrEqual(4)
    expect(chains.particles).toBeLessThanOrEqual(PARTICLES.lower!)
    // the top ring rides the body; everything below it hangs from the group
    const n = raw.positions.length / 3
    for (let v = 0; v < n; v++) expect(chains.chain[v * 3]).toBe(raw.hang![v] > 0 ? 0 : -1)
    const { file, report } = fitItem(raw, ref)
    expect(file.meta.chains).toEqual(chains.groups)
    expect(report.particles).toBe(chains.particles)
    // a skirt hangs off the thighs, so it covers much more than it hides
    expect((file.meta.hidden ?? []).length).toBeLessThan(file.meta.covers.length)
  })

  it('round-trips a fitted item through its file, chains and all', async () => {
    const { file } = fitItem(skirt(), ref)
    const back = await readItemFile(await writeItem(file), ref.shape.surface.count)
    expect(back.meta).toEqual(file.meta)
    expect(Array.from(back.item.chain!)).toEqual(Array.from(file.item.chain!))
    expect(Array.from(back.item.binding.tri)).toEqual(Array.from(file.item.binding.tri))
  })

  it("drops what lies under the item's own outer parts, tucks its edges under, and leaves what lies beside them", () => {
    const P = ref.shape.positions
    const chest = ref.rest.chest[1]
    const torso = (v: number) => ref.shape.skin[v] === 1 && leanOn(ref, v, ['spine', 'chest', 'upper_chest']) >= 0.5
    const arms = (v: number) => ref.shape.skin[v] === 1 && leanOn(ref, v, ['upper_arm_L', 'upper_arm_R', 'forearm_L', 'forearm_R']) >= 0.5
    const shirt = shell('shirt', 'upper', torso, 0.005)
    const band = shell('band', 'upper', (v) => torso(v) && Math.abs(P[v * 3 + 1] - chest) < 0.1, 0.014)
    const key = (q: ArrayLike<number>, v: number) => `${Math.round(q[v * 3] * 1e4)},${Math.round(q[v * 3 + 1] * 1e4)},${Math.round(q[v * 3 + 2] * 1e4)}`
    const all = (raw: RawItem) => Array.from({ length: raw.positions.length / 3 }, (_, v) => v)
    // a band 9 mm over the shirt, as an obi lies over a robe
    const { raw, buried } = unburied(joined('banded', shirt, band), ref)
    expect(buried).toBeGreaterThan(band.index.length / 3 / 4)
    const left = new Set(all(raw).map((v) => key(raw.positions, v)))
    // the band stays whole, and so does the shirt clear of it
    expect(all(band).every((v) => left.has(key(band.positions, v)))).toBe(true)
    expect(all(shirt).filter((v) => Math.abs(shirt.positions[v * 3 + 1] - chest) > 0.17).every((v) => left.has(key(shirt.positions, v)))).toBe(true)
    // what's left of the shirt under the band lies a centimetre under it
    const { lift } = bindPoints(raw.positions, ref.skin, ref.grid)
    const tucked = all(raw).filter((v) => Math.abs(raw.positions[v * 3 + 1] - chest) < 0.05 && lift[v] < 0.01)
    expect(tucked.length).toBeGreaterThan(0)
    for (const v of tucked) expect(lift[v]).toBeLessThan(0.014 - 0.01 + 5e-4)
    // sleeves beside the torso bury none of it
    expect(unburied(joined('sleeved', shirt, shell('sleeves', 'upper', arms, 0.014)), ref).buried).toBe(0)
  })

  it('flags an item that sinks into the skin, misses its slot, or runs over budget', () => {
    const legs = (v: number) => ref.shape.skin[v] === 1 && leanOn(ref, v, ['thigh_L', 'thigh_R', 'shin_L', 'shin_R']) >= 0.5
    expect(fitItem(shell('sunk', 'lower', legs, -0.01), ref).report.problems.join()).toMatch(/under the skin/)
    expect(fitItem(shell('wrong', 'upper', legs, 0.006), ref).report.problems.join()).toMatch(/covers \d+% of the upper region/)
    const big = skirt(80, 48)
    expect(big.index.length / 3).toBeGreaterThan(BUDGET.lower)
    expect(fitItem(big, ref).report.problems.join()).toMatch(/over the 3000 budget/)
  })
})
