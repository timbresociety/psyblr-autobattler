import * as THREE from 'three'
import { batchStatic } from './render/batch.js'

/**
 * The Game Centre hall round the House of Instinct (GAME.md §1 palette, owner 2026-11-03): instead of a valley outside
 * a barrier, one enormous 1990s Japanese arcade at Hypercharge scale, the heroes toy-sized inside it. Porcelain walls
 * with a cobalt wainscot and a vermilion stripe, a graphite ceiling hung with neutral fluorescent panels, the giant
 * pachinko cabinets whose ball trays the concourse fights on, the prize shelves behind each counter, and a gacha
 * machine in every corner. Nothing here is walked on or blocks: the engine's bounds stop a hero first. None of it
 * casts a shadow (the panels light it from above), and it batches to a draw per material.
 */

export const HALL = {
  /** How far past the arena's bounds the walls stand: the cabinets fill the sides, the ends hold shelves and gacha. */
  margin: 4,
  endMargin: 12,
  ceiling: 44,
  /** The main floor's height: where the cabinets and counters stand. */
  floor: 4.5,
  colors: {
    porcelain: 0xe9e3d7,
    graphite: 0x30383f,
    vermilion: 0xd44137,
    yellow: 0xeabb43,
    cobalt: 0x3569ab,
    jade: 0x70a99b,
    oxblood: 0x78464d,
    champagne: 0xcdb98f,
  },
} as const

const C = HALL.colors

/** A pachinko machine's face: a cream frame round a playfield of pin rows, a centre feature and a small screen. */
function pachinkoFace(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 384
  const g = canvas.getContext('2d')!
  g.fillStyle = '#e9e3d7'
  g.fillRect(0, 0, 256, 384)
  // the playfield: a deep red board behind glass, its pins in staggered rows
  g.fillStyle = '#9c2f2a'
  g.beginPath()
  g.ellipse(128, 170, 108, 140, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#cdb98f'
  for (let row = 0; row < 22; row++)
    for (let col = 0; col < 18; col++) {
      const x = 22 + col * 12 + (row % 2) * 6
      const y = 40 + row * 12
      if (((x - 128) / 104) ** 2 + ((y - 170) / 136) ** 2 < 1) g.fillRect(x, y, 2, 2)
    }
  // the centre feature: a gold-rimmed screen, the one emissive part (its glow comes from the emissive map)
  g.fillStyle = '#eabb43'
  g.fillRect(78, 122, 100, 76)
  g.fillStyle = '#3569ab'
  g.fillRect(84, 128, 88, 64)
  g.fillStyle = '#70a99b'
  g.beginPath()
  g.arc(128, 160, 18, 0, Math.PI * 2)
  g.fill()
  // the ball tray and the handle under the playfield
  g.fillStyle = '#30383f'
  g.fillRect(36, 318, 184, 40)
  g.fillStyle = '#cdb98f'
  g.fillRect(44, 326, 120, 22)
  g.fillStyle = '#d44137'
  g.beginPath()
  g.arc(200, 338, 12, 0, Math.PI * 2)
  g.fill()
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Where the face's screen glows: only the screen, per the palette's emissive rule. */
function screenMask(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 96
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 64, 96)
  g.fillStyle = '#7f9fd0'
  g.fillRect(21, 32, 22, 16)
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** `open` leaves off the ceiling and keeps the walls low: the staging board looks down on the whole House from above. */
export function buildHall(halfWidth: number, halfLength: number, open = false): THREE.Group {
  const group = new THREE.Group()
  group.name = 'hall'
  const X = halfWidth + HALL.margin
  const Z = halfLength + HALL.endMargin
  const top = open ? HALL.floor + 16 : HALL.ceiling
  const floor = HALL.floor
  const mats = new Map<string, THREE.Material>()
  const mat = (key: string, make: () => THREE.Material) => mats.get(key) ?? (mats.set(key, make()), mats.get(key)!)
  const plain = (color: number, roughness = 0.75, metalness = 0) => mat(`${color} ${roughness} ${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }))
  const statics = new THREE.Group()
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    m.position.set(x, y, z)
    m.receiveShadow = true
    statics.add(m)
    return m
  }

  // the shell: walls from the lower routes' floor to the ceiling, a cobalt wainscot and a vermilion stripe above it
  for (const s of [-1, 1]) {
    box(1, top, 2 * Z, s * (X + 0.5), top / 2, 0, plain(C.porcelain, 0.85))
    box(2 * X, top, 1, 0, top / 2, s * (Z + 0.5), plain(C.porcelain, 0.85))
    box(0.4, 6, 2 * Z, s * X, floor + 3, 0, plain(C.cobalt, 0.8))
    box(2 * X, 6, 0.4, 0, floor + 3, s * Z, plain(C.cobalt, 0.8))
    box(0.4, 1, 2 * Z, s * X, floor + 7, 0, plain(C.vermilion, 0.6))
    box(2 * X, 1, 0.4, 0, floor + 7, s * Z, plain(C.vermilion, 0.6))
  }
  if (!open) box(2 * X + 2, 1, 2 * Z + 2, 0, top + 0.5, 0, plain(C.graphite, 0.9))
  // the floor between the arena's bounds and the walls, under the cabinets, shelves and gacha machines, and a graphite
  // railing along the bounds at the ends, where a hero stops
  for (const s of [-1, 1]) {
    box(X - halfWidth, floor, 2 * Z, s * (halfWidth + (X - halfWidth) / 2), floor / 2, 0, plain(C.oxblood, 0.95))
    box(2 * halfWidth, floor, Z - halfLength, 0, floor / 2, s * (halfLength + (Z - halfLength) / 2), plain(C.oxblood, 0.95))
    box(2 * halfWidth, 0.12, 0.12, 0, floor + 1.1, s * (halfLength + 0.1), plain(C.graphite, 0.4, 0.6))
    for (let x = -halfWidth; x <= halfWidth; x += 4) box(0.1, 1.1, 0.1, x, floor + 0.55, s * (halfLength + 0.1), plain(C.graphite, 0.4, 0.6))
  }

  // Pachinko Alley's cabinets, one behind each ball tray: cream bodies, champagne trim, a vermilion marquee, and the face
  const face = mat('face', () => new THREE.MeshStandardMaterial({ map: pachinkoFace(), emissiveMap: screenMask(), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.45 }))
  for (const sx of [-1, 1])
    for (let zc = -50; zc <= 50; zc += 10) {
      const x = sx * (halfWidth + 2)
      box(4, 11, 9.2, x, floor + 5.5, zc, plain(C.porcelain, 0.5))
      box(4.2, 1.6, 9.4, x, floor + 11.8, zc, plain(C.vermilion, 0.5))
      box(4.3, 0.3, 9.5, x, floor + 11, zc, plain(C.champagne, 0.35, 0.6))
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 9.4), face)
      panel.position.set(x - sx * 2.01, floor + 6.2, zc)
      panel.rotation.y = -sx * Math.PI / 2
      statics.add(panel)
    }

  // the prize shelves behind each end's counter: jade frames, shelves of oversized prizes (capsules and plush balls)
  const prizes: { at: THREE.Vector3; r: number; color: number }[] = []
  const prizeColors = [C.yellow, C.vermilion, C.cobalt, C.jade, 0xf2a7b8, 0xffffff]
  for (const s of [-1, 1]) {
    const z = s * (halfLength + 3)
    box(34, 14, 4, 0, floor + 7, z + s * 0.6, plain(C.jade, 0.6))
    for (let shelf = 0; shelf < 3; shelf++) {
      const y = floor + 2.2 + shelf * 4
      box(32, 0.4, 3.6, 0, y, z - s * 0.4, plain(C.porcelain, 0.5))
      for (let k = 0; k < 9; k++) prizes.push({ at: new THREE.Vector3(-14 + k * 3.5, y + 1.4, z - s * 0.8), r: 1.2 + ((k * 7 + shelf * 3) % 3) * 0.15, color: prizeColors[(k + shelf * 2 + (s > 0 ? 1 : 0)) % prizeColors.length] })
    }
  }

  // giant gacha machines along each end behind the railing: a yellow body, a clear dome of capsules, a coin slot
  const capsules: { at: THREE.Vector3; r: number; color: number }[] = []
  const dome = mat('dome', () => new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false }))
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const at = new THREE.Vector3(sx * 42, floor, sz * (halfLength + 6.5))
      box(9, 9, 9, at.x, floor + 4.5, at.z, plain(C.yellow, 0.4))
      box(9.4, 0.8, 9.4, at.x, floor + 9.2, at.z, plain(C.porcelain, 0.4))
      box(2.4, 2.4, 0.6, at.x, floor + 4, at.z - sz * 4.6, plain(C.graphite, 0.4, 0.4))
      const glass = new THREE.Mesh(new THREE.SphereGeometry(5.6, 32, 20), dome)
      glass.position.set(at.x, floor + 14.6, at.z)
      group.add(glass)
      for (let k = 0; k < 26; k++) {
        const a = k * 2.399
        const rr = 1.2 + (k % 5) * 0.8
        capsules.push({ at: new THREE.Vector3(at.x + Math.cos(a) * rr, floor + 10.8 + (k % 4) * 1.1, at.z + Math.sin(a) * rr), r: 1.1, color: prizeColors[k % prizeColors.length] })
      }
    }

  // the prizes and capsules: one instanced sphere draw, two-tone capsules read from far off by colour alone
  const balls = [...prizes, ...capsules]
  const spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), plain(0xffffff, 0.35), balls.length)
  const m = new THREE.Matrix4()
  balls.forEach((b, i) => {
    spheres.setMatrixAt(i, m.makeScale(b.r, b.r, b.r).setPosition(b.at))
    spheres.setColorAt(i, new THREE.Color(b.color))
  })
  spheres.name = 'prizes'
  group.add(spheres)

  // the ceiling's fluorescent panels: neutral white at 4500–5000 K, one instanced draw
  const panels: THREE.Vector3[] = []
  if (!open) for (let x = -X + 8; x <= X - 8; x += 12) for (let z = -Z + 6; z <= Z - 6; z += 10) panels.push(new THREE.Vector3(x, top - 0.05, z))
  const lights = new THREE.InstancedMesh(new THREE.PlaneGeometry(6, 1.4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e8).multiplyScalar(1.6), toneMapped: false }), panels.length)
  panels.forEach((p, i) => lights.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)))
  lights.name = 'panels'
  if (panels.length) group.add(lights)

  batchStatic(statics)
  group.add(statics)
  group.traverse((o) => {
    o.castShadow = false
    o.name ||= 'hall'
  })
  return group
}
