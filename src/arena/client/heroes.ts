import * as THREE from 'three'
import type { Build } from '../../charter/build.js'
import type { HeroPackage } from '../../forge/package.js'
import type { Preset } from '../../forge/motion/library.js'
import { pickAnimation, viewerSource } from '../../ui/common/viewer.js'
import { SIZE_SCALE, benchHero } from '../demo/procedural-hero.js'
import type { AnimState } from './animation.js'
import type { SizeClass } from '../../charter/sizes.js'
import { formSize } from '../../forge/stages.js'
import { modelFor } from './character-look.js'
import { characterLook, characterView, heroHue, loadBuild } from './characters.js'
import { heroAtlas } from './face/hero-face.js'
import { loadGear } from './gear.js'
import { TEAM_COLORS } from './map.js'

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
  /** `moving` tells flying from hovering, and running from standing. */
  pose: (state: AnimState, t: number, dt: number, moving?: boolean) => void
  /** True when the hero's own body failed to load and this is the stand-in. */
  fallback: boolean
  /** The view plays its own death fall, so the physics corpse should not also tumble it. */
  animatesDeath?: boolean
  /** The hero's size class right now: a transformation swaps in its form's body, or grows the model if it has none. */
  setSize?: (size: SizeClass) => void
}

const PRESET_FOR: Record<AnimState['kind'], Preset> = { idle: 'idle', run: 'run', fly: 'dive', cast: 'slash', hit: 'hurt', stunned: 'hurt', dead: 'fall' }

function proceduralView(build: Build, index: number, fallback: boolean): HeroView {
  const hue = heroHue(build.heroName)
  const hero = benchHero({ hue: fallback ? 0 : hue, sizeClass: build.sizeClass ?? 'medium', textureSize: 512, seed: index + 1, look: 'suit' })
  if (fallback) (hero.mesh.material as THREE.MeshStandardMaterial).color.setRGB(0.55, 0.57, 0.62)
  const root = new THREE.Group()
  root.add(hero.mesh)
  return {
    root,
    fallback,
    pose: (state, t) => {
      if (state.kind === 'dead') return
      hero.animate(state.kind === 'idle' ? t * 0.2 : t, state.kind === 'fly')
    },
  }
}

async function arenaCharacter(build: Build, index: number, team: number, renderer: unknown): Promise<HeroView> {
  const hue = heroHue(build.heroName)
  const look = characterLook(build, hue)
  const l = await gltf(renderer)
  const load = (body: Parameters<typeof loadBuild>[0]) => loadBuild(body, (url) => l.load(url) as Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>)
  const color = new THREE.Color(TEAM_COLORS[team])
  // a photo face is painted into the hero's own atlas first; without one (or if it fails) the shared atlas serves
  const dressed = async (shape: Build) => {
    const shapeLook = characterLook(shape, hue)
    const file = await load(shapeLook.build)
    const [atlas, gear] = await Promise.all([heroAtlas(file, shapeLook), loadGear(shapeLook.build, shapeLook.gear, (url) => l.load(url) as Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>)])
    return characterView(file, shapeLook, color, build, atlas, gear)
  }
  const chosen = build.sizeClass ?? 'medium'
  const view = await dressed(build)
  view.root.scale.setScalar(SIZE_SCALE[chosen])
  // a hero whose ultimate transforms it brings its form's own body (a titan, not the same hero scaled up); a demo hero,
  // whose model is its own, grows instead
  const form = formSize(build)
  const formView = form && !modelFor(build.heroName) ? await dressed({ ...build, sizeClass: form }).catch(() => undefined) : undefined
  const root = new THREE.Group()
  root.add(view.root)
  if (formView) {
    formView.root.scale.setScalar(SIZE_SCALE[form!])
    formView.root.visible = false
    root.add(formView.root)
  }
  let size = chosen
  return {
    root,
    fallback: false,
    animatesDeath: true,
    pose: (state, _t, dt, moving = false) => (formView?.root.visible ? formView : view).pose(state, dt, moving),
    setSize: (next) => {
      if (next === size) return
      size = next
      const transformed = next !== chosen
      if (formView) {
        formView.root.visible = transformed
        view.root.visible = !transformed
      } else view.root.scale.setScalar(SIZE_SCALE[next])
    },
  }
}

/** Longest a hero's model may take to load before it fights as a stand-in, so one slow file never holds up Start. */
export const LOAD_TIMEOUT_MS = 20_000

/** `promise`, or a rejection once `ms` pass. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms)
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e)),
    )
  })
}

let loader: Promise<{ load: (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> }> | undefined

/** GLTF with KTX2 textures and meshopt geometry; the transcoder ships in public/decoders (KTD10). */
function gltf(renderer: unknown) {
  loader ??= (async () => {
    const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/KTX2Loader.js'), import('three/addons/libs/meshopt_decoder.module.js')])
    const ktx2 = new KTX2Loader().setTranscoderPath('/decoders/basis/')
    ;(ktx2 as unknown as { detectSupport: (r: unknown) => void }).detectSupport(renderer)
    const l = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder)
    return { load: (url: string) => withTimeout(l.loadAsync(url), LOAD_TIMEOUT_MS, url) }
  })().catch((e: unknown) => {
    // a failed import is not remembered: the next match tries again instead of using stand-ins until a reload
    loader = undefined
    throw e
  })
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
export async function loadHeroView(build: Build, pkg: HeroPackage | undefined, index: number, focus: boolean, renderer: unknown, team = 0): Promise<HeroView> {
  const source = heroSource(pkg, focus)
  if (source.kind === 'procedural') {
    // a hero with no forged body wears one of the arena's own rigged, animated builds (R24)
    if (!pkg) {
      try {
        return await arenaCharacter(build, index, team, renderer)
      } catch {
        return proceduralView(build, index, false)
      }
    }
    return proceduralView(build, index, true)
  }
  try {
    return await glbView(source, build, renderer)
  } catch {
    return proceduralView(build, index, true)
  }
}
