import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { characterLook, loadBuild, paintGeometry, type Build3D, type CharacterLook, type Gltf } from '../../../arena/client/character-look'
import type { Build } from '../../../charter/build'
import type { HeroPackage } from '../../../forge/package'
import { DEMO_HEROES, demoBuild } from '../../../arena/demo/roster'
import { benchHero } from '../../../arena/demo/procedural-hero'

/** One hero the streamer can place: a build, plus its package when it was forged. */
export interface LoadoutEntry {
  key: string
  build: Build
  pkg?: HeroPackage
  /** A short symbol for the hero's primary role, shown under its bust (R3). */
  symbol: string
}

const ROLE_SYMBOL: Record<string, string> = { tank: '🛡', fighter: '⚔', assassin: '🗡', mage: '✦', marksman: '◎', support: '✚' }
export const roleSymbol = (role: string) => ROLE_SYMBOL[role] ?? '•'

export const demoLoadout = (): LoadoutEntry[] => DEMO_HEROES.map((h) => {
  const build = demoBuild(h)
  return { key: `demo:${h.heroName}`, build, symbol: roleSymbol(build.roleId) }
})

export interface LoadoutDeps {
  /** Forged heroes matching a search, with their packages. */
  search: (q: string) => Promise<LoadoutEntry[]>
}

export const liveLoadout: LoadoutDeps = {
  search: async (q) => {
    const res = await fetch(`/api/heroes/search?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const { heroes } = (await res.json()) as { heroes: { id: string; name: string }[] }
    const entries = await Promise.all(
      heroes.map(async (h): Promise<LoadoutEntry | undefined> => {
        const pkgRes = await fetch(`/api/heroes/package?id=${encodeURIComponent(h.id)}`)
        if (!pkgRes.ok) return undefined
        const pkg = (await pkgRes.json()) as HeroPackage
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

/**
 * Load the four character builds the busts are drawn from (once; the arena reuses the same files). Resolves false if
 * they cannot load, and the busts keep the procedural stand-in.
 */
export function preloadBusts(): Promise<boolean> {
  preload ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')])
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const files = await Promise.all(BUILDS.map((b) => loadBuild(b, (url) => loader.loadAsync(url) as unknown as Promise<Gltf>)))
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

/**
 * A small 3D bust of a hero (R3), rendered once into an image so one canvas serves the whole row and the HUD's
 * portraits. It is the same character, colours and parts the hero wears in the arena. Without WebGL (tests, old
 * browsers) it returns undefined and the row shows initials instead.
 */
export function bust(entry: LoadoutEntry, index: number): string | undefined {
  const done = busts.get(entry.key)
  if (done) return done
  if (bustRenderer === undefined) {
    try {
      const canvas = document.createElement('canvas')
      bustRenderer = canvas.getContext('webgl2') ? new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }) : null
      bustRenderer?.setSize(BUST_PX, BUST_PX, false)
      if (bustRenderer) bustRenderer.toneMapping = THREE.ACESFilmicToneMapping
    } catch {
      bustRenderer = null
    }
  }
  if (!bustRenderer) return undefined
  const demo = DEMO_HEROES.find((h) => h.heroName === entry.build.heroName)
  const hue = demo?.hue ?? (index * 0.137) % 1
  const look = characterLook(entry.build, hue)
  const file = characters.get(look.build)
  if (!file && standIns.has(entry.key)) return standIns.get(entry.key)
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
    const hero = benchHero({ hue, sizeClass: 'medium', textureSize: 128, seed: index + 1, look: 'suit' })
    hero.animate(0, false)
    scene.add(hero.mesh)
    camera.position.set(0.5, 1.75, 1.6)
    camera.lookAt(0, 1.6, 0)
    release = () => hero.mesh.geometry.dispose()
  }
  bustRenderer.render(scene, camera)
  const url = bustRenderer.domElement.toDataURL('image/png')
  release()
  ;(file ? busts : standIns).set(entry.key, url)
  return url
}
