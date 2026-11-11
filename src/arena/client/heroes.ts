import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { BUILD_SLOTS, type Build } from '../../charter/build.js'
import type { HeroPackage } from '../../forge/package.js'
import type { Preset } from '../../forge/motion/library.js'
import { pickAnimation, viewerSource } from '../../ui/common/viewer.js'
import { SIZE_SCALE, benchHero } from './procedural-hero.js'
import { heightFactor } from '../../kit/body/physique.js'
import type { AnimState } from './animation.js'
import type { SizeClass } from '../../charter/sizes.js'
import { formSize, formSlot } from '../../forge/form.js'
import type { FormBody } from '../../charter/skill-look.js'
import { defaultLook, type Gender } from '../../charter/look.js'
import { isAttitude, type AttitudeId } from '../../kit/anim/attitude.js'
import { formLookOf, skillLookOf } from '../recipes/looks.js'
import { formCharacterLook, V2_BODIES } from './character-look.js'
import { characterLook, characterView, heroHue, loadBuild } from './characters.js'
import { heroAtlas } from './face/hero-face.js'
import { libraryGait, libraryMoves } from './library-gait.js'
import { WEAPON_MOVES, weaponOf } from '../../kit/anim/weapon-gait.js'
import { animIndex } from './anim-index.js'
import { blockMotion, carriedStyle, meleeSet, skillMotion } from '../recipes/motions.js'
import type { RigKind } from './rig.js'
import { loadKit } from './held.js'
import { TEAM_COLORS } from './map.js'

/**
 * Hero views (U13, KTD9): the arena GLB when the package has one (2K for heroes in focus, 1K for the rest), then the
 * rigged model, then a procedural body. A hero that fails to load still fights, as the procedural body, with a notice.
 */

/** A pistol or rifle hero's crouch, jump and air moves from its weapon's set (GAME.md §12). */
const weaponMoves = (build: Build): Record<string, string> => {
  const weapon = weaponOf(carriedStyle(build))
  return weapon ? { ...WEAPON_MOVES[weapon] } : {}
}

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
  /**
   * Whether the hero is transformed, and its size class now: a transformation swaps in its form's body (its size and
   * the form's body changes), or grows the model if it has none.
   */
  setForm?: (transformed: boolean, size: SizeClass) => void
  /** Swing the outfit's loose cloth once the hero stands where it's drawn this frame (see CharacterView.settle). */
  settle?: (dt: number, far?: boolean, still?: boolean) => boolean
  /** Where the hand leading along `dir` is in the world, as last posed: where a skill's effects leave from. */
  hand?: (dir: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3 | undefined
  /** The far end of what the hero holds in its right hand, as last posed: where a weapon's swing trail runs from. */
  tip?: (out: THREE.Vector3) => THREE.Vector3 | undefined
  /** Twist the chest from the hips, run backwards or not, covering the ground this fast (see CharacterView.lean); without it, the view faces its aim whole. */
  lean?: (twist: number, back: boolean, speed?: number, planted?: boolean, legs?: number, heading?: number, sprint?: boolean) => void
  /** Where the hero aims this frame (radians, the engine's yaw and pitch), for the look and aim IK (GAME.md §9.6). */
  aim?: (yaw: number, pitch: number) => void
  /** Whether it sidesteps and backpedals on clips of its own, its hips square to its aim (see CharacterView.strafes). */
  strafes?: boolean
}

const PRESET_FOR: Record<AnimState['kind'], Preset> = { idle: 'idle', run: 'run', air: 'dive', jump: 'jump', air_jump: 'jump', dash: 'run', slide: 'run', land: 'idle', cast: 'slash', hit: 'hurt', stunned: 'hurt', dead: 'fall', roll: 'dive', block: 'idle', crouch: 'idle', crouch_move: 'walk', prone: 'idle', prone_move: 'walk', launched: 'dive', charge: 'idle', toggle: 'idle', mantle: 'jump', land_roll: 'dive', land_heavy: 'idle', zip: 'dive', rail: 'idle', catch: 'climb', climb: 'climb', hang: 'climb', hang_left: 'climb', hang_right: 'climb', dive: 'dive' }

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
      hero.animate(state.kind === 'idle' ? t * 0.2 : t, state.kind === 'air')
    },
  }
}

/** How a hero carries itself (kit/anim/attitude.ts); `/dev/try?attitude=` tries one on the played hero (dev only). */
function attitudeOf(build: Build): AttitudeId {
  return build.look?.attitude ?? 'neutral'
}

async function arenaCharacter(given: Build, index: number, team: number, renderer: unknown): Promise<HeroView> {
  const tryAttitude = import.meta.env?.DEV && index === 0 ? new URLSearchParams(location.search).get('attitude') : null
  const build: Build = isAttitude(tryAttitude) ? { ...given, look: { ...(given.look ?? defaultLook(given.roleId, given.heroName ?? given.roleId, heroHue(given.heroName))), attitude: tryAttitude } } : given
  const hue = heroHue(build.heroName)
  const look = characterLook(build, hue)
  const l = await gltf(renderer)
  const load = (body: Parameters<typeof loadBuild>[0]) => loadBuild(body, (url) => l.load(url) as Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>)
  const color = new THREE.Color(TEAM_COLORS[team])
  // `/dev/try`: the hero being tried wears a generated test mesh in place of its body (dev only; the file is under .scratch)
  const mesh = import.meta.env?.DEV && index === 0 ? new URLSearchParams(location.search).get('mesh') : null
  const tried = mesh ? await import('../../kit/bench/hero-file.js') : undefined
  const generated = (await tried?.triedHeroes())?.find((h) => h.label === mesh && h.file)
  // a photo face is painted into the hero's own atlas first; without one (or if it fails) the shared atlas serves
  const dressed = async (shape: Build, body?: FormBody, worn = generated) => {
    const shapeLook = formCharacterLook(characterLook(shape, hue), body)
    const made = await load(shapeLook.build)
    const file = worn ? await tried!.reboundFile(worn, cloneSkinned(made.scene), (await animIndex('standard'))!, (url) => l.load(url)) : made
    // it moves on the motion library's gait and stands in its chosen stance, where the library loads (Forge goal, phase B)
    const rig: RigKind = V2_BODIES.has(shapeLook.build) ? 'standard' : 'legacy'
    const gender = shapeLook.build.charAt(0) as Gender
    const [atlas, kit, gait, moves] = await Promise.all([
      generated ? null : heroAtlas(file, shapeLook),
      loadKit(shapeLook.build, shapeLook.held, (url) => l.load(url) as Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>),
      libraryGait(gender, build.look?.idle, rig, weaponOf(carriedStyle(build)), attitudeOf(build)),
      rig === 'standard' ? animIndex(rig).then(() => libraryMoves(gender, rig, [...BUILD_SLOTS.flatMap((slot) => skillMotion(build, slot) ?? []), ...Object.values(meleeSet(build) ?? {}).flat()], { ...weaponMoves(build), block: blockMotion(build) }, attitudeOf(build))) : undefined,
    ])
    return characterView(file, shapeLook, color, build, atlas, kit, gait, moves)
  }
  const chosen = build.sizeClass ?? 'medium'
  const view = await dressed(build)
  // a generated mesh is already its own height
  view.root.scale.setScalar(generated ? 1 : SIZE_SCALE[chosen] * heightFactor(build.look?.physique))
  // a hero whose ultimate transforms it brings its form's own body (a titan, not the same hero scaled up), dressed in
  // the same look with the form's own changes (gold hair, a chakra cloak); if that fails, the hero grows instead
  const slot = formSlot(build)
  const formLook = slot ? formLookOf(skillLookOf(build, slot)) : undefined
  const form = formSize(build)
  const formMesh = generated?.form
  const formView = form || formLook?.body ? await dressed({ ...build, sizeClass: form ?? chosen }, formLook?.body, formMesh ? { ...generated!, ...formMesh } : generated).catch(() => undefined) : undefined
  // a generated form is its own height too, and swells from the hero's; a generated hero without one grows as far as its size does
  const ownScale = generated ? (formMesh ? generated.height / formMesh.height : 1) : SIZE_SCALE[chosen]
  const formScale = generated ? (formMesh ? 1 : SIZE_SCALE[form ?? chosen] / SIZE_SCALE[chosen]) : SIZE_SCALE[form ?? chosen]
  const root = new THREE.Group()
  root.add(view.root)
  if (formView) {
    formView.root.scale.setScalar(formScale)
    formView.root.visible = false
    root.add(formView.root)
  }
  let size = chosen
  // a swell eases from the hero's own size into the form's over a moment; a snap is there at once
  let grown = 1
  const shown = () => (formView?.root.visible ? formView : view)
  return {
    root,
    fallback: false,
    animatesDeath: true,
    pose: (state, _t, dt, moving = false) => {
      if (grown < 1 && formView?.root.visible) {
        grown = Math.min(1, grown + dt / SWELL_SECONDS)
        formView.root.scale.setScalar(ownScale + (formScale - ownScale) * (1 - (1 - grown) ** 3))
      }
      shown().pose(state, dt, moving)
    },
    settle: (dt, far, still) => shown().settle(dt, far, still),
    hand: (dir, out) => shown().hand(dir, out),
    tip: (out) => shown().tip(out),
    lean: (twist, back, speed, planted, legs, heading, sprint) => shown().lean(twist, back, speed, planted, legs, heading, sprint),
    aim: (yaw, pitch) => shown().aim(yaw, pitch),
    get strafes() {
      return shown().strafes
    },
    setForm: (transformed, next) => {
      if (formView) {
        if (formView.root.visible === transformed) return
        formView.root.visible = transformed
        view.root.visible = !transformed
        grown = transformed && formLook?.growth === 'swell' && form && form !== chosen ? 0 : 1
        if (grown === 1) formView.root.scale.setScalar(formScale)
      } else if (next !== size) view.root.scale.setScalar(SIZE_SCALE[next])
      size = next
    },
  }
}

/** How long a form takes to swell into its new size: short, so what's drawn stays what can be hit. */
export const SWELL_SECONDS = 0.3

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
