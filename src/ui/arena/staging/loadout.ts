import * as THREE from 'three'
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

const busts = new Map<string, string | undefined>()
let bustRenderer: THREE.WebGLRenderer | undefined | null

/**
 * A small 3D bust of a hero (R3), rendered once into an image so one canvas serves the whole row. Without WebGL
 * (tests, old browsers) it returns undefined and the row shows initials instead.
 */
export function bust(entry: LoadoutEntry, index: number): string | undefined {
  if (busts.has(entry.key)) return busts.get(entry.key)
  if (bustRenderer === undefined) {
    try {
      const canvas = document.createElement('canvas')
      bustRenderer = canvas.getContext('webgl2') ? new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }) : null
      bustRenderer?.setSize(96, 96, false)
    } catch {
      bustRenderer = null
    }
  }
  if (!bustRenderer) return undefined
  const demo = DEMO_HEROES.find((h) => h.heroName === entry.build.heroName)
  const hero = benchHero({ hue: demo?.hue ?? (index * 0.137) % 1, sizeClass: 'medium', textureSize: 128, seed: index + 1, look: 'suit' })
  hero.animate(0, false)
  const scene = new THREE.Scene()
  scene.add(hero.mesh, new THREE.HemisphereLight(0xffffff, 0x334455, 2.2))
  const light = new THREE.DirectionalLight(0xffffff, 1.6)
  light.position.set(1, 2, 3)
  scene.add(light)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10)
  camera.position.set(0.5, 1.75, 1.6)
  camera.lookAt(0, 1.6, 0)
  bustRenderer.render(scene, camera)
  const url = bustRenderer.domElement.toDataURL('image/png')
  busts.set(entry.key, url)
  hero.mesh.geometry.dispose()
  return url
}
