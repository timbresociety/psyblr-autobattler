import * as THREE from 'three'
import type { Vec3 } from '../engine/maths'

/**
 * The two cameras (U17, R13, R42, KTD16): a free camera that flies anywhere for watching, and an over-the-shoulder
 * camera behind and right of the controlled hero, reticle at screen centre. Switching blends over half a second, and
 * walls pull the camera in rather than letting it clip inside scenery.
 */

export const HERO_CAMERA = { back: 4.2, right: 1.1, up: 1.9, pitchLimit: 1.2 }
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
  readonly free = new THREE.Vector3(0, 13, -27)
  private blend = 1
  private from = new THREE.Vector3()
  private fromQ = new THREE.Quaternion()
  mode: 'free' | 'hero' = 'free'

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

  /** The free camera flies along its own view (WASD, Space up, Z down). */
  fly(dt: number, f: number, r: number, u: number) {
    const speed = 18 * dt
    const fwd = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
    this.free.addScaledVector(fwd, f * speed).addScaledVector(right, r * speed).y += u * speed
    this.free.y = Math.max(1, Math.min(40, this.free.y))
  }

  update(dt: number, hero: Vec3 | undefined, proxies: THREE.Box3[]) {
    const target = new THREE.Vector3()
    const forward = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    if (this.mode === 'hero' && hero) {
      const pivot = new THREE.Vector3(hero.x, hero.y + HERO_CAMERA.up, hero.z)
      const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
      const desired = pivot.clone().addScaledVector(forward, -HERO_CAMERA.back).addScaledVector(right, HERO_CAMERA.right)
      target.copy(pullIn(pivot, desired, proxies))
    } else target.copy(this.free)
    const look = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(target, target.clone().add(forward), new THREE.Vector3(0, 1, 0)))
    this.blend = Math.min(1, this.blend + dt / BLEND_SECONDS)
    const k = this.blend * this.blend * (3 - 2 * this.blend)
    this.camera.position.lerpVectors(this.from, target, k)
    this.camera.quaternion.slerpQuaternions(this.fromQ, look, k)
  }
}
