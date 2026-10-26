import { beforeAll, describe, expect, it } from 'vitest'
import { readBody, type BodyFile } from '../body/node.js'
import { bodyBase, shapeBody, type BodyShape } from '../body/shape.js'
import { readItemFile } from '../fit/write.js'
import { dress, type DressedItem } from '../wear/dress.js'
import { bodyFields } from '../wear/fields.js'
import type { SurfaceItem } from '../wear/item.js'
import { TriangleBVH } from '../wear/ray.js'
import { buildCloth, capsulesOf, clothState, MAX_PARTICLES, restCloth, stepCloth, type Cloth, type ClothRig, type ClothState } from './cloth.js'

const pub = (path: string) => new URL(`../../../public${path}`, import.meta.url)
const MORPHS = ['weight-', 'weight+', 'muscle-', 'muscle+', 'age']
let file: BodyFile
let shape: BodyShape
const outfits = new Map<string, DressedItem[]>()
/** Per outfit, the body vertices on triangles it leaves showing. */
const showing = new Map<string, Set<number>>()

beforeAll(async () => {
  file = await readBody(pub('/heroes/m-medium.glb'))
  shape = shapeBody(bodyBase({ vid: file.vid, index: file.index, positions: file.positions, morphs: file.morphs, joints: file.joints, weights: file.weights }), MORPHS)
  const fields = bodyFields({ positions: shape.positions, joints: shape.joints, weights: shape.weights, bones: file.bones, rest: (b) => file.rest[b] })
  const items = new Map<string, SurfaceItem>()
  for (const id of ['kimono', 'hair_long', 'tee', 'trousers', 'cape', 'skirt']) items.set(id, (await readItemFile(pub(`/kit/wear/${id}.glb`), shape.surface.count)).item)
  const wear = (name: string, ids: string[]) => {
    const dressed = dress({ body: shape, fields, worn: ids.map((id) => ({ item: items.get(id)!, colors: [[0.5, 0.5, 0.5]], finishes: ['cotton'] })) })
    outfits.set(name, dressed.items.filter((i) => i.index.length))
    showing.set(name, new Set(Array.from(dressed.body).flatMap((t) => [0, 1, 2].map((k) => file.vid[file.index[t * 3 + k]]))))
  }
  wear('kimono', ['kimono', 'hair_long'])
  wear('cape', ['tee', 'trousers', 'cape'])
  wear('skirt', ['tee', 'skirt'])
})

const cloth = (outfit: string): Cloth => buildCloth({ items: outfits.get(outfit)!, body: shape, bones: file.bones, rest: (b) => file.rest[b] })!

/** Every bone given the same matrix (column-major): the whole body moved as one. */
function pose(m: number[]): Float32Array {
  const out = new Float32Array(file.bones.length * 16)
  for (let i = 0; i < file.bones.length; i++) out.set(m, i * 16)
  return out
}
const still = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const at = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
/** Tipped about the x axis through the hips: forward for a positive angle. */
function tipped(angle: number): number[] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const h = file.rest.hips
  // about the hips: p' = R (p - h) + h
  const ty = h[1] - (c * h[1] - s * h[2])
  const tz = h[2] - (s * h[1] + c * h[2])
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, ty, tz, 1]
}

/** A turn about the x, y or z axis through a point, column-major. */
function turned(axis: 'x' | 'y' | 'z', angle: number, h: ArrayLike<number>): number[] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const R = axis === 'z' ? [c, s, 0, -s, c, 0, 0, 0, 1] : axis === 'y' ? [c, 0, -s, 0, 1, 0, s, 0, c] : [1, 0, 0, 0, c, s, 0, -s, c]
  const t = [0, 1, 2].map((r) => h[r] - (R[r] * h[0] + R[3 + r] * h[1] + R[6 + r] * h[2]))
  return [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, t[0], t[1], t[2], 1]
}

/** a then b, column-major: b's move, then a's. */
function times(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

/** Bones that no longer share one matrix: each leg swung out about its hip, and everything above the hips turned. */
function stance(): Float32Array {
  const out = new Float32Array(file.bones.length * 16)
  const upper = turned('y', 0.17, file.rest.spine)
  file.bones.forEach((name, i) => {
    const leg = /^(thigh|shin|foot)_([LR])$/.exec(name)
    if (leg) {
      const hip = file.rest[`thigh_${leg[2]}`]
      out.set(turned('z', Math.sign(hip[0]) * 0.21, hip), i * 16)
    } else out.set(name === 'hips' ? still : upper, i * 16)
  })
  return out
}

/** A stride: the left leg swung forward about its hip and the right one back, by `angle` each. */
function stride(angle: number): Float32Array {
  const out = new Float32Array(file.bones.length * 16)
  file.bones.forEach((name, i) => {
    const leg = /^(thigh|shin|foot)_([LR])$/.exec(name)
    out.set(leg ? turned('x', leg[2] === 'L' ? -angle : angle, file.rest[`thigh_${leg[2]}`]) : still, i * 16)
  })
  return out
}

/** Where a vertex's skin puts it: each weighted bone's matrix from the pose, or past the body's bones a particle's. */
function skinned(p: ArrayLike<number>, joints: ArrayLike<number>, weights: ArrayLike<number>, v: number, pose: ArrayLike<number>, particles?: ArrayLike<number>): number[] {
  const out = [0, 0, 0]
  const B = file.bones.length
  for (let j = 0; j < 4; j++) {
    const w = weights[v * 4 + j]
    if (!w) continue
    const b = joints[v * 4 + j]
    const m = b < B ? pose : particles!
    const o = (b < B ? b : b - B) * 16
    for (let r = 0; r < 3; r++) out[r] += w * (m[o + r] * p[0] + m[o + 4 + r] * p[1] + m[o + 8 + r] * p[2] + m[o + 12 + r])
  }
  return out
}

function run(rig: ClothRig, state: ClothState, frames: number, m: (f: number) => number[]) {
  for (let f = 0; f < frames; f++) stepCloth(rig, state, pose(m(f)), 1 / 60)
}

/** How far each moving particle is from where the body carries its rest place. */
function strays(rig: ClothRig, state: ClothState): number[] {
  const out: number[] = []
  for (let k = 0; k < rig.count; k++) {
    if (rig.pinned[k]) continue
    out.push(Math.hypot(state.x[k * 3] - state.target[k * 3], state.x[k * 3 + 1] - state.target[k * 3 + 1], state.x[k * 3 + 2] - state.target[k * 3 + 2]))
  }
  return out
}

describe('cloth', () => {
  it('rigs an outfit within the budget, every loose vertex on the particles round it', () => {
    for (const outfit of ['kimono', 'cape', 'skirt']) {
      const { rig, skinIndex, skinWeight } = cloth(outfit)
      expect(rig.bones, outfit).toBeLessThanOrEqual(MAX_PARTICLES)
      expect(rig.bones, outfit).toBeGreaterThan(4)
      const B = file.bones.length
      let swung = 0
      let v = 0
      for (const item of outfits.get(outfit)!) {
        for (let i = 0; i < item.count; i++, v++) {
          const w = [0, 1, 2, 3].reduce((s, k) => s + skinWeight[v * 4 + k], 0)
          expect(w, outfit).toBeCloseTo(1, 4)
          for (let k = 0; k < 4; k++) expect(skinIndex[v * 4 + k]).toBeLessThan(B + rig.bones)
          // below the first level a vertex swings on particles alone
          if (item.chain && item.chain[i * 3] >= 0 && item.chain[i * 3 + 2] >= 1) {
            swung++
            for (let k = 0; k < 4; k++) if (skinWeight[v * 4 + k] > 0) expect(skinIndex[v * 4 + k]).toBeGreaterThanOrEqual(B)
          }
        }
      }
      expect(swung, outfit).toBeGreaterThan(20)
    }
  })

  it('sizes capsules from the body, and none takes in cloth at rest', () => {
    const { rig } = cloth('kimono')
    const caps = capsulesOf(shape, file.bones, (b) => file.rest[b])
    expect(caps.length).toBeGreaterThanOrEqual(10)
    const radius = (bone: string) => caps.find((c) => c.bone === file.bones.indexOf(bone))!.r
    expect(radius('spine')).toBeGreaterThan(radius('forearm_L'))
    expect(radius('thigh_L')).toBeGreaterThan(radius('shin_L'))
    for (const c of rig.capsules) expect(c.r).toBeGreaterThan(0.01)
  })

  it('leaves the cloth as made while the body stands still, then sleeps', () => {
    const { rig } = cloth('kimono')
    const state = clothState(rig)
    run(rig, state, 120, () => still)
    expect(Math.max(...strays(rig, state))).toBeLessThan(0.001)
    expect(state.sleeping).toBe(true)
    // and wakes when the body moves again
    stepCloth(rig, state, pose(at(0.05, 0, 0)), 1 / 60)
    expect(state.sleeping).toBe(false)
  })

  it('rests where the body carries it in any pose: each particle on its carried place, turned by nothing', () => {
    const pose = stance()
    const { rig } = cloth('kimono')
    const state = clothState(rig)
    restCloth(rig, state, pose)
    for (let k = 0; k < rig.count; k++) {
      if (rig.pinned[k]) continue
      const o = rig.bone[k] * 16
      // the particle's own skin, blended from the pose
      const carry = new Array(16).fill(0)
      for (let j = 0; j < 4; j++) for (let e = 0; e < 16; e++) carry[e] += rig.weights[k * 4 + j] * pose[rig.joints[k * 4 + j] * 16 + e]
      for (let e = 0; e < 16; e++) expect(state.matrices[o + e]).toBeCloseTo(carry[e], 5)
    }
  })

  /** The legs an outfit covers well at rest, and those of them its cloth leaves outside in a pose. */
  function legsOutside(outfit: string, { skinIndex, skinWeight }: Cloth, state: ClothState, pose: Float32Array): { legs: number; out: string[] } {
    const items = outfits.get(outfit)!
    // the outfit as made, and as worn in the pose
    const total = items.reduce((n, i) => n + i.count, 0)
    const made = new Float32Array(total * 3)
    const worn = new Float32Array(total * 3)
    const index: number[] = []
    let v = 0
    for (const item of items) {
      for (let t = 0; t < item.index.length; t++) index.push(item.index[t] + v)
      for (let i = 0; i < item.count; i++, v++) {
        const p = item.positions.subarray(i * 3, i * 3 + 3)
        made.set(p, v * 3)
        worn.set(skinned(p, skinIndex, skinWeight, v, pose, state.matrices), v * 3)
      }
    }
    // inside: a ray out from the body's axis, level, meets the cloth
    const covered = (bvh: TriangleBVH, p: number[]) => {
      const l = Math.hypot(p[0], p[2])
      return !!bvh.first(p as [number, number, number], [p[0] / l, 0, p[2] / l], 0, 0.6)
    }
    const before = new TriangleBVH(made, index)
    const after = new TriangleBVH(worn, index)
    let legs = 0
    const out: string[] = []
    for (const b of showing.get(outfit)!) {
      const rest = Array.from(shape.positions.subarray(b * 3, b * 3 + 3))
      // well inside at rest: a short skirt's hem rides up a swung thigh, and the leg below it is meant to show
      if (rest[1] < 0.1 || rest[1] > 0.9 || !covered(before, rest) || !covered(before, [rest[0], rest[1] - 0.04, rest[2]])) continue
      legs++
      const p = skinned(rest, shape.joints, shape.weights, b, pose)
      if (!covered(after, p)) out.push(rest.map((c) => c.toFixed(3)).join(','))
    }
    return { legs, out }
  }

  it('keeps the legs inside a robe or a skirt in a stance, at rest', () => {
    const pose = stance()
    for (const outfit of ['kimono', 'skirt']) {
      const c = cloth(outfit)
      const state = clothState(c.rig)
      restCloth(c.rig, state, pose)
      const { legs, out } = legsOutside(outfit, c, state, pose)
      expect(legs, outfit).toBeGreaterThan(40)
      expect(out, outfit).toEqual([])
    }
  })

  it('keeps the legs inside a robe through a stride: its cloth stretches over it as the skin would, not held to its rest girth', () => {
    const c = cloth('kimono')
    const state = clothState(c.rig)
    // into a long stride and held there, the cloth swinging after it
    for (let f = 0; f < 90; f++) stepCloth(c.rig, state, stride(0.45 * Math.min(1, f / 20)), 1 / 60)
    const { legs, out } = legsOutside('kimono', c, state, stride(0.45))
    expect(legs).toBeGreaterThan(40)
    // a few slip out, over the front thigh and the back knee: links held to their rest lengths leave a third of them out
    expect(out.length, out.join(' ')).toBeLessThanOrEqual(legs / 20)
  })

  it('keeps long hair on the robe it lies on as the body leans back and sways: on it, never sunk into it', () => {
    const items = outfits.get('kimono')!
    const { rig, skinIndex, skinWeight } = cloth('kimono')
    const state = clothState(rig)
    const robe = items.findIndex((i) => i.id === 'kimono')
    const hair = items.findIndex((i) => i.id === 'hair_long')
    const first = (i: number) => items.slice(0, i).reduce((n, it) => n + it.count, 0)
    const hips = file.rest.hips
    /** Back hair as the body carries it now: how much of it there is, and the deepest any of it lies inside the robe. */
    const sunk = (m: number[]) => {
      const worn = (i: number) => {
        const out = new Float32Array(items[i].count * 3)
        for (let v = 0; v < items[i].count; v++) out.set(skinned(items[i].positions.subarray(v * 3, v * 3 + 3), skinIndex, skinWeight, first(i) + v, pose(m), state.matrices), v * 3)
        return out
      }
      // the robe where it's bound to the body, not its sleeves swinging behind the hair
      const chain = items[robe].chain
      const bound = Array.from(items[robe].index).filter((_, t, all) => [0, 1, 2].every((c) => !chain || chain[all[t - (t % 3) + c] * 3] < 0))
      const bvh = new TriangleBVH(worn(robe), bound)
      const at = worn(hair)
      // the body's back, as carried
      const back: [number, number, number] = [-m[8], -m[9], -m[10]]
      let deepest = 0
      let checked = 0
      for (let v = 0; v < items[hair].count; v++) {
        const rest = items[hair].positions.subarray(v * 3, v * 3 + 3)
        if (rest[1] > 1.52 || rest[1] < 1.3 || rest[2] > hips[2]) continue
        checked++
        const hit = bvh.first([at[v * 3], at[v * 3 + 1], at[v * 3 + 2]], back, 0, 0.05)
        if (hit) deepest = Math.max(deepest, hit.t)
      }
      return { checked, deepest }
    }
    run(rig, state, 10, () => still)
    // leaning back presses the hair into the robe; a sway slides it along
    const lean = (f: number) => tipped(-0.6 * Math.min(1, (f + 1) / 15))
    const sway = (f: number) => times(turned('y', 0.6 * Math.sin((2 * Math.PI * f) / 60), hips), lean(90))
    const seen: { checked: number; deepest: number }[] = []
    for (let f = 0; f < 90; f++) {
      stepCloth(rig, state, pose(lean(f)), 1 / 60)
      if (f % 15 === 14) seen.push(sunk(lean(f)))
    }
    for (let f = 0; f < 120; f++) {
      stepCloth(rig, state, pose(sway(f)), 1 / 60)
      if (f % 15 === 14) seen.push(sunk(sway(f)))
    }
    expect(Math.min(...seen.map((s) => s.checked))).toBeGreaterThan(40)
    expect(Math.max(...seen.map((s) => s.deepest))).toBeLessThan(0.0015)
  })

  it('trails a body that runs, and settles back once it stops', () => {
    const { rig } = cloth('cape')
    const state = clothState(rig)
    run(rig, state, 10, () => still)
    // 4 m/s along +x for half a second
    run(rig, state, 30, (f) => at((f + 1) * (4 / 60), 0, 0))
    let behind = 0
    let n = 0
    for (let k = 0; k < rig.count; k++) {
      if (rig.pinned[k]) continue
      behind += state.x[k * 3] - state.target[k * 3]
      n++
    }
    expect(behind / n).toBeLessThan(-0.01)
    run(rig, state, 240, () => at(2, 0, 0))
    expect(Math.max(...strays(rig, state))).toBeLessThan(0.003)
  })

  it('falls toward the ground when the body lies down, and stays out of the body', () => {
    const { rig } = cloth('skirt')
    const state = clothState(rig)
    run(rig, state, 10, () => still)
    run(rig, state, 240, () => tipped(Math.PI / 2))
    let drop = 0
    let n = 0
    for (let k = 0; k < rig.count; k++) {
      if (rig.pinned[k]) continue
      drop += state.x[k * 3 + 1] - state.target[k * 3 + 1]
      n++
    }
    expect(drop / n).toBeLessThan(-0.01)
    // no particle ends inside a capsule (the body's rest space carried by the tip)
    const m = tipped(Math.PI / 2)
    const carry = (p: number[]) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
    rig.capsules.forEach((c, i) => {
      const a = carry(c.a)
      const b = carry(c.b)
      for (let k = 0; k < rig.count; k++) {
        const keep = rig.room[k * rig.capsules.length + i]
        if (rig.pinned[k] || keep <= 0) continue
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const ap = [state.x[k * 3] - a[0], state.x[k * 3 + 1] - a[1], state.x[k * 3 + 2] - a[2]]
        const t = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)))
        expect(Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t)).toBeGreaterThan(keep)
      }
    })
  })

  it('keeps twenty heroes in loose outfits under a millisecond and a half a frame', () => {
    const rigs = Array.from({ length: 20 }, (_, i) => cloth(['kimono', 'cape', 'skirt'][i % 3]).rig)
    const states = rigs.map(clothState)
    const poses = Array.from({ length: 60 }, (_, f) => pose(at(Math.sin(f / 9) * 0.4, 0, Math.cos(f / 7) * 0.3)))
    for (let f = 0; f < 30; f++) rigs.forEach((r, i) => stepCloth(r, states[i], poses[f % 60], 1 / 60))
    const frames = 240
    const start = performance.now()
    for (let f = 0; f < frames; f++) rigs.forEach((r, i) => stepCloth(r, states[i], poses[f % 60], 1 / 60))
    const ms = (performance.now() - start) / frames
    console.log(`cloth: ${ms.toFixed(3)} ms a frame for 20 heroes (${rigs.reduce((n, r) => n + r.count, 0)} particles)`)
    expect(ms).toBeLessThan(1.5)
  })
})
