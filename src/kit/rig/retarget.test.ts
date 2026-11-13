import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'
import { legRatio, retargetClip, type RetargetSource } from './retarget.js'

const turn = (axis: [number, number, number], deg: number) => new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(), (deg * Math.PI) / 180)

const src: RetargetSource = { bones: ['Hips', 'LeftArm'], rest: [[0, 0, 0, 1], turn([0, 0, 1], 40).toArray()], hips: [0, 1, 0] }
/** A clip that raises the arm 30° from the source's rest and bobs and steps the hips. */
const clip = new AnimationClip('wave', 1, [
  new QuaternionKeyframeTrack('LeftArm.quaternion', [0, 1], [...turn([0, 0, 1], 40).toArray(), ...turn([0, 0, 1], 40).multiply(turn([1, 0, 0], 30)).toArray()]),
  new VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0.1, 0.9, 0.5]),
])

describe('dynamic retargeting (§9.6)', () => {
  it('puts each bone\'s turn from rest onto the character\'s own rest', () => {
    const ownRest = turn([0, 0, 1], 55)
    const out = retargetClip(clip, src, { rest: new Map([['LeftArm', ownRest], ['Hips', new Quaternion()]]), hips: [0, 1, 0] })
    const v = out.tracks.find((t) => t.name === 'LeftArm.quaternion')!.values
    const end = new Quaternion().fromArray(v, 4)
    // the turn from the character's rest is the clip's turn from the source's
    const delta = ownRest.clone().invert().multiply(end)
    expect(Math.abs(delta.dot(turn([1, 0, 0], 30)))).toBeCloseTo(1, 6)
  })

  it('scales the hips by the leg-length ratio, so a long-legged body stands taller and steps further', () => {
    const tall = { rest: new Map<string, Quaternion>(), hips: [0, 1.3, 0] }
    expect(legRatio(src, tall)).toBeCloseTo(1.3)
    const out = retargetClip(clip, src, tall)
    const p = out.tracks.find((t) => t.name === 'Hips.position')!.values
    expect(Array.from(p.slice(0, 3))).toEqual([0, 1.3, 0].map((x) => expect.closeTo(x, 6)))
    expect(p[4]).toBeCloseTo(0.9 * 1.3, 6)
    expect(p[5]).toBeCloseTo(0.5 * 1.3, 6)
    expect(out.userData.legRatio).toBeCloseTo(1.3)
  })

  it('scales the hips by thigh and shin where both are known, not by a hip joint set high above the legs (clip audit fault 1)', () => {
    // hips stand 1.3 times as high, but on legs only 1.1 times as long: a bent knee drops the hips by the legs'
    const high = { rest: new Map<string, Quaternion>(), hips: [0, 1.3, 0], legs: 0.99 }
    expect(legRatio({ ...src, legs: 0.9 }, high)).toBeCloseTo(1.1)
    const p = retargetClip(clip, { ...src, legs: 0.9 }, high).tracks.find((t) => t.name === 'Hips.position')!.values
    expect(p[1]).toBeCloseTo(1.3, 6)
    expect(p[4]).toBeCloseTo(1.3 - 0.1 * 1.1, 6)
    // either side unmeasured: standing height, as before
    expect(legRatio(src, high)).toBeCloseTo(1.3)
  })

  it('keys nothing but rotations and the hips', () => {
    const out = retargetClip(clip, src, { rest: new Map([['LeftArm', new Quaternion()]]), hips: [0, 0.8, 0] })
    expect(out.tracks.map((t) => t.name)).toEqual(['LeftArm.quaternion', 'Hips.position'])
    expect(out.duration).toBe(1)
  })
})
