import * as THREE from 'three'
import type { Build } from '../../charter/build'
import type { RoleId } from '../../charter/types'

/**
 * What a hero looks like in the arena's own characters (R24), without any renderer: which of the four Blender builds
 * it wears (tools/blender/hero.py), its colours per body region, and which switchable parts show. The arena and the
 * staging busts both read it, so a hero looks the same in its portrait as on the field, on either side.
 */

export type Build3D = 'athletic' | 'lithe' | 'heavy' | 'lean'
export type Hair = 'crop' | 'spiky' | 'long' | 'helmet'

/** Order matches REGIONS and PARTS in tools/blender/hero.py. */
const REGIONS = ['skin', 'suit', 'trim', 'pants', 'glove', 'boot', 'hair', 'metal', 'eye', 'iris', 'brow', 'cape'] as const
type Region = (typeof REGIONS)[number]
const PARTS = ['base', 'hair:crop', 'hair:spiky', 'hair:long', 'hair:helmet', 'armour', 'cape'] as const

export interface CharacterLook {
  build: Build3D
  hair: Hair
  armour: boolean
  cape: boolean
  colors: Record<Region, THREE.Color>
}

const BUILD_FOR: Record<RoleId, Build3D> = { tank: 'heavy', fighter: 'athletic', assassin: 'lean', mage: 'lithe', marksman: 'lean', support: 'lithe' }

/** A small stable number from a hero's name, so its hair and skin never depend on which slot or side it fights in. */
function seedOf(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A hero's look from its role and hue: tanks wear a Roman helmet and armour, fighters a cape, and so on. */
export function characterLook(build: Build, hue: number): CharacterLook {
  const role = build.roleId as RoleId
  const index = seedOf(build.heroName ?? build.roleId)
  const styles: Hair[] = ['spiky', 'crop', 'long']
  const hair: Hair = role === 'tank' ? 'helmet' : styles[index % styles.length]
  const c = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace)
  const skinTones = [c(0.07, 0.45, 0.72), c(0.06, 0.4, 0.55), c(0.07, 0.35, 0.4), c(0.08, 0.5, 0.82)]
  return {
    build: BUILD_FOR[role] ?? 'athletic',
    hair,
    armour: role === 'tank' || role === 'fighter' || role === 'support',
    cape: role === 'fighter' || role === 'mage' || role === 'tank',
    colors: {
      skin: skinTones[index % skinTones.length],
      suit: c(hue, 0.72, 0.5),
      trim: c(hue + 0.09, 0.8, 0.66),
      pants: c(hue, 0.3, 0.16),
      glove: c(0.12, 0.12, 0.9),
      boot: c(hue + 0.03, 0.25, 0.12),
      hair: [c(0.08, 0.5, 0.12), c(0.1, 0.65, 0.55), c(0.0, 0.0, 0.08), c(hue + 0.5, 0.6, 0.45)][index % 4],
      metal: c(0.1, 0.55, 0.55),
      eye: c(0, 0, 0.96),
      iris: c(hue + 0.45, 0.6, 0.35),
      brow: c(0.08, 0.4, 0.1),
      // a deep, dusty cloth tone: a bright cape reads as a board behind the hero
      cape: c(hue + 0.5, 0.42, 0.24),
    },
  }
}

export type Gltf = { scene: THREE.Group; animations: THREE.AnimationClip[] }
const files = new Map<Build3D, Promise<Gltf>>()

/** Load (once) and cache a build's GLB; `load` is the shared GLTF loader with meshopt support. */
export function loadBuild(build: Build3D, load: (url: string) => Promise<Gltf>): Promise<Gltf> {
  let file = files.get(build)
  if (!file) {
    file = load(`/heroes/${build}.glb`).catch((e: unknown) => {
      files.delete(build)
      throw e
    })
    files.set(build, file)
  }
  return file
}

/** The hero's geometry: shares the build's buffers, with its own colours and only the triangles of parts it wears. */
export function paintGeometry(source: THREE.BufferGeometry, look: CharacterLook): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(source.attributes)) if (name !== 'color') geo.setAttribute(name, attr)
  const meta = source.getAttribute('uv')
  const n = meta.count
  const colors = new Float32Array(n * 3)
  const shown = new Set<string>(['base', `hair:${look.hair}`, ...(look.armour ? ['armour'] : []), ...(look.cape ? ['cape'] : [])])
  const visible = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const region = REGIONS[Math.min(REGIONS.length - 1, Math.floor(meta.getX(i)))]
    // glTF flips v on export (its texture origin is the top-left), so the part index comes back as 1 - v
    const part = PARTS[Math.min(PARTS.length - 1, Math.max(0, Math.floor(1 - meta.getY(i))))]
    const col = look.colors[region]
    colors[i * 3] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
    visible[i] = shown.has(part) ? 1 : 0
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const index = source.getIndex()
  if (index) {
    const kept: number[] = []
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t)
      const b = index.getX(t + 1)
      const c = index.getX(t + 2)
      if (visible[a] && visible[b] && visible[c]) kept.push(a, b, c)
    }
    geo.setIndex(kept)
  }
  geo.boundingSphere = source.boundingSphere?.clone() ?? null
  return geo
}

