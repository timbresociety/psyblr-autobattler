import { readdirSync, readFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { clampToLimits, JOINT_LIMITS, limitExcess } from './limits.js'
import { ALL_BONES, bodyDirection, CLIP_BONES, HELPER_BONES, IK_TARGETS, METARIG_BONES, metaBone, MUSCLE_REGIONS, SOCKETS } from './metarig.js'
import { bone, KEYED_BONES, mirrored } from './standard.js'
import { fromSwingTwist, swingTwist } from './swing-twist.js'

const ANIM = new URL('../../../public/anim/standard/', import.meta.url)
const index = JSON.parse(readFileSync(new URL('index.json', ANIM), 'utf8')) as { bones: string[]; rot: number; genders: Record<string, { rest: number[][] }> }

/** A random rotation, the same ones every run. */
function rotations(n: number): Quaternion[] {
  let s = 7
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1
  return Array.from({ length: n }, () => new Quaternion(r(), r(), r(), r()).normalize())
}

describe('swing-twist', () => {
  it('splits a turn into a twist about the bone and a swing across it, and back again', () => {
    for (const q of rotations(500)) {
      const st = swingTwist(q)
      const back = fromSwingTwist(st)
      expect(Math.abs(back.dot(q)), JSON.stringify(st)).toBeGreaterThan(0.99999)
    }
  })

  it('reads a pure twist as twist and a pure swing as swing, in degrees', () => {
    const twist = swingTwist(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (40 * Math.PI) / 180))
    expect(twist.twist).toBeCloseTo(40, 5)
    expect(Math.hypot(twist.x, twist.z)).toBeCloseTo(0, 5)
    const bend = swingTwist(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (-120 * Math.PI) / 180))
    expect(bend.x).toBeCloseTo(-120, 4)
    expect(bend.z).toBeCloseTo(0, 4)
    expect(bend.twist).toBeCloseTo(0, 4)
  })
})

describe('joint limits (§9.2)', () => {
  it('limits every keyed joint but the hips and eyes, on three axes', () => {
    for (const name of KEYED_BONES) {
      if (name === 'Hips' || name.endsWith('Eye') || name === 'Jaw') continue
      const l = JOINT_LIMITS[name]
      expect(l, name).toBeDefined()
      for (const axis of ['twist', 'x', 'z'] as const) expect(l[axis][0], `${name} ${axis}`).toBeLessThan(l[axis][1])
    }
  })

  it('mirrors left and right: the same x, twist and z the other way round', () => {
    for (const [name, l] of Object.entries(JOINT_LIMITS)) {
      const r = JOINT_LIMITS[mirrored(name)]
      if (mirrored(name) === name) continue
      expect(r.x).toEqual(l.x)
      expect(r.twist).toEqual([-l.twist[1], -l.twist[0]])
      expect(r.z).toEqual([-l.z[1], -l.z[0]])
    }
  })

  it('reads anatomy the right way round: a knee bends one way only', () => {
    const knee = JOINT_LIMITS.LeftLeg
    expect(knee.x[0]).toBeLessThan(-140)
    expect(knee.x[1]).toBeLessThanOrEqual(20)
    const back = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (60 * Math.PI) / 180)
    expect(limitExcess('LeftLeg', back)).toBeGreaterThan(30)
  })

  it('clamps a turn inside the limit, and leaves one inside alone', () => {
    for (const q of rotations(200)) {
      const c = q.clone()
      clampToLimits('LeftForeArm', c)
      expect(limitExcess('LeftForeArm', c)).toBeLessThan(1e-3)
      const again = c.clone()
      expect(clampToLimits('LeftForeArm', again)).toBe(false)
      expect(again.dot(c)).toBeCloseTo(1, 6)
    }
  })

  it('no clip in the library breaks a limit', () => {
    let frames = 0
    const broken: string[] = []
    for (const g of Object.keys(index.genders)) {
      const rest = index.genders[g].rest.map((r) => new Quaternion().fromArray(r).invert())
      for (const file of readdirSync(new URL(`${g}/`, ANIM))) {
        const clip = JSON.parse(readFileSync(new URL(`${g}/${file}`, ANIM), 'utf8')) as { frames: number; rot: number[] }
        const n = clip.frames
        const tracks = clip.rot.length / (n * 4)
        const at = new Int32Array(tracks * 4)
        const q = new Quaternion()
        for (let f = 0; f < n; f++) {
          for (let k = 0; k < tracks; k++) {
            for (let c = 0; c < 4; c++) at[k * 4 + c] += clip.rot[(k * 4 + c) * n + f]
            q.set(at[k * 4] / index.rot, at[k * 4 + 1] / index.rot, at[k * 4 + 2] / index.rot, at[k * 4 + 3] / index.rot).normalize()
            const excess = limitExcess(index.bones[k], rest[k].clone().multiply(q))
            if (excess > 0) broken.push(`${g}/${file} ${index.bones[k]} frame ${f}: ${excess.toFixed(1)}°`)
          }
          frames++
        }
      }
    }
    expect(frames).toBeGreaterThan(10000)
    expect(broken.slice(0, 10)).toEqual([])
  })
})

describe('the metarig contract (§9.2)', () => {
  it('names every bone once and parents each on a bone that comes before it', () => {
    expect(new Set(ALL_BONES).size).toBe(ALL_BONES.length)
    const seen = new Set<string>(ALL_BONES.slice(0, ALL_BONES.length - METARIG_BONES.length))
    for (const b of METARIG_BONES) {
      if (b.kind === 'root') expect(b.parent).toBe('')
      else expect(seen.has(b.parent), `${b.name} on ${b.parent}`).toBe(true)
      seen.add(b.name)
    }
  })

  it('adds bones that clips never key', () => {
    for (const b of METARIG_BONES) expect(CLIP_BONES.has(b.name), b.name).toBe(false)
    for (const name of index.bones) expect(metaBone(name)).toBeUndefined()
  })

  it('has every kind §9.2 lists: root, neck, ten muscles and six correctives a side, jiggle, sockets, IK', () => {
    const count = (kind: string) => METARIG_BONES.filter((b) => b.kind === kind).length
    expect(count('root')).toBe(1)
    expect(count('neck')).toBe(1)
    expect(count('muscle')).toBe(20)
    expect(count('corrective')).toBe(12)
    expect(count('jiggle')).toBe(5)
    expect(count('socket')).toBe(SOCKETS.length)
    expect(count('ik')).toBe(IK_TARGETS.length)
    for (const name of ['Trapezius', 'Deltoid', 'Pectoral', 'Latissimus', 'Biceps', 'Triceps', 'Forearm', 'Glute', 'Quad', 'Calf']) expect(metaBone(`Left${name}Muscle`)).toBeDefined()
    for (const name of ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Knee', 'Ankle']) expect(metaBone(`Right${name}Corrective`)).toBeDefined()
    for (const s of ['muzzle', 'weapon_tip', 'hips', 'back', 'hand_l', 'hand_r']) expect(metaBone(`socket:${s}`)).toBeDefined()
  })

  it('drives each helper from a limited joint, places it between real bones and gives it skin to move', () => {
    for (const b of HELPER_BONES) {
      expect(b.region?.bones.length, b.name).toBeGreaterThan(0)
      for (const r of b.region!.bones) expect(bone(r), `${b.name} region ${r}`).toBeDefined()
      if (b.kind === 'jiggle') continue
      expect(JOINT_LIMITS[b.driver!.joint], b.name).toBeDefined()
      expect(bone(b.place!.from)).toBeDefined()
      expect(bone(b.place!.to)).toBeDefined()
      if (b.kind === 'muscle') expect(MUSCLE_REGIONS).toContain(b.dial)
    }
  })

  it('pairs every left helper with a right one', () => {
    for (const b of METARIG_BONES.filter((b) => b.side === 'Left')) {
      const r = metaBone(mirrored(b.name))
      expect(r?.side, b.name).toBe('Right')
      expect(r?.dial).toBe(b.dial)
    }
  })

  it('turns outward to +x on the left and -x on the right', () => {
    expect(bodyDirection([0, 1, 0], 'Left')).toEqual([1, 0, 0])
    expect(bodyDirection([0, 1, 0], 'Right')).toEqual([-1, 0, 0])
    expect(bodyDirection([1, 0, 0], 'Right')).toEqual([-0, 0, 1])
  })
})
