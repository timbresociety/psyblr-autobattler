import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toClip, type ClipFile } from './anim-library.js'
import type { AnimIndex } from './anim-index.js'
import * as THREE from 'three'
import { rollLine, shifted, swung, turned } from './library-gait.js'

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
