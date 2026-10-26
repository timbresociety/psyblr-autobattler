import * as THREE from 'three'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { attribute, clamp, distance, dot, float, max, mix, normalGeometry, normalView, positionGeometry, positionViewDirection, step, texture, uniform, vec3, vertexColor } from 'three/tsl'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { BUILD_SLOTS, type Build } from '../../charter/build.js'
import { POSE_RELEASE, poseClip } from '../../charter/skill-look.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot } from '../../charter/types.js'
import { skillLookOf } from '../recipes/looks.js'
import type { AnimState } from './animation.js'
import type { CharacterLook, Gltf } from './character-look.js'
import { restClothOn, settleCloth } from './wear/cloth-model.js'
import { dressModel, type ClothPrint } from './wear/dress-model.js'
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
 * finish (_finish), and the same team rim as the body. Two-sided, so a sleeve or hem shows its inside. With a map, a
 * generated item's: its texture where each channel keeps its own colour, and where the player chose another, that
 * colour shaded by the texture against the channel's own (_base), as printedColor does for the previews (dress-model.ts).
 */
export function clothMaterial(team: THREE.Color, map?: THREE.Texture): MeshStandardNodeMaterial {
  const own = vertexColor().rgb
  if (!map) return finished(new MeshStandardNodeMaterial({ vertexColors: true, side: THREE.DoubleSide }), own, team)
  const tex = texture(map).rgb
  const base = attribute('_base', 'vec3')
  const luma = vec3(0.2126, 0.7152, 0.0722)
  const shade = clamp(dot(tex, luma).div(max(dot(base, luma), 0.04)), 0, 2)
  return finished(new MeshStandardNodeMaterial({ side: THREE.DoubleSide }), mix(own.mul(shade), tex, float(1).sub(step(0.002, distance(own, base)))), team)
}

/**
 * A print in the arena, as classicPrintMaterial lays it on for the previews (dress-model.ts): its tile by where the
 * cloth sits on the body at rest, from the axis each face looks along, so it rides the cloth; a built-in print's ink
 * mixed over the channel's colour by its mask, a picture as it is.
 */
export function printMaterial(team: THREE.Color, print: ClothPrint): MeshStandardNodeMaterial {
  const p = positionGeometry.mul(print.repeat)
  const n = normalGeometry.normalize().abs().pow(4)
  const w = n.div(n.x.add(n.y).add(n.z))
  const tile = texture(print.map, p.zy).mul(w.x).add(texture(print.map, p.xz).mul(w.y)).add(texture(print.map, p.xy).mul(w.z))
  const color = print.ink ? mix(vertexColor().rgb, uniform(print.ink), tile.r) : tile.rgb
  return finished(new MeshStandardNodeMaterial({ side: THREE.DoubleSide }), color, team)
}

/** An outfit material in `color`, with the finish read per vertex (_finish) and the team rim. */
function finished(m: MeshStandardNodeMaterial, color: Node<'vec3'>, team: THREE.Color): MeshStandardNodeMaterial {
  const finish = attribute('_finish', 'vec4')
  m.roughnessNode = finish.x
  m.metalnessNode = finish.y
  if (!m.vertexColors) m.colorNode = color
  const grazing = float(1).sub(normalView.dot(positionViewDirection).abs())
  const glow = finish.w.add(finish.z.mul(grazing.pow(2)).mul(0.3))
  m.emissiveNode = color.mul(glow).add(uniform(team).mul(grazing.pow(2.5)).mul(0.6))
  return m
}

const LOCOMOTION = new Set(['idle', 'run', 'fly', 'hover', 'stunned'])

export interface CastClip {
  clip: string
  /** Seconds into the clip to start. */
  from: number
}

/**
 * Which clip a cast plays: the pose its look picks, else a swing for close skills, a shot or a two-handed blast for
 * ranged ones. The engine casts at once, so a pose starts just before its hands let go and the thrust lands with
 * the effect.
 */
export function castClip(build: Build, slot: string): CastClip {
  const pose = BUILD_SLOTS.includes(slot as BuildSlot) ? skillLookOf(build, slot as BuildSlot)?.pose : undefined
  if (pose) return { clip: poseClip(pose), from: Math.max(0, POSE_RELEASE[pose] - 0.08) }
  if (slot === 'ultimate') return { clip: 'ultimate', from: 0 }
  const id = build.slots[slot as keyof Build['slots']]?.templateId
  const kind = id ? getTemplate(id).delivery.kind : 'melee'
  if (kind === 'melee' || kind === 'cone' || kind === 'dash' || kind === 'grapple') return { clip: 'slash', from: 0 }
  return { clip: kind === 'projectile' && slot === 'basic' ? 'shoot' : 'cast', from: 0 }
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
  dressModel(scene, look, wear, { body, cloth: (map) => clothMaterial(team, map), print: (print) => printMaterial(team, print) }, atlas)
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
  const play = (name: string, fade: number, from = 0) => {
    const next = actions.get(name) ?? actions.get('idle')
    if (!next || next === current) return
    next.reset().setEffectiveWeight(1).fadeIn(fade).play()
    next.time = from
    current?.fadeOut(fade)
    current = next
    currentName = name
  }
  // each skill's clip, worked out once: reading a look from its words is too slow to do every frame
  const casts = new Map(BUILD_SLOTS.map((slot) => [slot as string, castClip(build, slot)]))
  return {
    root,
    pose: (state, dt, moving) => {
      const cast = state.kind === 'cast' ? (casts.get(state.slot) ?? castClip(build, state.slot)) : undefined
      const wanted = cast ? cast.clip : state.kind === 'fly' ? (moving ? 'fly' : 'hover') : state.kind === 'hit' ? 'hurt' : state.kind === 'dead' ? 'fall' : state.kind
      // a swing or a blast finishes before running or idling takes over; a new cast, a hit or death cuts in at once
      const oneShotPlaying = current && !LOCOMOTION.has(currentName) && currentName !== 'fall' && current.time < current.getClip().duration - 0.12
      if (wanted !== currentName && !(oneShotPlaying && LOCOMOTION.has(wanted))) play(wanted, wanted === 'hurt' ? 0.05 : cast?.from ? 0.1 : 0.15, cast?.from)
      mixer.update(dt)
    },
    settle: (dt, far, still) => {
      if (!still) return settleCloth(scene, dt, far)
      restClothOn(scene)
      return false
    },
  }
}
