import * as THREE from 'three'
import { SpriteNodeMaterial } from 'three/webgpu'
import { float, floor, instancedBufferAttribute, mix, mod, smoothstep, step, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { ring, take, type Ring } from './ring.js'

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
  /** An atlas cell by number, in place of `kind`: a motif on the motif sheet. */
  cell?: number
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
    /** Cells per side of the atlas: 2 for the effect sprites, 4 for the motif sheet. */
    grid = 2,
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
    const g = float(grid)
    // the canvas is flipped on upload, so the atlas's top row (glow, smoke) sits at the top of v
    const cellUV = uv().div(g).add(vec2(mod(cell, g).div(g), g.sub(1).sub(floor(cell.div(g))).div(g)))
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
    this.extra.setXYZW(i, spec.gravity ?? 0, spec.drag ?? 0, (spec.spin ?? 0) * (this.rnd() < 0.5 ? -1 : 1), spec.cell ?? CELL[spec.kind])
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
    /** Metres across at the head; a reused trail takes the width of its new shot. */
    public width: number,
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

  /** Free its GPU buffers and material, for a trail that will not be reused. */
  dispose() {
    this.mesh.removeFromParent()
    this.geo.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
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

// ---------------------------------------------------------------------------------------------- skill looks

/**
 * The motif sheet: sixteen little pictures in white, four by four, in the order of MOTIFS (src/charter/skill-look.ts),
 * for trails that shed coins, notes, leaves or code.
 */
export function motifAtlas(): THREE.CanvasTexture {
  return canvas(512, (ctx, size) => {
    const c = size / 4
    ctx.fillStyle = ctx.strokeStyle = '#ffffff'
    ctx.shadowColor = 'rgba(255,255,255,0.8)'
    ctx.shadowBlur = 6
    ctx.lineCap = ctx.lineJoin = 'round'
    const cells: ((x: CanvasRenderingContext2D) => void)[] = [
      // coin
      (x) => {
        x.beginPath(), x.arc(0, 0, 40, 0, Math.PI * 2), x.fill()
        x.globalCompositeOperation = 'destination-out'
        x.lineWidth = 5
        x.beginPath(), x.arc(0, 0, 31, 0, Math.PI * 2), x.stroke()
        x.font = 'bold 46px sans-serif'
        x.textAlign = 'center'
        x.textBaseline = 'middle'
        x.fillText('$', 0, 3)
      },
      // note
      (x) => {
        x.save(), x.translate(-12, 26), x.rotate(-0.4), x.beginPath(), x.ellipse(0, 0, 17, 12, 0, 0, Math.PI * 2), x.fill(), x.restore()
        x.lineWidth = 7
        x.beginPath(), x.moveTo(3, 22), x.lineTo(3, -40), x.quadraticCurveTo(30, -26, 26, -2), x.stroke()
      },
      // leaf
      (x) => {
        x.beginPath(), x.moveTo(0, 44), x.quadraticCurveTo(-42, 0, 0, -44), x.quadraticCurveTo(42, 0, 0, 44), x.fill()
        x.globalCompositeOperation = 'destination-out'
        x.lineWidth = 4
        x.beginPath(), x.moveTo(0, 40), x.lineTo(0, -36), x.stroke()
      },
      // petal
      (x) => {
        x.beginPath(), x.moveTo(0, 42), x.bezierCurveTo(-46, 10, -30, -40, -6, -36), x.lineTo(0, -26), x.lineTo(6, -36), x.bezierCurveTo(30, -40, 46, 10, 0, 42), x.fill()
      },
      // snowflake
      (x) => {
        x.lineWidth = 6
        for (let k = 0; k < 6; k++) {
          x.save(), x.rotate((k * Math.PI) / 3)
          x.beginPath(), x.moveTo(0, 0), x.lineTo(0, -44), x.moveTo(0, -24), x.lineTo(-13, -36), x.moveTo(0, -24), x.lineTo(13, -36), x.stroke()
          x.restore()
        }
      },
      // feather
      (x) => {
        x.rotate(0.5)
        x.beginPath(), x.moveTo(0, 46), x.quadraticCurveTo(-30, 0, 0, -46), x.quadraticCurveTo(26, 0, 0, 46), x.fill()
        x.globalCompositeOperation = 'destination-out'
        x.lineWidth = 3
        x.beginPath(), x.moveTo(0, 46), x.lineTo(0, -42), x.stroke()
        for (let k = -3; k <= 3; k++) x.beginPath(), x.moveTo(0, k * 11), x.lineTo(-18, k * 11 - 10), x.stroke()
      },
      // star
      (x) => {
        x.beginPath()
        for (let k = 0; k < 10; k++) {
          const r = k % 2 ? 19 : 46
          const a = (k * Math.PI) / 5 - Math.PI / 2
          x.lineTo(Math.cos(a) * r, Math.sin(a) * r)
        }
        x.fill()
      },
      // skull
      (x) => {
        x.beginPath(), x.arc(0, -8, 36, 0, Math.PI * 2), x.fill()
        x.fillRect(-20, 16, 40, 24)
        x.globalCompositeOperation = 'destination-out'
        x.beginPath(), x.arc(-14, -6, 10, 0, Math.PI * 2), x.arc(14, -6, 10, 0, Math.PI * 2), x.fill()
        x.fillRect(-3, 26, 6, 14), x.fillRect(-15, 26, 5, 14), x.fillRect(10, 26, 5, 14)
      },
      // heart
      (x) => {
        x.beginPath(), x.moveTo(0, 40), x.bezierCurveTo(-60, -4, -26, -54, 0, -20), x.bezierCurveTo(26, -54, 60, -4, 0, 40), x.fill()
      },
      // bolt
      (x) => {
        x.beginPath(), x.moveTo(10, -46), x.lineTo(-22, 6), x.lineTo(-2, 6), x.lineTo(-12, 46), x.lineTo(24, -10), x.lineTo(4, -10), x.closePath(), x.fill()
      },
      // code
      (x) => {
        x.font = 'bold 50px monospace'
        x.textAlign = 'center'
        x.textBaseline = 'middle'
        x.fillText('01', 0, 2)
      },
      // card
      (x) => {
        x.lineWidth = 6
        x.beginPath(), x.roundRect(-28, -42, 56, 84, 8), x.stroke()
        x.beginPath(), x.moveTo(0, -18), x.lineTo(14, 0), x.lineTo(0, 18), x.lineTo(-14, 0), x.closePath(), x.fill()
      },
      // bubble
      (x) => {
        x.lineWidth = 6
        x.beginPath(), x.arc(0, 0, 38, 0, Math.PI * 2), x.stroke()
        x.beginPath(), x.arc(-13, -13, 9, 0, Math.PI * 2), x.fill()
      },
      // flame
      (x) => {
        x.beginPath(), x.moveTo(0, 44), x.bezierCurveTo(-46, 30, -26, -16, 0, -46), x.bezierCurveTo(4, -20, 40, -4, 30, 24), x.bezierCurveTo(24, 40, 10, 44, 0, 44), x.fill()
        x.globalCompositeOperation = 'destination-out'
        x.beginPath(), x.moveTo(0, 40), x.bezierCurveTo(-18, 30, -10, 8, 2, -4), x.bezierCurveTo(6, 12, 18, 18, 12, 32), x.closePath(), x.fill()
      },
      // rune
      (x) => {
        x.lineWidth = 7
        x.beginPath(), x.moveTo(-14, 44), x.lineTo(-14, -44), x.lineTo(18, -18), x.lineTo(-14, 4), x.lineTo(20, 44), x.stroke()
      },
      // shuriken
      (x) => {
        x.beginPath()
        for (let k = 0; k < 8; k++) {
          const r = k % 2 ? 11 : 46
          const a = (k * Math.PI) / 4
          x.lineTo(Math.cos(a) * r, Math.sin(a) * r)
        }
        x.fill()
        x.globalCompositeOperation = 'destination-out'
        x.beginPath(), x.arc(0, 0, 6, 0, Math.PI * 2), x.fill()
      },
    ]
    cells.forEach((draw, i) => {
      ctx.save()
      ctx.translate((i % 4) * c + c / 2, Math.floor(i / 4) * c + c / 2)
      draw(ctx)
      ctx.restore()
    })
  })
}

/** Chain links one after another along v, tiling, for grapples: the beam cylinder runs v along its length. */
export function chainTexture(): THREE.CanvasTexture {
  return canvas(
    256,
    (ctx, s) => {
      ctx.strokeStyle = 'rgba(255,255,255,1)'
      ctx.shadowColor = 'rgba(255,255,255,0.7)'
      ctx.shadowBlur = 8
      for (let k = 0; k < 4; k++) {
        const y = (k + 0.5) * (s / 4)
        // a link seen face on, then one edge on
        ctx.lineWidth = k % 2 ? 10 : 14
        ctx.beginPath()
        if (k % 2) ctx.ellipse(s / 2, y, s / 18, s / 7, 0, 0, Math.PI * 2)
        else ctx.ellipse(s / 2, y, s / 4.5, s / 7, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
    },
    true,
  )
}

/** A whirlpool seen from above: spiral arms that fade toward the eye and the rim. */
export function vortexTexture(): THREE.CanvasTexture {
  return canvas(512, (ctx, s) => {
    ctx.translate(s / 2, s / 2)
    ctx.lineCap = 'round'
    for (let arm = 0; arm < 5; arm++) {
      for (let k = 0; k < 60; k++) {
        const t = k / 60
        const a = arm * ((Math.PI * 2) / 5) + t * Math.PI * 2.4
        const r = s * (0.06 + 0.42 * t)
        ctx.strokeStyle = `rgba(255,255,255,${(Math.sin(t * Math.PI) * 0.9).toFixed(3)})`
        ctx.lineWidth = 4 + 16 * t
        ctx.beginPath()
        ctx.arc(0, 0, r, a, a + 0.12)
        ctx.stroke()
      }
    }
  })
}

/** A spinning disc: a hot core and a bright serrated rim. */
export function discTexture(): THREE.CanvasTexture {
  return canvas(256, (ctx, s) => {
    ctx.translate(s / 2, s / 2)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)')
    g.addColorStop(0.8, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2
      const r = (k % 2 ? 0.44 : 0.5) * s
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    ctx.fill()
  })
}

/** A flying crescent: bright along its outer edge (v = 1) and in its middle, tapering to points at both ends. */
export function crescentTexture(): THREE.CanvasTexture {
  return canvas(256, (ctx, s) => {
    const along = ctx.createLinearGradient(0, 0, s, 0)
    along.addColorStop(0, 'rgba(255,255,255,0)')
    along.addColorStop(0.5, 'rgba(255,255,255,1)')
    along.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = along
    ctx.fillRect(0, 0, s, s)
    ctx.globalCompositeOperation = 'destination-in'
    const across = ctx.createLinearGradient(0, 0, 0, s)
    across.addColorStop(0, 'rgba(0,0,0,1)')
    across.addColorStop(0.2, 'rgba(0,0,0,0.8)')
    across.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = across
    ctx.fillRect(0, 0, s, s)
  })
}

/** A crescent standing upright with its convex side along +z, ready to fly: `lookAt` aims it. */
export function crescentGeometry(inner = 0.55, span = Math.PI * 0.9, segments = 28): THREE.BufferGeometry {
  const pos: number[] = []
  const uvs: number[] = []
  const index: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const a = -span / 2 + span * t
    for (const [r, v] of [
      [inner, 0],
      [1, 1],
    ]) {
      pos.push(0, Math.sin(a) * r, Math.cos(a) * r - 0.5)
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

/** A rough rock for meteors: an icosphere with its corners pushed in and out. */
export function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1)
  const p = g.getAttribute('position')
  const rnd = seeded(13)
  const bumps = new Map<string, number>()
  for (let i = 0; i < p.count; i++) {
    // the same corner shared by several faces moves once, so the rock stays closed
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`
    const k = bumps.get(key) ?? 0.78 + rnd() * 0.22
    bumps.set(key, k)
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k)
  }
  g.computeVertexNormals()
  return g
}

/**
 * Where a ribbon's points are at `age` seconds: point i of n, written into `out`. A path can say how many points it
 * wants: a few for a jagged lightning bolt, many for a smooth spiral.
 */
export type RibbonPath = ((i: number, n: number, age: number, out: THREE.Vector3) => void) & { points?: number }

interface Ribbon {
  path: RibbonPath
  color: THREE.Color
  width: number
  born: number
  life: number
  points: number
  /** Thin to nothing at the far end, like a streak. */
  taper: boolean
  flicker: boolean
  live: boolean
}

/**
 * Camera-facing ribbons along paths that move: lightning arcs struck again many times a second, spirals turning
 * round a beam, streaks. Every ribbon lives in one buffer, so the lot is a single draw call; a full pool gives its
 * oldest ribbon to the newest.
 */
export class RibbonPool {
  readonly mesh: THREE.Mesh
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly ribbons: Ribbon[] = []
  private next = 0
  private readonly geo = new THREE.BufferGeometry()
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Vector3()
  private readonly side = new THREE.Vector3()
  private readonly view = new THREE.Vector3()

  constructor(
    private readonly capacity: number,
    private readonly points = 64,
  ) {
    const verts = capacity * points * 2
    this.positions = new Float32Array(verts * 3)
    this.colors = new Float32Array(verts * 4)
    const index: number[] = []
    for (let r = 0; r < capacity; r++)
      for (let i = 0; i < points - 1; i++) {
        const a = (r * points + i) * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    this.geo.setIndex(index)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage))
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
  }

  spawn(path: RibbonPath, color: THREE.Color, width: number, life: number, now: number, options: { taper?: boolean; flicker?: boolean } = {}) {
    const points = Math.min(this.points, Math.max(2, path.points ?? this.points))
    const ribbon: Ribbon = { path, color: color.clone(), width, born: now, life, points, taper: !!options.taper, flicker: !!options.flicker, live: true }
    if (this.ribbons.length < this.capacity) this.ribbons.push(ribbon)
    else this.ribbons[this.next] = ribbon
    this.next = (this.next + 1) % this.capacity
  }

  live() {
    return this.ribbons.filter((r) => r.live).length
  }

  update(now: number, camera: THREE.Camera) {
    const n = this.points
    const pos = this.positions
    const col = this.colors
    for (let r = 0; r < this.ribbons.length; r++) {
      const ribbon = this.ribbons[r]
      if (!ribbon.live) continue
      const base = r * n * 2
      const age = now - ribbon.born
      if (age >= ribbon.life) {
        ribbon.live = false
        for (let v = 0; v < n * 2; v++) col[(base + v) * 4 + 3] = 0
        continue
      }
      const m = ribbon.points
      const fade = (1 - age / ribbon.life) * (ribbon.flicker ? 0.55 + 0.45 * Math.sin(age * 90 + r) ** 2 : 1)
      const { r: cr, g: cg, b: cb } = ribbon.color
      for (let i = 0; i < n; i++) {
        const v = (base + i * 2) * 3
        const c = (base + i * 2) * 4
        if (i >= m) {
          // the slot's unused points fold onto the last one, unseen
          pos.copyWithin(v, v - 6, v)
          col[c + 3] = col[c + 7] = 0
          continue
        }
        ribbon.path(i, m, age, this.p)
        if (i < m - 1) ribbon.path(i + 1, m, age, this.q)
        else {
          ribbon.path(i - 1, m, age, this.q)
          this.q.subVectors(this.p, this.q).add(this.p)
        }
        this.view.subVectors(camera.position, this.p)
        this.side.subVectors(this.q, this.p).cross(this.view)
        const along = ribbon.taper ? 1 - i / (m - 1) : 1
        if (this.side.lengthSq() > 1e-12) this.side.normalize().multiplyScalar((ribbon.width * along) / 2)
        const { x, y, z } = this.p
        const s = this.side
        pos[v] = x + s.x
        pos[v + 1] = y + s.y
        pos[v + 2] = z + s.z
        pos[v + 3] = x - s.x
        pos[v + 4] = y - s.y
        pos[v + 5] = z - s.z
        const alpha = fade * along ** 1.5
        col[c] = col[c + 4] = cr
        col[c + 1] = col[c + 5] = cg
        col[c + 2] = col[c + 6] = cb
        col[c + 3] = col[c + 7] = alpha
      }
    }
    this.geo.getAttribute('position').needsUpdate = true
    this.geo.getAttribute('color').needsUpdate = true
  }
}

/** A cheap repeatable hash in [-1, 1], for lightning that jitters the same way within a strike. */
export function jitter(a: number, b: number, c: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

/**
 * A lightning path from a to b, struck again `rate` times a second: each strike bends the middle up to `reach` metres
 * off the straight line, never the ends.
 */
export function lightning(a: THREE.Vector3, b: THREE.Vector3, reach: number, seed: number, rate = 22): RibbonPath {
  const along = new THREE.Vector3().subVectors(b, a)
  const n1 = new THREE.Vector3(along.z, 0, -along.x)
  if (n1.lengthSq() < 1e-8) n1.set(1, 0, 0)
  n1.normalize()
  const n2 = new THREE.Vector3().crossVectors(along, n1).normalize()
  const path: RibbonPath = (i, n, age, out) => {
    const t = i / (n - 1)
    const strike = Math.floor(age * rate)
    const bend = Math.sin(Math.PI * t) * reach
    out.copy(a).addScaledVector(along, t).addScaledVector(n1, jitter(seed, strike, i) * bend).addScaledVector(n2, jitter(seed + 7, strike, i) * bend)
  }
  // a dozen kinks read as a bolt; more turns it into noise
  path.points = 12
  return path
}

/** A spiral round the line from a to b, `turns` times over its length, turning `spin` times a second. */
export function spiral(a: THREE.Vector3, b: THREE.Vector3, radius: number, turns: number, spin: number, phase = 0): RibbonPath {
  const along = new THREE.Vector3().subVectors(b, a)
  const n1 = new THREE.Vector3(along.z, 0, -along.x)
  if (n1.lengthSq() < 1e-8) n1.set(1, 0, 0)
  n1.normalize()
  const n2 = new THREE.Vector3().crossVectors(along, n1).normalize()
  const path: RibbonPath = (i, n, age, out) => {
    const t = i / (n - 1)
    const angle = phase + t * turns * Math.PI * 2 + age * spin * Math.PI * 2
    out.copy(a).addScaledVector(along, t).addScaledVector(n1, Math.cos(angle) * radius).addScaledVector(n2, Math.sin(angle) * radius)
  }
  // about ten points a turn keeps it round
  path.points = Math.ceil(turns * 10) + 1
  return path
}

/** A straight line from a to b that stays put: a streak, laid with a handful of points so it can taper. */
export function straight(a: THREE.Vector3, b: THREE.Vector3): RibbonPath {
  const path: RibbonPath = (i, n, _age, out) => out.lerpVectors(a, b, i / (n - 1))
  path.points = 8
  return path
}
