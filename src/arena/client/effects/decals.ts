import * as THREE from 'three'

/**
 * Marks on the ground (GAME.md §6b): craters where heavies, slams and ultimates land, skid marks where a knockback slid
 * a body along the floor, and the elements' marks (scorch, frost, acid, char, void, a holy ring). Each lies on the
 * floor under it, tilted to a ramp's slope, and fades away; at most `DECAL_BUDGET` at once, the oldest giving way.
 */
export const DECAL_BUDGET = 64

export type Mark = 'crater' | 'scorch' | 'frost' | 'acid' | 'char' | 'void' | 'holy' | 'skid'

/** Seconds a mark stays before it has faded out; it fades over its last third. */
export const MARK_LIFE: Record<Mark, number> = { crater: 14, scorch: 10, frost: 9, acid: 9, char: 9, void: 9, holy: 6, skid: 7 }
const TINT: Record<Mark, number> = { crater: 0x2a221c, scorch: 0x140f0c, frost: 0xd8f2ff, acid: 0x5fd13a, char: 0x1a1612, void: 0x3a1a5c, holy: 0xffd970, skid: 0x2b241e }
const OPACITY: Record<Mark, number> = { crater: 0.9, scorch: 0.8, frost: 0.85, acid: 0.7, char: 0.85, void: 0.75, holy: 0.8, skid: 0.6 }

type Art = 'crater' | 'blotch' | 'frost' | 'streaks' | 'ring' | 'skid'
const ART: Record<Mark, Art> = { crater: 'crater', scorch: 'blotch', frost: 'frost', acid: 'blotch', char: 'streaks', void: 'blotch', holy: 'ring', skid: 'skid' }

function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/** Each mark's picture: white and greys with alpha, tinted by its material. Undefined without a DOM (tests). */
function paint(art: Art): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  if (!g) return undefined
  const r = seeded(art.length * 7919 + 13)
  const mid = size / 2
  const blotch = (inner: number, outer: number, alpha: number) => {
    const grad = g.createRadialGradient(mid, mid, size * inner, mid, mid, size * outer)
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`)
    grad.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.7})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    // a ragged edge: a ring of overlapping lobes
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2
      const d = size * outer * (0.15 + r() * 0.25)
      g.beginPath()
      g.arc(mid + Math.cos(a) * d, mid + Math.sin(a) * d, size * outer * (0.55 + r() * 0.25), 0, Math.PI * 2)
      g.fill()
    }
  }
  const cracks = (n: number, reach: number, width: number) => {
    g.strokeStyle = 'rgba(255,255,255,0.95)'
    g.lineCap = 'round'
    for (let k = 0; k < n; k++) {
      let a = (k / n) * Math.PI * 2 + r() * 0.5
      let x = mid
      let y = mid
      g.lineWidth = width
      g.beginPath()
      g.moveTo(x, y)
      for (let s = 0; s < 6; s++) {
        a += (r() - 0.5) * 0.9
        const step = (size * reach) / 6
        x += Math.cos(a) * step
        y += Math.sin(a) * step
        g.lineTo(x, y)
      }
      g.stroke()
    }
  }
  switch (art) {
    case 'crater':
      blotch(0, 0.32, 0.55)
      g.fillStyle = 'rgba(255,255,255,0.9)'
      g.beginPath()
      g.arc(mid, mid, size * 0.16, 0, Math.PI * 2)
      g.fill()
      cracks(9, 0.46, 2.4)
      break
    case 'blotch':
      blotch(0, 0.36, 0.9)
      break
    case 'frost':
      blotch(0, 0.3, 0.5)
      cracks(12, 0.44, 1.6)
      break
    case 'streaks':
      blotch(0, 0.22, 0.7)
      cracks(7, 0.48, 1.8)
      break
    case 'ring': {
      g.strokeStyle = 'rgba(255,255,255,0.95)'
      g.lineWidth = size * 0.05
      g.beginPath()
      g.arc(mid, mid, size * 0.38, 0, Math.PI * 2)
      g.stroke()
      g.lineWidth = size * 0.015
      g.beginPath()
      g.arc(mid, mid, size * 0.3, 0, Math.PI * 2)
      g.stroke()
      break
    }
    case 'skid':
      // two scrapes along the slide (the texture's x), fading at both ends
      for (const y of [0.38, 0.62]) {
        const grad = g.createLinearGradient(0, 0, size, 0)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.2, 'rgba(255,255,255,0.9)')
        grad.addColorStop(0.85, 'rgba(255,255,255,0.7)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grad
        g.fillRect(0, size * (y - 0.07), size, size * 0.14)
      }
      break
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const textures = new Map<Art, THREE.Texture | undefined>()
const art = (a: Art) => {
  if (!textures.has(a)) textures.set(a, paint(a))
  return textures.get(a)
}

interface Live {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  kind: Mark
  born: number
  life: number
  opacity: number
  live: boolean
}

const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const UP = new THREE.Vector3(0, 1, 0)

export class Decals {
  readonly group = new THREE.Group()
  private readonly marks: Live[] = []
  private next = 0
  private layer = 0

  constructor(
    private readonly floorAt: (p: { x: number; y: number; z: number }) => number,
    readonly budget = DECAL_BUDGET,
  ) {
    this.group.name = 'fx:decals'
    for (let i = 0; i < budget; i++) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      const mesh = new THREE.Mesh(flat, material)
      mesh.visible = false
      mesh.renderOrder = 1
      this.group.add(mesh)
      this.marks.push({ mesh, material, kind: 'scorch', born: 0, life: 0, opacity: 0, live: false })
    }
  }

  live(): number {
    return this.marks.reduce((n, m) => n + (m.live ? 1 : 0), 0)
  }

  /**
   * Lay a mark of `size` metres across at `at` (on the floor under it). A skid runs `length` metres along `yaw`
   * (radians about y, 0 along +z).
   */
  place(kind: Mark, at: { x: number; y: number; z: number }, size: number, clock: number, options: { yaw?: number; length?: number; color?: THREE.Color } = {}) {
    // a blow landing where the same mark already lies deepens that one (fresh again, a little wider) instead of
    // spending another: a brawl on one spot would otherwise use up the budget in seconds
    if (kind !== 'skid') {
      const same = this.marks.find((m) => m.live && m.kind === kind && Math.hypot(m.mesh.position.x - at.x, m.mesh.position.z - at.z) < m.mesh.scale.x * 0.5 && Math.abs(m.mesh.position.y - this.floorAt(at)) < 0.5)
      if (same) {
        same.born = clock
        same.material.opacity = same.opacity
        same.mesh.scale.setScalar(Math.min(Math.max(same.mesh.scale.x, size) * 1.08, size * 1.5)).setY(1)
        return
      }
    }
    const m = this.marks[this.next]
    this.next = (this.next + 1) % this.budget
    const y = this.floorAt(at)
    m.kind = kind
    m.born = clock
    m.life = MARK_LIFE[kind]
    m.opacity = OPACITY[kind]
    m.live = true
    const map = art(ART[kind])
    if (m.material.map !== (map ?? null)) {
      m.material.map = map ?? null
      m.material.needsUpdate = true
    }
    m.material.color.set(options.color ?? TINT[kind])
    m.material.opacity = m.opacity
    m.material.blending = kind === 'holy' || kind === 'frost' ? THREE.AdditiveBlending : THREE.NormalBlending
    // each new mark a hair above the last, so overlapping marks never flicker through each other
    this.layer = (this.layer + 1) % 16
    m.mesh.position.set(at.x, y + 0.02 + this.layer * 0.002, at.z)
    // lie on the surface: tilted to a ramp's slope, flat on a floor or across a ledge's lip
    const normal = this.normalAt(at.x, y, at.z)
    m.mesh.quaternion.setFromUnitVectors(UP, normal)
    m.mesh.rotateY(options.yaw ?? Math.random() * Math.PI * 2)
    if (kind === 'skid') m.mesh.scale.set(size, 1, options.length ?? size)
    else m.mesh.scale.set(size, 1, size)
    m.mesh.visible = true
  }

  private normalAt(x: number, y: number, z: number): THREE.Vector3 {
    const d = 0.4
    const at = (dx: number, dz: number) => this.floorAt({ x: x + dx, y: y + 0.3, z: z + dz })
    const hx = at(d, 0) - at(-d, 0)
    const hz = at(0, d) - at(0, -d)
    // a step or a ledge's lip in reach is no slope: lie flat
    if (Math.abs(hx) > 0.6 || Math.abs(hz) > 0.6) return UP.clone()
    return new THREE.Vector3(-hx / (2 * d), 1, -hz / (2 * d)).normalize()
  }

  step(clock: number) {
    for (const m of this.marks) {
      if (!m.live) continue
      const age = clock - m.born
      if (age >= m.life) {
        m.live = false
        m.mesh.visible = false
        continue
      }
      const fadeFrom = m.life * (2 / 3)
      m.material.opacity = age < fadeFrom ? m.opacity : m.opacity * (1 - (age - fadeFrom) / (m.life - fadeFrom))
    }
  }
}
