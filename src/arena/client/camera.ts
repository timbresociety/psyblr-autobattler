import * as THREE from 'three'
import type { Vec3 } from '../engine/maths.js'

/**
 * The two cameras (U17, R13, R42, KTD16): a watching camera that works like a strategy game's (drag to turn around
 * what it looks at, right drag or WASD to slide, the wheel to zoom), and an over-the-shoulder camera behind and right
 * of the controlled hero, reticle at screen centre. A hero clicked while watching is followed from behind its shoulder
 * too, turning with it; a drag looks around it and the wheel moves in or out, and sliding the camera lets it go.
 * Switching blends over half a second. Walls pull the camera in at once rather than let it clip inside scenery, and it
 * eases back out, so a wall grazing past the line of sight doesn't shake it.
 */

/**
 * The shoulder camera, measured off MHUR's (docs/reference/2026-11-04-mhur-study.md): about two hero heights behind,
 * 0.38 of one to the right and a little over its head, level, with a 60 degree view. The hero stands left of centre
 * at 0.4 of the width, head near the middle, feet near the bottom, and the reticle sits just above and outside its
 * right shoulder (owner, 2026-11-04: ours sat far from the hero, and its rolls read off the line it looked along).
 */
export const HERO_CAMERA = { back: 3.4, right: 0.68, up: 2.0, pitchLimit: 1.2, eyes: 1.62, ahead: 0.12, fov: 60, pitch: 0 }
/** Following a hero while watching: a little further back and higher than playing it, and how fast it turns with it. */
export const FOLLOW_CAMERA = { back: 5.6, right: 0.7, up: 2.3, pitch: -0.22, minBack: 2.5, maxBack: 14, turn: 3, lookAround: 2.5 }
/** How fast a camera pulled in by a wall eases back out to its full distance, in metres a second. */
const BOOM_OUT = 4
/**
 * A boom blocked close behind (a post, a railing, a wall at the hero's back) lifts over it rather than pressing the
 * camera into the hero's head: the heights it tries, metres, and how fast it rises and settles back, metres a second.
 */
const BOOM_LIFT = { tries: [1, 2, 3], up: 8, down: 3 } as const
/**
 * How fast the shoulder camera follows the eyes up and down, per second: it sits as far over the eyes standing,
 * crouched, sliding or prone, so the reticle keeps its place against the hero (owner, 2026-11-04: lying prone, the
 * camera stayed at standing height and the hero sank out of the bottom of the view). How far over the head bone the
 * eyes are, in first person.
 */
const EYES = { follow: 8, overHead: 0.08 }
/** How fast the camera goes to first person and back, in whole zooms a second. */
const SCOPE_SPEED = 6
/** Past this much of the zoom, the hero's own body hides so the camera sees out of its eyes. */
export const FIRST_PERSON = 0.6
/** The watching camera's limits: how low, high and far it goes, how steep it tilts, and the edge of the map. */
export const WATCH = { minHeight: 1.5, maxHeight: 70, minDistance: 5, maxDistance: 95, levelDistance: 20, minPitch: -1.4, maxPitch: 0.15, bounds: 72 }
export const BLEND_SECONDS = 0.5
/** Hanging from a ledge, the shoulder camera swings round behind the hero, over the drop, to face the wall it hangs
 * on and look a little down at it: how fast it turns (per second) and the pitch it settles at. */
export const HANG_CAMERA = { turn: 5, pitch: -0.2 }

/** Where a camera at `from` can sit on the way to `to` without passing through a box. */
export function pullIn(from: THREE.Vector3, to: THREE.Vector3, proxies: THREE.Box3[]): THREE.Vector3 {
  const dir = to.clone().sub(from)
  const length = dir.length()
  if (length === 0) return to.clone()
  const ray = new THREE.Ray(from, dir.normalize())
  let nearest = length
  const hit = new THREE.Vector3()
  for (const box of proxies) if (ray.intersectBox(box, hit)) nearest = Math.min(nearest, hit.distanceTo(from) - 0.3)
  // a box closer than the margin stops it just short of the box (never inside it), however close that is
  return from.clone().add(ray.direction.multiplyScalar(Math.min(length, Math.max(0, Math.min(0.5, nearest + 0.25), nearest))))
}

/**
 * The boom's pivot over a hero's feet at `feet`: lowered under any deck or roof it would be inside (a jump that took the
 * head up to a deck's underside), so the boom always starts in the open.
 */
export function underRoof(pivot: THREE.Vector3, feet: number, proxies: THREE.Box3[]): THREE.Vector3 {
  for (const box of proxies) if (box.containsPoint(pivot) && box.min.y > feet) pivot.y = Math.max(feet + 0.2, box.min.y - 0.15)
  return pivot
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
  private followed: number | undefined
  /** How far behind a followed hero the camera sits (the wheel moves it). */
  followBack = FOLLOW_CAMERA.back
  /** Seconds since the camera was last turned by hand while following: it turns with the hero again after a while. */
  private turnedFor = Infinity
  /** How far the shoulder camera's boom reaches now; a wall shortens it at once and it grows back slowly. */
  private boom: number | undefined
  /** How far the boom's root is lifted over something close behind the hero, metres. */
  private lift = 0
  /** How high the played hero's eyes are over its feet, followed smoothly (see EYES). */
  private eyes: number | undefined
  /**
   * First person (the canon: the right button held zooms in): `scoping` while it's held, and `scope` how far the
   * camera has gone from over the shoulder to the hero's eyes, 0 to 1. The hero's own body hides past FIRST_PERSON.
   */
  scoping = false
  scope = 0
  /** Height of the floor the watching camera turns around and zooms toward: the map's main floor. */
  floor = 0
  /** How far out and up the watching camera may go: the map's edge and the sky, or a hall's walls and ceiling. */
  limits = { x: WATCH.bounds, z: WATCH.bounds, height: WATCH.maxHeight }

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.free)
  }

  /** Switch view, blending from wherever the camera is now. */
  set(mode: 'free' | 'hero') {
    if (mode === this.mode) return
    this.mode = mode
    this.startBlend()
    if (mode === 'free') this.free.copy(this.camera.position)
  }

  /** The hero the watching camera follows from behind its shoulder (a click on a hero or its portrait); panning ends it. */
  get follow(): number | undefined {
    return this.followed
  }

  set follow(hero: number | undefined) {
    if (hero === this.followed) return
    const was = this.followed
    this.followed = hero
    if (this.mode !== 'free') return
    this.startBlend()
    if (hero === undefined) {
      // let go: watch on from where the camera is, looking the same way
      this.free.copy(this.camera.position)
      this.pitch = Math.min(this.pitch, WATCH.maxPitch)
    } else if (was === undefined) {
      this.pitch = FOLLOW_CAMERA.pitch
      this.turnedFor = Infinity
    }
  }

  private startBlend() {
    this.from.copy(this.camera.position)
    this.fromQ.copy(this.camera.quaternion)
    this.blend = 0
    this.boom = undefined
    this.lift = 0
  }

  /** Whether a wall has pulled the shoulder camera in so close it would sit inside the hero's head. */
  tooClose(): boolean {
    return this.boom !== undefined && this.boom < 1.2
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
    const t = f.y < -0.08 ? Math.min(WATCH.maxDistance, (this.floor - this.free.y) / f.y) : WATCH.levelDistance
    return this.free.clone().addScaledVector(f, t)
  }

  /** Watching: slide across the ground in screen directions (WASD, right drag); Space and Z rise and sink. Ends a follow. */
  fly(dt: number, f: number, r: number, u: number) {
    // higher up, the same key covers more ground, the way a strategy camera feels
    const speed = (10 + this.free.y * 0.9) * dt
    this.pan(r * speed, f * speed)
    this.free.y = Math.max(WATCH.minHeight, Math.min(this.limits.height, this.free.y + u * speed))
  }

  /** Watching: move the camera and what it looks at together, along the ground. */
  pan(right: number, forward: number) {
    if (right === 0 && forward === 0) return
    this.follow = undefined
    const flat = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    const side = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
    this.free.addScaledVector(side, right).addScaledVector(flat, forward)
    this.free.x = Math.max(-this.limits.x, Math.min(this.limits.x, this.free.x))
    this.free.z = Math.max(-this.limits.z, Math.min(this.limits.z, this.free.z))
  }

  /** Watching: turn around the point being looked at (left drag, Q and E), or around the hero being followed. */
  orbit(dx: number, dy: number) {
    if (this.followed !== undefined) {
      this.yaw -= dx * 0.005
      this.pitch = Math.max(-HERO_CAMERA.pitchLimit, Math.min(HERO_CAMERA.pitchLimit * 0.5, this.pitch - dy * 0.004))
      this.turnedFor = 0
      return
    }
    const pivot = this.pivot()
    const distance = this.free.distanceTo(pivot)
    this.yaw -= dx * 0.005
    this.pitch = Math.max(WATCH.minPitch, Math.min(WATCH.maxPitch, this.pitch - dy * 0.004))
    this.free.copy(pivot).addScaledVector(this.forward(), -distance)
    this.free.y = Math.max(WATCH.minHeight, this.free.y)
  }

  /** Watching: move in toward the point being looked at, or back out (the wheel); following, toward the hero. */
  zoom(factor: number) {
    if (this.followed !== undefined) {
      this.followBack = Math.max(FOLLOW_CAMERA.minBack, Math.min(FOLLOW_CAMERA.maxBack, this.followBack * factor))
      return
    }
    const pivot = this.pivot()
    const distance = Math.max(WATCH.minDistance, Math.min(WATCH.maxDistance, this.free.distanceTo(pivot) * factor))
    this.free.copy(pivot).addScaledVector(this.forward(), -distance)
    this.free.y = Math.max(WATCH.minHeight, Math.min(this.limits.height, this.free.y))
  }

  /**
   * `hero` is the controlled hero, `followed` the hero the watching camera follows (its drawn position) and
   * `followedYaw` the way it faces, if any. `sight` is the controlled hero's eyes: how high they are over its feet in
   * the stance it is in, and where its head bone is as last posed, which first person looks out from.
   */
  update(dt: number, hero: Vec3 | undefined, proxies: THREE.Box3[], followed?: Vec3, followedYaw?: number, wall?: number, sight?: { eyes: number; head?: Vec3 }) {
    const following = this.mode === 'free' && this.followed !== undefined && followed !== undefined
    if (this.mode === 'hero' && wall !== undefined) {
      const k = 1 - Math.exp(-dt * HANG_CAMERA.turn)
      this.yaw += Math.atan2(Math.sin(wall - this.yaw), Math.cos(wall - this.yaw)) * k
      this.pitch += (HANG_CAMERA.pitch - this.pitch) * k
    }
    if (following && followedYaw !== undefined) {
      // turn with the hero, the short way round, unless the camera was turned by hand a moment ago
      this.turnedFor += dt
      if (this.turnedFor > FOLLOW_CAMERA.lookAround) {
        const off = Math.atan2(Math.sin(followedYaw - this.yaw), Math.cos(followedYaw - this.yaw))
        this.yaw += off * (1 - Math.exp(-dt * FOLLOW_CAMERA.turn))
      }
    }
    const target = new THREE.Vector3()
    const forward = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    const toward = this.mode === 'hero' && this.scoping ? 1 : 0
    this.scope += Math.sign(toward - this.scope) * Math.min(Math.abs(toward - this.scope), dt * SCOPE_SPEED)
    if (this.mode === 'hero' && hero) {
      const s = this.scope * this.scope * (3 - 2 * this.scope)
      const eyes = sight?.eyes ?? HERO_CAMERA.eyes
      this.eyes = this.eyes === undefined ? eyes : this.eyes + (eyes - this.eyes) * (1 - Math.exp(-dt * EYES.follow))
      // over the shoulder the boom hangs as far over the eyes in every stance; in first person it is the head itself
      const behind = new THREE.Vector3(hero.x, hero.y + this.eyes + HERO_CAMERA.up - HERO_CAMERA.eyes, hero.z)
      const head = sight?.head ? new THREE.Vector3(sight.head.x, sight.head.y + EYES.overHead, sight.head.z) : new THREE.Vector3(hero.x, hero.y + this.eyes, hero.z)
      const pivot = underRoof(behind.lerp(head, s), hero.y, proxies)
      target.copy(this.shoulder(dt, pivot, forward, -HERO_CAMERA.back * (1 - s) + HERO_CAMERA.ahead * s, HERO_CAMERA.right * (1 - s), proxies))
    } else if (following) {
      const pivot = underRoof(new THREE.Vector3(followed.x, followed.y + FOLLOW_CAMERA.up, followed.z), followed.y, proxies)
      target.copy(this.shoulder(dt, pivot, forward, -this.followBack, FOLLOW_CAMERA.right, proxies))
      this.free.copy(target)
    } else {
      this.boom = undefined
      this.lift = 0
      target.copy(this.free)
    }
    const look = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(target, target.clone().add(forward), new THREE.Vector3(0, 1, 0)))
    this.blend = Math.min(1, this.blend + dt / BLEND_SECONDS)
    const k = this.blend * this.blend * (3 - 2 * this.blend)
    this.camera.position.lerpVectors(this.from, target, k)
    this.camera.quaternion.slerpQuaternions(this.fromQ, look, k)
  }

  /**
   * Where a camera `back` metres along `forward` and `right` to the side of `pivot` sits: pulled in at once by any wall
   * between, easing back out at BOOM_OUT when the wall is gone.
   */
  private shoulder(dt: number, pivot: THREE.Vector3, forward: THREE.Vector3, back: number, right: number, proxies: THREE.Box3[]): THREE.Vector3 {
    const side = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
    const offset = forward.clone().multiplyScalar(back).addScaledVector(side, right)
    const full = offset.length()
    if (full < 1e-6) return pivot.clone()
    // how far the boom reaches from its root lifted `lift` over the pivot; -1 when something is in the way of the lift
    const up = new THREE.Vector3(0, 1, 0)
    const reachFrom = (lift: number) => {
      const root = pivot.clone().addScaledVector(up, lift)
      if (lift > 0 && pullIn(pivot, root, proxies).distanceTo(pivot) < lift - 0.05) return -1
      return Math.min(full, pullIn(root, root.clone().add(offset), proxies).distanceTo(root))
    }
    let want = 0
    let best = reachFrom(0)
    if (best < full * 0.6)
      for (const lift of BOOM_LIFT.tries) {
        const r = reachFrom(lift)
        if (r > best + 0.5) {
          best = r
          want = lift
          if (r >= full * 0.9) break
        }
      }
    this.lift += want > this.lift ? Math.min(want - this.lift, BOOM_LIFT.up * dt) : -Math.min(this.lift - want, BOOM_LIFT.down * dt)
    const root = pivot.clone().addScaledVector(up, this.lift)
    // the root eases, so it may be partway up something: never through it
    const rootRoom = this.lift > 0 ? pullIn(pivot, root, proxies).distanceTo(pivot) : 0
    if (this.lift > 0 && rootRoom < this.lift) root.copy(pivot).addScaledVector(up, rootRoom)
    const reach = Math.min(full, pullIn(root, root.clone().add(offset), proxies).distanceTo(root))
    this.boom = this.boom === undefined || reach < this.boom ? reach : Math.min(reach, this.boom + BOOM_OUT * dt)
    return root.addScaledVector(offset, this.boom / full)
  }
}
