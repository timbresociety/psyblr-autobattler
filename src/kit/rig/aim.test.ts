import { Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { AIM_SHARES, aimChain, aimLinks, gripWeight, yawPitch } from './aim.js'
import { limitExcess } from './limits.js'

const UP = new Vector3(0, 1, 0)
const FACING = new Vector3(0, 0, 1)
const DEG = Math.PI / 180

/** A straight back on its hips: Spine, Spine1, Spine2, Neck, Head, each 12 cm above the last, all at rest. */
function back() {
  const hips = new Object3D()
  let parent = hips
  const bones = new Map<string, Object3D>()
  for (const name of ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head']) {
    const b = new Object3D()
    b.name = name
    b.position.set(0, 0.12, 0)
    parent.add(b)
    bones.set(name, b)
    parent = b
  }
  hips.updateMatrixWorld(true)
  return { hips, bones, links: aimLinks((n) => bones.get(n), AIM_SHARES) }
}

const toward = (yaw: number, pitch: number) => new Vector3(Math.sin(yaw * DEG) * Math.cos(pitch * DEG), Math.sin(pitch * DEG), Math.cos(yaw * DEG) * Math.cos(pitch * DEG))
const turnOf = (b: Object3D) => (2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w)))) / DEG

describe('aim and look IK across the spine and neck (§9.6 fix-ups)', () => {
  it('reads left-right and up-down the right way round', () => {
    const r = yawPitch(FACING, toward(30, 10), UP)
    expect(r.yaw / DEG).toBeCloseTo(30, 3)
    expect(r.pitch / DEG).toBeCloseTo(10, 3)
  })

  it('reaches a target the chain can take, spread so no joint takes it all, inside every limit', () => {
    const { bones, links } = back()
    const left = aimChain(links, FACING, toward(60, 20), UP)
    expect(left).toBeLessThan(1)
    for (const l of links) {
      expect(limitExcess(l.name, new Quaternion().copy(l.rest).invert().multiply(l.bone.quaternion)), l.name).toBe(0)
      expect(turnOf(l.bone), l.name).toBeLessThan(l.yaw + l.pitch + 1)
    }
    // the back takes some of it, the neck and head the most
    expect(turnOf(bones.get('Spine')!)).toBeGreaterThan(3)
    expect(turnOf(bones.get('Neck')!)).toBeGreaterThan(turnOf(bones.get('Spine')!))
  })

  it('leaves what is past the whole chain over, without breaking a joint', () => {
    const { links } = back()
    const left = aimChain(links, FACING, toward(170, 0), UP)
    const reach = links.reduce((s, l) => s + l.yaw, 0)
    expect(left).toBeGreaterThan(170 - reach - 2)
    for (const l of links) expect(limitExcess(l.name, new Quaternion().copy(l.rest).invert().multiply(l.bone.quaternion)), l.name).toBe(0)
  })

  it('moves nothing at no weight, and part way at half', () => {
    const { links } = back()
    expect(aimChain(links, FACING, toward(40, 0), UP, 0)).toBeCloseTo(40, 3)
    for (const l of links) expect(turnOf(l.bone)).toBeLessThan(1e-3)
    const half = back()
    const left = aimChain(half.links, FACING, toward(40, 0), UP, 0.5)
    expect(left).toBeGreaterThan(5)
    expect(left).toBeLessThan(35)
  })
})

describe('two-hand grip (§9.6 fix-ups)', () => {
  it('takes the grip when the clip brings the off hand near it, and lets a one-handed clip be', () => {
    expect(gripWeight(0.05)).toBe(1)
    expect(gripWeight(0.12)).toBe(1)
    expect(gripWeight(0.3)).toBe(0)
    expect(gripWeight(0.6)).toBe(0)
    for (let d = 0; d < 0.4; d += 0.01) expect(gripWeight(d + 0.01)).toBeLessThanOrEqual(gripWeight(d))
    // a smaller hero's hands are nearer to start with
    expect(gripWeight(0.2, 1.2)).toBeLessThan(gripWeight(0.2, 1.8))
  })
})
