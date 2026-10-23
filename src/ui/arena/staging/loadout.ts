import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { characterLook, heroHue, loadBuild, paintGeometry, type Build3D, type CharacterLook, type Gltf } from '../../../arena/client/character-look'
import type { Build } from '../../../charter/build'
import type { RoleId } from '../../../charter/types'
import type { HeroPackage } from '../../../forge/package'
import { DEMO_HEROES, demoBuild, type DemoFaction } from '../../../arena/demo/roster'
import { benchHero } from '../../../arena/demo/procedural-hero'
import { liveDeps } from '../../api'

/** One hero the streamer can place: a build, plus its package when it was forged. */
export interface LoadoutEntry {
  key: string
  build: Build
  pkg?: HeroPackage
  /** A short symbol for the hero's primary role, shown under its bust (R3). */
  symbol: string
  /** Demo heroes fight for a faction (moguls or world leaders); the player's own heroes have none. */
  faction?: DemoFaction
  /** Suit colour. Demo heroes carry their own; others take one from their place in the row. */
  hue?: number
}

const ROLE_SYMBOL: Record<string, string> = { tank: '🛡', fighter: '⚔', assassin: '🗡', mage: '✦', marksman: '◎', support: '✚', controller: '⛓', summoner: '⚙' }
export const roleSymbol = (role: string) => ROLE_SYMBOL[role] ?? '•'

export const demoLoadout = (): LoadoutEntry[] => DEMO_HEROES.map((h) => {
  const build = demoBuild(h)
  return { key: `demo:${h.heroName}`, build, symbol: roleSymbol(build.roleId), faction: h.faction, hue: h.hue }
})

export interface LoadoutDeps {
  /** Heroes to add to the row, with their packages when forged. An empty query means the player's own heroes. */
  search: (q: string) => Promise<LoadoutEntry[]>
}

async function packageOf(heroId: string): Promise<HeroPackage | undefined> {
  const res = await fetch(`/api/heroes/package?id=${encodeURIComponent(heroId)}`)
  return res.ok ? ((await res.json()) as HeroPackage) : undefined
}

export const liveLoadout: LoadoutDeps = {
  search: async (q) => {
    // the player's own heroes: everything this device saved in the Creator or forged (a forged one also has a package)
    if (!q.trim()) {
      const builds = await liveDeps.listBuilds()
      return Promise.all(
        builds.map(async (r): Promise<LoadoutEntry> => {
          const pkg = await packageOf(r.heroId).catch(() => undefined)
          return { key: `build:${r.id}`, build: r.build, ...(pkg ? { pkg } : {}), symbol: roleSymbol(r.build.roleId) }
        }),
      )
    }
    const res = await fetch(`/api/heroes/search?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const { heroes } = (await res.json()) as { heroes: { id: string; name: string }[] }
    const entries = await Promise.all(
      heroes.map(async (h): Promise<LoadoutEntry | undefined> => {
        const pkg = await packageOf(h.id)
        if (!pkg) return undefined
        return { key: `hero:${h.id}`, build: pkg.build, pkg, symbol: roleSymbol(pkg.build.roleId) }
      }),
    )
    return entries.filter((e): e is LoadoutEntry => !!e)
  },
}

const busts = new Map<string, string>()
/** Busts drawn with the procedural stand-in while the character files load; replaced once they arrive. */
const standIns = new Map<string, string>()
let bustRenderer: THREE.WebGLRenderer | undefined | null
const BUST_PX = 160

const BUILDS: Build3D[] = ['athletic', 'lithe', 'heavy', 'lean']
const characters = new Map<Build3D, Gltf>()
let preload: Promise<boolean> | undefined
let gltf: Promise<(url: string) => Promise<Gltf>> | undefined

/** The GLTF loader with meshopt, created once and shared by the busts and the 3D previews. */
function loader(): Promise<(url: string) => Promise<Gltf>> {
  gltf ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')])
    const l = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    return (url: string) => l.loadAsync(url) as unknown as Promise<Gltf>
  })().catch((e: unknown) => {
    gltf = undefined
    throw e
  })
  return gltf
}

/** One of the four character builds (cached; the arena reuses the same files). */
export async function characterFile(build: Build3D): Promise<Gltf> {
  return loadBuild(build, await loader())
}

/**
 * Load the four character builds the busts are drawn from (once). Resolves false if they cannot load, and the busts
 * keep the procedural stand-in.
 */
export function preloadBusts(): Promise<boolean> {
  preload ??= (async () => {
    const files = await Promise.all(BUILDS.map((b) => characterFile(b)))
    BUILDS.forEach((b, i) => characters.set(b, files[i]))
    return true
  })().catch(() => {
    preload = undefined
    return false
  })
  return preload
}

/** A clone of the hero's build in its own colours and parts, held in the first beat of its idle. */
function posed(file: Gltf, look: CharacterLook): THREE.Object3D {
  const model = cloneSkinned(file.scene)
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 })
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    mesh.geometry = paintGeometry(mesh.geometry, look)
    mesh.material = material
    mesh.frustumCulled = false
  })
  const idle = file.animations.find((c) => c.name === 'idle')
  if (idle) {
    const mixer = new THREE.AnimationMixer(model)
    mixer.clipAction(idle).play()
    mixer.update(0.4)
  }
  model.updateMatrixWorld(true)
  return model
}

/** What a portrait needs to know about a hero: a cache key, its name and role, and optionally its suit colour. */
export interface PortraitHero {
  key: string
  heroName: string
  roleId: RoleId
  hue?: number
}

/**
 * A small 3D bust of a hero (R3), rendered once into an image so one canvas serves every row and the HUD's portraits.
 * It is the same character, colours and parts the hero wears in the arena. Without WebGL (tests, old browsers) it
 * returns undefined and the UI shows initials instead.
 */
export function portrait(hero: PortraitHero, index = 0): string | undefined {
  const done = busts.get(hero.key)
  if (done) return done
  if (bustRenderer === undefined) {
    try {
      if (typeof WebGL2RenderingContext === 'undefined') throw new Error('no WebGL2')
      const canvas = document.createElement('canvas')
      bustRenderer = canvas.getContext('webgl2') ? new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }) : null
      bustRenderer?.setSize(BUST_PX, BUST_PX, false)
      if (bustRenderer) bustRenderer.toneMapping = THREE.ACESFilmicToneMapping
    } catch {
      bustRenderer = null
    }
  }
  if (!bustRenderer) return undefined
  const hue = hero.hue ?? heroHue(hero.heroName)
  // the look reads only the name and the role
  const look = characterLook({ heroName: hero.heroName, roleId: hero.roleId } as Build, hue)
  const file = characters.get(look.build)
  if (!file && standIns.has(hero.key)) return standIns.get(hero.key)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xfff2e2, 0x3a3048, 1.5))
  const key = new THREE.DirectionalLight(0xffe2c4, 2.4)
  key.position.set(1.5, 2.5, 2.5)
  const rim = new THREE.DirectionalLight(0x9fc4ff, 2)
  rim.position.set(-1.8, 2.2, -2)
  scene.add(key, rim)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10)
  let release: () => void
  if (file) {
    const model = posed(file, look)
    scene.add(model)
    // frame the head and shoulders from the head bone, so every build sits the same way in its frame
    const head = new THREE.Vector3(0, 1.62, 0)
    model.getObjectByName('head')?.getWorldPosition(head)
    camera.position.set(head.x + 0.42, head.y + 0.05, head.z + 1.3)
    camera.lookAt(head.x, head.y - 0.12, head.z)
    release = () => model.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose())
  } else {
    const stand = benchHero({ hue, sizeClass: 'medium', textureSize: 128, seed: index + 1, look: 'suit' })
    stand.animate(0, false)
    scene.add(stand.mesh)
    camera.position.set(0.5, 1.75, 1.6)
    camera.lookAt(0, 1.6, 0)
    release = () => stand.mesh.geometry.dispose()
  }
  bustRenderer.render(scene, camera)
  const url = bustRenderer.domElement.toDataURL('image/png')
  release()
  ;(file ? busts : standIns).set(hero.key, url)
  return url
}

/** A loadout entry's bust (the staging row, the board's tokens and the HUD's portraits). */
export function bust(entry: LoadoutEntry, index: number): string | undefined {
  return portrait({ key: entry.key, heroName: entry.build.heroName, roleId: entry.build.roleId, hue: entry.hue }, index)
}
