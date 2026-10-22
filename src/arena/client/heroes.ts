import * as THREE from 'three'
import type { Build } from '../../charter/build'
import type { HeroPackage } from '../../forge/package'
import type { Preset } from '../../forge/motion/library'
import { pickAnimation, viewerSource } from '../../ui/forge/viewer'
import { DEMO_HEROES } from '../demo/roster'
import { SIZE_SCALE, benchHero } from '../demo/procedural-hero'
import type { AnimState } from './animation'

/**
 * Hero views (U13, KTD9): the arena GLB when the package has one (2K for heroes in focus, 1K for the rest), then the
 * rigged model, then a procedural body. A hero that fails to load still fights, as the procedural body, with a notice.
 */

export type HeroSource = { kind: 'glb'; url: string; motions: string[] } | { kind: 'procedural' }

/** Where a hero's body comes from (R24, R40). */
export function heroSource(pkg: HeroPackage | undefined, focus: boolean): HeroSource {
  if (!pkg) return { kind: 'procedural' }
  const arena = pkg.assets.arena
  const motions = (arena?.motions ?? pkg.assets.motions).map((m) => m.url).filter((u) => viewerSource(u) === 'glb')
  for (const url of [focus ? arena?.focus.url : arena?.other.url, arena?.focus.url, pkg.assets.rigged.url]) if (url && viewerSource(url) === 'glb') return { kind: 'glb', url, motions }
  return { kind: 'procedural' }
}

export interface HeroView {
  root: THREE.Object3D
  pose: (state: AnimState, t: number, dt: number) => void
  /** True when the hero's own body failed to load and this is the stand-in. */
  fallback: boolean
}

const PRESET_FOR: Record<AnimState['kind'], Preset> = { idle: 'idle', run: 'run', fly: 'dive', cast: 'slash', hit: 'hurt', stunned: 'hurt', dead: 'fall' }

function proceduralView(build: Build, index: number, fallback: boolean): HeroView {
  const demo = DEMO_HEROES.find((h) => h.heroName === build.heroName)
  const hue = demo?.hue ?? (index * 0.137) % 1
  const hero = benchHero({ hue: fallback ? 0 : hue, sizeClass: build.sizeClass ?? 'medium', textureSize: 512, seed: index + 1 })
  if (fallback) (hero.mesh.material as THREE.MeshStandardMaterial).color.setRGB(0.55, 0.57, 0.62)
  const root = new THREE.Group()
  root.add(hero.mesh)
  return {
    root,
    fallback,
    pose: (state, t) => {
      if (state.kind === 'dead') {
        root.rotation.x = -Math.PI / 2
        return
      }
      root.rotation.x = 0
      hero.animate(state.kind === 'idle' ? t * 0.2 : t, state.kind === 'fly')
    },
  }
}

let loader: Promise<{ load: (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> }> | undefined

/** GLTF with KTX2 textures and meshopt geometry; the transcoder ships in public/decoders (KTD10). */
function gltf(renderer: unknown) {
  loader ??= (async () => {
    const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/KTX2Loader.js'), import('three/addons/libs/meshopt_decoder.module.js')])
    const ktx2 = new KTX2Loader().setTranscoderPath('/decoders/basis/')
    ;(ktx2 as unknown as { detectSupport: (r: unknown) => void }).detectSupport(renderer)
    const l = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder)
    return { load: (url: string) => l.loadAsync(url) }
  })()
  return loader
}

async function glbView(source: Extract<HeroSource, { kind: 'glb' }>, build: Build, renderer: unknown): Promise<HeroView> {
  const l = await gltf(renderer)
  const [main, ...motions] = await Promise.all([l.load(source.url), ...source.motions.map((u) => l.load(u).catch(() => undefined))])
  const root = new THREE.Group()
  root.add(main.scene)
  root.scale.setScalar(SIZE_SCALE[build.sizeClass ?? 'medium'])
  const clips = [...main.animations, ...motions.flatMap((m) => m?.animations ?? [])]
  const mixer = new THREE.AnimationMixer(main.scene)
  let playing: string | undefined
  return {
    root,
    fallback: false,
    pose: (state, _t, dt) => {
      const name = pickAnimation({ kind: 'preset', preset: PRESET_FOR[state.kind] }, clips.map((c) => c.name)) ?? pickAnimation({ kind: 'preset', preset: 'idle' }, clips.map((c) => c.name))
      if (name && name !== playing) {
        mixer.stopAllAction()
        const action = mixer.clipAction(clips.find((c) => c.name === name)!)
        if (state.kind === 'dead') {
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true
        }
        action.play()
        playing = name
      }
      mixer.update(dt)
    },
  }
}

/** Load one hero's view, falling back to a procedural body (with `fallback` set) if its GLB fails. */
export async function loadHeroView(build: Build, pkg: HeroPackage | undefined, index: number, focus: boolean, renderer: unknown): Promise<HeroView> {
  const source = heroSource(pkg, focus)
  if (source.kind === 'procedural') return proceduralView(build, index, !!pkg)
  try {
    return await glbView(source, build, renderer)
  } catch {
    return proceduralView(build, index, true)
  }
}
