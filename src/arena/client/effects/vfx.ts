import * as THREE from 'three'
import { SpriteNodeMaterial } from 'three/webgpu'
import { float, floor, instancedBufferAttribute, mix, mod, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { ring, take, type Ring } from './ring'

/**
 * Visual effects building blocks (R10, R21): textured, camera-facing sprites animated on the GPU (glows, smoke, star
 * flashes, soft rings), ribbon trails for anything that flies, and painted textures for shockwaves, magic circles,
 * slash arcs, beams and ground cracks. All drawn procedurally on canvases at load; nothing is downloaded. Purely
 * cosmetic: the engine never reads any of it.
 */

// ---------------------------------------------------------------------------------------------- textures

function canvas(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, wrap = false): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/** The sprite atlas, four cells: soft glow, smoke puff, star flash, soft ring. White, so every sprite tints freely. */
export function spriteAtlas(): THREE.CanvasTexture {
  return canvas(1024, (ctx, size) => {
    const cell = size / 2
    const rnd = seeded(9)
    // glow: a hot core and a long soft falloff
    let g = ctx.createRadialGradient(cell / 2, cell / 2, 0, cell / 2, cell / 2, cell / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.12, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.4)')
    g.addColorStop(0.7, 'rgba(255,255,255,0.08)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, cell, cell)
    // smoke: many soft blobs inside a round mask, lighter in the middle
    ctx.save()
    ctx.translate(cell, 0)
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(rnd()) * cell * 0.3
      const x = cell / 2 + Math.cos(a) * r
      const y = cell / 2 + Math.sin(a) * r
      const rad = cell * (0.08 + rnd() * 0.14)
      const b = ctx.createRadialGradient(x, y, 0, x, y, rad)
      const shade = 200 + Math.floor(rnd() * 55)
      b.addColorStop(0, `rgba(${shade},${shade},${shade},0.22)`)
      b.addColorStop(1, `rgba(${shade},${shade},${shade},0)`)
      ctx.fillStyle = b
      ctx.fillRect(0, 0, cell, cell)
    }
    ctx.restore()
    // star: a four-point flare with thin streaks over a small glow
    ctx.save()
    ctx.translate(cell / 2, cell + cell / 2)
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.22)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(-cell / 2, -cell / 2, cell, cell)
    for (const [w, len, rot] of [
      [6, 0.48, 0],
      [6, 0.48, Math.PI / 2],
      [3, 0.3, Math.PI / 4],
      [3, 0.3, -Math.PI / 4],
    ]) {
      ctx.save()
      ctx.rotate(rot)
      const s = ctx.createLinearGradient(-cell * len, 0, cell * len, 0)
      s.addColorStop(0, 'rgba(255,255,255,0)')
      s.addColorStop(0.5, 'rgba(255,255,255,1)')
      s.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = s
      ctx.beginPath()
      ctx.ellipse(0, 0, cell * len, w, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
    // ring: a soft annulus
    ctx.save()
    ctx.translate(cell + cell / 2, cell + cell / 2)
    g = ctx.createRadialGradient(0, 0, cell * 0.3, 0, 0, cell / 2)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.15)')
    g.addColorStop(0.8, 'rgba(255,255,255,1)')
    g.addColorStop(0.92, 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(-cell / 2, -cell / 2, cell, cell)
    ctx.restore()
  })
}

/** A shockwave ring for the ground: bright leading edge, a soft wake inside. */
export function shockTexture(): THREE.CanvasTexture {
  return canvas(512, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.08)')
    g.addColorStop(0.86, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.95, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  })
}

/** A magic circle: rings, a star and runes, drawn white for tinting. */
export function magicCircleTexture(): THREE.CanvasTexture {
  return canvas(512, (ctx, s) => {
    const rnd = seeded(31)
    ctx.translate(s / 2, s / 2)
    ctx.strokeStyle = 'rgba(255,255,255,1)'
    ctx.shadowColor = 'rgba(255,255,255,0.9)'
    ctx.shadowBlur = 12
    const ring = (r: number, w: number) => {
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ring(s * 0.47, 5)
    ring(s * 0.42, 2)
    ring(s * 0.27, 3)
    ring(s * 0.1, 2)
    // a six-pointed star between the inner rings
    ctx.lineWidth = 3
    for (const off of [0, Math.PI / 3]) {
      ctx.beginPath()
      for (let k = 0; k <= 3; k++) {
        const a = off + (k * Math.PI * 2) / 3 - Math.PI / 2
        const x = Math.cos(a) * s * 0.41
        const y = Math.sin(a) * s * 0.41
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    // runes in the band between the outer rings
    ctx.lineWidth = 2.5
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2
      ctx.save()
      ctx.rotate(a)
      ctx.translate(0, -s * 0.445)
      ctx.beginPath()
      const strokes = 2 + Math.floor(rnd() * 3)
      for (let j = 0; j < strokes; j++) {
        ctx.moveTo((rnd() - 0.5) * 12, (rnd() - 0.5) * 10)
        ctx.lineTo((rnd() - 0.5) * 12, (rnd() - 0.5) * 10)
      }
      ctx.stroke()
      ctx.restore()
    }
  })
}

/** A slash arc: bright at the blade's leading edge (u = 1), fading back along the swing, soft across its width. */
export function slashTexture(): THREE.CanvasTexture {
  return canvas(256, (ctx, s) => {
    const along = ctx.createLinearGradient(0, 0, s, 0)
    along.addColorStop(0, 'rgba(255,255,255,0)')
    along.addColorStop(0.7, 'rgba(255,255,255,0.55)')
    along.addColorStop(0.95, 'rgba(255,255,255,1)')
    along.addColorStop(1, 'rgba(255,255,255,0.2)')
    ctx.fillStyle = along
    ctx.fillRect(0, 0, s, s)
    ctx.globalCompositeOperation = 'destination-in'
    const across = ctx.createLinearGradient(0, 0, 0, s)
    across.addColorStop(0, 'rgba(0,0,0,0)')
    across.addColorStop(0.35, 'rgba(0,0,0,1)')
    across.addColorStop(0.55, 'rgba(0,0,0,1)')
    across.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = across
    ctx.fillRect(0, 0, s, s)
  })
}

/** Streaky noise that tiles, scrolled along beams to make them flow. */
export function flowTexture(): THREE.CanvasTexture {
  const t = canvas(
    256,
    (ctx, s) => {
      const rnd = seeded(77)
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(0, 0, s, s)
      for (let i = 0; i < 90; i++) {
        const x = rnd() * s
        const w = 2 + rnd() * 10
        const y = rnd() * s
        const h = 30 + rnd() * 120
        const g = ctx.createLinearGradient(0, y, 0, y + h)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(0.5, `rgba(255,255,255,${0.4 + rnd() * 0.6})`)
        g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g
        for (const dy of [0, -s, s]) ctx.fillRect(x, y + dy, w, h)
      }
    },
    true,
  )
  return t
}

/** A ground crack decal: dark fissures with bright molten edges. */
export function crackTexture(): THREE.CanvasTexture {
  return canvas(512, (ctx, s) => {
    const rnd = seeded(5)
    ctx.translate(s / 2, s / 2)
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      if (depth > 4 || len < 8) return
      const nx = x + Math.cos(a) * len
      const ny = y + Math.sin(a) * len
      for (const [width, color] of [
        [w + 6, 'rgba(255,255,255,0.35)'],
        [w, 'rgba(255,255,255,1)'],
      ] as const) {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(nx, ny)
        ctx.stroke()
      }
      branch(nx, ny, a + (rnd() - 0.5) * 0.9, len * 0.75, w * 0.7, depth + 1)
      if (rnd() < 0.6) branch(nx, ny, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), len * 0.55, w * 0.6, depth + 1)
    }
    for (let k = 0; k < 7; k++) branch(0, 0, (k / 7) * Math.PI * 2 + rnd() * 0.4, s * 0.15, 7, 0)
  })
}

// ---------------------------------------------------------------------------------------------- sprites

export type SpriteKind = 'glow' | 'smoke' | 'star' | 'ring'
const CELL: Record<SpriteKind, number> = { glow: 0, smoke: 1, star: 2, ring: 3 }

export interface SpriteSpec {
  at: { x: number; y: number; z: number }
  count: number
  kind: SpriteKind
  /** Seconds each sprite lives (±30% random). */
  life: number
  /** Size at birth and at death, metres. */
  size: [number, number]
  color: THREE.Color
  /** Outward speed in a random direction, m/s. */
  speed?: number
  /** A shared drift added to every sprite, m/s. */
  velocity?: { x: number; y: number; z: number }
  /** Random start offset radius, metres. */
  spread?: number
  gravity?: number
  /** Slowdown: velocity falls off as 1 / (1 + drag·t). */
  drag?: number
  spin?: number
  alpha?: number
  /** Only fly upward and outward (0-1 bias), for dust and debris. */
  up?: number
}

/**
 * A pool of instanced, camera-facing sprites. Each spawn writes a few slots; after that the GPU flies, grows, spins and
 * fades every sprite by itself, so thousands cost one draw call. Slots come from a ring (KTD11): the pool never grows
 * and the oldest sprites are overwritten first.
 */
export class SpritePool {
  readonly mesh: THREE.Sprite
  private readonly origin: THREE.InstancedBufferAttribute
  private readonly velocity: THREE.InstancedBufferAttribute
  private readonly timing: THREE.InstancedBufferAttribute
  private readonly extra: THREE.InstancedBufferAttribute
  private readonly tint: THREE.InstancedBufferAttribute
  private readonly now = uniform(0)
  private readonly slots: Ring
  private used = 0
  private seed = 7

  constructor(
    private readonly capacity: number,
    atlas: THREE.Texture,
    blending: THREE.Blending,
  ) {
    const attr = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n)
      a.setUsage(THREE.DynamicDrawUsage)
      return a
    }
    this.origin = attr(3)
    this.velocity = attr(3)
    this.timing = attr(4)
    this.extra = attr(4)
    this.tint = attr(4)
    // every slot starts long dead
    for (let i = 0; i < capacity; i++) this.timing.setXYZW(i, -1e6, 1, 0, 0)
    this.slots = ring(capacity)
    // the node library types instanced attributes loosely; these casts name what each one holds
    type V3 = ReturnType<typeof vec3>
    type V4 = ReturnType<typeof vec4>
    const o = instancedBufferAttribute(this.origin, 'vec3') as unknown as V3
    const v = instancedBufferAttribute(this.velocity, 'vec3') as unknown as V3
    const tm = instancedBufferAttribute(this.timing, 'vec4') as unknown as V4
    const ex = instancedBufferAttribute(this.extra, 'vec4') as unknown as V4
    const col = instancedBufferAttribute(this.tint, 'vec4') as unknown as V4
    const t = this.now.sub(tm.x)
    const age = t.div(tm.y)
    const live = step(0, age).mul(step(age, 1))
    // damped flight plus gravity: v·t / (1 + drag·t), minus ½·g·t²
    const flown = v.mul(t.div(float(1).add(ex.y.mul(t))))
    const fall = t.mul(t).mul(ex.x).mul(-0.5)
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending })
    material.positionNode = o.add(flown).add(vec3(0, fall, 0))
    material.scaleNode = mix(tm.z, tm.w, age).mul(live)
    material.rotationNode = ex.z.mul(t)
    const cell = ex.w
    // the canvas is flipped on upload, so the atlas's top row (glow, smoke) sits at v 0.5-1
    const cellUV = uv().mul(0.5).add(vec2(mod(cell, 2).mul(0.5), float(1).sub(floor(cell.div(2))).mul(0.5)))
    const tex = texture(atlas, cellUV)
    const fade = smoothstep(0, 0.12, age).mul(float(1).sub(age).pow(1.3))
    material.colorNode = vec4(col.xyz.mul(tex.xyz), 1)
    material.opacityNode = tex.w.mul(col.w).mul(fade).mul(live)
    this.mesh = new THREE.Sprite(material)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  spawn(spec: SpriteSpec, now: number) {
    const drift = spec.velocity ?? { x: 0, y: 0, z: 0 }
    for (const [start, count] of take(this.slots, spec.count))
      for (let i = start; i < start + count; i++) this.write(i, spec, drift, now)
    for (const attr of [this.origin, this.velocity, this.timing, this.extra, this.tint]) attr.needsUpdate = true
  }

  private write(i: number, spec: SpriteSpec, drift: { x: number; y: number; z: number }, now: number) {
    // one sprite in slot i: a random direction, then its flight, size, spin, atlas cell and colour
    if (i + 1 > this.used) this.mesh.count = this.used = i + 1
    const u = this.rnd() * 2 - 1
    const a = this.rnd() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    let dx = r * Math.cos(a)
    let dy = u
    let dz = r * Math.sin(a)
    if (spec.up) dy = Math.abs(dy) * spec.up + dy * (1 - spec.up)
    const spread = (spec.spread ?? 0) * this.rnd()
    const speed = (spec.speed ?? 0) * (0.45 + this.rnd() * 0.55)
    this.origin.setXYZ(i, spec.at.x + dx * spread, spec.at.y + dy * spread, spec.at.z + dz * spread)
    this.velocity.setXYZ(i, dx * speed + drift.x, dy * speed + drift.y, dz * speed + drift.z)
    const life = spec.life * (0.7 + this.rnd() * 0.6)
    const grow = 0.8 + this.rnd() * 0.4
    this.timing.setXYZW(i, now, life, spec.size[0] * grow, spec.size[1] * grow)
    this.extra.setXYZW(i, spec.gravity ?? 0, spec.drag ?? 0, (spec.spin ?? 0) * (this.rnd() < 0.5 ? -1 : 1), CELL[spec.kind])
    this.tint.setXYZW(i, spec.color.r, spec.color.g, spec.color.b, spec.alpha ?? 1)
  }

  update(now: number) {
    this.now.value = now
  }
}

// ---------------------------------------------------------------------------------------------- trails

/** A ribbon that follows a moving point, wide and bright at the head, tapering to nothing at the tail. */
export class Trail {
  readonly mesh: THREE.Mesh
  private readonly points: THREE.Vector3[] = []
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly geo = new THREE.BufferGeometry()

  constructor(
    private readonly length: number,
    private readonly width: number,
    color: THREE.Color,
  ) {
    this.positions = new Float32Array(length * 2 * 3)
    this.colors = new Float32Array(length * 2 * 4)
    const index: number[] = []
    for (let i = 0; i < length - 1; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    this.geo.setIndex(index)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage))
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    this.mesh.frustumCulled = false
    this.recolor(color)
  }

  recolor(color: THREE.Color) {
    for (let i = 0; i < this.length; i++) {
      const f = 1 - i / (this.length - 1)
      for (const side of [0, 1]) {
        const k = (i * 2 + side) * 4
        this.colors[k] = color.r
        this.colors[k + 1] = color.g
        this.colors[k + 2] = color.b
        this.colors[k + 3] = f * f
      }
    }
    this.geo.getAttribute('color').needsUpdate = true
  }

  reset() {
    this.points.length = 0
  }

  /** Add the head's new position and rebuild the ribbon facing the camera. */
  push(head: THREE.Vector3, camera: THREE.Camera) {
    this.points.unshift(head.clone())
    if (this.points.length > this.length) this.points.pop()
    const eye = camera.position
    const side = new THREE.Vector3()
    const along = new THREE.Vector3()
    const view = new THREE.Vector3()
    for (let i = 0; i < this.length; i++) {
      const p = this.points[Math.min(i, this.points.length - 1)]
      const q = this.points[Math.min(i + 1, this.points.length - 1)]
      along.subVectors(p, q)
      if (along.lengthSq() < 1e-8) along.set(0, 0, 1)
      view.subVectors(eye, p)
      side.crossVectors(along, view).normalize().multiplyScalar((this.width * (1 - i / this.length)) / 2)
      this.positions.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6)
    }
    this.geo.getAttribute('position').needsUpdate = true
  }
}

// ---------------------------------------------------------------------------------------------- shapes

/** A crescent for slash arcs with polar UVs: u runs along the swing, v across the blade. */
export function arcGeometry(inner: number, outer: number, start: number, length: number, segments = 32): THREE.BufferGeometry {
  const pos: number[] = []
  const uvs: number[] = []
  const index: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const a = start + length * t
    for (const [r, v] of [
      [inner, 0],
      [outer, 1],
    ]) {
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r)
      uvs.push(t, v)
    }
    if (i < segments) {
      const k = i * 2
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(index)
  return g
}
