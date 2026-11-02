import * as THREE from 'three'
import type { Vec3 } from '../engine/maths.js'

/**
 * The two cameras (U17, R13, R42, KTD16): a watching camera that works like a strategy game's (drag to turn around
 * what it looks at, right drag or WASD to slide, the wheel to zoom, click a hero to follow it), and an
 * over-the-shoulder camera behind and right of the controlled hero, reticle at screen centre. Switching blends over
 * half a second, and walls pull the camera in rather than letting it clip inside scenery.
 */

export const HERO_CAMERA = { back: 4.2, right: 1.1, up: 1.9, pitchLimit: 1.2, eyes: 1.62, ahead: 0.12 }
/** How fast the camera goes to first person and back, in whole zooms a second. */
const SCOPE_SPEED = 6
/** Past this much of the zoom, the hero's own body hides so the camera sees out of its eyes. */
export const FIRST_PERSON = 0.6
/** The watching camera's limits: how low, high and far it goes, how steep it tilts, and the edge of the map. */
export const WATCH = { minHeight: 1.5, maxHeight: 70, minDistance: 5, maxDistance: 95, levelDistance: 20, minPitch: -1.4, maxPitch: 0.15, bounds: 72 }
export const BLEND_SECONDS = 0.5

/** Where a camera at `from` can sit on the way to `to` without passing through a box. */
export function pullIn(from: THREE.Vector3, to: THREE.Vector3, proxies: THREE.Box3[]): THREE.Vector3 {
  const dir = to.clone().sub(from)
  const length = dir.length()
  if (length === 0) return to.clone()
  const ray = new THREE.Ray(from, dir.normalize())
  let nearest = length
  const hit = new THREE.Vector3()
  for (const box of proxies) if (ray.intersectBox(box, hit)) nearest = Math.min(nearest, hit.distanceTo(from) - 0.3)
  return from.clone().add(ray.direction.multiplyScalar(Math.max(0.5, nearest)))
}

export class Cameras {
  yaw = 0
  // a low, close opening view sells the ruins and the fighters; the streamer flies out from here
  pitch = -0.32
  readonly free = new THREE.Vector3(0, 12, -21)
  private blend = 1
  private from = new THREE.Vector3()
  private fromQ = new THREE.Quaternion()
  mode: 'free' | 'hero' = 'free'
  /** The hero the watching camera follows (a click on a hero or its portrait); panning ends it. */
  follow: number | undefined
  /**
   * First person (the canon: the right button held zooms in): `scoping` while it's held, and `scope` how far the
   * camera has gone from over the shoulder to the hero's eyes, 0 to 1. The hero's own body hides past FIRST_PERSON.
   */
  scoping = false
  scope = 0

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.free)
  }

  /** Switch view, blending from wherever the camera is now. */
  set(mode: 'free' | 'hero') {
    if (mode === this.mode) return
    this.mode = mode
    this.from.copy(this.camera.position)
    this.fromQ.copy(this.camera.quaternion)
    this.blend = 0
    if (mode === 'free') this.free.copy(this.camera.position)
  }

  /** Blend progress 0-1; 1 once settled. */
  progress() {
    return this.blend
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0025
    this.pitch = Math.max(-HERO_CAMERA.pitchLimit, Math.min(HERO_CAMERA.pitchLimit, this.pitch - dy * 0.0025))
  }

  private forward() {
    return new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
  }

  /**
   * What the watching camera turns around and zooms toward: where its view meets the floor, or a point straight ahead
   * when it looks level.
   */
  pivot(): THREE.Vector3 {
    const f = this.forward()
    const t = f.y < -0.08 ? Math.min(WATCH.maxDistance, -this.free.y / f.y) : WATCH.levelDistance
    return this.free.clone().addScaledVector(f, t)
  }

  /** Watching: slide across the ground in screen directions (WASD, right drag); Space and Z rise and sink. Ends a follow. */
  fly(dt: number, f: number, r: number, u: number) {
    // higher up, the same key covers more ground, the way a strategy camera feels
    const speed = (10 + this.free.y * 0.9) * dt
    this.pan(r * speed, f * speed)
    this.free.y = Math.max(WATCH.minHeight, Math.min(WATCH.maxHeight, this.free.y + u * speed))
  }

  /** Watching: move the camera and what it looks at together, along the ground. */
  pan(right: number, forward: number) {
    if (right === 0 && forward === 0) return
    const flat = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    const side = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
    this.free.addScaledVector(side, right).addScaledVector(flat, forward)
    this.free.x = Math.max(-WATCH.bounds, Math.min(WATCH.bounds, this.free.x))
    this.free.z = Math.max(-WATCH.bounds, Math.min(WATCH.bounds, this.free.z))
    this.follow = undefined
  }

  /** Watching: turn around the point being looked at (left drag, Q and E). */
  orbit(dx: number, dy: number) {
    const pivot = this.pivot()
    const distance = this.free.distanceTo(pivot)
    this.yaw -= dx * 0.005
    this.pitch = Math.max(WATCH.minPitch, Math.min(WATCH.maxPitch, this.pitch - dy * 0.004))
    this.free.copy(pivot).addScaledVector(this.forward(), -distance)
    this.free.y = Math.max(WATCH.minHeight, this.free.y)
  }

  /** Watching: move in toward the point being looked at, or back out (the wheel). */
  zoom(factor: number) {
    const pivot = this.pivot()
    const distance = Math.max(WATCH.minDistance, Math.min(WATCH.maxDistance, this.free.distanceTo(pivot) * factor))
    this.free.copy(pivot).addScaledVector(this.forward(), -distance)
    this.free.y = Math.max(WATCH.minHeight, Math.min(WATCH.maxHeight, this.free.y))
  }

  /**
   * `hero` is the controlled hero, `followed` the hero the watching camera keeps in view (its drawn position), if any.
   */
  update(dt: number, hero: Vec3 | undefined, proxies: THREE.Box3[], followed?: Vec3) {
    if (this.mode === 'free' && followed) {
      // keep the same angle and distance, and glide the point being looked at onto the followed hero
      const pivot = this.pivot()
      const k = 1 - Math.exp(-dt * 5)
      this.free.x += (followed.x - pivot.x) * k
      this.free.z += (followed.z - pivot.z) * k
    }
    const target = new THREE.Vector3()
    const forward = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    const toward = this.mode === 'hero' && this.scoping ? 1 : 0
    this.scope += Math.sign(toward - this.scope) * Math.min(Math.abs(toward - this.scope), dt * SCOPE_SPEED)
    if (this.mode === 'hero' && hero) {
      const s = this.scope * this.scope * (3 - 2 * this.scope)
      const pivot = new THREE.Vector3(hero.x, hero.y + HERO_CAMERA.up + (HERO_CAMERA.eyes - HERO_CAMERA.up) * s, hero.z)
      const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
      const desired = pivot.clone().addScaledVector(forward, -HERO_CAMERA.back * (1 - s) + HERO_CAMERA.ahead * s).addScaledVector(right, HERO_CAMERA.right * (1 - s))
      target.copy(pullIn(pivot, desired, proxies))
    } else target.copy(this.free)
    const look = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(target, target.clone().add(forward), new THREE.Vector3(0, 1, 0)))
    this.blend = Math.min(1, this.blend + dt / BLEND_SECONDS)
    const k = this.blend * this.blend * (3 - 2 * this.blend)
    this.camera.position.lerpVectors(this.from, target, k)
    this.camera.quaternion.slerpQuaternions(this.fromQ, look, k)
  }
}
