import * as THREE from 'three'

/**
 * Debris (GAME.md §6b): chunks thrown by blasts, slams and broken props, flying, bouncing on the floor under them and
 * settling, then shrinking away. One instanced mesh of unit boxes, each chunk scaled and tinted, so a whole fight's
 * debris is one draw call. At most `DEBRIS_BUDGET` live at once (the MacBook Air budget); a new chunk past it takes the
 * oldest one's place. Cosmetic: the engine never reads it.
 */
export const DEBRIS_BUDGET = 300

const GRAVITY = 18
const BOUNCE = 0.3
const FRICTION = 0.55
/** Seconds a chunk takes to shrink away at the end of its life. */
const FADE = 0.6

export interface Throw {
  at: { x: number; y: number; z: number }
  count: number
  /** Metres a second outward, and upward on top of it. */
  speed: number
  up: number
  /** Chunk edge, metres, smallest to largest. */
  size: [number, number]
  color: THREE.Color
  /** Seconds it lies before shrinking away. */
  life: number
  /** Thrown mostly this way (a slam's rebound, a blow's follow-through); evenly round when absent. */
  dir?: { x: number; y: number; z: number }
  /** Starting spread round `at`, metres. */
  spread?: number
}

interface Chunk {
  p: THREE.Vector3
  v: THREE.Vector3
  axis: THREE.Vector3
  angle: number
  spin: number
  size: THREE.Vector3
  age: number
  life: number
  live: boolean
}

export class DebrisPool {
  readonly mesh: THREE.InstancedMesh
  private readonly chunks: Chunk[] = []
  private next = 0
  private readonly place = new THREE.Object3D()
  private readonly q = new THREE.Quaternion()

  constructor(
    /** The floor under a point: chunks bounce and settle on it. */
    private readonly floorAt: (p: { x: number; y: number; z: number }) => number,
    readonly budget = DEBRIS_BUDGET,
    private readonly random: () => number = Math.random,
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 }), budget)
    this.mesh.name = 'fx:debris'
    this.mesh.count = 0
    this.mesh.castShadow = true
    this.mesh.frustumCulled = false
    for (let i = 0; i < budget; i++) {
      this.chunks.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), angle: 0, spin: 0, size: new THREE.Vector3(), age: 0, life: 0, live: false })
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1))
    }
  }

  /** Chunks alive right now; never more than the budget. */
  live(): number {
    let n = 0
    for (const c of this.chunks) if (c.live) n++
    return n
  }

  throw(t: Throw) {
    const r = this.random
    const color = new THREE.Color()
    for (let k = 0; k < t.count; k++) {
      const i = this.next
      this.next = (this.next + 1) % this.budget
      const c = this.chunks[i]
      const a = r() * Math.PI * 2
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      if (t.dir) out.multiplyScalar(0.45).add(new THREE.Vector3(t.dir.x, Math.max(0, t.dir.y), t.dir.z)).normalize()
      const spread = t.spread ?? 0.3
      c.p.set(t.at.x + out.x * spread * r(), t.at.y + 0.1 + r() * spread * 0.5, t.at.z + out.z * spread * r())
      c.v.copy(out).multiplyScalar(t.speed * (0.5 + r() * 0.8))
      c.v.y += t.up * (0.6 + r() * 0.7)
      c.axis.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize()
      c.angle = r() * Math.PI * 2
      c.spin = 6 + r() * 14
      const e = t.size[0] + (t.size[1] - t.size[0]) * r()
      c.size.set(e * (0.7 + r() * 0.6), e * (0.4 + r() * 0.4), e * (0.7 + r() * 0.6))
      c.age = 0
      c.life = t.life * (0.8 + r() * 0.4)
      c.live = true
      // each chunk a shade off the next, so a pile reads as broken pieces rather than one colour
      this.mesh.setColorAt(i, color.copy(t.color).multiplyScalar(0.8 + r() * 0.35))
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  /**
   * Break something pre-fractured: each chunk starts where it sat, at its own size, and flies off away from `from` (the
   * blast, or the body knocked into it), faster the closer it was.
   */
  shatter(chunks: readonly { at: { x: number; y: number; z: number }; size: { x: number; y: number; z: number } }[], from: { x: number; y: number; z: number }, t: { speed: number; up: number; color: THREE.Color; life: number }) {
    const r = this.random
    const color = new THREE.Color()
    for (const chunk of chunks) {
      const i = this.next
      this.next = (this.next + 1) % this.budget
      const c = this.chunks[i]
      c.p.set(chunk.at.x, chunk.at.y, chunk.at.z)
      const away = new THREE.Vector3(chunk.at.x - from.x, Math.max(0.2, chunk.at.y - from.y), chunk.at.z - from.z)
      const d = Math.max(0.3, away.length())
      away.divideScalar(d)
      c.v.copy(away).multiplyScalar(t.speed * (0.6 + r() * 0.6) * Math.min(1.5, 1.5 / d))
      c.v.x += (r() - 0.5) * t.speed * 0.4
      c.v.z += (r() - 0.5) * t.speed * 0.4
      c.v.y += t.up * (0.5 + r() * 0.6)
      c.axis.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize()
      c.angle = 0
      c.spin = 5 + r() * 12
      c.size.set(chunk.size.x, chunk.size.y, chunk.size.z)
      c.age = 0
      c.life = t.life * (0.8 + r() * 0.4)
      c.live = true
      this.mesh.setColorAt(i, color.copy(t.color).multiplyScalar(0.85 + r() * 0.3))
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  step(dt: number) {
    if (!(dt > 0)) return
    const place = this.place
    let top = 0
    for (let i = 0; i < this.budget; i++) {
      const c = this.chunks[i]
      if (!c.live) {
        place.scale.setScalar(0)
        place.updateMatrix()
        this.mesh.setMatrixAt(i, place.matrix)
        continue
      }
      c.age += dt
      if (c.age >= c.life + FADE) {
        c.live = false
        place.scale.setScalar(0)
        place.updateMatrix()
        this.mesh.setMatrixAt(i, place.matrix)
        continue
      }
      top = i + 1
      const floor = this.floorAt(c.p) + c.size.y / 2
      const resting = c.p.y <= floor + 1e-3 && Math.abs(c.v.y) < 0.6
      if (!resting) {
        c.v.y -= GRAVITY * dt
        c.p.addScaledVector(c.v, dt)
        c.angle += c.spin * dt
        if (c.p.y < floor) {
          c.p.y = floor
          c.v.y = -c.v.y * BOUNCE
          c.v.x *= FRICTION
          c.v.z *= FRICTION
          c.spin *= 0.5
        }
      } else {
        c.p.y = floor
        c.v.set(0, 0, 0)
      }
      const shrink = c.age > c.life ? 1 - (c.age - c.life) / FADE : 1
      place.position.copy(c.p)
      place.quaternion.copy(this.q.setFromAxisAngle(c.axis, c.angle))
      place.scale.copy(c.size).multiplyScalar(Math.max(0, shrink))
      place.updateMatrix()
      this.mesh.setMatrixAt(i, place.matrix)
    }
    // draw only up to the last live chunk's slot; the dead ones below it are scaled to nothing
    this.mesh.count = top
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
