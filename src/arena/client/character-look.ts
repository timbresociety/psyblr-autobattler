import * as THREE from 'three'
import type { Build } from '../../charter/build.js'
import { defaultLook, outfitOf, ROLE_GENDER, type FacePhoto, type Gender, type LookSlot, type Worn } from '../../charter/look.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../../kit/body/shape.js'
import { ALL_SIZE_CLASSES, type SizeClass } from '../../charter/sizes.js'
import { DEMO_HEROES } from '../demo/roster.js'

/**
 * What a hero looks like in the arena's own characters (R24), without any renderer: which body it wears (its size and
 * gender), how that body is built, its skin and photo face, and its outfit from the wardrobe (wear/dress-model.ts
 * dresses the body with it). Every hero is made this way, the demo roster too (demo/looks.ts). The bodies come from
 * tools/blender/human.py. The arena, the staging busts and the 3D previews all read this, so a hero looks the same in
 * its portrait as on the field, on either side.
 */

/** A body for every size class in both genders, drawn at one nominal height: the game's size scale makes it big. */
export type BodyName = `${Gender}-${SizeClass}`
export const BODIES: readonly BodyName[] = (['m', 'f'] as const).flatMap((g) => ALL_SIZE_CLASSES.map((s) => `${g}-${s}` as BodyName))

export interface CharacterLook {
  build: BodyName
  /** How the body is built. */
  physique: Physique
  /** What it wears, slot by slot. */
  outfit: Partial<Record<LookSlot, Worn>>
  /** The body's own colours: its skin (baked into the hero's atlas under a photo face) and the whites of its eyes. */
  colors: { skin: THREE.Color; eye: THREE.Color }
  /** A photo face to warp onto the body's own; its skin colour is then baked into the hero's atlas (face/composite). */
  face?: FacePhoto
}

/** The body a hero wears: its size class (colossal while transformed) in its look's gender, or its role's without one. */
export function bodyFor(build: Pick<Build, 'roleId' | 'sizeClass' | 'look'>, size: SizeClass = build.sizeClass ?? 'medium'): BodyName {
  return `${build.look?.gender ?? ROLE_GENDER[build.roleId] ?? 'm'}-${size}`
}

/**
 * A hero's signature colour: a demo hero's own, else a stable one from its name. The arena, the portraits and the 3D
 * previews all read this, so a hero keeps it everywhere and while it is edited.
 */
export function heroHue(name: string): number {
  const demo = DEMO_HEROES.find((h) => h.heroName === name)
  if (demo) return demo.hue
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/** A hero's look: its own, or what its role and hue give it before anyone dresses it. */
export function characterLook(build: Build, hue: number): CharacterLook {
  const base = defaultLook(build.roleId, build.heroName ?? build.roleId, hue)
  const look = build.look ?? base
  const out: CharacterLook = {
    build: bodyFor(build),
    physique: { ...NEUTRAL_PHYSIQUE, ...(look.physique ?? {}) },
    outfit: outfitOf(look),
    colors: { skin: new THREE.Color().setStyle(look.colors.skin ?? base.colors.skin, THREE.SRGBColorSpace), eye: new THREE.Color().setHSL(0, 0, 0.96, THREE.SRGBColorSpace) },
  }
  if (look.face) out.face = look.face
  return out
}

export type Gltf = { scene: THREE.Group; animations: THREE.AnimationClip[] }
const files = new Map<BodyName, Promise<Gltf>>()

/** Load (once) and cache a character file; `load` is the shared GLTF loader with meshopt support. */
export function loadBuild(build: BodyName, load: (url: string) => Promise<Gltf>): Promise<Gltf> {
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

/** The meta channel: each vertex's region (u), skin or eye. Textured files carry it in the second UV set. */
export function metaChannel(geometry: THREE.BufferGeometry): 'uv' | 'uv1' {
  return geometry.getAttribute('uv1') ? 'uv1' : 'uv'
}

/** The atlas texture a character mesh carries (its skin and face), if any. */
export function characterMap(mesh: THREE.Mesh): THREE.Texture | null {
  const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
  return (Array.isArray(m) ? m[0]?.map : m?.map) ?? null
}

/** The baked relief a character's skin carries, if any. */
export function characterNormalMap(mesh: THREE.Mesh): THREE.Texture | null {
  const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
  return (Array.isArray(m) ? m[0]?.normalMap : m?.normalMap) ?? null
}

/** The classic (WebGL) material the previews and busts draw a character with. */
export function classicCharacterMaterial(map: THREE.Texture | null, normalMap: THREE.Texture | null = null): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, map, normalMap, roughness: 0.58, metalness: 0.04 })
}
