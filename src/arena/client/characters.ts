import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { float, mix, normalView, positionViewDirection, step, uniform, uv } from 'three/tsl'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { Build } from '../../charter/build'
import { getTemplate } from '../../charter/templates/catalog'
import type { AnimState } from './animation'
import { metaChannel, paintModel, REGION_INDEX, type CharacterLook, type Gltf } from './character-look'

export { characterLook, heroHue, loadBuild } from './character-look'

/**
 * The arena's own characters (R24): rigged, animated MakeHuman-based models made in Blender (tools/blender/human.py),
 * each one textured mesh with its body regions and switchable parts carried per vertex. A demo hero wears its own
 * model; anyone else a clone of one of four generic bodies, repainted in its own colours, wearing the parts its role
 * calls for. All are lit with a rim in the team colour. One draw call per hero.
 */

/**
 * The hero's material: the file's atlas (face, outfit, hair) times the per-vertex region colours, metal regions
 * metallic, leather and silk glossy, everything else soft, and a rim light in the team's colour so a crowd of twenty
 * reads by side at a glance (R38). `meta` is the UV set carrying regions (the second one on textured files).
 */
export function characterMaterial(team: THREE.Color, map: THREE.Texture | null = null, meta: 'uv' | 'uv1' = 'uv'): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ vertexColors: true })
  if (map) m.map = map
  const region = uv(meta === 'uv1' ? 1 : 0).x
  const inRegion = (index: number) => step(index, region).mul(step(region, index + 1))
  const metal = inRegion(REGION_INDEX.metal).add(inRegion(REGION_INDEX.bakedMetal))
  const gloss = inRegion(REGION_INDEX.bakedGloss)
  m.metalnessNode = metal.mul(0.85)
  m.roughnessNode = mix(mix(float(0.6), float(0.34), gloss), float(0.4), metal)
  // a painted face reads best with the rim kept to the silhouette, so textured characters get a tighter, softer one
  const rim = float(1).sub(normalView.dot(positionViewDirection).abs()).pow(map ? 3.2 : 2.5)
  const rimColor = uniform(team)
  m.emissiveNode = rimColor.mul(rim).mul(map ? 0.5 : 0.6)
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
}

/** A posed, animated clone of a build for one hero. */
export function characterView(file: Gltf, look: CharacterLook, team: THREE.Color, build: Build): CharacterView {
  const root = new THREE.Group()
  const scene = cloneSkinned(file.scene) as THREE.Group
  let meta: 'uv' | 'uv1' = 'uv'
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh) meta = metaChannel(mesh.geometry)
  })
  paintModel(scene, look, (map) => characterMaterial(team, map, meta))
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
  }
}
