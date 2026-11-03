import * as THREE from 'three'
import type { CoverPiece } from '../../engine/cover.js'
import { LEVEL } from '../../engine/house.js'
import type { DebrisPool } from './debris.js'

/**
 * Breakable props (GAME.md §6b): the house's dressing (chip stacks and cards on the poker tables, dice on the dealer
 * stations, gacha capsules by the slot machines, the machines' cabinet panels, signs at the court's entrances,
 * railings along the back of the VIP walkway) shatters under blasts and when a body is knocked into it, and the loose
 * things scatter when walked through. Each is pre-fractured when the map loads, so nothing is cut at runtime: breaking
 * one hides it and throws its own chunks. All cosmetic: the engine's breakables (cover, glass, card bridges) are the
 * engine's, and `fracture` gives them chunks too.
 */
export type PropKind = 'chips' | 'card' | 'dice' | 'capsule' | 'panel' | 'sign' | 'railing'
type Shape = 'box' | 'disc' | 'ball'

interface Part {
  shape: Shape
  at: THREE.Vector3
  size: THREE.Vector3
  color: THREE.Color
  /** The slot in its shape's instanced mesh. */
  slot: number
}

export interface Chunk {
  at: { x: number; y: number; z: number }
  size: { x: number; y: number; z: number }
}

export interface Prop {
  kind: PropKind
  centre: THREE.Vector3
  /** Reach of its body round the centre, metres. */
  radius: number
  /** Breaks only under a blast or a body knocked into it; loose things also scatter when walked through. */
  sturdy: boolean
  parts: Part[]
  chunks: Chunk[]
  color: THREE.Color
  broken: boolean
}

function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/**
 * Cut a box into chunks once, ahead of time: a grid of `nx` × `ny` × `nz` cells whose inner cut lines are jittered so
 * the pieces come out uneven, each shrunk a little so they read as separate pieces.
 */
export function fractureBox(centre: { x: number; y: number; z: number }, size: { x: number; y: number; z: number }, nx: number, ny: number, nz: number, seed = 1): Chunk[] {
  const r = seeded(seed * 48271 + 11)
  const cuts = (n: number) => {
    const c = [0]
    for (let i = 1; i < n; i++) c.push((i + (r() - 0.5) * 0.5) / n)
    c.push(1)
    return c
  }
  const [cx, cy, cz] = [cuts(nx), cuts(ny), cuts(nz)]
  const out: Chunk[] = []
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const lo = { x: centre.x - size.x / 2 + cx[i] * size.x, y: centre.y - size.y / 2 + cy[j] * size.y, z: centre.z - size.z / 2 + cz[k] * size.z }
        const hi = { x: centre.x - size.x / 2 + cx[i + 1] * size.x, y: centre.y - size.y / 2 + cy[j + 1] * size.y, z: centre.z - size.z / 2 + cz[k + 1] * size.z }
        out.push({ at: { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 }, size: { x: (hi.x - lo.x) * 0.92, y: (hi.y - lo.y) * 0.92, z: (hi.z - lo.z) * 0.92 } })
      }
  return out
}

/** Chunks for one of the engine's breakable pieces (a barricade, a glass partition, a card bridge), cut by its size. */
export function fracture(piece: CoverPiece, seed = 1): Chunk[] {
  const s = piece.shape
  const h = piece.top - piece.base
  const centre = { x: s.x, y: (piece.top + piece.base) / 2, z: s.z }
  if (s.kind === 'column') return fractureBox(centre, { x: s.r * 1.6, y: h, z: s.r * 1.6 }, 2, Math.max(1, Math.round(h / 0.6)), 2, seed)
  const size = { x: s.hx * 2, y: h, z: s.hz * 2 }
  if (piece.look === 'glass') {
    // a pane: thin shards across its face, about 0.3 m, a pane's thickness through it
    const n = (len: number) => Math.max(1, Math.min(8, Math.round(len / 0.3)))
    const across = size.x >= size.z
    const shards = fractureBox(centre, size, across ? n(size.x) : 1, Math.min(5, n(size.y)), across ? 1 : n(size.z), seed)
    for (const c of shards) c.size = across ? { ...c.size, z: 0.04 } : { ...c.size, x: 0.04 }
    return shards
  }
  // about 0.7 m pieces, never more than 40 from one piece
  const n = (len: number) => Math.max(1, Math.min(8, Math.round(len / 0.7)))
  const [nx, ny, nz] = [n(size.x), n(size.y), n(size.z)]
  const scale = Math.min(1, Math.cbrt(40 / (nx * ny * nz)))
  return fractureBox(centre, size, Math.max(1, Math.round(nx * scale)), Math.max(1, Math.round(ny * scale)), Math.max(1, Math.round(nz * scale)), seed)
}

/** The colour pieces of a broken engine piece fly in. */
export const pieceColor = (piece: CoverPiece) => new THREE.Color(piece.look === 'glass' ? 0x7cc6f2 : piece.look === 'card' ? 0xf3ead6 : piece.look === 'barricade' ? 0xa23e2a : 0x8f8a84)

const CHIP_COLORS = [0xd23b3b, 0x2f6fd8, 0x2fa65a, 0x1c1c1c, 0xf2f2f2]
const CAPSULE_COLORS = [0xff6fa8, 0x6fd3ff, 0xffd84d, 0x8cff7a, 0xc48cff]

/** Where the house's props stand: a few dozen each half, mirrored like the map. */
export function houseProps(floorAt: (p: { x: number; y: number; z: number }) => number): Prop[] {
  const props: Prop[] = []
  const { main, up } = LEVEL
  const r = seeded(7)
  const put = (kind: PropKind, parts: Omit<Part, 'slot'>[], chunks: Chunk[], sturdy: boolean, color: THREE.Color) => {
    const centre = new THREE.Vector3()
    for (const p of parts) centre.add(p.at)
    centre.divideScalar(parts.length)
    let radius = 0
    for (const p of parts) radius = Math.max(radius, p.at.distanceTo(centre) + p.size.length() / 2)
    props.push({ kind, centre, radius, sturdy, parts: parts.map((p) => ({ ...p, slot: -1 })), chunks, color, broken: false })
  }
  const on = (x: number, z: number, from: number) => floorAt({ x, y: from, z })
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

  for (const s of [-1, 1]) {
    // chip stacks and cards on the poker tables
    for (const [tx, tz] of [[-26, 12], [-26, 20]] as const) {
      const top = on(tx, tz * s, main + 2)
      for (let k = 0; k < 5; k++) {
        const x = tx - 2.2 + k * 1.1 + (r() - 0.5) * 0.3
        const z = (tz + (r() - 0.5) * 2.4) * s
        const chips = 4 + Math.floor(r() * 6)
        const color = new THREE.Color(CHIP_COLORS[k % CHIP_COLORS.length])
        const h = chips * 0.04
        put('chips', [{ shape: 'disc', at: v(x, top + h / 2, z), size: v(0.36, h, 0.36), color }], fractureBox({ x, y: top + h / 2, z }, { x: 0.34, y: h, z: 0.34 }, 1, chips, 1, k + tz), false, color)
      }
      for (let k = 0; k < 4; k++) {
        const x = tx - 1.5 + k + (r() - 0.5) * 0.4
        const z = (tz + (r() - 0.5) * 2) * s
        const color = new THREE.Color(0xf6f1e4)
        put('card', [{ shape: 'box', at: v(x, top + 0.01, z), size: v(0.26, 0.01, 0.36), color }], [{ at: { x, y: top + 0.01, z }, size: { x: 0.26, y: 0.01, z: 0.36 } }], false, color)
      }
    }
    // dice on the dealer stations
    for (const [x0, z0] of [[-36.25, 12.75], [-26.25, 7.25], [-14.25, 23.75]] as const) {
      const top = on(x0, z0 * s, main + 2)
      for (let k = 0; k < 2; k++) {
        const x = x0 + (k - 0.5) * 0.5
        const z = (z0 + (r() - 0.5) * 0.4) * s
        const color = new THREE.Color(k ? 0xd23b3b : 0xf6f1e4)
        put('dice', [{ shape: 'box', at: v(x, top + 0.13, z), size: v(0.26, 0.26, 0.26), color }], fractureBox({ x, y: top + 0.13, z }, { x: 0.26, y: 0.26, z: 0.26 }, 2, 1, 2, k + 3), false, color)
      }
    }
    // cabinet panels on the slot machines' court-facing fronts, and gacha capsules piled beside them
    for (const [mx, mz] of [[11, 28], [15, 28], [19, 31], [9, 35]] as const) {
      const face = (mz - 0.75 - 0.05) * s
      const y = main + 1.7
      const color = new THREE.Color(0x3a3f6b)
      put('panel', [{ shape: 'box', at: v(mx, y, face), size: v(1.6, 1.3, 0.08), color }], fractureBox({ x: mx, y, z: face }, { x: 1.6, y: 1.3, z: 0.08 }, 3, 2, 1, mx), true, color)
      for (let k = 0; k < 4; k++) {
        const x = mx + 1.4 + (r() - 0.5) * 0.8
        const z = (mz - 1.6 + (r() - 0.5) * 1.2) * s
        const floor = on(x, z, main + 0.5)
        const color = new THREE.Color(CAPSULE_COLORS[(k + mx) % CAPSULE_COLORS.length])
        put('capsule', [{ shape: 'ball', at: v(x, floor + 0.22, z), size: v(0.44, 0.44, 0.44), color }], fractureBox({ x, y: floor + 0.22, z }, { x: 0.4, y: 0.4, z: 0.4 }, 1, 2, 1, k), false, color)
      }
    }
    // signs at the court's four entrances, beside the gap in the ring of posts
    for (const [x, z] of [[3.2, 17.5], [-3.2, 17.5]] as const) {
      const zz = z * s
      const floor = on(x, zz, main + 0.5)
      const color = new THREE.Color(0xffc820)
      put(
        'sign',
        [
          { shape: 'box', at: v(x, floor + 0.7, zz), size: v(0.08, 1.4, 0.08), color: new THREE.Color(0x555555) },
          { shape: 'box', at: v(x, floor + 1.55, zz), size: v(1.3, 0.7, 0.06), color },
        ],
        [...fractureBox({ x, y: floor + 1.55, z: zz }, { x: 1.3, y: 0.7, z: 0.06 }, 3, 2, 1, Math.round(x * 10)), ...fractureBox({ x, y: floor + 0.7, z: zz }, { x: 0.08, y: 1.4, z: 0.08 }, 1, 2, 1, 5)],
        true,
        color,
      )
    }
    for (const [x, z] of [[17.5, 3.2], [17.5, -3.2]] as const) {
      const xx = x * s
      const floor = on(xx, z, main + 0.5)
      const color = new THREE.Color(0xffc820)
      put(
        'sign',
        [
          { shape: 'box', at: v(xx, floor + 0.7, z), size: v(0.08, 1.4, 0.08), color: new THREE.Color(0x555555) },
          { shape: 'box', at: v(xx, floor + 1.55, z), size: v(0.06, 0.7, 1.3), color },
        ],
        [...fractureBox({ x: xx, y: floor + 1.55, z }, { x: 0.06, y: 0.7, z: 1.3 }, 1, 2, 3, Math.round(z * 10)), ...fractureBox({ x: xx, y: floor + 0.7, z }, { x: 0.08, y: 1.4, z: 0.08 }, 1, 2, 1, 6)],
        true,
        color,
      )
    }
    // railings along the back of the VIP walkway, in 2 m sections
    for (let x = -21; x < 21; x += 2) {
      const z = 33.8 * s
      const y = up
      const color = new THREE.Color(0xb9b2a6)
      const cx = x + 1
      put(
        'railing',
        [
          { shape: 'box', at: v(cx, y + 1, z), size: v(2, 0.07, 0.07), color },
          { shape: 'box', at: v(x + 0.1, y + 0.5, z), size: v(0.07, 1, 0.07), color },
          { shape: 'box', at: v(x + 1.9, y + 0.5, z), size: v(0.07, 1, 0.07), color },
        ],
        [...fractureBox({ x: cx, y: y + 1, z }, { x: 2, y: 0.07, z: 0.07 }, 3, 1, 1, x + 40), { at: { x: x + 0.1, y: y + 0.5, z }, size: { x: 0.07, y: 1, z: 0.07 } }, { at: { x: x + 1.9, y: y + 0.5, z }, size: { x: 0.07, y: 1, z: 0.07 } }],
        true,
        color,
      )
    }
  }
  return props
}

const GEOMETRY: Record<Shape, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  disc: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  ball: () => new THREE.SphereGeometry(0.5, 14, 10),
}

export class Props {
  readonly group = new THREE.Group()
  private readonly meshes: Record<Shape, THREE.InstancedMesh>
  private readonly place = new THREE.Object3D()

  constructor(readonly props: Prop[]) {
    this.group.name = 'fx:props'
    const counts: Record<Shape, number> = { box: 0, disc: 0, ball: 0 }
    for (const p of props) for (const part of p.parts) part.slot = counts[part.shape]++
    this.meshes = {} as Record<Shape, THREE.InstancedMesh>
    for (const shape of ['box', 'disc', 'ball'] as const) {
      const mesh = new THREE.InstancedMesh(GEOMETRY[shape](), new THREE.MeshStandardMaterial({ roughness: shape === 'ball' ? 0.3 : 0.6, metalness: 0.05 }), Math.max(1, counts[shape]))
      mesh.name = `props:${shape}`
      mesh.count = counts[shape]
      mesh.castShadow = mesh.receiveShadow = true
      this.meshes[shape] = mesh
      this.group.add(mesh)
    }
    for (const p of props) for (const part of p.parts) this.set(part, true)
    for (const m of Object.values(this.meshes)) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }

  private set(part: Part, shown: boolean) {
    const mesh = this.meshes[part.shape]
    this.place.position.copy(part.at)
    this.place.scale.copy(part.size).multiplyScalar(shown ? 1 : 0)
    this.place.updateMatrix()
    mesh.setMatrixAt(part.slot, this.place.matrix)
    if (shown) mesh.setColorAt(part.slot, part.color)
  }

  /** Props still standing. */
  standing(): number {
    return this.props.filter((p) => !p.broken).length
  }

  private shatter(p: Prop, from: { x: number; y: number; z: number }, debris: DebrisPool, force: number) {
    p.broken = true
    for (const part of p.parts) {
      this.set(part, false)
      this.meshes[part.shape].instanceMatrix.needsUpdate = true
    }
    debris.shatter(p.chunks, from, { speed: 3 + 3 * force, up: 2 + 2 * force, color: p.color, life: 5 })
  }

  /** A blast of `radius` at `at` breaks every prop it reaches; returns how many broke. */
  blast(at: { x: number; y: number; z: number }, radius: number, debris: DebrisPool, force = 1): number {
    let n = 0
    for (const p of this.props) {
      if (p.broken) continue
      const d = Math.sqrt((p.centre.x - at.x) ** 2 + (p.centre.y - at.y) ** 2 + (p.centre.z - at.z) ** 2)
      if (d <= radius + p.radius) (this.shatter(p, at, debris, force), n++)
    }
    return n
  }

  /**
   * A body at `feet` (an upright capsule of `radius` and `height`) going through the props: a body knocked back
   * (`thrown`) breaks anything it meets; one walking only scatters the loose things.
   */
  body(feet: { x: number; y: number; z: number }, radius: number, height: number, thrown: boolean, debris: DebrisPool): number {
    let n = 0
    for (const p of this.props) {
      if (p.broken || (p.sturdy && !thrown)) continue
      const y = Math.min(feet.y + height, Math.max(feet.y, p.centre.y))
      const d = Math.sqrt((p.centre.x - feet.x) ** 2 + (p.centre.y - y) ** 2 + (p.centre.z - feet.z) ** 2)
      if (d <= radius + p.radius) (this.shatter(p, { x: feet.x, y: p.centre.y - 0.3, z: feet.z }, debris, thrown ? 1 : 0.3), n++)
    }
    return n
  }
}
