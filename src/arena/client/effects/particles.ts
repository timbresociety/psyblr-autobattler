import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { float, instancedBufferAttribute, positionLocal, step, uniform, vec3 } from 'three/tsl'
import type { Vec3 } from '../../engine/maths'
import { ring, take, type Ring } from './ring'

/**
 * A pool of GPU particles (KTD11). Each spawn writes a handful of slots; after that every particle flies, falls and
 * fades in the vertex shader from its start time, so the CPU does no per-particle work and nothing is allocated.
 * Particles are tiny octahedra, which read from any camera angle without billboarding.
 */
export interface SpawnSpec {
  count: number
  at: Vec3
  /** Outward speed, m/s; negative pulls inward toward `at`. */
  speed: number
  /** Start spread radius around `at`. */
  spread: number
  life: number
  size: number
  color: THREE.Color
  /** m/s² pulling down; 0 floats. */
  gravity?: number
  /** Extra upward speed. */
  lift?: number
}

export class Particles {
  readonly mesh: THREE.InstancedMesh
  private readonly ring: Ring
  private readonly origin: THREE.InstancedBufferAttribute
  private readonly velocity: THREE.InstancedBufferAttribute
  private readonly meta: THREE.InstancedBufferAttribute
  private readonly color: THREE.InstancedBufferAttribute
  private readonly now = uniform(0)
  private seed = 1

  constructor(count: number, additive = true) {
    this.ring = ring(count)
    this.origin = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    this.velocity = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    // start, life, size, gravity; start far in the past so empty slots are dead
    this.meta = new THREE.InstancedBufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? -1e6 : i % 4 === 1 ? 1 : 0)), 4)
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    for (const a of [this.origin, this.velocity, this.meta, this.color]) a.setUsage(THREE.DynamicDrawUsage)
    const o = instancedBufferAttribute(this.origin, 'vec3') as unknown as typeof positionLocal
    const v = instancedBufferAttribute(this.velocity, 'vec3') as unknown as typeof positionLocal
    const m = instancedBufferAttribute(this.meta, 'vec4') as unknown as ReturnType<typeof vec3> & { x: ReturnType<typeof float>; y: ReturnType<typeof float>; z: ReturnType<typeof float>; w: ReturnType<typeof float> }
    const c = instancedBufferAttribute(this.color, 'vec3') as unknown as typeof positionLocal
    const t = this.now.sub(m.x)
    const age = t.div(m.y)
    const live = step(0, age).mul(step(age, 1))
    const size = m.z.mul(float(1).sub(age).mul(0.7).add(0.3)).mul(live)
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    material.positionNode = positionLocal.mul(size).add(o.add(v.mul(t)).add(vec3(0, t.mul(t).mul(m.w).mul(-0.5), 0)))
    material.colorNode = c
    material.opacityNode = float(1).sub(age).mul(live)
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), material, count)
    this.mesh.frustumCulled = false
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  spawn(spec: SpawnSpec, now: number) {
    for (const [start, n] of take(this.ring, spec.count)) {
      for (let i = start; i < start + n; i++) {
        // a random direction on the sphere, then speed along it
        const u = this.rnd() * 2 - 1
        const a = this.rnd() * Math.PI * 2
        const r = Math.sqrt(1 - u * u)
        const d = [r * Math.cos(a), u, r * Math.sin(a)]
        const s = spec.speed * (0.4 + this.rnd() * 0.6)
        this.origin.setXYZ(i, spec.at.x + d[0] * spec.spread, spec.at.y + d[1] * spec.spread, spec.at.z + d[2] * spec.spread)
        this.velocity.setXYZ(i, d[0] * s, d[1] * s + (spec.lift ?? 0), d[2] * s)
        this.meta.setXYZW(i, now, spec.life * (0.6 + this.rnd() * 0.4), spec.size * (0.6 + this.rnd() * 0.8), spec.gravity ?? 0)
        this.color.setXYZ(i, spec.color.r, spec.color.g, spec.color.b)
      }
      for (const [attr, size] of [[this.origin, 3], [this.velocity, 3], [this.meta, 4], [this.color, 3]] as const) {
        attr.addUpdateRange(start * size, n * size)
        attr.needsUpdate = true
      }
    }
  }

  update(now: number) {
    this.now.value = now
  }
}
