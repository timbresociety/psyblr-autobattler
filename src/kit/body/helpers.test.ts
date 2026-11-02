import { Quaternion, Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { drive, helperPose } from '../rig/drivers.js'
import { jiggleParams, jiggleState, stepJiggle, stepRing, type Vec3 } from '../rig/jiggle.js'
import { HELPER_BONES, metaBone } from '../rig/metarig.js'
import { helperSkin, planHelpers, skinParent, type HelperPlan } from './helpers.js'
import { readBody, type BodyFile } from './node.js'
import type { Skeleton } from './regions.js'
import { bodyBase, shapeBody, type BodyShape } from './shape.js'

let file: BodyFile
let shape: BodyShape
let skeleton: Skeleton
let plans: HelperPlan[]

beforeAll(async () => {
  file = await readBody(new URL('../../../public/heroes/v2/f-medium.glb', import.meta.url))
  shape = shapeBody(bodyBase(file), [], { weight: 0.5, muscle: 0.5, age: 0 })
  skeleton = { bones: file.bones, rest: file.rest }
  plans = planHelpers(shape, skeleton)
})

describe('helper bones on a body (§9.2)', () => {
  it('places every helper near the body it serves', () => {
    expect(plans).toHaveLength(HELPER_BONES.length)
    for (const p of plans) {
      const from = skeleton.rest[p.from]
      const d = Math.hypot(p.at[0] - from[0], p.at[1] - from[1], p.at[2] - from[2])
      expect(d, p.bone.name).toBeLessThan(0.45)
      expect(p.girth, p.bone.name).toBeGreaterThan(0.015)
    }
    expect(skinParent(metaBone('LeftBreastJiggle')!)).toBe('Spine2')
    expect(skinParent(metaBone('LeftBicepsMuscle')!)).toBe('LeftArm')
  })

  it('takes skin only from the bone each helper hangs on, so the body at rest deforms as before', () => {
    const s = helperSkin(shape, skeleton, plans)
    const n = shape.positions.length / 3
    const base = file.bones.length
    let folded = 0
    let most = 0
    for (let i = 0; i < n; i++) {
      let sum = 0
      const before = new Map<number, number>()
      const after = new Map<number, number>()
      for (let k = 0; k < 4; k++) {
        before.set(shape.joints[i * 4 + k], (before.get(shape.joints[i * 4 + k]) ?? 0) + shape.weights[i * 4 + k])
        sum += s.weights[i * 4 + k]
        const j = s.joints[i * 4 + k]
        // a helper's share counts as its parent's
        const as = j >= base ? file.bones.indexOf(plans[j - base].from) : j
        after.set(as, (after.get(as) ?? 0) + s.weights[i * 4 + k])
      }
      expect(sum).toBeCloseTo(1, 4)
      let off = 0
      for (const [j, w] of before) if (w > 1e-6) off = Math.max(off, Math.abs((after.get(j) ?? 0) - w))
      if (off > 1e-4) folded++
      most = Math.max(most, off)
    }
    // only a vertex that had all four slots full and needed one folds its smallest influence, and that one is small
    expect(folded).toBeLessThan(n * 0.03)
    expect(most).toBeLessThanOrEqual(0.08)
  })

  it('gives every helper some skin, and the bust and muscles plenty', () => {
    const s = helperSkin(shape, skeleton, plans)
    plans.forEach((p, k) => expect(s.counts[k], p.bone.name).toBeGreaterThan(p.bone.kind === 'corrective' ? 3 : 15))
    const breast = plans.findIndex((p) => p.bone.name === 'LeftBreastJiggle')
    expect(s.counts[breast]).toBeGreaterThan(80)
  })
})

const turn = (axis: [number, number, number], deg: number) => new Quaternion().setFromAxisAngle(new Vector3(...axis), (deg * Math.PI) / 180)

describe('drivers', () => {
  it('drives a biceps as the elbow bends and a triceps as it straightens', () => {
    const biceps = metaBone('LeftBicepsMuscle')!
    const triceps = metaBone('LeftTricepsMuscle')!
    expect(drive(biceps.driver!, new Quaternion())).toBe(0)
    expect(drive(biceps.driver!, turn([1, 0, 0], 90))).toBeCloseTo((90 - 15) / 105, 2)
    expect(drive(biceps.driver!, turn([0, 0, 1], 150))).toBe(1)
    expect(drive(triceps.driver!, new Quaternion())).toBe(1)
    expect(drive(triceps.driver!, turn([1, 0, 0], 90))).toBe(0)
  })

  it('moves a muscle only on a muscled body, and a corrective on every body', () => {
    const biceps = metaBone('LeftBicepsMuscle')!
    const elbow = metaBone('LeftElbowCorrective')!
    expect(helperPose(biceps, 1, 0)).toEqual({ out: 0, swell: 0 })
    expect(helperPose(biceps, 1, 1).swell).toBeGreaterThan(0.1)
    expect(helperPose(elbow, 1, 0).out).toBeGreaterThan(0.2)
  })
})

/** A body that jumps: its tip rises and falls on a parabola, then stands; the offsets the jiggle gives every frame. */
function jump(preset: 'realistic' | 'anime' | 'off', fps: number, seconds = 2.5) {
  const p = jiggleParams(preset, 'bust', 0.4)
  const s = jiggleState()
  const out: number[] = []
  const dt = 1 / fps
  let landed = false
  for (let t = 0; t <= seconds; t += dt) {
    const y = t < 0.8 ? 1.3 + 4 * t - 5 * t * t : 1.3
    const tip: Vec3 = [0, y, 0.15]
    const kick: Vec3 | undefined = !landed && t >= 0.8 ? ((landed = true), [0, -4, 0]) : undefined
    out.push(stepJiggle(s, p, tip, 0.1, dt, kick)[1])
  }
  return out
}

const crossings = (xs: number[]) => xs.slice(1).filter((x, i) => Math.sign(x) !== Math.sign(xs[i]) && Math.abs(x) > 1e-4).length

describe('jiggle (§9.4)', () => {
  it('holds still when off', () => {
    expect(jump('off', 60).every((y) => y === 0)).toBe(true)
  })

  it('bounces on a jump and landing, and settles', () => {
    const y = jump('realistic', 60)
    expect(Math.max(...y.map(Math.abs))).toBeGreaterThan(0.002)
    expect(Math.abs(y[y.length - 1])).toBeLessThan(0.0005)
  })

  it('rings longer and swings further with the anime (Gainax) preset than the realistic one', () => {
    const real = jump('realistic', 60)
    const anime = jump('anime', 60)
    expect(Math.max(...anime.map(Math.abs))).toBeGreaterThan(Math.max(...real.map(Math.abs)) * 1.5)
    expect(crossings(anime)).toBeGreaterThan(crossings(real))
  })

  it('never turns past its maximum angle', () => {
    const p = jiggleParams('anime', 'bust', 0.5)
    const most = Math.tan((p.maxAngle * Math.PI) / 180) * 0.1
    for (const y of jump('anime', 60)) expect(Math.abs(y)).toBeLessThanOrEqual(most + 1e-9)
  })

  it('jiggles the same at 30, 60 and 120 frames a second', () => {
    // a body bobbing up and down, read at the same moment: one second in
    const at = (fps: number) => {
      const p = jiggleParams('anime', 'bust', 0.4)
      const s = jiggleState()
      let y = 0
      for (let f = 0; f <= fps; f++) y = stepJiggle(s, p, [0, 1.3 + 0.15 * Math.sin((f / fps) * 9), 0.15], 0.1, 1 / fps)[1]
      return y
    }
    expect(Math.abs(at(30) - at(120))).toBeLessThan(0.0015)
    expect(Math.abs(at(60) - at(120))).toBeLessThan(0.0008)
    expect(Math.abs(at(120))).toBeGreaterThan(0.003)
  })

  it("keeps a child's bust still, gives a male chest only a subtle pad, and softens glutes with body fat", () => {
    expect(jiggleParams('anime', 'bust', 0.5, { child: true }).stiffness).toBe(0)
    expect(jiggleParams('anime', 'bust', 0.5, { male: true }).maxAngle).toBeLessThan(5)
    expect(jiggleParams('realistic', 'glutes', 1).maxAngle).toBeGreaterThan(jiggleParams('realistic', 'glutes', 0).maxAngle)
  })

  it('rings the muscles briefly after a landing', () => {
    const r = { x: 0, v: 0 }
    const xs = [stepRing(r, 1 / 60, 6)]
    for (let i = 0; i < 90; i++) xs.push(stepRing(r, 1 / 60))
    expect(Math.max(...xs.map(Math.abs))).toBeGreaterThan(0.005)
    expect(Math.abs(xs[xs.length - 1])).toBeLessThan(0.001)
  })
})
