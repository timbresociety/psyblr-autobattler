import { beforeAll, describe, expect, it } from 'vitest'
import type { ItemSlot } from '../wear/item.js'
import { boundaryVertices, fitItem } from './fit.js'
import { placeGenerated, type GeneratedMesh } from './generated.js'
import { readReference, type Reference } from './reference.js'
import { readItemFile, type ItemFile } from './write.js'

/**
 * A 3D generator's garment arrives at its own scale and place, in its own pose, closed into a solid, often with a
 * mannequin inside. These fixtures are built-in items made awkward in each of those ways; placeGenerated must bring
 * each back to a garment fitItem passes, lying where the built-in one lies.
 */

const pub = (path: string) => new URL(`../../../public${path}`, import.meta.url)
let ref: Reference
const items = new Map<string, ItemFile>()

beforeAll(async () => {
  ref = await readReference(pub('/heroes/m-medium.glb'), pub('/heroes/m-medium.kit.json'))
  for (const id of ['tee', 'trousers', 'kimono', 'sneakers', 'cape', 'beanie', 'cowboy_hat']) items.set(id, await readItemFile(pub(`/kit/wear/${id}.glb`), ref.shape.surface.count))
})

/** A seeded generator, so a jittered fixture is the same every run. */
function random(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/** Scale, move and jitter: the generator's own units and place. */
function displaced(positions: ArrayLike<number>, scale: number, at: [number, number, number], jitter: number, seed = 7): Float32Array {
  const r = random(seed)
  return Float32Array.from({ length: positions.length }, (_, k) => positions[k] * scale + at[k % 3] + (r() * 2 - 1) * jitter)
}

/** Meshes joined into one, as a generator hands back a single mesh. */
function joined(...meshes: { positions: ArrayLike<number>; index: ArrayLike<number> }[]): { positions: Float32Array; index: Uint32Array } {
  const positions: number[] = []
  const index: number[] = []
  for (const m of meshes) {
    const base = positions.length / 3
    for (let k = 0; k < m.positions.length; k++) positions.push(m.positions[k])
    for (let k = 0; k < m.index.length; k++) index.push(m.index[k] + base)
  }
  return { positions: Float32Array.from(positions), index: Uint32Array.from(index) }
}

/** The garment's inner wall, as a solid has one: its surface again 6 mm in, facing in. */
function innerWall(file: ItemFile): { positions: Float32Array; index: Uint32Array } {
  const { positions: P, normals: N } = file
  const index = file.item.index
  return {
    positions: Float32Array.from({ length: P.length }, (_, k) => P[k] - N[k] * 0.006),
    index: Uint32Array.from({ length: index.length }, (_, k) => index[k - (k % 3) + [0, 2, 1][k % 3]]),
  }
}

/** Each open edge (a neck, a cuff, a hem) fanned shut to its middle. */
function capped(file: ItemFile): { positions: Float32Array; index: Uint32Array } {
  const { positions: P } = file
  const index = file.item.index
  const open = boundaryVertices(P, index)
  // the open edges, walked into loops by position (an item's vertices split along its seams)
  const key = (v: number) => `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`
  const count = new Map<string, number>()
  const edge = (a: number, b: number) => (key(a) < key(b) ? `${key(a)}|${key(b)}` : `${key(b)}|${key(a)}`)
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) count.set(edge(index[t + k], index[t + ((k + 1) % 3)]), (count.get(edge(index[t + k], index[t + ((k + 1) % 3)])) ?? 0) + 1)
  const next = new Map<string, number[]>()
  const at = new Map<string, number>()
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k]
      const b = index[t + ((k + 1) % 3)]
      if (!open[a] || !open[b] || count.get(edge(a, b)) !== 1) continue
      at.set(key(a), a)
      at.set(key(b), b)
      ;(next.get(key(a)) ?? next.set(key(a), []).get(key(a))!).push(b)
    }
  const positions = Array.from(P)
  const caps: number[] = []
  const seen = new Set<string>()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: number[] = []
    for (let k: string | undefined = start; k && !seen.has(k); ) {
      seen.add(k)
      loop.push(at.get(k)!)
      const ahead: number | undefined = next.get(k)?.[0]
      k = ahead === undefined ? undefined : key(ahead)
    }
    if (loop.length < 3) continue
    const middle = [0, 1, 2].map((d) => loop.reduce((s, v) => s + P[v * 3 + d], 0) / loop.length)
    const c = positions.length / 3
    positions.push(...middle)
    for (let i = 0; i < loop.length; i++) caps.push(loop[i], loop[(i + 1) % loop.length], c)
  }
  return { positions: Float32Array.from(positions), index: Uint32Array.from([...index, ...caps]) }
}

/**
 * A form filling the garment, as a generator leaves one: the reference body's skin cut to the garment's own height
 * (a dress form, not a whole body: a head or feet beyond the garment would be taken for part of it).
 */
function mannequin(file: ItemFile): { positions: ArrayLike<number>; index: Uint32Array } {
  let lo = Infinity
  let hi = -Infinity
  for (let v = 1; v < file.positions.length; v += 3) (lo = Math.min(lo, file.positions[v])), (hi = Math.max(hi, file.positions[v]))
  const P = ref.skin.positions
  const T = ref.skin.triangles
  const within = (v: number) => P[v * 3 + 1] > lo + 0.02 && P[v * 3 + 1] < hi - 0.02
  const index: number[] = []
  for (let t = 0; t < T.length; t += 3) if (within(T[t]) && within(T[t + 1]) && within(T[t + 2])) index.push(T[t], T[t + 1], T[t + 2])
  return { positions: P, index: Uint32Array.from(index) }
}

/** Sleeves swung up toward a T-pose: turned about the shoulder, the turn easing in over the first 10 cm out. */
function tPosed(positions: Float32Array, angle: number): Float32Array {
  const out = Float32Array.from(positions)
  for (const side of [1, -1]) {
    const j = ref.rest[side > 0 ? 'upper_arm_L' : 'upper_arm_R']
    for (let v = 0; v < out.length / 3; v++) {
      const x = out[v * 3] - j[0]
      const ease = Math.min(1, Math.max(0, (x * side - 0.02) / 0.08))
      if (ease <= 0) continue
      const a = angle * ease * ease * (3 - 2 * ease) * side
      const y = out[v * 3 + 1] - j[1]
      out[v * 3] = j[0] + x * Math.cos(a) - y * Math.sin(a)
      out[v * 3 + 1] = j[1] + x * Math.sin(a) + y * Math.cos(a)
    }
  }
  return out
}

function overlap(fitted: number[], original: number[]): number {
  const have = new Set(fitted)
  return original.filter((v) => have.has(v)).length / original.length
}

function place(id: string, mesh: GeneratedMesh) {
  const file = items.get(id)!
  const slot = file.meta.slot as ItemSlot
  const placed = placeGenerated(mesh, { id: `gen_${id}`, name: id, slot }, ref)
  const fitted = fitItem(placed.raw, ref)
  return { file, placed, fitted, report: fitted.report, overlap: overlap(fitted.file.meta.covers, file.meta.covers) }
}

describe('placing a generated garment', () => {
  it('brings each slot back from its own scale and place, jittered', () => {
    for (const id of ['tee', 'trousers', 'kimono', 'sneakers', 'cape']) {
      const file = items.get(id)!
      const { placed, report, overlap } = place(id, { positions: displaced(file.positions, 1.7, [0.4, -0.3, 1.2], 0.002), index: file.item.index })
      expect(placed.steps.scale, id).toBeCloseTo(1 / 1.7, 1)
      expect(report.problems, id).toEqual([])
      expect(overlap, id).toBeGreaterThan(0.85)
    }
  })

  it('swings sleeves held out toward a T-pose back down the arms', () => {
    const file = items.get('tee')!
    const { placed, report, overlap } = place('tee', { positions: tPosed(file.positions, 0.7), index: file.item.index })
    expect(placed.steps.reposed.length).toBeGreaterThan(0)
    expect(report.problems).toEqual([])
    expect(overlap).toBeGreaterThan(0.85)
  })

  it("keeps a hat's crown: the head ends under it, so only a cap shut underneath goes", () => {
    // a brim (a cowboy hat's curls up past its crown) is placed by the beanie's rule for now, so only its crown counts here
    for (const id of ['beanie', 'cowboy_hat']) {
      const file = items.get(id)!
      const open = place(id, { positions: displaced(file.positions, 1.7, [0.4, -0.3, 1.2], 0.002), index: file.item.index })
      expect(open.placed.steps.clipped.caps, id).toBe(0)
      expect(open.report.problems, id).toEqual([])
      if (id === 'beanie') expect(open.overlap).toBeGreaterThan(0.95)
    }
    const shut = place('beanie', capped(items.get('beanie')!))
    expect(shut.placed.steps.clipped.caps).toBeGreaterThan(0)
    expect(shut.report.problems).toEqual([])
    expect(shut.overlap).toBeGreaterThan(0.95)
  })

  it('cuts away the inner wall of a solid, the caps over its openings and the mannequin inside', () => {
    for (const id of ['tee', 'trousers', 'kimono']) {
      const file = items.get(id)!
      const { placed, report, overlap } = place(id, joined(capped(file), innerWall(file), mannequin(file)))
      const { clipped } = placed.steps
      expect(clipped.inner + clipped.covered + clipped.inside, id).toBeGreaterThan(file.item.index.length / 3 / 2)
      expect(clipped.caps, id).toBeGreaterThan(0)
      // what's left is about the garment's own outside
      expect(placed.raw.index.length / 3, id).toBeLessThan((file.item.index.length / 3) * 1.25)
      expect(report.problems, id).toEqual([])
      expect(overlap, id).toBeGreaterThan(0.85)
    }
  })
})
