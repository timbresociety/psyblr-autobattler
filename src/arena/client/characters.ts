import * as THREE from 'three'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { attribute, clamp, distance, dot, float, max, mix, normalGeometry, normalView, positionGeometry, positionViewDirection, step, texture, uniform, vec3, vertexColor } from 'three/tsl'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { BUILD_SLOTS, type Build } from '../../charter/build.js'
import { CAST_POSES, POSE_RELEASE, poseClip } from '../../charter/skill-look.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot } from '../../charter/types.js'
import { skillLookOf } from '../recipes/looks.js'
import { STANCE, type AnimState } from './animation.js'
import { hipYaw, legReach, planter, turn } from './feet.js'
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

/** The bones a cast on the move leaves to the run: the hips and both legs (Forge goal, phase 2). */
const LEG_BONES = new Set(['hips', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'])
/** A foot within this many metres of its lowest point carries weight. */
const PLANTED = 0.03
/** Slowest and quickest the run plays to keep up with the ground: quicker strides beat feet sliding, up to a point. */
const PACE = [0.4, 2.6] as const
/** Seconds a cast takes to take over the body, and the legs to change between running and the cast's stance. */
const CAST_FADE = 0.08
const LEG_FADE = 0.12

type Halves<T> = { legs: T; top: T }

/** A clip split in two: its legs (hips down) and the rest of the body. */
export function splitClip(clip: THREE.AnimationClip): Halves<THREE.AnimationClip> {
  const leg = (track: THREE.KeyframeTrack) => LEG_BONES.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)
  return {
    legs: new THREE.AnimationClip(`${clip.name}:legs`, clip.duration, clip.tracks.filter(leg)),
    top: new THREE.AnimationClip(`${clip.name}:top`, clip.duration, clip.tracks.filter((track) => !leg(track))),
  }
}

/** Each file clip's halves, split once and shared by every hero wearing that body. */
const split = new WeakMap<THREE.AnimationClip, Halves<THREE.AnimationClip>>()
function halvesOf(clip: THREE.AnimationClip): Halves<THREE.AnimationClip> {
  let halves = split.get(clip)
  if (!halves) split.set(clip, (halves = splitClip(clip)))
  return halves
}

/**
 * How fast a looping clip carries the body over the ground at 1x, in the model's metres a second: a planted foot slides
 * back under the hips at that speed. Measured on a bare copy of the skeleton, so the model itself is never posed.
 * Undefined without both feet, or when they never plant.
 */
export function groundSpeed(model: THREE.Object3D, clip: THREE.AnimationClip): number | undefined {
  const bare = (o: THREE.Object3D): THREE.Object3D => {
    const copy = new THREE.Object3D()
    copy.name = o.name
    copy.position.copy(o.position)
    copy.quaternion.copy(o.quaternion)
    copy.scale.copy(o.scale)
    for (const child of o.children) copy.add(bare(child))
    return copy
  }
  const root = bare(model)
  const feet = ['foot_L', 'foot_R'].map((name) => root.getObjectByName(name))
  if (feet.some((foot) => !foot)) return undefined
  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(clip).play()
  const steps = 120
  const dt = clip.duration / steps
  const paths = feet.map(() => [] as THREE.Vector3[])
  for (let k = 0; k <= steps; k++) {
    action.time = k * dt
    mixer.update(0)
    root.updateMatrixWorld(true)
    feet.forEach((foot, j) => paths[j].push(foot!.getWorldPosition(new THREE.Vector3())))
  }
  const speeds: number[] = []
  for (const path of paths) {
    const low = Math.min(...path.map((p) => p.y))
    for (let k = 0; k < steps; k++) if (path[k].y <= low + PLANTED && path[k + 1].y <= low + PLANTED) speeds.push(Math.abs(path[k].z - path[k + 1].z) / dt)
  }
  if (!speeds.length) return undefined
  speeds.sort((a, b) => a - b)
  return speeds[speeds.length >> 1]
}

/** Each model file's run, in metres a second at 1x (see groundSpeed); null when it can't be measured. */
const runSpeeds = new WeakMap<Gltf, number | null>()
function runSpeed(file: Gltf): number | null {
  let speed = runSpeeds.get(file)
  if (speed === undefined) {
    const run = file.animations.find((clip) => clip.name === 'run')
    runSpeeds.set(file, (speed = (run && groundSpeed(file.scene, run)) || null))
  }
  return speed
}

/**
 * Seconds into each one-shot clip where its blow lands or its shot leaves (tools/blender/humanlib/clips.py): the strike
 * of a slash, the shot, the hip charge's thrust, the ultimate's burst, and each cast pose's release. A cast that runs
 * on the engine's clock stretches the clip so this frame lands on the release tick (Forge goal, phase 1).
 */
export const CLIP_RELEASE: Record<string, number> = { slash: 0.2, shoot: 0.1, cast: 0.28, ultimate: 0.45 }
for (const pose of CAST_POSES) if (POSE_RELEASE[pose] > 0) CLIP_RELEASE[poseClip(pose)] ??= POSE_RELEASE[pose]

/** Where a cast's clip is when the wind-up is `prep` done and the recovery `recover` done: the release frame at prep 1. */
export function castTime(clip: string, duration: number, prep: number, recover: number): number {
  const release = Math.min(CLIP_RELEASE[clip] ?? duration / 2, duration)
  return prep < 1 ? prep * release : release + recover * (duration - release)
}

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
  /** Where the hand leading along `dir` is, as last posed (see `leadHand`); undefined for a body without hand bones. */
  hand: (dir: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3 | undefined
  /** The far end of what the right hand holds, as last posed; undefined when it holds nothing. */
  tip: (out: THREE.Vector3) => THREE.Vector3 | undefined
  /**
   * Twist the chest this far (radians) from the hips at the next pose, run backwards or not (see `stance`), and cover
   * the ground at `speed` metres a second: the run plays at whatever pace keeps a planted foot from sliding. `planted`,
   * the hero stands on the ground, so its feet stay where they land (see feet.ts). `legs` turns each leg about its hip
   * joint, so a strafing hero runs on a diagonal under hips that face nearer its aim.
   */
  lean: (twist: number, back: boolean, speed?: number, planted?: boolean, legs?: number) => void
}

/** How a twist is shared up the back, hips to head. */
const TWIST_SHARE: Record<string, number> = { spine: 0.3, chest: 0.3, upper_chest: 0.25, neck: 0.15 }
const UP = new THREE.Vector3(0, 1, 0)

/** How far past the wrist the palm is, as a share of the forearm. */
const PALM = 0.35
/** Hands closer than this share of the gap between them along the aim lead together (a two-handed blast). */
const TOGETHER = 0.35

/**
 * The palm that leads along `dir`: the one further out, or the point between both when they push out together.
 * Each palm is a little past its wrist, along the forearm. Effects leave from here (Forge goal, phase 1).
 */
export function leadHand(hands: readonly THREE.Object3D[], dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | undefined {
  if (!hands.length) return undefined
  const palms = hands.map((bone) => {
    const wrist = bone.getWorldPosition(new THREE.Vector3())
    return bone.parent ? wrist.lerp(bone.parent.getWorldPosition(new THREE.Vector3()), -PALM) : wrist
  })
  if (palms.length === 1) return out.copy(palms[0])
  const ahead = palms[1].dot(dir) - palms[0].dot(dir)
  if (Math.abs(ahead) < TOGETHER * palms[0].distanceTo(palms[1])) return out.copy(palms[0]).add(palms[1]).multiplyScalar(0.5)
  return out.copy(ahead > 0 ? palms[1] : palms[0])
}

/**
 * The far end of a held piece in its socket's own space: the middle of the end of its longest side that lies further
 * from the hand. A sword's point, a staff's head. Undefined for a socket holding nothing.
 */
export function heldTip(socket: THREE.Object3D): THREE.Vector3 | undefined {
  if (!socket.children.length) return undefined
  socket.updateWorldMatrix(true, true)
  const toSocket = socket.matrixWorld.clone().invert()
  const box = new THREE.Box3()
  socket.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.computeBoundingBox()
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toSocket.clone().multiply(mesh.matrixWorld)))
  })
  if (box.isEmpty()) return undefined
  const size = box.getSize(new THREE.Vector3())
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z'
  const tip = box.getCenter(new THREE.Vector3())
  tip[axis] = Math.abs(box.max[axis]) >= Math.abs(box.min[axis]) ? box.max[axis] : box.min[axis]
  return tip
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
    if (!next) return
    if (next === current) {
      // the same clip again: a repeated swing starts over from its guard, where the last one ended
      next.reset().setEffectiveWeight(1).play()
      next.time = from
      return
    }
    next.reset().setEffectiveWeight(1).fadeIn(fade).play()
    next.time = from
    current?.fadeOut(fade)
    current = next
    currentName = name
  }
  // each skill's clip, worked out once: reading a look from its words is too slow to do every frame
  const casts = new Map(BUILD_SLOTS.map((slot) => [slot as string, castClip(build, slot)]))
  const hands = ['hand_L', 'hand_R'].flatMap((name) => scene.getObjectByName(name) ?? [])
  const back = Object.keys(TWIST_SHARE).flatMap((name) => scene.getObjectByName(name) ?? [])
  let twist = 0
  let backwards = false
  // metres a second the hero covers, as last told (see `lean`); undefined, the run plays as it was made
  let ground: number | undefined
  const keyed = runSpeed(file)
  // a cast on the engine's clock plays in halves (see splitClip): the cast above the hips, and below them its own stance
  // or, on the move, the run, so the feet keep up with the ground while the arms cast (Forge goal, phase 2). `layer` is
  // how much of the body the halves own and `striding` how much of their legs runs; the run carries on underneath
  // meanwhile, so its legs keep its step and it's there when the cast ends
  const pairs = new Map<string, Halves<THREE.AnimationAction>>()
  const pairOf = (name: string) => {
    let pair = pairs.get(name)
    if (!pair) {
      const clip = (actions.get(name) ?? actions.get('idle'))?.getClip()
      if (!clip) return undefined
      const { legs, top } = halvesOf(clip)
      pairs.set(name, (pair = { legs: mixer.clipAction(legs), top: mixer.clipAction(top) }))
    }
    return pair
  }
  const run = actions.get('run')
  const runLegs = run && mixer.clipAction(halvesOf(run.getClip()).legs)
  let shown: Halves<THREE.AnimationAction> | undefined
  let layer = 0
  let striding = 0
  // a twist goes on after the clip has posed the bones, each bone turning about its own length. The mixer only writes
  // a bone whose clip value changed, so a held pose (idle, a cast frozen in a hit-stop) would keep last frame's twist
  // and twist again: each bone's clip pose is kept and put back before the next update.
  const untwisted = back.map(() => new THREE.Quaternion())
  let twisted = false
  const untwist = () => {
    if (twisted) back.forEach((bone, k) => bone.quaternion.copy(untwisted[k]))
    twisted = false
  }
  const turnChest = () => {
    if (!twist) return
    back.forEach((bone, k) => {
      untwisted[k].copy(bone.quaternion)
      bone.rotateY(twist * TWIST_SHARE[bone.name])
    })
    twisted = true
  }
  // standing, the feet stay where they land (feet.ts): once the hero is placed for the frame, each leg bends to keep its
  // ankle there. Like the twist, the bend is taken off again before the next update
  const legs = (['L', 'R'] as const).map((side) => ['thigh', 'shin', 'foot'].map((part) => scene.getObjectByName(`${part}_${side}`)!))
  const plants = legs.every((leg) => leg.every(Boolean)) ? planter() : undefined
  const wants = legs.map(() => new THREE.Vector3())
  const targets = legs.map(() => new THREE.Vector3())
  const unbent = legs.map(() => [new THREE.Quaternion(), new THREE.Quaternion()])
  const forward = new THREE.Vector3()
  let planted = false
  let bent = false
  // seconds the last pose moved on, until the feet are placed for it
  let posed: number | undefined
  const unbend = () => {
    if (bent) legs.forEach(([thigh, shin], k) => (thigh.quaternion.copy(unbent[k][0]), shin.quaternion.copy(unbent[k][1])))
    bent = false
  }
  // running at an angle to the hips (see `stance`), each whole leg turns about the upright through its hip joint after
  // the clip has posed it, and is put back before the next update, like the twist
  let swing = 0
  const unswung = [new THREE.Quaternion(), new THREE.Quaternion()]
  const yawQ = new THREE.Quaternion()
  let swung = false
  const unswing = () => {
    if (swung) legs.forEach(([thigh], k) => thigh.quaternion.copy(unswung[k]))
    swung = false
  }
  const swingLegs = () => {
    if (!swing || !legs.every(([thigh]) => thigh)) return
    legs[0][0].parent!.updateWorldMatrix(true, false)
    yawQ.setFromAxisAngle(UP, swing)
    legs.forEach(([thigh], k) => {
      unswung[k].copy(thigh.quaternion)
      thigh.updateMatrixWorld()
      turn(thigh, yawQ)
    })
    swung = true
  }
  const plantFeet = () => {
    if (!plants || posed === undefined) return
    const dt = posed
    posed = undefined
    legs[0][0].parent!.updateWorldMatrix(true, false)
    legs.forEach(([thigh, , foot], k) => {
      thigh.updateMatrixWorld(true)
      wants[k].setFromMatrixPosition(foot.matrixWorld)
    })
    const yaw = hipYaw(targets[0].setFromMatrixPosition(legs[0][0].matrixWorld), targets[1].setFromMatrixPosition(legs[1][0].matrixWorld))
    if (!plants.place(wants, yaw, dt, planted, targets)) return
    forward.set(Math.sin(yaw), 0, Math.cos(yaw))
    legs.forEach(([thigh, shin, foot], k) => {
      unbent[k][0].copy(thigh.quaternion)
      unbent[k][1].copy(shin.quaternion)
      legReach(thigh, shin, foot, targets[k], forward)
    })
    bent = true
  }
  // what the right hand holds is measured the first time its tip is asked for, once the model is in the scene
  const holder = scene.getObjectByName('socket:hand_r')
  let tip: THREE.Vector3 | undefined | null = holder ? null : undefined
  return {
    root,
    pose: (state, dt, moving) => {
      // undone in the reverse order they went on: the feet's bend, then the legs' swing, then the twist
      unbend()
      unswing()
      untwist()
      const cast = state.kind === 'cast' ? (casts.get(state.slot) ?? castClip(build, state.slot)) : undefined
      const wanted = cast ? cast.clip : state.kind === 'fly' ? (moving ? 'fly' : 'hover') : state.kind === 'hit' ? 'hurt' : state.kind === 'dead' ? 'fall' : state.kind
      const layered = layer > 0
      const onFoot = ground !== undefined && ground > STANCE.stride
      const pair = state.kind === 'cast' && state.prep !== undefined ? pairOf(wanted) : undefined
      if (pair && state.kind === 'cast') {
        // on the engine's clock: the clip starts from its guard with the wind-up and is held to it, frame by frame. A
        // new cast's halves take over from the last one's, or from the whole body; the same clip again starts over
        if (pair !== shown) {
          const handover = layered && shown
          if (handover) for (const half of [shown!.legs, shown!.top]) half.fadeOut(CAST_FADE)
          for (const half of [pair.legs, pair.top]) {
            half.reset().play()
            half.timeScale = 0
            if (handover) half.fadeIn(CAST_FADE)
          }
          shown = pair
        }
        if (!layered) {
          runLegs?.reset().play()
          striding = onFoot ? 1 : 0
        }
        pair.legs.time = pair.top.time = castTime(wanted, pair.top.getClip().duration, state.prep ?? 0, state.recover ?? 0)
        layer = Math.min(1, layer + dt / CAST_FADE)
        striding = onFoot ? Math.min(1, striding + dt / LEG_FADE) : Math.max(0, striding - dt / LEG_FADE)
        if (onFoot && currentName !== 'run') play('run', LEG_FADE)
      } else {
        // a swing or a blast finishes before running or idling takes over; a new cast, a hit or death cuts in at once
        const oneShotPlaying = current && !LOCOMOTION.has(currentName) && currentName !== 'fall' && current.time < current.getClip().duration - 0.12
        const fade = wanted === 'hurt' ? 0.05 : cast?.from ? 0.1 : 0.15
        if (wanted !== currentName && !(oneShotPlaying && LOCOMOTION.has(wanted))) play(wanted, fade, cast?.from)
        // a cast on the engine's clock gives the body back as it ends, or is cut short
        layer = Math.max(0, layer - dt / fade)
        if (!layer) shown = undefined
      }
      // the run keeps pace with the ground it covers, so a planted foot stays put; backing away, it plays backwards
      if (current && currentName === 'run') {
        const pace = keyed && ground !== undefined ? Math.min(PACE[1], Math.max(PACE[0], ground / (keyed * root.scale.x))) : 1
        current.timeScale = backwards ? -pace : pace
      }
      if (layer > 0 || layered) {
        for (const action of actions.values()) action.weight = 1 - layer
        for (const half of pairs.values()) {
          half.top.weight = layer
          half.legs.weight = layer * (1 - striding)
        }
        if (runLegs && run) {
          runLegs.weight = layer * striding
          runLegs.time = run.time
          runLegs.timeScale = run.timeScale
        }
      }
      mixer.update(dt)
      turnChest()
      swingLegs()
      posed = dt
    },
    settle: (dt, far, still) => {
      plantFeet()
      if (!still) return settleCloth(scene, dt, far)
      restClothOn(scene)
      return false
    },
    hand: (dir, out) => leadHand(hands, dir, out),
    lean: (t, b, speed, onGround = false, angle = 0) => {
      twist = t
      backwards = b
      ground = speed
      planted = onGround
      swing = angle
    },
    tip: (out) => {
      if (tip === null) tip = heldTip(holder!)
      return tip && holder ? holder.localToWorld(out.copy(tip)) : undefined
    },
  }
}
