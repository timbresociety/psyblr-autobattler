import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { attribute, float, normalView, positionViewDirection, uniform, vertexColor } from 'three/tsl'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { Build } from '../../charter/build.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { AnimState } from './animation.js'
import type { CharacterLook, Gltf } from './character-look.js'
import { restClothOn, settleCloth } from './wear/cloth-model.js'
import { dressModel } from './wear/dress-model.js'
import type { LoadedWear } from './wear/items.js'

export { characterLook, heroHue, loadBuild } from './character-look.js'

/**
 * The arena's own characters (R24): rigged, animated MakeHuman-based bodies made in Blender (tools/blender/human.py),
 * all on one shared surface, shaped by each hero's physique and dressed from the wardrobe (src/kit/wear): two draws per
 * hero, the body and its whole outfit, plus any rigid pieces. All are lit with a rim in the team colour.
 */

/**
 * The hero's body material: the file's atlas (skin and face) times the per-vertex skin colour, soft, and a rim light in
 * the team's colour so a crowd of twenty reads by side at a glance (R38).
 */
export function characterMaterial(team: THREE.Color, map: THREE.Texture | null = null, normalMap: THREE.Texture | null = null): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 })
  if (map) m.map = map
  if (normalMap) m.normalMap = normalMap
  // a painted face reads best with the rim kept to the silhouette, so textured characters get a tighter, softer one
  const rim = float(1).sub(normalView.dot(positionViewDirection).abs()).pow(map ? 3.2 : 2.5)
  const rimColor = uniform(team)
  m.emissiveNode = rimColor.mul(rim).mul(map ? 0.5 : 0.6)
  return m
}

/**
 * A hero's outfit in the arena: colours per vertex, with roughness, metalness, cloth sheen and glow from each channel's
 * finish (_finish), and the same team rim as the body. Two-sided, so a sleeve or hem shows its inside.
 */
export function clothMaterial(team: THREE.Color): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ vertexColors: true, side: THREE.DoubleSide })
  const finish = attribute('_finish', 'vec4')
  m.roughnessNode = finish.x
  m.metalnessNode = finish.y
  const grazing = float(1).sub(normalView.dot(positionViewDirection).abs())
  const glow = finish.w.add(finish.z.mul(grazing.pow(2)).mul(0.3))
  m.emissiveNode = vertexColor().mul(glow).add(uniform(team).mul(grazing.pow(2.5)).mul(0.6))
  return m
}

const LOCOMOTION = new Set(['idle', 'run', 'fly', 'hover', 'stunned'])

/** Which clip a cast plays: a swing for close skills, a shot or a two-handed blast for ranged ones. */
export function castClip(build: Build, slot: string): string {
  if (slot === 'ultimate') return 'ultimate'
  const id = build.slots[slot as keyof Build['slots']]?.templateId
  const kind = id ? getTemplate(id).delivery.kind : 'melee'
  if (kind === 'melee' || kind === 'cone' || kind === 'dash' || kind === 'grapple') return 'slash'
  if (kind === 'projectile') return slot === 'basic' ? 'shoot' : 'cast'
  return 'cast'
}

export interface CharacterView {
  root: THREE.Group
  pose: (state: AnimState, dt: number, moving: boolean) => void
  /**
   * The outfit's loose cloth, once the hero stands where it's drawn this frame: `far` steps it less often, `still`
   * holds it at rest (reduced motion). True while it still swings.
   */
  settle: (dt: number, far?: boolean, still?: boolean) => boolean
}

/** A posed, animated clone of a build for one hero; `atlas` is its own atlas when it has a photo face, `wear` its outfit. */
export function characterView(file: Gltf, look: CharacterLook, team: THREE.Color, build: Build, atlas: THREE.Texture | null = null, wear?: LoadedWear): CharacterView {
  const root = new THREE.Group()
  const scene = cloneSkinned(file.scene) as THREE.Group
  const body = (map: THREE.Texture | null, normalMap: THREE.Texture | null) => characterMaterial(team, map, normalMap)
  dressModel(scene, look, wear, { body, cloth: () => clothMaterial(team) }, atlas)
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.castShadow = true
  })
  root.add(scene)
  const mixer = new THREE.AnimationMixer(scene)
  const actions = new Map(file.animations.map((clip) => [clip.name, mixer.clipAction(clip)]))
  for (const [name, action] of actions) {
    if (!LOCOMOTION.has(name)) {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
  }
  let current: THREE.AnimationAction | undefined
  let currentName = ''
  const play = (name: string, fade: number) => {
    const next = actions.get(name) ?? actions.get('idle')
    if (!next || next === current) return
    next.reset().setEffectiveWeight(1).fadeIn(fade).play()
    current?.fadeOut(fade)
    current = next
    currentName = name
  }
  return {
    root,
    pose: (state, dt, moving) => {
      const wanted =
        state.kind === 'cast' ? castClip(build, state.slot) : state.kind === 'fly' ? (moving ? 'fly' : 'hover') : state.kind === 'hit' ? 'hurt' : state.kind === 'dead' ? 'fall' : state.kind
      // a swing or a blast finishes before running or idling takes over; a new cast, a hit or death cuts in at once
      const oneShotPlaying = current && !LOCOMOTION.has(currentName) && currentName !== 'fall' && current.time < current.getClip().duration - 0.12
      if (wanted !== currentName && !(oneShotPlaying && LOCOMOTION.has(wanted))) play(wanted, wanted === 'hurt' ? 0.05 : 0.15)
      mixer.update(dt)
    },
    settle: (dt, far, still) => {
      if (!still) return settleCloth(scene, dt, far)
      restClothOn(scene)
      return false
    },
  }
}
