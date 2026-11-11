import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { animClip, fitClip, groundClip, restPose } from './anim-library.js'
import { applyAttitude } from './metarig/attitude.js'

const sets = { idle: { idle: 1 / 24 }, fidget: {}, move: {}, dance: {}, talk: {} }
const INDEX = {
  version: 1,
  fps: 24,
  bones: ['hips', 'spine'],
  rot: 10000,
  pos: 1000,
  genders: { m: { rest: [[0, 0, 0, 1], [0, 0, 0, 1]], hips: [0, 1, 0], sets }, f: { rest: [[0, 0, 0, 1], [0, 0, 0, 1]], hips: [0, 0.9, 0], sets } },
}
// two frames, track-major changes from frame to frame: the hips turn a quarter about +y and step 10 cm along +x
const IDLE = {
  frames: 2,
  from: 'test',
  rot: [0, 0, 0, 7071, 0, 0, 10000, -2929, 0, 0, 0, 0, 0, 0, 10000, 0],
  pos: [0, 100, 1000, 0, 0, 0],
}
const fetched: string[] = []

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url)
    const body = url === '/anim/index.json' ? INDEX : url === '/anim/m/idle.json' ? IDLE : undefined
    return { ok: !!body, status: body ? 200 : 404, json: async () => body }
  })
})
afterAll(() => vi.unstubAllGlobals())

const track = (clip: THREE.AnimationClip, name: string) => Array.from(clip.tracks.find((t) => t.name === name)!.values)

describe('the motion library', () => {
  it('unpacks a clip: each bone’s rotations and the hips’ travel, frame by frame, at the library’s rate', async () => {
    const clip = (await animClip('m', 'idle'))!
    expect(clip.duration).toBeCloseTo(1 / 24)
    expect(track(clip, 'hips.quaternion').map((v) => +v.toFixed(3))).toEqual([0, 0, 0, 1, 0, 0.707, 0, 0.707])
    expect(track(clip, 'spine.quaternion')).toEqual([0, 0, 0, 1, 0, 0, 0, 1])
    expect(track(clip, 'hips.position').map((v) => +v.toFixed(3))).toEqual([0, 1, 0, 0.1, 1, 0])
    expect(await animClip('m', 'idle')).toBe(clip)
  })

  it('fetches nothing for a clip the index hasn’t got', async () => {
    expect(await animClip('m', 'moonwalk')).toBeUndefined()
    expect(fetched.filter((u) => u.includes('moonwalk'))).toEqual([])
  })

  it('fits a clip to another body: each bone’s change from rest on that body’s rest, the hips’ travel to its height', async () => {
    const clip = (await animClip('m', 'idle'))!
    const tilted = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2)
    const rest = { rotations: new Map([['hips', tilted], ['spine', new THREE.Quaternion()]]), hips: new THREE.Vector3(0, 1.2, 0) }
    const big = fitClip(clip, 'm', 'm-large', rest)
    const hips = track(big, 'hips.quaternion')
    // the first frame is the reference's rest, so it lands on this body's rest
    expect(new THREE.Quaternion().fromArray(hips, 0).angleTo(tilted)).toBeLessThan(1e-4)
    // the second turns a quarter from it, about the hips' own +y
    const turned = tilted.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2))
    expect(new THREE.Quaternion().fromArray(hips, 4).angleTo(turned)).toBeLessThan(1e-3)
    expect(track(big, 'hips.position').map((v) => +v.toFixed(3))).toEqual([0, 1.2, 0, 0.12, 1.2, 0])
    expect(fitClip(clip, 'm', 'm-large', rest)).toBe(big)
    // every body plays its own fit, the medium one too (its posture and proportions are its own); the same rest is fitted once
    expect(fitClip(clip, 'm', 'm-medium', rest)).toBe(big)
    expect(fitClip(clip, 'm', 'm-medium', { ...rest })).not.toBe(clip)
  })

  it('reads a model’s rest pose, or none when a bone is missing', () => {
    const model = new THREE.Group()
    const hips = new THREE.Bone()
    hips.name = 'hips'
    hips.position.set(0, 0.95, 0)
    const spine = new THREE.Bone()
    spine.name = 'spine'
    spine.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.1)
    model.add(hips)
    hips.add(spine)
    const rest = restPose(model, ['hips', 'spine'])!
    expect(rest.hips.y).toBeCloseTo(0.95)
    expect(rest.rotations.get('spine')!.equals(spine.quaternion)).toBe(true)
    expect(rest.rotations.get('spine')).not.toBe(spine.quaternion)
    expect(restPose(model, ['hips', 'head'])).toBeUndefined()
  })
})

describe('an attitude\u2019s bent legs kept on the floor (2026-11-11)', () => {
  const LEG = ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'] as const
  /** A hips and one leg standing a metre tall, the toes ahead. */
  const body = () => {
    const root = new THREE.Group()
    const at: Record<string, [number, number, number]> = { Hips: [0, 1, 0], LeftUpLeg: [0.1, -0.05, 0], LeftLeg: [0, -0.45, 0], LeftFoot: [0, -0.45, 0], LeftToeBase: [0, -0.05, 0.12] }
    let parent: THREE.Object3D = root
    for (const name of LEG) {
      const bone = new THREE.Bone()
      bone.name = name
      bone.position.set(...at[name])
      parent.add(bone)
      parent = bone
    }
    return root
  }
  const lowest = (model: THREE.Object3D) => {
    model.updateMatrixWorld(true)
    return Math.min(...['LeftFoot', 'LeftToeBase'].map((n) => model.getObjectByName(n)!.getWorldPosition(new THREE.Vector3()).y))
  }
  // a crouch on the plain body: the thigh forward, the shin back, the hips down
  const bend = (name: string, d: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (d * Math.PI) / 180)
  const plain = new THREE.AnimationClip('crouch', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0, 0.8, 0]),
    new THREE.QuaternionKeyframeTrack('LeftUpLeg.quaternion', [0, 1], [0, 0, 0, 1, ...bend('LeftUpLeg', -50).toArray()]),
    new THREE.QuaternionKeyframeTrack('LeftLeg.quaternion', [0, 1], [0, 0, 0, 1, ...bend('LeftLeg', 90).toArray()]),
    new THREE.QuaternionKeyframeTrack('LeftFoot.quaternion', [0, 1], [0, 0, 0, 1, ...bend('LeftFoot', -40).toArray()]),
  ])

  it('lowers the hips each frame by as much as the bend lifts the feet, there and in a crouch alike', () => {
    const neutral = body()
    const low = body()
    applyAttitude(low, 'low')
    const turns = low.userData.attitudeTurns as Record<string, number[]>
    expect(Object.keys(turns)).toEqual(expect.arrayContaining(['LeftUpLeg', 'LeftLeg', 'LeftFoot']))
    const rest = restPose(low, [...LEG])!
    expect(rest.ground).toBeDefined()
    expect(rest.plain!.rotations.get('LeftLeg')!.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
    // the clip as fitting puts it on the low body: each leg key with the attitude's turn in front
    const onLow = new THREE.AnimationClip('crouch', 1, plain.tracks.map((t) => {
      const turn = turns[t.name.split('.')[0]]
      if (!turn || !t.name.endsWith('quaternion')) return t
      const v = Float32Array.from(t.values)
      for (let i = 0; i < v.length; i += 4) new THREE.Quaternion().fromArray(v, i).premultiply(new THREE.Quaternion().fromArray(turn)).toArray(v, i)
      return new THREE.QuaternionKeyframeTrack(t.name, Array.from(t.times), Array.from(v))
    }))
    const grounded = groundClip(onLow, rest.ground!)
    const a = new THREE.AnimationMixer(neutral).clipAction(plain).play()
    const b = new THREE.AnimationMixer(low).clipAction(grounded).play()
    let lifted = 0
    // at the hips' keys (a library clip keys every frame; between two keys a second apart the bend's lift isn't linear)
    for (const time of [0, 1]) {
      for (const action of [a, b]) {
        action.time = time
        action.getMixer().update(0)
      }
      expect(lowest(low)).toBeCloseTo(lowest(neutral), 4)
      // ungrounded, the bend would have lifted the feet, more in the crouch than standing
      b.stop()
      const raw = new THREE.AnimationMixer(low).clipAction(onLow).play()
      raw.time = time
      raw.getMixer().update(0)
      lifted = Math.max(lifted, lowest(low) - lowest(neutral))
      raw.stop()
      b.play()
    }
    expect(lifted).toBeGreaterThan(0.02)
  })
})
