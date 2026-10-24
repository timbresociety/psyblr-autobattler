import * as THREE from 'three'
import type { Build } from '../../charter/build.js'
import type { RoleId } from '../../charter/types.js'
import { DEMO_HEROES } from '../demo/roster.js'

/**
 * What a hero looks like in the arena's own characters (R24), without any renderer: which character file it wears,
 * its colours per body region, and which switchable parts show. The demo roster's real people each have their own
 * model (a MakeHuman body with their face, hair and signature outfit over battle gear); every other hero wears one of
 * four generic bodies, recoloured. Both come from tools/blender/human.py. The arena, the staging busts and the 3D
 * previews all read this, so a hero looks the same in its portrait as on the field, on either side.
 */

/** The generic bodies every hero without a model of its own wears, recoloured per hero. */
export type BaseBuild = 'athletic' | 'lithe' | 'heavy' | 'lean'
export const BASE_BUILDS: readonly BaseBuild[] = ['athletic', 'lithe', 'heavy', 'lean']

/** The demo roster's own models, public/heroes/<id>.glb, by hero name. */
export const HERO_MODELS = {
  'Elon "Starship" Musk': 'musk',
  'Jensen "CUDA Core" Huang': 'huang',
  'Jeff "Prime" Bezos': 'bezos',
  'Mark "Metaverse" Zuckerberg': 'zuckerberg',
  'Satya "Copilot" Nadella': 'nadella',
  'Sam "AGI" Altman': 'altman',
  'Warren "Oracle" Buffett': 'buffett',
  'Oprah "You Get One" Winfrey': 'winfrey',
  'Mukesh "Jio" Ambani': 'ambani',
  'Lisa "Zen Core" Su': 'su',
  'Abraham "Honest Axe" Lincoln': 'lincoln',
  'Winston "Bulldog" Churchill': 'churchill',
  'Barack "Hope Beam" Obama': 'obama',
  'Donald "Dealmaker" Trump': 'trump',
  'Narendra "Saffron Storm" Modi': 'modi',
  'Angela "Iron Chancellor" Merkel': 'merkel',
  'Emmanuel "Jupiter" Macron': 'macron',
  'Volodymyr "Kyiv Shield" Zelenskyy': 'zelenskyy',
  'Jacinda "Kindness Wave" Ardern': 'ardern',
  'Lee Kuan "Miracle" Yew': 'yew',
} as const
export type HeroModel = (typeof HERO_MODELS)[keyof typeof HERO_MODELS]

/** Which character file a look loads: a generic body or a demo hero's own model. */
export type Build3D = BaseBuild | HeroModel
export type Hair = 'crop' | 'spiky' | 'long' | 'helmet'

/**
 * Order matches REGIONS and PARTS in tools/blender/humanlib/bake.py. The first twelve take a colour from the look and
 * multiply the texture by it; the 'baked' regions keep the texture's own colour (a real person's outfit), plain,
 * glossy (leather, silk) or metal (bronze armour).
 */
const REGIONS = ['skin', 'suit', 'trim', 'pants', 'glove', 'boot', 'hair', 'metal', 'eye', 'iris', 'brow', 'cape', 'baked', 'baked_gloss', 'baked_metal'] as const
type Region = (typeof REGIONS)[number]
export type TintRegion = Exclude<Region, 'baked' | 'baked_gloss' | 'baked_metal'>
const PARTS = ['base', 'hair:crop', 'hair:spiky', 'hair:long', 'hair:helmet', 'armour', 'cape'] as const

/** Region indices the materials shade differently (metal and gloss). */
export const REGION_INDEX = { metal: 7, baked: 12, bakedGloss: 13, bakedMetal: 14 } as const

export interface CharacterLook {
  build: Build3D
  hair: Hair
  armour: boolean
  cape: boolean
  colors: Record<TintRegion, THREE.Color>
}

const BUILD_FOR: Record<RoleId, BaseBuild> = { tank: 'heavy', fighter: 'athletic', assassin: 'lean', mage: 'lithe', marksman: 'lean', support: 'lithe', controller: 'lithe', summoner: 'athletic' }

/** The demo hero's own model, if this name is one of the demo roster. */
export function modelFor(heroName: string | undefined): HeroModel | undefined {
  return heroName ? (HERO_MODELS as Record<string, HeroModel>)[heroName] : undefined
}

/**
 * A hero's suit colour: a demo hero's own, else a stable one from its name. The arena, the portraits and the 3D
 * previews all read this, so a hero wears the same suit everywhere and keeps it while it is edited.
 */
export function heroHue(name: string): number {
  const demo = DEMO_HEROES.find((h) => h.heroName === name)
  if (demo) return demo.hue
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/** A small stable number from a hero's name, so its hair and skin never depend on which slot or side it fights in. */
function seedOf(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * A hero's look from its role and hue. A demo hero wears its own model (its outfit is baked in; its suit colour still
 * tints its accent pieces). Anyone else wears the generic body for the role: tanks a Roman helmet and armour, fighters
 * a cape, and so on.
 */
export function characterLook(build: Build, hue: number): CharacterLook {
  const role = build.roleId as RoleId
  const index = seedOf(build.heroName ?? build.roleId)
  const styles: Hair[] = ['spiky', 'crop', 'long']
  const hair: Hair = role === 'tank' ? 'helmet' : styles[index % styles.length]
  const c = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace)
  const skinTones = [c(0.07, 0.45, 0.72), c(0.06, 0.4, 0.55), c(0.07, 0.35, 0.4), c(0.08, 0.5, 0.82)]
  return {
    build: modelFor(build.heroName) ?? BUILD_FOR[role] ?? 'athletic',
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

/** Load (once) and cache a character file; `load` is the shared GLTF loader with meshopt support. */
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

/** The meta channel: region (u) and part (v) per vertex. Textured files carry it in the second UV set. */
export function metaChannel(geometry: THREE.BufferGeometry): 'uv' | 'uv1' {
  return geometry.getAttribute('uv1') ? 'uv1' : 'uv'
}

const WHITE = new THREE.Color(1, 1, 1)

/** The hero's geometry: shares the file's buffers, with its own colours and only the triangles of parts it wears. */
export function paintGeometry(source: THREE.BufferGeometry, look: CharacterLook): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(source.attributes)) if (name !== 'color') geo.setAttribute(name, attr)
  const meta = source.getAttribute(metaChannel(source))
  const n = meta.count
  const colors = new Float32Array(n * 3)
  const shown = new Set<string>(['base', `hair:${look.hair}`, ...(look.armour ? ['armour'] : []), ...(look.cape ? ['cape'] : [])])
  const visible = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const region = REGIONS[Math.min(REGIONS.length - 1, Math.floor(meta.getX(i)))]
    // glTF flips v on export (its texture origin is the top-left), so the part index comes back as 1 - v
    const part = PARTS[Math.min(PARTS.length - 1, Math.max(0, Math.floor(1 - meta.getY(i))))]
    const col = region in look.colors ? look.colors[region as TintRegion] : WHITE
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

/** The atlas texture a character mesh carries (its face, outfit and hair), if any. */
export function characterMap(mesh: THREE.Mesh): THREE.Texture | null {
  const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
  return (Array.isArray(m) ? m[0]?.map : m?.map) ?? null
}

/** The baked relief (cloth folds and weave, leather grain, hammered bronze, hair strands) a character carries, if any. */
export function characterNormalMap(mesh: THREE.Mesh): THREE.Texture | null {
  const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
  return (Array.isArray(m) ? m[0]?.normalMap : m?.normalMap) ?? null
}

/**
 * Repaint a cloned character for one hero: each skinned mesh gets the hero's geometry (colours, parts) and the
 * material `material(map, normalMap)` makes from the file's atlas and relief. Renderer-agnostic: the arena passes
 * node materials, the previews and busts classic ones.
 */
export function paintModel(model: THREE.Object3D, look: CharacterLook, material: (map: THREE.Texture | null, normalMap: THREE.Texture | null) => THREE.Material): void {
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const map = characterMap(mesh)
    const normalMap = characterNormalMap(mesh)
    const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    mesh.geometry = paintGeometry(mesh.geometry, look)
    const made = material(map, normalMap) as THREE.MeshStandardMaterial
    // glTF's tangent-space convention: the loader flips the normal scale's y for meshes without tangents; keep it
    if (normalMap && source?.normalScale && made.normalScale) made.normalScale.copy(source.normalScale)
    mesh.material = made
    mesh.frustumCulled = false
  })
}

/** The classic (WebGL) material the previews and busts draw a character with. */
export function classicCharacterMaterial(map: THREE.Texture | null, normalMap: THREE.Texture | null = null): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, map, normalMap, roughness: 0.58, metalness: 0.04 })
}
