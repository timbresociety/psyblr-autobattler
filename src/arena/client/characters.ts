import * as THREE from 'three'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { attribute, clamp, distance, dot, float, max, mix, normalGeometry, normalView, positionGeometry, positionViewDirection, step, texture, uniform, vec3, vertexColor } from 'three/tsl'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { BUILD_SLOTS, type Build } from '../../charter/build.js'
import { CAST_POSES, POSE_RELEASE, poseClip } from '../../charter/skill-look.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot } from '../../charter/types.js'
import { skillLookOf } from '../recipes/looks.js'
import { meleeClip, skillMotion } from '../recipes/motions.js'
import { MOTION_RELEASE } from './anim-index.js'
import { HELD_KINDS, STANCE, type AnimState } from './animation.js'
import { fitClip, restPose } from './anim-library.js'
import { hipYaw, legReach, planter, turn } from './feet.js'
import { GAIT_CLIPS, GAIT_TIERS, GAIT_WAYS, PACE_LIMITS, pickTier, strideSeconds, strideTime, tierSpeed, wayWeights, type GaitTier } from './gait.js'
import type { LibraryGait } from './library-gait.js'
import type { CharacterLook, Gltf } from './character-look.js'
import { restClothOn, settleCloth } from './wear/cloth-model.js'
import { dressModel, type ClothPrint } from './wear/dress-model.js'
import type { LoadedWear } from './wear/items.js'
import { rigOf, RIGS, type RigNames } from './rig.js'
import { metarigRuntime, type MetarigRuntime } from './metarig/runtime.js'
import type { Metarig } from './metarig/upgrade.js'

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
  // the team rim kept to the silhouette: any wider and it repaints dark cloth in the team's colour (black reads navy)
  m.emissiveNode = color.mul(glow).add(uniform(team).mul(grazing.pow(4)).mul(0.5))
  return m
}

const LOCOMOTION = new Set(['idle', 'run', 'air', 'stunned', ...HELD_KINDS])
/** Clips that play once and hold their last pose, but give way the moment the hero runs, jumps or stands again. */
const YIELDING = new Set(['fall', 'slide', 'land'])
/** Seconds each movement blends in over: a jump or a dash snaps, a slide drops in. */
const MOVE_FADE: Record<string, number> = { jump: 0.06, air_jump: 0.05, dash: 0.04, dash_back: 0.04, land: 0.06, slide: 0.1, air: 0.18 }

/** How far each finger joint curls round a held piece, radians, and each thumb joint. */
const GRIP = { finger: 1.1, thumb: 0.4 }
/** A foot within this many metres of its lowest point carries weight. */
const PLANTED = 0.03
/** Slowest and quickest the run plays to keep up with the ground: quicker strides beat feet sliding, up to a point. */
const PACE = [0.4, 2.6] as const
/** Seconds a cast takes to take over the body, and the legs to change between running and the cast's stance. */
const CAST_FADE = 0.08
/** Metres a second of sudden change in a body's speed that kick its jiggle (a landing, a dash, a knockback). */
const KICK_FROM = 2
const LEG_FADE = 0.12

type Halves<T> = { legs: T; top: T }

/** A clip split in two: its legs (hips down, see RigNames.legBones) and the rest of the body. */
export function splitClip(clip: THREE.AnimationClip, rig: RigNames = RIGS.legacy): Halves<THREE.AnimationClip> {
  const leg = (track: THREE.KeyframeTrack) => rig.legBones.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)
  return {
    legs: new THREE.AnimationClip(`${clip.name}:legs`, clip.duration, clip.tracks.filter(leg)),
    top: new THREE.AnimationClip(`${clip.name}:top`, clip.duration, clip.tracks.filter((track) => !leg(track))),
  }
}

/** Each file clip's halves, split once and shared by every hero wearing that body. */
const split = new WeakMap<THREE.AnimationClip, Halves<THREE.AnimationClip>>()
function halvesOf(clip: THREE.AnimationClip, rig: RigNames): Halves<THREE.AnimationClip> {
  let halves = split.get(clip)
  if (!halves) split.set(clip, (halves = splitClip(clip, rig)))
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
  const rig = rigOf(model)
  const feet = [rig.foot.L, rig.foot.R].map((name) => root.getObjectByName(name))
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
  const release = Math.min(CLIP_RELEASE[clip] ?? MOTION_RELEASE.get(clip) ?? duration / 2, duration)
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
export function castClip(build: Build, slot: string, has?: (clip: string) => boolean): CastClip {
  // the skill's own motion-captured clip, where the body has it (the Psyblr Human's combat set)
  const motion = BUILD_SLOTS.includes(slot as BuildSlot) ? skillMotion(build, slot as BuildSlot) : undefined
  if (motion && has?.(motion)) return { clip: motion, from: 0 }
  const pose = BUILD_SLOTS.includes(slot as BuildSlot) ? skillLookOf(build, slot as BuildSlot)?.pose : undefined
  if (pose) return { clip: poseClip(pose), from: Math.max(0, POSE_RELEASE[pose] - 0.08) }
  if (slot === 'ultimate') return { clip: 'ultimate', from: 0 }
  const id = build.slots[slot as keyof Build['slots']]?.templateId
  const kind = id ? getTemplate(id).delivery.kind : 'melee'
  if (kind === 'melee' || kind === 'cone' || kind === 'dash' || kind === 'grapple') return { clip: 'slash', from: 0 }
  return { clip: kind === 'projectile' && slot === 'basic' ? 'shoot' : 'cast', from: 0 }
}

/** Seconds a change of pace (walking, jogging, running) blends over. */
const TIER_FADE = 0.25
/** How much of a strafe's turn toward where the hero goes its back takes off again while it runs, its chest toward its aim. */
const SQUARE = 0.6
/** How much of the head's tilt toward a shoulder the neck takes back while the gait carries the body. */
const LEVEL = 0.8

/**
 * The library's walks, jogs and runs every way (gait.ts), fitted to one body: every clip held to one shared stride and
 * weighted by how much the gait shows, its tier's share (eased, so a change of pace blends) and its way's. Their legs
 * halves carry a cast on the move.
 */
export function gaitPlayer(mixer: THREE.AnimationMixer, gait: LibraryGait, fit: (clip: THREE.AnimationClip) => THREE.AnimationClip, rig: RigNames = RIGS.legacy) {
  const clips = GAIT_CLIPS.map((name) => fit(gait.clips.get(name)!))
  const durations = Object.fromEntries(clips.map((clip, k) => [GAIT_CLIPS[k], clip.duration]))
  const whole = clips.map((clip) => mixer.clipAction(clip))
  const legs = clips.map((clip) => mixer.clipAction(halvesOf(clip, rig).legs))
  for (const action of [...whole, ...legs]) {
    action.play()
    action.timeScale = 0
    action.weight = 0
  }
  const tiers = GAIT_TIERS.map((_, k) => (k === 0 ? 1 : 0))
  let tier: GaitTier = 'walk'
  let phase = 0
  return {
    /**
     * Carry the stride on at `speed` (metres a second on the clips' own body), going `heading` from the hips (see
     * Stance), and weight every clip: `shown` is how much of the body the gait has, `striding` how much of a cast's legs.
     */
    update(dt: number, shown: number, striding: number, speed: number, heading: number, sprint = false) {
      const ways = wayWeights(heading)
      // a sprint runs, a tier at a time: up through the jog until it shows, then the run; anything else tops out at a jog
      const jogging = tiers[GAIT_TIERS.indexOf('jog')] >= 0.5
      if (shown + striding > 0) tier = sprint ? (tier === 'run' || jogging ? 'run' : 'jog') : pickTier(gait.gaits, ways, speed, tier, 'jog')
      let sum = 0
      GAIT_TIERS.forEach((t, k) => {
        const want = t === tier ? 1 : 0
        tiers[k] += Math.sign(want - tiers[k]) * Math.min(Math.abs(want - tiers[k]), dt / TIER_FADE)
        sum += tiers[k]
      })
      // the blend's own speed and stride at 1x, played quicker or slower to cover the ground, within limits
      let own = 0
      let stride = 0
      GAIT_TIERS.forEach((t, k) => {
        tiers[k] /= sum
        own += tiers[k] * tierSpeed(gait.gaits, t, ways)
        stride += tiers[k] * strideSeconds(gait.gaits, durations, t, ways)
      })
      const rate = Math.min(PACE_LIMITS[1], Math.max(PACE_LIMITS[0], speed / own))
      phase = (phase + (dt * rate) / stride) % 1
      GAIT_CLIPS.forEach((name, k) => {
        // GAIT_CLIPS runs tier by tier, each tier's ways in GAIT_WAYS's order
        const share = tiers[Math.floor(k / GAIT_WAYS.length)] * ways[k % GAIT_WAYS.length]
        whole[k].weight = shown * share
        legs[k].weight = striding * share
        whole[k].time = legs[k].time = strideTime(gait.gaits[name], durations[name], phase)
      })
    },
  }
}

const between = new THREE.Quaternion()
const partway = new THREE.Quaternion()

/**
 * A bone's turn on hips that stand one way, as it would stand on hips that stand another (`castHips`, both turns from
 * the same parent), `share` of the way: the back of a cast played over a gait's hips holds itself as the cast does.
 * Written to `out`, which may be `spine`.
 */
export function standOn(spine: THREE.Quaternion, hips: THREE.Quaternion, castHips: THREE.Quaternion, share: number, out: THREE.Quaternion): THREE.Quaternion {
  between.copy(hips).invert().multiply(castHips)
  return out.copy(spine).premultiply(partway.identity().slerp(between, share))
}

export interface CharacterView {
  root: THREE.Group
  /** The metarig's muscles, correctives and jiggle (GAME.md §9.2, §9.4), on a body that has one. */
  metarig?: MetarigRuntime
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
   * joint, so a strafing hero runs on a diagonal under hips that face nearer its aim. `heading`, which way it moves
   * from its hips (see Stance), picks the gait's ways for a view that `strafes`.
   */
  lean: (twist: number, back: boolean, speed?: number, planted?: boolean, legs?: number, heading?: number, sprint?: boolean) => void
  /**
   * Whether it walks, jogs and runs on the motion library's clips every way (Forge goal, phase B): its hips square to
   * its aim, sidestepping and backpedalling (see `stance`). Otherwise it runs on its body's own run, its legs swung.
   */
  strafes: boolean
}

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

interface GripJoint {
  joint: THREE.Object3D
  /** The hinge in the joint's own space: a positive turn about it curls the finger toward the palm. */
  axis: THREE.Vector3
  angle: number
}

const wp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
const wq = new THREE.Quaternion()
/**
 * The finger joints of one hand with their hinges, read off the model at rest: the palm faces the way the fingers
 * cross the thumb (the left hand's the other way), and each joint's hinge is across its finger and the palm.
 */
function gripJoints(scene: THREE.Object3D, rig: RigNames, side: 'L' | 'R'): GripJoint[] {
  const hand = scene.getObjectByName(rig.hand[side])
  const prefix = side === 'L' ? 'LeftHand' : 'RightHand'
  const middle = scene.getObjectByName(`${prefix}Middle1`)
  const thumbBase = scene.getObjectByName(`${prefix}Thumb1`)
  const thumbTip = scene.getObjectByName(`${prefix}Thumb3`)
  if (!hand || !middle || !thumbBase || !thumbTip) return []
  scene.updateMatrixWorld(true)
  const at = hand.getWorldPosition(wp[0])
  const fingers = middle.getWorldPosition(wp[1]).sub(at).normalize()
  // the thumb's own direction, base to tip: its base sits by the wrist, so the base alone says nothing
  const t = thumbTip.getWorldPosition(wp[2]).sub(thumbBase.getWorldPosition(new THREE.Vector3()))
  t.addScaledVector(fingers, -t.dot(fingers)).normalize()
  const palm = side === 'L' ? new THREE.Vector3().crossVectors(fingers, t) : new THREE.Vector3().crossVectors(t, fingers)
  return rig.fingers[side].flatMap((name) => {
    const joint = scene.getObjectByName(name)
    const next = joint?.children[0]
    if (!joint || !next) return []
    const along = next.getWorldPosition(new THREE.Vector3()).sub(joint.getWorldPosition(new THREE.Vector3())).normalize()
    const axis = new THREE.Vector3().crossVectors(along, palm)
    if (axis.lengthSq() < 1e-6) return []
    axis.normalize().applyQuaternion(joint.getWorldQuaternion(wq).invert())
    return [{ joint, axis, angle: name.includes('Thumb') ? GRIP.thumb : GRIP.finger }]
  })
}

/**
 * A posed, animated clone of a build for one hero; `atlas` is its own atlas when it has a photo face, `wear` its outfit.
 * `combat` is the motion library's one-shot clips for a body whose file carries none (the Psyblr Human bodies), by
 * the names the engine plays: jump, air, slash, shoot, cast, hurt, fall and the rest.
 */
export function characterView(file: Gltf, look: CharacterLook, team: THREE.Color, build: Build, atlas: THREE.Texture | null = null, wear?: LoadedWear, gait?: LibraryGait, combat?: ReadonlyMap<string, THREE.AnimationClip>): CharacterView {
  const root = new THREE.Group()
  const scene = cloneSkinned(file.scene) as THREE.Group
  const rig = rigOf(scene)
  const body = (map: THREE.Texture | null, normalMap: THREE.Texture | null) => characterMaterial(team, map, normalMap)
  dressModel(scene, look, wear, { body, cloth: (map) => clothMaterial(team, map), print: (print) => printMaterial(team, print) }, atlas)
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.castShadow = true
  })
  root.add(scene)
  const mixer = new THREE.AnimationMixer(scene)
  const actions = new Map(file.animations.map((clip) => [clip.name, mixer.clipAction(clip)]))
  // with the motion library's gait (Forge goal, phase B), fitted to this body from its rest as the file has it, the
  // hero stands in the library's stance and moves on its walks, jogs and runs; 'run' becomes a stand-in with no tracks
  // that only carries the run's fades and weight, which the gait plays under
  const rest = gait && restPose(scene, gait.bones)
  const fitted = (clip: THREE.AnimationClip) => (gait && rest ? fitClip(clip, gait.gender, look.build, rest, gait.rig) : clip)
  if (combat) for (const [name, clip] of combat) if (!actions.has(name)) actions.set(name, mixer.clipAction(fitted(clip)))
  const strides = gait && rest ? gaitPlayer(mixer, gait, fitted, rig) : undefined
  if (gait && rest && strides) {
    if (gait.stance) actions.set('idle', mixer.clipAction(fitted(gait.stance)))
    actions.set('run', mixer.clipAction(new THREE.AnimationClip('run', 1, [])))
  }
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
  const casts = new Map(BUILD_SLOTS.map((slot) => [slot as string, castClip(build, slot, (clip) => actions.has(clip))]))
  const hands = [rig.hand.L, rig.hand.R].flatMap((name) => scene.getObjectByName(name) ?? [])
  const back = Object.keys(rig.twistShare).flatMap((name) => scene.getObjectByName(name) ?? [])
  let twist = 0
  let backwards = false
  let heading = 0
  // metres a second the hero covers, as last told (see `lean`); undefined, the run plays as it was made
  let ground: number | undefined
  // a sprint runs; anything slower jogs or walks (the canon's move and sprint, 2026-11-02)
  let sprinting = false
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
      const { legs, top } = halvesOf(clip, rig)
      pairs.set(name, (pair = { legs: mixer.clipAction(legs), top: mixer.clipAction(top) }))
    }
    return pair
  }
  const run = actions.get('run')
  const runLegs = run && !strides ? mixer.clipAction(halvesOf(run.getClip(), rig).legs) : undefined
  // in the air the legs under a cast hang as they do in a jump
  const air = actions.get('air')
  const airLegs = air && mixer.clipAction(halvesOf(air.getClip(), rig).legs)
  let shown: Halves<THREE.AnimationAction> | undefined
  let layer = 0
  let striding = 0
  let hanging = 0
  // the last movement played, so a second dash straight after the first starts over
  let moveSeq = 0
  // a twist goes on after the clip has posed the bones, each bone turning about its own length. The mixer only writes
  // a bone whose clip value changed, so a held pose (idle, a cast frozen in a hit-stop) would keep last frame's twist
  // and twist again: each bone's clip pose is kept and put back before the next update.
  const untwisted = back.map(() => new THREE.Quaternion())
  let twisted = false
  const untwist = () => {
    if (twisted) back.forEach((bone, k) => bone.quaternion.copy(untwisted[k]))
    twisted = false
  }
  const turnChest = (amount: number) => {
    if (!amount) return
    back.forEach((bone, k) => {
      untwisted[k].copy(bone.quaternion)
      bone.rotateY(amount * rig.twistShare[bone.name])
    })
    twisted = true
  }
  // standing, the feet stay where they land (feet.ts): once the hero is placed for the frame, each leg bends to keep its
  // ankle there. Like the twist, the bend is taken off again before the next update
  const legs = (['L', 'R'] as const).map((side) => [rig.thigh[side], rig.shin[side], rig.foot[side]].map((name) => scene.getObjectByName(name)!))
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
  // the library's strafes run with the hips and chest turned most of the way toward where the hero goes, the head
  // looking back: the back twists the chest back toward the aim the hero faces (see `squared`), and the neck turns the
  // head the rest of the way, as far as the gait has the body, after the clip has posed it; like the twist, put back
  // before the next update
  const chest = strides ? scene.getObjectByName(rig.upperChest) : undefined
  const neck = strides ? scene.getObjectByName(rig.neck) : undefined
  const head = scene.getObjectByName(rig.head)
  const unsteadied = new THREE.Quaternion()
  const at = new THREE.Vector3()
  const facing = new THREE.Quaternion()
  const own = new THREE.Quaternion()
  const unown = new THREE.Quaternion()
  const size = new THREE.Vector3()
  const ahead = new THREE.Vector3()
  /** How far round from where the hero faces a bone faces, as posed now; undefined for one facing nearly straight up or down. */
  const yawFromRoot = (bone: THREE.Object3D): number | undefined => {
    bone.updateWorldMatrix(true, false)
    root.matrixWorld.decompose(at, own, size)
    bone.matrixWorld.decompose(at, facing, size)
    ahead.set(0, 0, 1).applyQuaternion(facing.premultiply(unown.copy(own).invert()))
    return Math.hypot(ahead.x, ahead.z) < 0.3 ? undefined : Math.atan2(ahead.x, ahead.z)
  }
  /** The stance's twist, and as much again as squares the chest `share` of the way back to where the hero faces. */
  const squared = (share: number) => {
    const off = chest && share > 0 ? yawFromRoot(chest) : undefined
    return off === undefined ? twist : twist - off * share
  }
  let steadied = false
  const unsteady = () => {
    if (steadied) neck!.quaternion.copy(unsteadied)
    steadied = false
  }
  const steadyHead = (share: number) => {
    const off = neck && head && share > 0 ? yawFromRoot(head) : undefined
    if (off === undefined) return
    unsteadied.copy(neck!.quaternion)
    yawQ.setFromAxisAngle(at.set(0, 1, 0).applyQuaternion(own), -off * share)
    turn(neck!, yawQ)
    // and levels it: a strafe leans the body into the run, but the eyes stay level
    head!.matrixWorld.decompose(at, facing, size)
    ahead.set(0, 1, 0).applyQuaternion(facing).applyQuaternion(unown.copy(own).invert())
    yawQ.setFromAxisAngle(at.set(0, 0, 1).applyQuaternion(own), Math.atan2(ahead.x, ahead.y) * LEVEL * share)
    turn(neck!, yawQ)
    steadied = true
  }
  // a cast on the move stands its back on the cast's own hips, not the gait's. A cast's back is made to carry its arms
  // from how its hips stand (a shot tips the hips back and the back forward again over them), so on a strafe's hips,
  // turned and leaning into the run, the cast leaned twice as far, nearly flat. The hips stay the gait's and the spine
  // turns by the difference, as far as the gait carries the cast's legs; like the twist, put back before the next update
  const hipsBone = strides ? scene.getObjectByName(rig.hips) : undefined
  const spine = strides ? scene.getObjectByName(rig.spine) : undefined
  const castHips = new Map<THREE.AnimationClip, THREE.Interpolant | null>()
  const castHip = new THREE.Quaternion()
  const unstood = new THREE.Quaternion()
  let stood = false
  const unstand = () => {
    if (stood) spine!.quaternion.copy(unstood)
    stood = false
  }
  const standOnCast = (legs: THREE.AnimationAction | undefined, share: number) => {
    if (!hipsBone || !spine || !legs || share <= 0) return
    const clip = legs.getClip()
    let hipsAt = castHips.get(clip)
    if (hipsAt === undefined) {
      const track = clip.tracks.find((t) => t.name === `${rig.hips}.quaternion`)
      castHips.set(clip, (hipsAt = track ? new THREE.QuaternionLinearInterpolant(track.times, track.values, 4, new Float32Array(4)) : null))
    }
    if (!hipsAt) return
    unstood.copy(spine.quaternion)
    standOn(spine.quaternion, hipsBone.quaternion, castHip.fromArray(hipsAt.evaluate(legs.time) as Float32Array), share, spine.quaternion)
    stood = true
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
  // the Psyblr Human's twist bones (rig.ts): after every pose, each turns halfway toward the roll of the bone it follows
  // about its segment, so the skin twists along the limb instead of at the joint. Set outright, from its rest in the file.
  const twists = rig.twists.flatMap(({ bone, follows }) => {
    const t = scene.getObjectByName(bone)
    const f = scene.getObjectByName(follows)
    return t && f ? [{ bone: t, follows: f, rest: t.quaternion.clone(), axis: f.position.clone().normalize() }] : []
  })
  const roll = new THREE.Quaternion()
  const halfRoll = new THREE.Quaternion()
  const solveTwists = () => {
    for (const { bone, follows, rest, axis } of twists) {
      const q = follows.quaternion
      const d = q.x * axis.x + q.y * axis.y + q.z * axis.z
      roll.set(axis.x * d, axis.y * d, axis.z * d, q.w).normalize()
      if (roll.w < 0) roll.set(-roll.x, -roll.y, -roll.z, -roll.w)
      bone.quaternion.copy(rest).multiply(halfRoll.identity().slerp(roll, 0.5))
    }
  }
  // a hand holding a piece closes round it after the clip has posed the fingers; like the twist, put back before the next update
  const grips = (['L', 'R'] as const).flatMap((side) => {
    const socket = scene.getObjectByName(`socket:hand_${side.toLowerCase()}`)
    const joints = socket ? gripJoints(scene, rig, side) : []
    return joints.length ? [{ socket: socket!, joints, held: joints.map(() => new THREE.Quaternion()) }] : []
  })
  const curl = new THREE.Quaternion()
  let gripped = false
  const ungrip = () => {
    if (gripped) for (const g of grips) g.joints.forEach(({ joint }, k) => joint.quaternion.copy(g.held[k]))
    gripped = false
  }
  const gripHands = () => {
    for (const g of grips) {
      if (!g.socket.children.length) continue
      g.joints.forEach(({ joint, axis, angle }, k) => {
        g.held[k].copy(joint.quaternion)
        joint.quaternion.multiply(curl.setFromAxisAngle(axis, angle))
      })
      gripped = true
    }
  }
  // the metarig (metarig/): muscles, correctives and jiggle after everything else has posed the body. Jiggle and the
  // muscles' ring are kicked by any sudden change in the body's speed: a jump, a landing, a dash, a knockback
  const metarig = scene.userData.metarig as Metarig | undefined
  const meta = metarig ? metarigRuntime(metarig, scene, look.physique, look.build.startsWith('f') ? 'f' : 'm') : undefined
  const bodyAt = new THREE.Vector3()
  const lastAt = new THREE.Vector3()
  const speed = new THREE.Vector3()
  const lastSpeed = new THREE.Vector3()
  const kick = new THREE.Vector3()
  let tracked = false
  const runMeta = (dt: number, far: boolean) => {
    if (!meta || dt <= 0) return
    root.getWorldPosition(bodyAt)
    if (tracked) speed.copy(bodyAt).sub(lastAt).divideScalar(dt)
    // the body's change of speed this frame, against it: the flesh carries on the way it was going
    kick.copy(lastSpeed).sub(speed)
    const kicked = tracked && kick.length() > KICK_FROM
    meta.update(dt, { detail: far ? 'mid' : 'near', kick: kicked ? kick : undefined })
    lastAt.copy(bodyAt)
    lastSpeed.copy(speed)
    tracked = true
  }
  return {
    root,
    metarig: meta,
    pose: (state, dt, moving) => {
      // undone in the reverse order they went on: the feet's bend, then the legs' swing, the head's steadying, the twist,
      // the back stood on a cast's hips
      unbend()
      unswing()
      unsteady()
      untwist()
      unstand()
      ungrip()
      // a basic attack's blow plays its own step of the chain, or the charged heavy blow
      const blow = state.kind === 'cast' && state.melee ? meleeClip(build, state.melee) : undefined
      const cast = state.kind !== 'cast' ? undefined : blow && actions.has(blow) ? { clip: blow, from: 0 } : (casts.get(state.slot) ?? castClip(build, state.slot, (clip) => actions.has(clip)))
      // a dash away from the aim hops backwards, where the model has the clip
      const named = state.kind === 'dash' && backwards && actions.has('dash_back') ? 'dash_back' : state.kind
      const wanted = cast ? cast.clip : state.kind === 'hit' ? 'hurt' : state.kind === 'dead' ? 'fall' : named
      const layered = layer > 0
      const onFoot = ground !== undefined && ground > STANCE.stride
      const aloft = state.kind === 'cast' && !!state.air
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
          airLegs?.reset().play()
          striding = onFoot ? 1 : 0
          hanging = aloft ? 1 : 0
        }
        pair.legs.time = pair.top.time = castTime(wanted, pair.top.getClip().duration, state.prep ?? 0, state.recover ?? 0)
        layer = Math.min(1, layer + dt / CAST_FADE)
        striding = onFoot ? Math.min(1, striding + dt / LEG_FADE) : Math.max(0, striding - dt / LEG_FADE)
        hanging = aloft ? Math.min(1, hanging + dt / LEG_FADE) : Math.max(0, hanging - dt / LEG_FADE)
        if (onFoot && currentName !== 'run') play('run', LEG_FADE)
        else if (aloft && currentName !== 'air') play('air', LEG_FADE)
      } else {
        // a swing, a blast, a jump or a dash finishes before running, idling or hanging in the air takes over; a new
        // cast, a hit, a movement or death cuts in at once, and a slide or a landing gives way as soon as it's done with
        const oneShotPlaying = current && !LOCOMOTION.has(currentName) && !YIELDING.has(currentName) && current.time < current.getClip().duration - 0.12
        const fade = wanted === 'hurt' ? 0.05 : cast?.from ? 0.1 : (MOVE_FADE[wanted] ?? 0.15)
        const again = 'seq' in state && state.kind !== 'cast' && state.seq !== moveSeq
        if (again) moveSeq = state.seq
        if (again || (wanted !== currentName && !(oneShotPlaying && LOCOMOTION.has(wanted)))) play(wanted, fade, cast?.from)
        // a cast on the engine's clock gives the body back as it ends, or is cut short
        layer = Math.max(0, layer - dt / fade)
        if (!layer) shown = undefined
      }
      // the run keeps pace with the ground it covers, so a planted foot stays put; backing away, it plays backwards
      if (current && currentName === 'run' && !strides) {
        const pace = keyed && ground !== undefined ? Math.min(PACE[1], Math.max(PACE[0], ground / (keyed * root.scale.x))) : 1
        current.timeScale = backwards ? -pace : pace
      }
      if (layer > 0 || layered) {
        for (const action of actions.values()) action.weight = 1 - layer
        for (const half of pairs.values()) {
          half.top.weight = layer
          half.legs.weight = layer * Math.max(0, 1 - striding - hanging)
        }
        if (runLegs && run) {
          runLegs.weight = layer * striding
          runLegs.time = run.time
          runLegs.timeScale = run.timeScale
        }
        if (airLegs && air) {
          airLegs.weight = layer * hanging
          airLegs.time = air.time
        }
      }
      // the library's gait plays under the stand-in run, as much as its fades and a cast leave it, and under a cast's legs
      const gaitShare = strides ? actions.get('run')!.getEffectiveWeight() : 0
      strides?.update(dt, gaitShare, layer * striding, ground !== undefined ? ground / root.scale.x : 0, heading, sprinting)
      mixer.update(dt)
      standOnCast(shown?.legs, layer * striding)
      // running, the chest comes SQUARE of the way back round to the aim; casting on the move, all of it, so the cast aims true
      turnChest(squared(Math.min(1, gaitShare * SQUARE + layer * striding)))
      steadyHead(gaitShare)
      swingLegs()
      gripHands()
      solveTwists()
      posed = dt
    },
    settle: (dt, far, still) => {
      plantFeet()
      if (bent) solveTwists()
      runMeta(dt, !!far)
      if (!still) return settleCloth(scene, dt, far)
      restClothOn(scene)
      return false
    },
    hand: (dir, out) => leadHand(hands, dir, out),
    lean: (t, b, speed, onGround = false, angle = 0, way = 0, sprint = false) => {
      sprinting = sprint
      twist = t
      backwards = b
      ground = speed
      planted = onGround
      swing = angle
      heading = way
    },
    strafes: !!strides,
    tip: (out) => {
      if (tip === null) tip = heldTip(holder!)
      return tip && holder ? holder.localToWorld(out.copy(tip)) : undefined
    },
  }
}
