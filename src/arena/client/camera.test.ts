import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Cameras, FOLLOW_CAMERA, HERO_CAMERA, HERO_FOLLOW } from './camera.js'
import { ALL_SIZE_CLASSES, SIZES } from '../../charter/sizes.js'
import { ENGINE } from '../engine/calibration.js'

/** The shoulder camera through a full jump at `fps`, drawn every frame: the hero's height and the camera's over its rest. */
function jump(fps: number) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100)
  const cameras = new Cameras(camera)
  cameras.set('hero')
  cameras.pitch = 0
  const dt = 1 / fps
  // settle the blend first, standing
  for (let i = 0; i < fps; i++) cameras.update(dt, { x: 0, y: 0, z: 0 }, [])
  const rest = camera.position.y
  const g = ENGINE.move.gravity
  const v0 = Math.sqrt(2 * g * ENGINE.move.jump)
  const flight = (2 * v0) / g
  const rows: { t: number; hero: number; camera: number }[] = []
  for (let t = 0; t <= flight + 0.5; t += dt) {
    const y = t < flight ? Math.max(0, v0 * t - 0.5 * g * t * t) : 0
    cameras.update(dt, { x: 0, y, z: 0 }, [])
    rows.push({ t, hero: y, camera: camera.position.y - rest })
  }
  return { rows, flight }
}

describe('the shoulder camera through a jump', () => {
  it('eases after the hero up and down, never further behind than its lag', () => {
    const { rows } = jump(60)
    const behind = rows.map((r) => r.hero - r.camera)
    expect(Math.max(...behind)).toBeGreaterThan(0.5)
    expect(Math.max(...behind)).toBeLessThanOrEqual(HERO_FOLLOW.rise + 1e-6)
    // it trails a fall by less, so the hero stays off the bottom of the frame
    expect(Math.min(...behind)).toBeGreaterThanOrEqual(-HERO_FOLLOW.fall - 1e-6)
    expect(Math.min(...behind)).toBeLessThan(-0.2)
  })

  it('settles on the hero again after the landing, without a step', () => {
    const { rows, flight } = jump(60)
    const after = rows.filter((r) => r.t > flight)
    // the frame after touchdown the view is still coming down: no jump to the floor in one frame
    expect(after[1].camera).toBeGreaterThan(0.1)
    const steps = after.slice(1).map((r, i) => Math.abs(r.camera - after[i].camera))
    expect(Math.max(...steps)).toBeLessThan(0.35)
    expect(Math.abs(after[after.length - 1].camera)).toBeLessThan(0.01)
  })

  it('is where it is at 30, 60 and 120 frames a second alike', () => {
    const at = (fps: number, t: number) => jump(fps).rows.reduce((best, r) => (Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best)).camera
    for (const t of [0.2, 0.5, 0.9]) {
      expect(at(30, t)).toBeCloseTo(at(60, t), 0)
      expect(at(120, t)).toBeCloseTo(at(60, t), 0)
    }
  })

  it('stays fixed to the hero across the floor, so aim and strafe answer at once', () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100)
    const cameras = new Cameras(camera)
    cameras.set('hero')
    for (let i = 0; i < 60; i++) cameras.update(1 / 60, { x: 0, y: 0, z: 0 }, [])
    const before = camera.position.clone()
    cameras.update(1 / 60, { x: 3, y: 0, z: 2 }, [])
    expect(camera.position.x - before.x).toBeCloseTo(3)
    expect(camera.position.z - before.z).toBeCloseTo(2)
    expect(HERO_CAMERA.back).toBeGreaterThan(0)
  })
})

/**
 * Where a hero of `scale` stands in the settled shoulder camera's view, as shares of the screen (-1 to 1, right and
 * up): the top of its head, its feet and its right shoulder, on a body in a medium one's proportions.
 */
function framing(scale: number) {
  const camera = new THREE.PerspectiveCamera(HERO_CAMERA.fov, 16 / 9, 0.1, 100)
  const cameras = new Cameras(camera)
  cameras.set('hero')
  cameras.yaw = 0
  cameras.pitch = 0
  for (let i = 0; i < 90; i++) cameras.update(1 / 60, { x: 0, y: 0, z: 0 }, [], undefined, undefined, undefined, { eyes: HERO_CAMERA.eyes * scale, scale })
  camera.updateMatrixWorld(true)
  const on = (x: number, y: number) => new THREE.Vector3(x * scale, y * scale, 0).project(camera)
  // the camera looks along +z, so its right is the world's -x
  return { head: on(0, 1.75), feet: on(0, 0), shoulder: on(-0.22, 1.45), back: -camera.position.z, tooClose: cameras.tooClose() }
}

describe("the shoulder camera on a hero of any size", () => {
  it('frames every size as it frames a medium hero: as many of its own heights behind, beside and above', () => {
    const medium = framing(1)
    expect(medium.back).toBeCloseTo(HERO_CAMERA.back, 5)
    for (const size of ALL_SIZE_CLASSES) {
      const f = framing(SIZES[size].scale)
      expect(f.back, size).toBeCloseTo(HERO_CAMERA.back * SIZES[size].scale, 5)
      for (const part of ['head', 'feet', 'shoulder'] as const) {
        expect(f[part].x, `${size} ${part}`).toBeCloseTo(medium[part].x, 5)
        expect(f[part].y, `${size} ${part}`).toBeCloseTo(medium[part].y, 5)
      }
      expect(f.tooClose, size).toBe(false)
    }
  })

  it('eases out as the hero grows (a form), rather than jumping', () => {
    const camera = new THREE.PerspectiveCamera(HERO_CAMERA.fov, 16 / 9, 0.1, 100)
    const cameras = new Cameras(camera)
    cameras.set('hero')
    cameras.yaw = 0
    cameras.pitch = 0
    const step = (scale: number) => cameras.update(1 / 60, { x: 0, y: 0, z: 0 }, [], undefined, undefined, undefined, { eyes: HERO_CAMERA.eyes * scale, scale })
    for (let i = 0; i < 90; i++) step(1)
    step(1.6)
    expect(-camera.position.z).toBeLessThan(HERO_CAMERA.back * 1.1)
    for (let i = 0; i < 180; i++) step(1.6)
    expect(-camera.position.z).toBeCloseTo(HERO_CAMERA.back * 1.6, 1)
  })

  it('follows a watched hero from as many of its heights too', () => {
    const at = (scale: number) => {
      const camera = new THREE.PerspectiveCamera(HERO_CAMERA.fov, 16 / 9, 0.1, 100)
      const cameras = new Cameras(camera)
      cameras.follow = 0
      cameras.yaw = 0
      cameras.pitch = 0
      for (let i = 0; i < 90; i++) cameras.update(1 / 60, undefined, [], { x: 0, y: 0, z: 0 }, 0, undefined, undefined, scale)
      return camera.position.clone()
    }
    const medium = at(1)
    const colossal = at(1.6)
    expect(medium.y).toBeCloseTo(FOLLOW_CAMERA.up, 5)
    expect(colossal.x).toBeCloseTo(medium.x * 1.6, 5)
    expect(colossal.y).toBeCloseTo(medium.y * 1.6, 5)
    expect(colossal.z).toBeCloseTo(medium.z * 1.6, 5)
  })
})
