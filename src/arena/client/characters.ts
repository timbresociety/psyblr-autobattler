import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { float, mix, normalView, positionViewDirection, step, uniform, uv } from 'three/tsl'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { Build } from '../../charter/build'
import { getTemplate } from '../../charter/templates/catalog'
import type { AnimState } from './animation'
import { paintGeometry, type CharacterLook, type Gltf } from './character-look'

export { characterLook, loadBuild } from './character-look'

/**
 * The arena's own characters (R24): four rigged, animated builds made in Blender (tools/blender/hero.py), each one
 * mesh with its body regions and switchable parts carried per vertex. A hero is a clone of one build, repainted in its
 * own colours, wearing the parts its role calls for, lit with a rim in its team colour. One draw call per hero.
 */

/**
 * The hero's material: vertex colours, bronze regions metallic and glossy, everything else soft, and a rim light in the
 * team's colour so a crowd of twenty reads by side at a glance (R38).
 */
export function characterMaterial(team: THREE.Color): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ vertexColors: true })
  const region = uv().x
  const metal = step(7, region).mul(step(region, 8))
  m.metalnessNode = metal.mul(0.85)
  m.roughnessNode = mix(float(0.58), float(0.42), metal)
  const rim = float(1).sub(normalView.dot(positionViewDirection).abs()).pow(2.5)
  const rimColor = uniform(team)
  m.emissiveNode = rimColor.mul(rim).mul(0.6)
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
  const material = characterMaterial(team)
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    mesh.geometry = paintGeometry(mesh.geometry, look)
    mesh.material = material
    mesh.castShadow = true
    mesh.frustumCulled = false
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
