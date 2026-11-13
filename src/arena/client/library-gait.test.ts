import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toClip, type ClipFile } from './anim-library.js'
import type { AnimIndex } from './anim-index.js'
import * as THREE from 'three'
import { floorLifted, landed, mirrored, quickened, rollLine, shifted, spliced, swung, turned, turnedBelow } from './library-gait.js'

const index = JSON.parse(readFileSync('public/anim/standard/index.json', 'utf8')) as AnimIndex
const clip = (name: string) => toClip(name, JSON.parse(readFileSync(`public/anim/standard/m/${name}.json`, 'utf8')) as ClipFile, index)
const deg = (a: number) => (a * 180) / Math.PI

describe('tumbles rolled along the way the hero goes (owner, 2026-11-04)', () => {
  it('reads the line a Mixamo roll goes along off its hips', () => {
    // the dodge roll went over the right shoulder, 65 degrees off the way it was played; the dive roll goes straight
    expect(deg(rollLine(clip('quick_roll_to_run'))!)).toBeCloseTo(-65, -1)
    expect(Math.abs(deg(rollLine(clip('cmu_dive_roll'))!))).toBeLessThan(8)
    expect(Math.abs(deg(rollLine(clip('backflip'))!))).toBeGreaterThan(170)
    expect(rollLine(clip('idle'))).toBeUndefined()
  })

  it('turned by its line, a roll goes straight ahead', () => {
    for (const name of ['quick_roll_to_run', 'falling_to_roll']) {
      const roll = clip(name)
      expect(Math.abs(deg(rollLine(turned(roll, -rollLine(roll)!))!)), name).toBeLessThan(1)
    }
  })
})

describe('hips moved where the engine wants them (owner, 2026-11-04)', () => {
  const hips = (c: ReturnType<typeof clip>) => c.tracks.find((t) => t.name.endsWith('.position'))!
  it('a hang goes forward to the wall all through', () => {
    const hang = clip('hanging_from_a_ledge_idle')
    const moved = hips(shifted(hang, { ahead: 0.4 }))
    hips(hang).values.forEach((v, i) => expect(moved.values[i] - v).toBeCloseTo(i % 3 === 2 ? 0.4 : 0, 5))
  })
  it('a dive comes down to the floor by its end, untouched over its first half', () => {
    const dive = clip('cmu_dive_roll')
    const before = hips(dive)
    const after = hips(shifted(dive, { down: 0.14 }))
    expect(after.values[after.values.length - 2]).toBeCloseTo(0.14, 5)
    const half = before.times.findIndex((t) => t > dive.duration / 2)
    for (let i = 0; i < half; i++) expect(after.values[i * 3 + 1]).toBe(before.values[i * 3 + 1])
  })
})

describe('an attitude\u2019s swing on the gait loops (2026-11-11)', () => {
  const walk = clip('walk')
  /** A bone's swing about each of its own axes over the loop, degrees, and how far its last key is from its first. */
  const range = (c: THREE.AnimationClip, bone: string) => {
    const t = c.tracks.find((x) => x.name === `${bone}.quaternion`)!
    const qs = Array.from({ length: t.values.length / 4 }, (_, i) => new THREE.Quaternion().fromArray(t.values, i * 4))
    const e = qs.map((q) => new THREE.Euler().setFromQuaternion(qs[0].clone().invert().multiply(q), 'YXZ'))
    const span = (k: 'x' | 'y' | 'z') => deg(Math.max(...e.map((v) => v[k])) - Math.min(...e.map((v) => v[k])))
    return { pitch: span('x'), twist: span('y'), drop: span('z'), seam: deg(qs[0].angleTo(qs[qs.length - 1])) }
  }

  it('leaves a clip alone with no gains, and bones it isn\u2019t given', () => {
    expect(range(swung(walk, {}), 'Hips')).toEqual(range(walk, 'Hips'))
    expect(range(swung(walk, { Hips: { drop: 2 } }), 'Spine2')).toEqual(range(walk, 'Spine2'))
  })

  it('grows the axis it\u2019s given by about its gain, the others hardly, and keeps the loop closed', () => {
    const before = range(walk, 'Hips')
    const after = range(swung(walk, { Hips: { drop: 2.8 } }), 'Hips')
    expect(after.drop / before.drop).toBeGreaterThan(2.4)
    expect(after.drop / before.drop).toBeLessThan(3.2)
    expect(Math.abs(after.twist - before.twist)).toBeLessThan(before.twist * 0.25)
    expect(after.seam).toBeLessThan(0.2)
  })

  it('a share takes that much of the extra', () => {
    const before = range(walk, 'Hips').drop
    const half = range(swung(walk, { Hips: { drop: 3 } }, 0.5), 'Hips').drop
    expect(half / before).toBeGreaterThan(1.7)
    expect(half / before).toBeLessThan(2.3)
  })
})

describe('strafes built from a sidestep under the walk’s arms (clip audit, call 1)', () => {
  const values = (c: THREE.AnimationClip, name: string, t: number) =>
    Array.from((c.tracks.find((k) => k.name === name) as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant().evaluate(t))
  const side = clip('walking_left')
  const walk = clip('walk')
  const sideGait = { speed: 1.35, strides: 1, strike: 0.25 }
  const walkGait = index.genders.m!.gait!.walk!

  it('mirrors left for right: the left arm plays the right one’s turns reflected, and twice is the clip again', () => {
    const once = mirrored(side)
    const [x, y, z, w] = values(side, 'RightArm.quaternion', 0.4)
    expect(values(once, 'LeftArm.quaternion', 0.4).map((v) => +v.toFixed(5))).toEqual([x, -y, -z, w].map((v) => +v.toFixed(5)))
    expect(values(once, 'Hips.position', 0.4)[0]).toBeCloseTo(-values(side, 'Hips.position', 0.4)[0], 5)
    const twice = mirrored(once)
    for (const name of ['LeftUpLeg.quaternion', 'Spine1.quaternion', 'Hips.position']) expect(values(twice, name, 0.7)).toEqual(values(side, name, 0.7))
  })

  it('swings the walk’s arms in the sidestep’s stride, left foot landing with left foot landing, and leaves its legs', () => {
    const both = spliced(side, sideGait, walk, walkGait)
    expect(both.duration).toBe(side.duration)
    expect(values(both, 'LeftUpLeg.quaternion', 0.5)).toEqual(values(side, 'LeftUpLeg.quaternion', 0.5))
    const landed = values(both, 'RightForeArm.quaternion', sideGait.strike)
    values(walk, 'RightForeArm.quaternion', walkGait.strike).forEach((v, i) => expect(landed[i]).toBeCloseTo(v, 2))
    // half a stride on, the arms are half a stride on too
    const half = values(both, 'LeftArm.quaternion', sideGait.strike + side.duration / 2)
    values(walk, 'LeftArm.quaternion', walkGait.strike + walk.duration / walkGait.strides / 2).forEach((v, i) => expect(half[i]).toBeCloseTo(v, 2))
  })

  it('turned below the waist, the hips turn and the chest above them doesn’t', () => {
    const turn = 0.3
    const out = turnedBelow(side, turn)
    const world = (c: THREE.AnimationClip, t: number) => new THREE.Quaternion().fromArray(values(c, 'Hips.quaternion', t)).multiply(new THREE.Quaternion().fromArray(values(c, 'Spine.quaternion', t)))
    for (const t of [0, 0.3, 0.8]) {
      expect(new THREE.Quaternion().fromArray(values(out, 'Hips.quaternion', t)).angleTo(new THREE.Quaternion().fromArray(values(turned(side, turn), 'Hips.quaternion', t)))).toBeLessThan(1e-3)
      expect(world(out, t).angleTo(world(side, t))).toBeLessThan(1e-3)
    }
  })

  it('a quickened clip is the same moves sooner', () => {
    const fast = quickened(side, 1.4)
    expect(fast.duration).toBeCloseTo(side.duration / 1.4, 6)
    expect(values(fast, 'LeftUpLeg.quaternion', 0.5 / 1.4).map((v) => +v.toFixed(4))).toEqual(values(side, 'LeftUpLeg.quaternion', 0.5).map((v) => +v.toFixed(4)))
  })
})

describe('floor poses lifted by the body that lies on them (clip audit, fault 3)', () => {
  const down = () => new THREE.AnimationClip('down', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0, 1, 0, 0, 0.6, 0, 0, 0.2, 0])])
  const hips = (clip: THREE.AnimationClip) => [1, 4, 7].map((i) => +clip.tracks[0]!.values[i]!.toFixed(4))
  const reference = { front: 0.14, back: 0.1, head: { front: 0.17, back: 0.075, top: 0.23 } }

  it('lifts a pose on the back by the deeper back or the bigger skull behind, whichever is more', () => {
    expect(hips(floorLifted('fall', down(), { ...reference, back: 0.15 }, reference, 1))).toEqual([1, 0.625, 0.25])
    expect(hips(floorLifted('fall', down(), { ...reference, head: { ...reference.head, back: 0.175 } }, reference, 1))).toEqual([1, 0.65, 0.3])
    expect(hips(floorLifted('fall', down(), { ...reference, head: { ...reference.head, front: 0.5 } }, reference, 1))).toEqual([1, 0.6, 0.2])
  })

  it('gives a curled roll its whole lift by the time the hips are 60% of the way down', () => {
    const big = { ...reference, head: { ...reference.head, top: 0.33 } }
    expect(hips(floorLifted('roll', down(), big, reference, 1))).toEqual([1, 0.6833, 0.3])
    expect(hips(floorLifted('slash', down(), big, reference, 1))).toEqual([1, 0.6, 0.2])
  })
})

describe('a get-down that ends where prone lies (all-moves check, 2026-11-13)', () => {
  it('crawls only as far as the next move needs, at its own pace, and meets its height', () => {
    const crawl = new THREE.AnimationClip('down', 1, [new THREE.VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0, 0.4, 0, 0, 0.3, 0.5, 0, 0.1, 1])])
    const met = Array.from(landed(crawl, [0, 0.12, 0.3]).tracks[0]!.values, (v) => +v.toFixed(4))
    expect(met).toEqual([0, 0.4, 0, 0, 0.31, 0.15, 0, 0.12, 0.3])
  })
})
