import { describe, expect, it } from 'vitest'
import { alignment, fitJoints, transferWeights } from './autofit.js'
import { readBody } from './node.js'
import { bodyBase } from './shape.js'

/** The joints a clip moves the body by: the back, neck, the arms and legs (one side; the other mirrors it). */
const MAJOR = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightArm', 'RightLeg']

async function load(name: string) {
  const file = await readBody(new URL(`../../../public/heroes/v2/${name}.glb`, import.meta.url))
  return { file, base: bodyBase(file) }
}

/** Fit `target`'s mesh from `from`'s body and skeleton, and measure it against the target's own. */
async function refit(from: string, target: string) {
  const b = await load(from)
  const t = await load(target)
  const align = alignment(t.base.positions, b.base.positions)
  const w = transferWeights(t.base.positions, b.base, align)
  const joints = fitJoints({ positions: t.base.positions, joints: w.joints, weights: w.weights, skin: t.base.skin }, b.base, { bones: b.file.bones, rest: b.file.rest }, align)
  const errors = MAJOR.map((j) => Math.hypot(...[0, 1, 2].map((k) => joints[j][k] - t.file.rest[j][k])))
  // the bone each skin vertex follows most, transferred against the target's own
  let agree = 0
  let n = 0
  const top = (joints: ArrayLike<number>, weights: ArrayLike<number>, bones: readonly string[], i: number) => {
    let best = 0
    for (let k = 1; k < 4; k++) if (weights[i * 4 + k] > weights[i * 4 + best]) best = k
    return bones[joints[i * 4 + best]]
  }
  for (let i = 0; i < t.base.positions.length / 3; i++) {
    if (!t.base.skin[i]) continue
    n++
    if (top(w.joints, w.weights, b.file.bones, i) === top(t.base.joints, t.base.weights, t.file.bones, i)) agree++
  }
  return { joints, errors, agree: agree / n, height: t.file.rest.Head[1] }
}

describe('the skeleton fits a new body (§9.5)', () => {
  it('refits a body from itself exactly', async () => {
    const r = await refit('m-medium', 'm-medium')
    expect(Math.max(...r.errors)).toBeLessThan(1e-4)
    expect(r.agree).toBe(1)
  })

  it.each([
    ['m-medium', 'm-huge'],
    ['m-medium', 'm-tiny'],
    ['f-medium', 'f-colossal'],
    ['f-medium', 'f-small'],
    ['m-medium', 'f-medium'],
  ])('refits the shipped %s → %s joints from its mesh alone', async (from, target) => {
    const r = await refit(from, target)
    const mean = r.errors.reduce((s, e) => s + e, 0) / r.errors.length
    // within 4% of the body's height at any joint, and 2% on average
    expect(Math.max(...r.errors)).toBeLessThan(0.04 * r.height * 1.15)
    expect(mean).toBeLessThan(0.02 * r.height * 1.15)
    expect(r.agree).toBeGreaterThan(0.72)
    // the hierarchy reads the same way up: knee under hip, hand past elbow
    expect(r.joints.LeftLeg[1]).toBeLessThan(r.joints.LeftUpLeg[1])
    expect(r.joints.LeftHand[0]).toBeGreaterThan(r.joints.LeftForeArm[0])
  }, 60000)
})
