import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { animClip, fitClip, restPose } from './anim-library.js'

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
