import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { float, normalView, positionViewDirection, uniform } from 'three/tsl'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { BUILD_SLOTS, type Build } from '../../charter/build.js'
import { CAST_POSES, POSE_RELEASE, poseClip } from '../../charter/skill-look.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot } from '../../charter/types.js'
import { skillLookOf } from '../recipes/looks.js'
import { MELEE_SETS, meleeClip, meleeSet, shotGrip, skillMotion, templateOf } from '../recipes/motions.js'
import { MOTION_RELEASE } from './anim-index.js'
import { HELD_KINDS, STANCE, type AnimState } from './animation.js'
import { animIndexNow, clipTags } from './anim-index.js'
import { clipTime, sourceOf, sourceTime } from './clip-source.js'
import { travelFromEnd } from './motion-pack.js'
import { fitClip, REFERENCE_DEPTH, restPose } from './anim-library.js'
import { hipYaw, legReach, levelToes, planter, soleHeights, torsoDepth, turn } from './feet.js'
import { GAIT_CLIPS, GAIT_TIERS, GAIT_WAYS, PACE_LIMITS, pickTier, strideSeconds, strideTime, tierSpeed, wayWeights, type GaitTier } from './gait.js'
import { floorLifted, type LibraryGait } from './library-gait.js'
import type { CharacterLook, Gltf } from './character-look.js'
import { buildModel, rigsOf } from './body-model.js'
import { applyAttitude } from './metarig/attitude.js'
import { akimbo, hangArms, hangHands } from './arms.js'
import { measureFit } from './fit.js'
import type { LoadedKit } from './held.js'
import { rigOf, RIGS, type RigNames } from './rig.js'
import { metarigRuntime, type MetarigRuntime } from './metarig/runtime.js'
import { headRuntime, type HeadRuntime } from './head/runtime.js'
import { fixups as fixupsFor, type Fixups, type Gaze } from './metarig/fixups.js'
import { extraSpread } from '../../kit/body/spread.js'
import { heightScale } from '../../kit/body/physique.js'

export { characterLook, heroHue, loadBuild } from './character-look.js'

/**
 * The arena's own characters (R24): rigged, animated MakeHuman-based bodies made in Blender (tools/blender/human.py),
 * all on one shared surface, shaped by each hero's physique and drawn bare: one draw for the body, its head's, and the
 * weapons in its hands. All are lit with a rim in the team colour.
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

/** A knockdown plays once and lies where it ends: held, but never round again. */
const HELD_ONCE = new Set(['down'])
const LOCOMOTION = new Set(['idle', 'run', 'air', 'air_rise', 'stunned', ...HELD_KINDS.filter((kind) => !HELD_ONCE.has(kind))])
/**
 * What a state plays on a body that has no clip of its own for it, each the nearest it has: every state the animator
 * can hand over shows something made for it or one of these, never the stance by default.
 */
const STAND_INS: Readonly<Record<string, string>> = { wall_run: 'run', glide: 'air', swing: 'zip', crawl: 'hang', ride: 'crouch', regain: 'air', get_up: 'crouch', block_hit: 'block', down: 'fall', air_rise: 'air', air_apex: 'air', air_jump: 'jump', rail: 'crouch', launched: 'air', charge: 'block' }
/**
 * How much of a jump's clip is its take-off, on a body whose jump clip runs on to the top of the rise (the library's,
 * library-gait.ts MOVE_CUTS): the rest of it plays through the rise. A body with a rise of its own (`air_rise`) plays
 * its jump clip whole over the take-off.
 */
const TAKE_OFF_SHARE = 0.4
/** Clips the body is already down on the floor in, so going prone needs no getting down; and how early the get-down hands over. */
const LYING = new Set(['prone', 'prone_move', 'prone_fire', 'prone_down', 'dive', 'land_roll'])
const DOWN_HANDOVER = 0.12
/** Seconds each movement blends in over: a jump or a dash snaps, a slide drops in. */
const MOVE_FADE: Record<string, number> = { jump: 0.06, air_jump: 0.05, roll: 0.06, dive: 0.05, dash: 0.04, dash_back: 0.04, land: 0.06, land_roll: 0.06, land_heavy: 0.06, slide: 0.1, air: 0.18, air_rise: 0.1, air_apex: 0.12, get_up: 0.08, regain: 0.06, down: 0.08, catch: 0.08, mantle: 0.08, climb: 0.1 }

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
// the turret's kneel-and-build: knelt and at work by 1.2 s (its own mark falls at the end of four seconds of work)
CLIP_RELEASE.ual_fixing_kneeling = 1.2
// the E dash goes at once, so its clip plays on from its mark: the break into the sprint, where the Shift dash's cut
// starts too (library-gait.ts MOVE_CUTS), not the half-second of standing before it (its own mark, 0.75 s, is a stride in)
CLIP_RELEASE.idle_to_sprint = 0.3
/**
 * Blows whose library mark is not where the blow reaches its target. The library marks a blow where the hand is
 * fastest, which for a long blade is a tenth to a third of a second before the blade comes round, and for a clip with
 * two motions can be the wrong one. Each was read through on the body (`timeline`, scripts/course.mjs --clips) and is
 * marked where the weapon's tip, or the kicking foot, is furthest toward the target (kit check, 2026-11-13); in the
 * clip's own seconds, as every mark is.
 */
Object.assign(CLIP_RELEASE, {
  // kicks: the back kick's leg comes round 0.35 s after its mark (the foot was 0.32 m out, 0.77 at its reach); the
  // snap kicks' first kick, not the step before it; the flying kick at its stretch, not its landing
  spinning_back_kick_advancing: 1.77,
  double_front_snap_kick: 0.63,
  hurricane_kick: 1.4,
  flying_kick: 0.36,
  // one hand: the advancing slash's blade was still behind the hip at its mark; the stab is out by 0.55 s and drawn
  // back by its mark
  slash_advance: 0.85,
  stabbing: 0.55,
  // the shield's heavy cut lands at 1.3 s (its mark was the sword raised again after it)
  ss_sword_and_shield_slash_2: 1.3,
  // the great sword's blade trails its hands: behind the body at every one of these marks
  gs_great_sword_slash: 0.71,
  gs_great_sword_slash_2: 0.89,
  gs_great_sword_slash_3: 0.95,
  gs_great_sword_slash_4: 0.8,
  gs_great_sword_slash_5: 0.5,
  gs_great_sword_slide_attack: 1.27,
  gs_great_sword_high_spin_attack: 1.19,
  two_hand_sword_combo: 2.28,
  // the axe's: the head comes through a little off each mark, and the jump's chop lands at 2 s (overhead at its mark)
  axe_standing_melee_attack_horizontal: 0.97,
  axe_standing_melee_attack_backhand: 1,
  axe_standing_melee_attack_360_low: 1.08,
  axe_standing_melee_attack_360_high: 1.11,
  axe_standing_melee_run_jump_attack: 2,
  // the club's: the head a tenth behind the hands; the home run meets its target on the way up, not over the head
  club_swing_single: 1.11,
  club_swing_double: 1.41,
  two_hand_club_combo: 2.89,
  club_swing_homerun: 1.47,
  // a pitch lets go as the arm comes over (its mark was the wind-up: the shot left a hand still down by the hip)
  throwing: 1.86,
  // the casts: the one-arm thrust is out a tenth after its mark, the staff's thrust and the two-palm push a fifth
  // (each mark was the hands starting forward: the bolt left a bent arm, the beam hands still at the chest)
  magic_standing_1h_magic_attack_01: 0.89,
  magic_standing_2h_magic_attack_01: 1.28,
  magic_standing_2h_magic_attack_03: 1.2,
  // the grab takes hold as the hands close, and its slam (3.5 s, its own mark) comes down as the engine throws, the
  // grab's hold later (kit-tuning.ts grab.hold): marked on the slam, the hero slammed thin air and the throw came after
  grab_and_slam: 3.05,
})

/**
 * Which way the piece in the right hand runs, in the hand's own socket (where a blade is modelled running up +y), for a
 * blow whose own hand held its piece another way: read off the clip on the body (`timeline`, 2026-11-13). An overhand
 * stab holds its blade out of the bottom of the fist, and so does the great sword's thrust; the bayonet's hand is on a
 * rifle's grip, the barrel running out across the palm. Held as modelled, the spear stood on end through its lunge and
 * the stabs pointed back over the shoulder.
 */
const HOLDS: Record<string, readonly [number, number, number]> = {
  stabbing: [0, -1, 0],
  gs_great_sword_attack: [0, -1, 0],
  bayonet_stab: [-1, 0, 1],
  // a staff's jab and its shaft strike are a rifle's butt smash and punch: the pole lies where the rifle's barrel ran,
  // under both hands (held as modelled it stood on end in the fist, across the back of the neck through the strike)
  rifle_butt_smash: [0, 0, 1],
  rifle_punch: [0, 0, 1],
}
const NO_TURN = new THREE.Quaternion()
const PIECE_UP = new THREE.Vector3(0, 1, 0)
/** The most a shot's arm or chest is turned to bring its weapon onto the aim, radians. */
const POINT = { most: (60 * Math.PI) / 180 }
/** A long gun's shooter leans back no further than `keep` from upright, radians; `most` is the most it is brought up by. */
const LEAN = { keep: (3 * Math.PI) / 180, most: (25 * Math.PI) / 180 }
/**
 * The head at a long gun's sights: how far in from the shoulder joint toward the neck its stock sits (a share of the
 * way), and how far the head tips over to it, radians.
 */
const SIGHTS = { inboard: 0.3, tilt: (12 * Math.PI) / 180 }
const HOLD_TURNS = new Map(Object.entries(HOLDS).map(([clip, d]) => [clip, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d).normalize())]))

/**
 * A long motion-captured clip (a combo, a long cast or set piece) plays only round its blow, from `lead` seconds before
 * its release to `tail` after: played whole inside one cast it ran five to ten times too fast, every hit of a combo in
 * one swing.
 */
const CAST_SPAN = { longer: 2.5, lead: 0.8, tail: 0.8 }

/**
 * Where each arm of a two-gun shot points, seen from above (radians out from straight ahead of its own shoulder): a
 * two-handed shot's arms reach across to the middle, so each is turned until its hand is just outside its shoulder.
 */
const AKIMBO = 0.1

/**
 * The fastest a wind-up plays against its clip's own pace, and the least of it that shows, seconds. The engine winds a
 * light blow up in a tenth of a second and its clip takes half a second or more to come to its contact: played whole
 * in that time it ran five to eight times too fast (a staff's tip crossed two metres between one frame and the next,
 * owner, 2026-11-13: "the pole is breaking"). So a short wind-up starts late in its clip, the body blending into it.
 */
const WIND = { fastest: 2, least: 0.1 }

/**
 * Where a cast's clip is when the wind-up is `prep` done and the recovery `recover` done: the release frame at prep 1.
 * `wind` is how long the engine gives the wind-up, seconds (WIND); without it the whole wind-up is spread over `prep`.
 */
export function castTime(clip: THREE.AnimationClip, prep: number, recover: number, since?: number, wind?: number): number {
  const { from, release, to } = castSpan(clip)
  const lead = wind === undefined ? release - from : Math.min(release - from, Math.max(WIND.least, wind * WIND.fastest))
  if (prep < 1) return release - (1 - prep) * lead
  // past its contact the clip follows through at its own pace (`since` seconds on); a preview without a clock spreads
  // what is left over the recovery
  return since !== undefined ? Math.min(to, release + since) : release + recover * (to - release)
}

/**
 * When a clip's blow lands or its shot leaves, in the clip's own seconds as it plays; undefined for a clip with no
 * mark. The mark is its source's (clip-source.ts): a contact checked on the clip itself (`userData.contact`, the motion
 * pack's), the library's mark under the source's name, or a body file's own clip's (CLIP_RELEASE), moved onto what
 * plays. So a clip cut, retimed or renamed keeps its own blow, and never takes the mark of the name it plays under.
 */
export function releaseOf(clip: THREE.AnimationClip): number | undefined {
  const src = sourceOf(clip)
  const at = (clip.userData?.contact as number | undefined) ?? CLIP_RELEASE[src.clip] ?? MOTION_RELEASE.get(src.clip)
  return at === undefined ? undefined : clipTime(clip, at)
}

/** The part of a cast's clip that plays (CAST_SPAN): from its start to its end, or round the release of a long one. */
export function castSpan(clip: THREE.AnimationClip): { from: number; release: number; to: number } {
  const { duration } = clip
  const marked = releaseOf(clip)
  const release = marked ?? duration / 2
  const long = duration > CAST_SPAN.longer && marked !== undefined
  return { from: long ? Math.max(0, release - CAST_SPAN.lead) : 0, release, to: long ? Math.min(duration, release + CAST_SPAN.tail) : duration }
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
/** Falling, how fast the feet come down to the body's base (a second), and how fast the body comes back as the fall ends. */
const FALL_REACH = { down: 9, back: 22 }
/** Metres a falling foot's joint rides over the body's base: its own height over its sole. */
const FOOT_CLEAR = 0.02
/** How finely a climb's clip is searched for where this ledge's climb starts in it, and the latest share of it that may be. */
const CLIMB_STEPS = 60
const CLIMB_LATEST = 0.75
/** Metres a second under which no pace is picked (the body isn't covering ground: standing, or off it). */
const PACE_FLOOR = 0.2
/** How much of a strafe's turn toward where the hero goes its back takes off again while it runs, its chest toward its aim. */
const SQUARE = 0.6
/** How much of the head's tilt toward a shoulder the neck takes back while the gait carries the body. */
const LEVEL = 0.8

/** The states the body is off the floor in, where its toes may hang lower than it stands: no toe levelling there. */
export const OFF_GROUND: ReadonlySet<AnimState['kind']> = new Set(['air', 'jump', 'air_jump', 'launched', 'zip', 'catch', 'hang', 'hang_left', 'hang_right', 'climb', 'mantle', 'wall_run', 'glide', 'swing', 'crawl', 'regain', 'down', 'get_up'])

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
      // a pace is only picked off ground being covered: in the air, or the frame it stops, the hero keeps the pace it
      // had, so a jump taken at a run lands running, not walking up to a run again
      if (shown + striding > 0 && speed > PACE_FLOOR) tier = sprint ? (tier === 'run' || jogging ? 'run' : 'jog') : pickTier(gait.gaits, ways, speed, tier, 'jog')
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

/** A small seed from a string, so each hero blinks on its own beat. */
const seedOf = (text: string) => {
  let h = 7
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0x7fffffff
  return h || 1
}

export interface CharacterView {
  root: THREE.Group
  /** The metarig's muscles, correctives and jiggle (GAME.md §9.2, §9.4), on a body that has one. */
  metarig?: MetarigRuntime
  /** The head's face (GAME.md §9.1): blinks, eyes, jaw and expression shapes, on a body that has its own head. */
  head?: HeadRuntime
  pose: (state: AnimState, dt: number, moving: boolean) => void
  /**
   * The body settled once the hero stands where it's drawn this frame: its feet planted and its metarig stepped (`far`
   * steps it less often; `still`, for reduced motion, is the same). True while anything still swings: nothing does now
   * that heroes wear no loose cloth.
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
  /** Where the hero aims (the engine's yaw and pitch, radians), for the look and aim at the next pose (GAME.md §9.6). */
  aim: (yaw: number, pitch: number) => void
  /**
   * Sink the hips this many metres at the next pose, the legs bending to keep each foot where its stride has it: a
   * landing taken at a run (animation.ts LANDING).
   */
  squash: (metres: number) => void
  /** Seconds a cast's clip goes on after its contact frame: its follow-through, for the animator to let play out. */
  tail: (state: AnimState) => number
  /**
   * Where a climbing body is from where its climb ends, in metres up (`y`, under the top while it is below it) and as a
   * share of the way across still to go (`z`, 1 at its start, 0 at its end), for a clip made with its own way up and
   * over. `share` is how much of the body the climb's clip has yet, 0 to 1 as it blends in: the body is that far from
   * where the engine has it to where the clip does, so it doesn't jump there while its pose is still arriving.
   * Undefined for a clip without a way of its own: the engine's own path is drawn.
   */
  travel: (state: AnimState) => { y: number; z: number; share: number } | undefined
  /** The fix-ups after the clip (spread, two-hand grip, look and aim), on a body with the standard rig. */
  fixups?: Fixups
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
 * A posed, animated clone of a build for one hero; `atlas` is its own atlas when it has a photo face, `kit` its held
 * pieces, sockets and head.
 * `combat` is the motion library's one-shot clips for a body whose file carries none (the Psyblr Human bodies), by
 * the names the engine plays: jump, air, slash, shoot, cast, hurt, fall and the rest.
 */
export function characterView(file: Gltf, look: CharacterLook, team: THREE.Color, build: Build, atlas: THREE.Texture | null = null, kit?: LoadedKit, gait?: LibraryGait, combat?: ReadonlyMap<string, THREE.AnimationClip>): CharacterView {
  const root = new THREE.Group()
  const scene = cloneSkinned(file.scene) as THREE.Group
  const rig = rigOf(scene)
  const body = (map: THREE.Texture | null, normalMap: THREE.Texture | null) => characterMaterial(team, map, normalMap)
  // a body of ours takes its attitude with its posture; a generated hero's own skin takes it on its rest here
  if (!buildModel(scene, look, kit, body, atlas)) {
    applyAttitude(scene, look.attitude)
    if (kit && look.arms) hangHands(scene, kit)
  }
  // weapons it swaps in and out: the melee set out for a blow, the ranged set for a shot
  const arms = kit && look.arms ? hangArms(scene, look.arms, kit) : undefined
  const floorAt = new THREE.Vector3()
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !o.userData.noShadow) o.castShadow = true
  })
  root.add(scene)
  const mixer = new THREE.AnimationMixer(scene)
  const actions = new Map(file.animations.map((clip) => [clip.name, mixer.clipAction(clip)]))
  // with the motion library's gait (Forge goal, phase B), fitted to this body from its rest as the file has it, the
  // hero stands in the library's stance and moves on its walks, jogs and runs; 'run' becomes a stand-in with no tracks
  // that only carries the run's fades and weight, which the gait plays under
  const rest = gait && restPose(scene, gait.bones)
  const fitted = (clip: THREE.AnimationClip) => (gait && rest ? fitClip(clip, gait.gender, look.build, rest, gait.rig) : clip)
  // a body deeper than the one the clips were made on lies higher on the floor (clip audit 2026-11-05, fault 3): a big
  // chest, a belly or a pack went under it in prone, a roll and a slide, where the slim body's hips put it
  const reference = gait && REFERENCE_DEPTH[gait.rig]?.[gait.gender]
  const depth = reference && rest ? torsoDepth(scene, scene.getObjectByName(rig.hips)!, scene.getObjectByName(rig.neck)!, scene.getObjectByName(rig.head)) : undefined
  const onFloor = (name: string, clip: THREE.AnimationClip) => (depth && reference && rest ? floorLifted(name, clip, depth, reference, rest.hips.y) : clip)
  if (combat) for (const [name, clip] of combat) if (!actions.has(name)) actions.set(name, mixer.clipAction(onFloor(name, fitted(clip))))
  const strides = gait && rest ? gaitPlayer(mixer, gait, fitted, rig) : undefined
  if (gait && rest && strides) {
    if (gait.stance) actions.set('idle', mixer.clipAction(fitted(gait.stance)))
    actions.set('run', mixer.clipAction(new THREE.AnimationClip('run', 1, [])))
  }
  for (const [name, action] of actions) {
    if (!LOCOMOTION.has(name) && !action.getClip().userData?.loop) {
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
    }
  }
  // a climb's clip with a way up of its own (the motion pack's travel, or the library's, library-gait.ts travelled) is
  // played from the moment its hips are as far under the top as this body's are as it starts: all of it from a hang, the
  // last of it (the push up and over) onto something low. So the hands are where the clip has them on the ledge
  // whatever its height, and the body never rises twice
  const hipsDown = scene.getObjectByName(rig.hips)
  const standY = hipsDown?.position.y ?? 1
  const scaleOf = new THREE.Vector3()
  const climbs = new Map<string, { clip: THREE.AnimationClip; from: number; metres: { travel: number; hips: number }; hips: (seconds: number) => number }>()
  const climbOf = (state: AnimState) => {
    if (state.kind !== 'mantle' && state.kind !== 'climb') return undefined
    const name = clipFor(state.kind === 'mantle' && state.low && actions.has('mantle_low') ? 'mantle_low' : state.kind)
    const clip = whole(name)
    if (!clip || !(clip.userData?.travel as { path?: unknown } | undefined)?.path || !hipsDown?.parent) return undefined
    const rise = state.rise ?? 0
    const key = `${name}/${state.kind}/${rise.toFixed(2)}`
    let climb = climbs.get(key)
    if (!climb) {
      const track = clip.tracks.find((t) => t.name === `${rig.hips}.position`)
      const sample = track ? (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() : undefined
      const hips = (seconds: number) => (sample ? (sample.evaluate(Math.min(clip.duration, Math.max(0, seconds))) as Float32Array)[1] : standY)
      // the hips' units to metres, and the clip's travel (on the body it was made on) to metres on this one
      const world = hipsDown.parent.getWorldScale(scaleOf).y || 1
      const metres = { hips: world, travel: world * ((clip.userData.legRatio as number | undefined) ?? 1) }
      let from = 0
      if (state.kind === 'mantle') {
        // the first moment the clip's hips stand no lower under the top than this body's do now
        const start = standY * metres.hips - rise
        for (let k = 0; k <= CLIMB_STEPS * CLIMB_LATEST; k++) {
          from = k / CLIMB_STEPS
          const way = travelFromEnd(clip, sourceTime(clip, from * clip.duration))
          if (way && way[1] * metres.travel + hips(from * clip.duration) * metres.hips >= start) break
        }
      }
      climbs.set(key, (climb = { clip, from, metres, hips }))
    }
    return climb
  }
  /** The clip a state plays under `name`, or its stand-in's on a body without one (STAND_INS). */
  const clipFor = (name: string): string => (actions.has(name) ? name : STAND_INS[name] && actions.has(STAND_INS[name]) ? STAND_INS[name] : name)
  /** The clip that plays under a name, whole (a cast's halves are cut from it, and carry no marks of their own). */
  const whole = (name: string) => (actions.get(name) ?? actions.get('idle'))?.getClip()
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
  /** The whole clip `shown` is the halves of. */
  let shownClip: THREE.AnimationClip | undefined
  let layer = 0
  let striding = 0
  let hanging = 0
  // the last movement played, so a second dash straight after the first starts over
  let moveSeq = 0
  // the clip the last jump took off on, which plays on through the rise on a body with no rise of its own
  let lastJump: string | undefined
  // a one-shot started by a state with no clock of the engine's (a preview: the staging board, the moves page) plays to
  // its end before standing or running takes over; in a match every one-shot is on the engine's clock and nothing here
  // holds it
  let unclocked = false
  let sink = 0
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
  // on the ground, a toe the pose puts under the floor comes back up (clip audit 2026-11-05, fault 2): a foot longer
  // than the clip's performer's went through the floor as each heel lifted. Each foot turns about its ankle once the
  // feet are planted, and is put back before the next update, like the bend
  const toes = rig.kind === 'standard' ? (['Left', 'Right'] as const).map((side) => [`${side}ToeBase`, `${side}Toe_End`].map((name) => scene.getObjectByName(name)!)) : []
  const soles = plants && toes.length && toes.every((pair) => pair.every(Boolean)) ? soleHeights(scene, toes.flat(), root) : undefined
  const unlevelled = legs.map(() => new THREE.Quaternion())
  let grounded = false
  let levelled = false
  const unlevel = () => {
    if (levelled) legs.forEach(([, , foot], k) => foot.quaternion.copy(unlevelled[k]))
    levelled = false
  }
  const levelFeet = () => {
    if (!soles || !grounded) return
    legs[0][0].parent!.updateWorldMatrix(true, false)
    legs.forEach(([thigh, , foot], k) => {
      thigh.updateMatrixWorld(true)
      unlevelled[k].copy(foot.quaternion)
      if (levelToes(foot, toes[k], soles.slice(k * 2, k * 2 + 2), root)) levelled = true
    })
  }
  // a landing taken at a run sinks the hips (animation.ts LANDING): each foot stays where its stride has it and its leg
  // bends to reach, so the body dips over legs that go on running. Put back before the next update, like the bend
  const unsunk = new THREE.Vector3()
  const unsquat = legs.map(() => [new THREE.Quaternion(), new THREE.Quaternion()])
  const strideAt = legs.map(() => new THREE.Vector3())
  let sunk = false
  const unsink = () => {
    if (!sunk) return
    hipsDown!.position.copy(unsunk)
    legs.forEach(([thigh, shin], k) => (thigh.quaternion.copy(unsquat[k][0]), shin.quaternion.copy(unsquat[k][1])))
    sunk = false
  }
  // falling, the lowest foot comes down to the body's base, where the floor will meet it: a fall clip that tucks its
  // legs (the library's hangs them 20 to 27 cm up) touched down in the air and stretched to the floor after. The whole
  // body eases down by as much over the fall, and back as it ends; put back before the next update with the sink
  const soleBones = legs.flatMap(([, , foot]) => (foot ? [foot, ...foot.children.filter((c) => /Toe/.test(c.name))] : []))
  let reach = 0
  const feetDown = (falling: boolean, dt: number) => {
    if (!hipsDown?.parent || !soleBones.length) return
    let target = 0
    if (falling) {
      hipsDown.parent.updateWorldMatrix(true, false)
      hipsDown.updateMatrixWorld(true)
      root.getWorldPosition(floorAt)
      let low = Infinity
      for (const bone of soleBones) low = Math.min(low, strideAt[0].setFromMatrixPosition(bone.matrixWorld).y - floorAt.y)
      target = Math.max(0, low - FOOT_CLEAR)
    }
    reach += (target - reach) * (1 - Math.exp(-dt * (falling ? FALL_REACH.down : FALL_REACH.back)))
    if (reach < 1e-3) return
    if (!sunk) {
      unsunk.copy(hipsDown.position)
      legs.forEach(([thigh, shin], k) => (unsquat[k][0].copy(thigh.quaternion), unsquat[k][1].copy(shin.quaternion)))
      sunk = true
    }
    hipsDown.position.y -= reach / (hipsDown.parent.getWorldScale(scaleOf).y || 1)
  }
  const sinkHips = () => {
    if (sink <= 1e-4 || !hipsDown?.parent || !legs.every((leg) => leg.every(Boolean))) return
    hipsDown.parent.updateWorldMatrix(true, false)
    hipsDown.updateMatrixWorld(true)
    legs.forEach(([, , foot], k) => strideAt[k].setFromMatrixPosition(foot.matrixWorld))
    if (!sunk) unsunk.copy(hipsDown.position)
    // metres to the hips' own units, under whatever the body and its skeleton are scaled by
    hipsDown.position.y -= sink / (hipsDown.parent.getWorldScale(scaleOf).y || 1)
    hipsDown.updateMatrixWorld(true)
    forward.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(bodyQ))
    legs.forEach(([thigh, shin, foot], k) => {
      unsquat[k][0].copy(thigh.quaternion)
      unsquat[k][1].copy(shin.quaternion)
      legReach(thigh, shin, foot, strideAt[k], forward)
    })
    sunk = true
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
  // a tagged one-shot (GAME.md §12) says which of its performer's feet are on the floor; moving, the gait plants its own
  const downs = [false, false]
  const tagged = (): boolean[] | undefined => {
    if (!gait) return undefined
    // the clip that plays, whole: a cast's legs are a half of it, at the same time
    const [action, clip] = layer > 0 && shown ? (striding + hanging < 0.5 ? [shown.legs, shownClip] : []) : current && !LOCOMOTION.has(currentName) ? [current, current.getClip()] : []
    // its tags are its source's, in the source's own seconds (clip-source.ts): a clip cut to an engine move, or playing
    // under an engine name, never reads another clip's
    const tags = action && clip && clipTags(animIndexNow(gait.rig), (clip.userData?.rest as typeof gait.gender | undefined) ?? gait.gender, sourceOf(clip).clip)
    if (!tags || !action || !clip) return undefined
    const t = sourceTime(clip, action.time)
    downs[0] = tags.plants.left.some(([a, b]) => t >= a && t <= b)
    downs[1] = tags.plants.right.some(([a, b]) => t >= a && t <= b)
    return downs
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
    if (!plants.place(wants, yaw, dt, planted, targets, planted ? tagged() : undefined)) return
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
  // how the piece in that hand is turned in it now (HOLDS), and its tip with it: measured as modelled, read as turned
  const heldTurn = new THREE.Quaternion()
  const tipAt = (out: THREE.Vector3) => {
    if (tip === null) {
      arms?.turn(NO_TURN)
      tip = heldTip(holder!)
      arms?.turn(heldTurn)
    }
    return tip && holder ? holder.localToWorld(out.copy(tip).applyQuaternion(heldTurn)) : undefined
  }
  // a gun in each hand (paired guns): neither hand takes the other's grip, and a shot turns each arm out to its own side
  // (AKIMBO) and its hand back by as much, so each gun points straight ahead of its own shoulder (the clip, the one-hand
  // gun's shot, has the off arm mirror the main one half a beat behind: heroes.ts akimboShot). Like the twist, put back
  // before the next update
  const twoGuns = akimbo(build.look?.arms)
  let drawn: 'melee' | 'ranged' | undefined
  let emptied = false
  // what a Q or an R is cast with: the melee weapons when its motion is a blow's (a lock-on's flurry, a leaping slam),
  // else bare hands
  const blows = new Set(Object.values(MELEE_SETS).flatMap((set) => [...set.chain, set.heavy, set.dash, set.air, set.slam, set.launcher, set.flurry]))
  const spellUseOf = (slot: BuildSlot): 'melee' | 'none' => {
    const motion = skillMotion(build, slot)
    return motion !== undefined && blows.has(motion) ? 'melee' : 'none'
  }
  const spellUse = { active2: spellUseOf('active2'), ultimate: spellUseOf('ultimate') }
  let firing: string | undefined
  /** A shot's layer is still showing: through the shot and on while it fades, until another cast takes the layer. */
  let shotOn = false
  // each side's upper arm, then its hand
  const gunBones = twoGuns && rig.kind === 'standard' ? ['LeftArm', 'LeftHand', 'RightArm', 'RightHand'].map((name) => scene.getObjectByName(name)) : []
  const unspread = gunBones.map(() => new THREE.Quaternion())
  const spreadQ = new THREE.Quaternion()
  const bodyQ = new THREE.Quaternion()
  const bodyUp = new THREE.Vector3()
  const bodyAhead = new THREE.Vector3()
  const bodyLeft = new THREE.Vector3()
  const shoulderAt = new THREE.Vector3()
  const handAt = new THREE.Vector3()
  let spread = false
  const unspreadArms = () => {
    if (spread) gunBones.forEach((bone, k) => bone!.quaternion.copy(unspread[k]))
    spread = false
  }
  const spreadArms = (share: number) => {
    if (share <= 0 || !gunBones.length || !gunBones.every(Boolean)) return
    root.updateWorldMatrix(true, false)
    bodyUp.set(0, 1, 0).applyQuaternion(root.getWorldQuaternion(bodyQ))
    gunBones.forEach((bone, k) => unspread[k].copy(bone!.quaternion))
    gunBones[0]!.parent!.updateWorldMatrix(true, true)
    gunBones[2]!.parent!.updateWorldMatrix(true, true)
    bodyAhead.set(0, 0, 1).applyQuaternion(bodyQ)
    bodyLeft.crossVectors(bodyUp, bodyAhead)
    for (const k of [0, 2]) {
      const arm = gunBones[k]!
      const hand = gunBones[k + 1]!
      // +x is the hero's left: how far round toward it the hand now lies from its shoulder, seen from above, and the turn
      // that puts it AKIMBO outside its own side; the hand turns back by as much, so its gun still points ahead
      const reach = hand.getWorldPosition(handAt).sub(arm.getWorldPosition(shoulderAt))
      const now = Math.atan2(reach.dot(bodyLeft), reach.dot(bodyAhead))
      const by = ((k === 0 ? 1 : -1) * AKIMBO - now) * share
      turn(arm, spreadQ.setFromAxisAngle(bodyUp, by))
      turn(hand, spreadQ.setFromAxisAngle(bodyUp, -by))
    }
    spread = true
  }
  // The weapon on the aim. A shot's clip was captured aiming where its actor aimed: the long gun fires tipped a hand's
  // breadth over the target, a wand is thrust out held upright like a baton, a staff lies a metre off to the side of the
  // hands that push its blast, and a body with broad shoulders or thick arms carries every one of them somewhere else
  // again. The effect leaves the weapon's far end along the engine's aim whatever the body does, so as the shot comes
  // to its release what points is turned onto the aim: a gun about the wrist that holds it, on its own barrel's line (it
  // stays up at the eye; every gun's clip carries it 14 to 28 degrees nose up); the arm that holds a wand or a staff
  // about its shoulder; the chest for a bow (both arms with it, the arrow's line from the string hand to the bow hand);
  // the casting arm for bare hands. The off hand then takes its grip where the weapon ends up. Up to POINT.most; put
  // back each frame.
  const shot = rig.kind === 'standard' ? templateOf(build, 'active1') : undefined
  const grip = shot ? shotGrip(shot) : undefined
  const pointBones = ['RightArm', 'LeftArm', 'Spine2', 'Neck', 'RightHand', 'RightForeArm', 'Spine'].map((name) => scene.getObjectByName(name))
  const pointHips = scene.getObjectByName('Hips')
  const pointRest = pointBones.map(() => new THREE.Quaternion())
  const armOf = (side: 'Left' | 'Right') => ({ upper: scene.getObjectByName(`${side}Arm`), elbow: scene.getObjectByName(`${side}ForeArm`), wrist: scene.getObjectByName(`${side}Hand`) })
  const pointArms = { Left: armOf('Left'), Right: armOf('Right') }
  const pointAim = new THREE.Vector3()
  const pointNow = new THREE.Vector3()
  const pointFrom = new THREE.Vector3()
  const pointTurn = new THREE.Quaternion()
  const pointBack = new THREE.Quaternion()
  let pointed = false
  // how far a held gun runs back from its grip (its stock, a launcher's tail), in its socket's own space, per piece
  const stocks = new WeakMap<THREE.Object3D, number>()
  const stockOf = (socket: THREE.Object3D): number => {
    const piece = socket.children[0]
    let back = stocks.get(piece)
    if (back === undefined) {
      socket.updateWorldMatrix(true, true)
      const toSocket = socket.matrixWorld.clone().invert()
      const box = new THREE.Box3()
      piece.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.computeBoundingBox()
        box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(toSocket.clone().multiply(mesh.matrixWorld)))
      })
      back = box.isEmpty() ? 0 : Math.max(0, -box.min.z)
      stocks.set(piece, back)
    }
    return back
  }
  const stockAt = new THREE.Vector3()
  const elbowOut = new THREE.Vector3()
  const aimFlat = new THREE.Vector3()
  const leanAxis = new THREE.Vector3()
  const neckAt = new THREE.Vector3()
  const unpoint = () => {
    if (pointed) pointBones.forEach((bone, k) => bone?.quaternion.copy(pointRest[k]))
    pointed = false
  }
  /** The forearm's line, elbow to wrist, in the world. */
  const forearm = (side: 'Left' | 'Right', out: THREE.Vector3) => {
    const { elbow, wrist } = pointArms[side]
    return elbow && wrist ? wrist.getWorldPosition(out).sub(elbow.getWorldPosition(pointFrom)) : undefined
  }
  const pointWeapon = (share: number) => {
    if (share <= 0.01 || !grip || grip === 'thrown' || grip === 'paired' || pointBones.some((b) => !b)) return
    const cp = Math.cos(gaze.pitch)
    pointAim.set(Math.sin(gaze.yaw) * cp, Math.sin(gaze.pitch), Math.cos(gaze.yaw) * cp)
    let pivots: THREE.Object3D[]
    let line: THREE.Vector3 | undefined
    if (grip === 'bow') {
      const l = pointArms.Left.wrist
      const r = pointArms.Right.wrist
      line = l && r ? l.getWorldPosition(pointNow).sub(r.getWorldPosition(pointFrom)) : undefined
      pivots = [pointBones[2]!]
    } else if (grip === 'emitter') {
      // bare hands: the arm whose hand is further along the aim, or both when they push out together
      const l = forearm('Left', new THREE.Vector3())
      const r = forearm('Right', new THREE.Vector3())
      const lAt = pointArms.Left.wrist?.getWorldPosition(new THREE.Vector3()).dot(pointAim) ?? -Infinity
      const rAt = pointArms.Right.wrist?.getWorldPosition(new THREE.Vector3()).dot(pointAim) ?? -Infinity
      const together = Math.abs(lAt - rAt) < 0.12
      line = together && l && r ? pointNow.copy(l.normalize()).add(r.normalize()) : lAt > rAt ? l && pointNow.copy(l) : r && pointNow.copy(r)
      pivots = together ? [pointBones[1]!, pointBones[0]!] : [lAt > rAt ? pointBones[1]! : pointBones[0]!]
    } else if (grip === 'magic1' || grip === 'magic2') {
      // a wand or a staff: from its grip to its far end, levelled along the forearm by now (levelPiece)
      const end = drawn === 'ranged' && holder ? tipAt(pointNow) : undefined
      line = end ? end.sub(holder!.getWorldPosition(pointFrom)) : undefined
      pivots = [pointBones[0]!]
    } else if (grip === 'rifle' || grip === 'heavy') {
      // a long gun is shouldered. The hand that holds it is drawn in along the aim to where its stock reaches back to
      // the shoulder (the clip's own arm is out as far as its performer's gun was long, and ours is another length on
      // every body), and the barrel is then laid on the aim about the wrist: the stock runs back to the shoulder and
      // stays there. (Turned about the wrist alone, where the clip left the hand, the barrel came onto the aim and the
      // stock left the shoulder: the gun hung off a bent wrist in front of the face.)
      const { upper, elbow, wrist } = pointArms.Right
      if (drawn !== 'ranged' || !holder || !holder.children.length || !upper || !elbow || !wrist) return
      pointBones.forEach((bone, k) => pointRest[k].copy(bone!.quaternion))
      pointed = true
      // the shooter stands up to the gun: the rifle clips lean back from the hips through the shot (their performer's
      // stance, and all the further on a tall body), so the back is brought upright about the lowest of the spine
      aimFlat.set(pointAim.x, 0, pointAim.z)
      if (pointHips && aimFlat.lengthSq() > 1e-6) {
        aimFlat.normalize()
        const spine = pointBones[3]!.getWorldPosition(neckAt).sub(pointHips.getWorldPosition(stockAt))
        const lean = Math.atan2(-spine.dot(aimFlat), spine.y) - LEAN.keep
        if (lean > 0) turn(pointBones[6]!, pointBack.setFromAxisAngle(leanAxis.set(0, 1, 0).cross(aimFlat).normalize(), Math.min(LEAN.most, lean) * share))
      }
      const back = stockOf(holder) * holder.getWorldScale(pointFrom).x
      const shoulder = upper.getWorldPosition(pointFrom)
      // a long gun's stock sits in the pocket inside the shoulder joint, and the head comes over to its sights; a
      // launcher lies on top of the shoulder, beside the head
      if (grip === 'rifle') {
        pointBones[3]!.getWorldPosition(neckAt).sub(shoulder)
        neckAt.y = 0
        shoulder.addScaledVector(neckAt.addScaledVector(pointAim, -neckAt.dot(pointAim)), SIGHTS.inboard)
        turn(pointBones[3]!, pointBack.setFromAxisAngle(aimFlat, SIGHTS.tilt * share))
      }
      const hand = wrist.getWorldPosition(pointNow)
      // no closer than a third of the arm: a short gun is held out in front of the shoulder, not against the chest
      const out = Math.max(back, (shoulder.distanceTo(elbow.getWorldPosition(stockAt)) + stockAt.distanceTo(hand)) / 3)
      stockAt.copy(shoulder).addScaledVector(pointAim, out)
      // the elbow bends down and out to its own side
      elbowOut.set(-0.6, -0.75, -0.25).normalize().applyQuaternion(root.getWorldQuaternion(pointBack))
      legReach(upper, elbow, wrist, hand.lerp(stockAt, share), elbowOut)
      line = pointNow.set(0, 0, 1).applyQuaternion(holder.getWorldQuaternion(pointBack))
      pivots = [pointBones[4]!]
    } else {
      // a gun in one hand: its barrel, the piece's own +z in the hand (gear.ts), turned about the wrist
      line = drawn === 'ranged' && holder && holder.children.length ? pointNow.set(0, 0, 1).applyQuaternion(holder.getWorldQuaternion(pointBack)) : undefined
      pivots = [pointBones[4]!]
    }
    if (!line || line.lengthSq() < 1e-6) return
    const off = line.normalize().angleTo(pointAim)
    if (off < 0.01) return
    if (!pointed) pointBones.forEach((bone, k) => pointRest[k].copy(bone!.quaternion))
    pointed = true
    pointTurn.setFromUnitVectors(line, pointAim)
    pointBack.identity().slerp(pointTurn, share * Math.min(1, POINT.most / off))
    for (const pivot of pivots) turn(pivot, pointBack)
    // the head stays on what it looks at: a chest turned for the bow leaves it where the look put it
    if (grip === 'bow') turn(pointBones[3]!, pointTurn.copy(pointBack).invert())
  }
  // a wand and a staff are levelled at what they cast at: held as modelled, a blade standing up out of the fist, the
  // wand stood upright through its thrust and the staff lay across the body. Along the forearm, as far as the shot is on
  const levelTurn = new THREE.Quaternion()
  const levelFrame = new THREE.Quaternion()
  const levelPiece = (share: number) => {
    if ((grip !== 'magic1' && grip !== 'magic2') || drawn !== 'ranged' || !holder || share <= 0.01) return
    const along = forearm('Right', pointNow)
    if (!along) return
    along.normalize().applyQuaternion(holder.getWorldQuaternion(levelFrame).invert())
    levelTurn.setFromUnitVectors(PIECE_UP, along)
    heldTurn.identity().slerp(levelTurn, share)
    arms?.turn(heldTurn)
  }
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
  const { metarig, head: headRig } = rigsOf(scene)
  const meta = metarig ? metarigRuntime(metarig, scene, look.physique, look.build.startsWith('f') ? 'f' : 'm') : undefined
  const bodyAt = new THREE.Vector3()
  const lastAt = new THREE.Vector3()
  const speed = new THREE.Vector3()
  const lastSpeed = new THREE.Vector3()
  const kick = new THREE.Vector3()
  let tracked = false
  // the head (head/): blinks on each hero's own beat, the eyes held inside their limit, the jaw with jawOpen
  const face = headRig ? headRuntime(headRig, seedOf(look.build + build.heroName)) : undefined
  // the fix-ups after the clip (GAME.md §9.6): limbs spread by the body's girth, the off hand onto a two-handed grip,
  // the look and aim spread up the back; like the twist, put back before the next update
  const gender = look.build.startsWith('f') ? 'f' : 'm'
  const fix =
    rig.kind === 'standard'
      ? fixupsFor(scene, root, metarig?.spread ? extraSpread(metarig.spread, gender) : undefined, (out) => {
          if (twoGuns && drawn === 'ranged') return undefined
          return tipAt(out)
        }, 1.8 * heightScale(look.physique ?? {}))
      : undefined
  const gaze: Gaze = { yaw: 0, pitch: 0, mode: 'look' }
  // dev probe: each hero's spread and the fix-ups' last leftovers (window.__fix)
  if (import.meta.env.DEV && fix && typeof window !== 'undefined') {
    const probe = window as unknown as { __fix?: unknown[] }
    // `playing`: the clips sounding now and their weights, to read which set (unarmed or a weapon's) the hero moves on
    const live = mixer as unknown as { _actions: THREE.AnimationAction[]; _isActiveAction: (a: THREE.AnimationAction) => boolean }
    const playing = () => live._actions.filter((a) => a.enabled && live._isActiveAction(a) && a.getEffectiveWeight() > 0.05).map((a) => `${a.getClip().name}(${a.getClip().duration.toFixed(2)}s):${a.getEffectiveWeight().toFixed(2)}`)
    // `clip`: a clip the hero has played, by name, to read its tracks; `root`: its model, to read where bones and pieces are
    const clip = (name: string) => live._actions.find((a) => a.getClip().name === name)?.getClip()
    // `timeline`: a clip of the hero's read through on a copy of its body, nothing drawn (the kit check's contact
    // marks): at each step, in the body's own frame as [side, up, ahead], which way a piece in the right hand points
    // (a blade runs up its socket's +y) and where each hand and foot is from the hips
    const timeline = (name: string, steps = 40) => {
      const clip = actions.get(name)?.getClip()
      if (!clip) return undefined
      const copy = cloneSkinned(scene) as THREE.Group
      copy.position.set(0, 0, 0)
      copy.quaternion.identity()
      const reader = new THREE.AnimationMixer(copy)
      reader.clipAction(clip).play()
      const at = new THREE.Vector3()
      const hips = new THREE.Vector3()
      const r2 = (x: number) => Math.round(x * 100) / 100
      const rows = []
      for (let i = 0; i <= steps; i++) {
        reader.setTime(Math.min(clip.duration - 1e-4, (clip.duration * i) / steps))
        copy.updateMatrixWorld(true)
        copy.getObjectByName('Hips')?.getWorldPosition(hips)
        const from = (bone: string) => {
          const o = copy.getObjectByName(bone)
          return o ? o.getWorldPosition(at).sub(hips).toArray().map(r2) : undefined
        }
        const e = copy.getObjectByName('socket:hand_r')?.matrixWorld.elements
        const n = e ? Math.hypot(e[4], e[5], e[6]) || 1 : 1
        rows.push({ t: r2(sourceTime(clip, reader.time)), blade: e ? [r2(e[4] / n), r2(e[5] / n), r2(e[6] / n)] : undefined, hips: hips.toArray().map(r2), hands: [from('LeftHand'), from('RightHand')], feet: [from('LeftFoot'), from('RightFoot')] })
      }
      reader.stopAllAction()
      reader.uncacheRoot(copy)
      const mark = releaseOf(clip)
      return { clip: sourceOf(clip).clip, duration: r2(clip.duration), mark: mark === undefined ? undefined : r2(sourceTime(clip, mark)), rows }
    }
    // `time`: where a playing clip is, in its own seconds (its top half's, when a cast plays it in halves)
    const time = (name: string) => live._actions.find((a) => a.enabled && live._isActiveAction(a) && (a.getClip().name === `${name}:top` || a.getClip().name === name))?.time
    ;(probe.__fix ??= []).push({ hero: build.heroName, spread: metarig?.spread ? extraSpread(metarig.spread, gender) : undefined, gaze, state: fix.state, playing, clip, time, timeline, root, fit: measureFit(scene) })
  }
  const runMeta = (dt: number, far: boolean) => {
    face?.update(dt, { detail: far ? 'mid' : 'near' })
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
    ...(face ? { head: face } : {}),
    ...(fix ? { fixups: fix } : {}),
    aim: (yaw, pitch) => {
      gaze.yaw = yaw
      gaze.pitch = pitch
    },
    squash: (metres) => {
      sink = metres
    },
    travel: (state) => {
      const climb = climbOf(state)
      if (!climb || !('t' in state) || state.t === undefined) return undefined
      const { clip, from, metres, hips } = climb
      const at = (from + (1 - from) * state.t) * clip.duration
      const now = travelFromEnd(clip, sourceTime(clip, at))
      const start = travelFromEnd(clip, sourceTime(clip, from * clip.duration))
      if (!now || !start) return undefined
      // how far short of where the body really starts the clip's own start is (a ledge higher than the clip climbs, or
      // a mantle begun in the air): made up over the first half of the climb, so it neither jumps at its start nor
      // misses the top at its end
      const rise = 'rise' in state ? (state.rise ?? 0) : 0
      const wanted = state.kind === 'mantle' ? -rise + (standY - hips(from * clip.duration)) * metres.hips : start[1] * metres.travel
      const short = wanted - start[1] * metres.travel
      const u = Math.min(1, state.t / 0.5)
      const share = current && current.getClip() === clip ? current.getEffectiveWeight() : 1
      return { y: now[1] * metres.travel + short * (1 - u * u * (3 - 2 * u)), z: Math.abs(start[2]) > 0.05 ? now[2] / start[2] : 1 - state.t * state.t * (3 - 2 * state.t), share }
    },
    tail: (state) => {
      if (state.kind !== 'cast') return 0
      const blow = state.melee ? meleeClip(build, state.melee) : undefined
      const clip = whole(blow && actions.has(blow) ? blow : (casts.get(state.slot)?.clip ?? ''))
      if (!clip) return 0
      const { release, to } = castSpan(clip)
      return to - release
    },
    pose: (state, dt, moving) => {
      // undone in the reverse order they went on: the toes' levelling, the feet's bend, then the legs' swing, the head's
      // steadying, the twist, the back stood on a cast's hips, the hips' sink
      unlevel()
      unbend()
      unsink()
      grounded = !OFF_GROUND.has(state.kind) && !(state.kind === 'cast' && state.air)
      unspreadArms()
      unpoint()
      fix?.undo()
      unswing()
      unsteady()
      untwist()
      unstand()
      ungrip()
      // a blow brings the melee weapons out and a shot the ranged ones; what the right hand holds is measured again
      const use = state.kind === 'charge' || (state.kind === 'cast' && (state.melee || state.slot === 'basic')) ? 'melee' : state.kind === 'cast' && state.slot === 'active1' ? 'ranged' : undefined
      // a grab takes both hands: what they held goes back on its slots until the throw is over. So does a Q or an R
      // cast with the hands (spellUse): the spell leaves the palm that casts it, not the muzzle of a gun left in a fist
      const grabbing = state.kind === 'cast' && state.melee?.kind === 'grab'
      const spell = state.kind === 'cast' && !state.melee && (state.slot === 'active2' || state.slot === 'ultimate') ? spellUse[state.slot] : undefined
      const freeing = grabbing || spell === 'none'
      if (freeing !== emptied) {
        emptied = freeing
        if (arms?.wield(freeing ? 'none' : (drawn ?? 'melee')) && holder) tip = null
      }
      const wielded = use ?? (spell === 'melee' ? 'melee' : undefined)
      if (wielded && !freeing) {
        drawn = wielded
        if (arms?.wield(wielded) && holder) tip = null
      }
      // a basic attack's blow plays its own step of the chain, or the charged heavy blow
      const blow = state.kind === 'cast' && state.melee ? meleeClip(build, state.melee) : undefined
      // a shot or a spell from a crouch or prone fires from there, on that stance's own firing clip (owner, 2026-11-04)
      const low = state.kind === 'cast' && state.low && !blow ? `${state.low}_fire` : undefined
      const cast = state.kind !== 'cast' ? undefined : blow && actions.has(blow) ? { clip: blow, from: 0 } : low && actions.has(low) ? { clip: low, from: 0 } : (casts.get(state.slot) ?? castClip(build, state.slot, (clip) => actions.has(clip)))
      // a dash away from the aim hops backwards, where the model has the clip; a jump, a second jump or a roll plays its
      // way's clip (animation.ts, Way), where the model has it
      const wayed = 'way' in state && state.way && state.way !== 'forward' ? `${state.kind}_${state.way}` : undefined
      // how far through its clip a one-shot on the engine's clock is, and the part of the clip that is: `span` of it
      let scrub = 't' in state && state.t !== undefined && state.kind !== 'hit' && state.kind !== 'air' ? state.t : undefined
      let span: readonly [number, number] = [0, 1]
      let named: string = state.kind === 'dash' && backwards && actions.has('dash_back') ? 'dash_back' : wayed && actions.has(wayed) ? wayed : state.kind
      if (state.kind === 'dash' && state.air && actions.has('dash_air')) named = 'dash_air'
      if (state.kind === 'mantle' && state.low && actions.has('mantle_low')) named = 'mantle_low'
      const ownRise = actions.has('air_rise')
      if (state.kind === 'jump' || state.kind === 'air_jump') {
        lastJump = clipFor(named)
        if (!ownRise) span = [0, TAKE_OFF_SHARE]
      } else if (state.kind === 'air') {
        // rising on the body's own rise, or on through the rest of the clip it took off on; over the top on its own
        // clip, read off how fast it rises; falling on its fall
        if (state.phase === 'rise') {
          if (ownRise) named = 'air_rise'
          else if (lastJump && actions.has(lastJump)) [named, scrub, span] = [lastJump, state.t ?? 1, [TAKE_OFF_SHARE, 1]]
        } else if (state.phase === 'apex' && actions.has('air_apex')) [named, scrub] = ['air_apex', state.t ?? 0]
      } else if (grounded) lastJump = undefined
      named = clipFor(named)
      // a climb plays the part of its clip this ledge needs (climbOf)
      const climbing = climbOf(state)
      if (climbing) span = [climbing.from, 1]
      // a looping stand-in for a one-shot (a crouch for getting up) just plays; it has no span of its own to be read through
      if (scrub !== undefined && (LOCOMOTION.has(named) || actions.get(named)?.getClip().userData?.loop)) scrub = undefined
      // a charge holds the heavy blow's own wind-up, drawn back as far as the charge has gone (animation.ts, wound)
      const heavy = state.kind === 'charge' ? meleeSet(build)?.heavy : undefined
      const charging = heavy && actions.has(heavy) ? heavy : undefined
      const meant = cast ? cast.clip : (charging ?? (state.kind === 'hit' ? 'hurt' : state.kind === 'dead' ? 'fall' : named))
      // going prone from on its feet gets down first, then lies still or crawls: faded straight from standing, the shins
      // swung 20 to 30 cm through the floor (all-moves check, 2026-11-13)
      const down = (meant === 'prone' || meant === 'prone_move') && actions.has('prone_down') && (currentName === 'prone_down' ? current!.time < current!.getClip().duration - DOWN_HANDOVER : !LYING.has(currentName))
      const wanted = down ? 'prone_down' : meant
      const layered = layer > 0
      // crouched or prone, the cast's own legs carry it: nothing standing runs under it
      const onFoot = ground !== undefined && ground > STANCE.stride && !(state.kind === 'cast' && state.low)
      const aloft = state.kind === 'cast' && !!state.air
      const prep = state.kind === 'cast' ? state.prep : charging && state.kind === 'charge' ? (state.wound ?? 0) : undefined
      const pair = prep !== undefined ? pairOf(wanted) : undefined
      if (pair && prep !== undefined) {
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
          shownClip = whole(wanted)
        }
        if (!layered) {
          runLegs?.reset().play()
          airLegs?.reset().play()
          striding = onFoot ? 1 : 0
          hanging = aloft ? 1 : 0
        }
        pair.legs.time = pair.top.time = castTime(whole(wanted)!, prep, state.kind === 'cast' ? (state.recover ?? 0) : 0, state.kind === 'cast' ? state.since : undefined, state.kind === 'cast' ? state.wind : undefined)
        layer = Math.min(1, layer + dt / CAST_FADE)
        striding = onFoot ? Math.min(1, striding + dt / LEG_FADE) : Math.max(0, striding - dt / LEG_FADE)
        hanging = aloft ? Math.min(1, hanging + dt / LEG_FADE) : Math.max(0, hanging - dt / LEG_FADE)
        if (onFoot && currentName !== 'run') play('run', LEG_FADE)
        else if (aloft && currentName !== 'air') play('air', LEG_FADE)
      } else {
        // a swing, a blast, a jump or a dash finishes before running, idling or hanging in the air takes over; a new
        // cast, a hit, a movement or death cuts in at once, and a slide or a landing gives way as soon as it's done with
        // the state is played as handed over. Only a preview's one-shot, started with no clock of the engine's, is left
        // to finish before standing or running takes over (the staging board and the moves page say what, not how long)
        const finishing = unclocked && current && !LOCOMOTION.has(currentName) && current.time < current.getClip().duration - 0.12
        const fade = wanted === 'hurt' ? 0.05 : cast?.from ? 0.1 : (MOVE_FADE[wanted] ?? MOVE_FADE[state.kind] ?? 0.15)
        const again = 'seq' in state && state.kind !== 'cast' && state.seq !== moveSeq
        if (again) moveSeq = state.seq
        // a cast not on the engine's clock plays through from where its span starts: a long clip's lead-in is skipped
        const from = cast && !cast.from && whole(wanted) ? castSpan(whole(wanted)!).from : cast?.from
        if (again || (wanted !== currentName && !(finishing && LOCOMOTION.has(wanted)))) {
          play(wanted, fade, from)
          unclocked = scrub === undefined && !LOCOMOTION.has(wanted) && state.kind !== 'hit' && state.kind !== 'dead' && !HELD_ONCE.has(state.kind)
        }
        // on the engine's clock the clip is where the move is, whatever the frame rate or the match's pace
        if (current && currentName === wanted && currentName !== 'run') {
          if (scrub !== undefined) {
            const length = current.getClip().duration
            current.time = Math.min(length - 1e-4, (span[0] + (span[1] - span[0]) * scrub) * length)
            current.timeScale = 0
          } else current.timeScale = 1
        }
        // a cast on the engine's clock gives the body back as it ends, or is cut short
        layer = Math.max(0, layer - dt / fade)
        // its halves stop with it: still playing, the next held cast would weigh them in alongside its own
        if (!layer && shown) {
          shown.legs.stop()
          shown.top.stop()
          shown = undefined
          shownClip = undefined
        }
      }
      // a blow whose own hand held its piece another way turns ours in the hand with it, as the blow comes in and goes
      const hold = shownClip && layer > 0 && drawn === 'melee' ? HOLD_TURNS.get(sourceOf(shownClip).clip) : undefined
      if (hold || !heldTurn.equals(NO_TURN)) {
        heldTurn.identity()
        if (hold) heldTurn.slerp(hold, layer * layer * (3 - 2 * layer))
        arms?.turn(heldTurn)
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
      // (only while the run runs: an action never played yet reports its starting weight of 1)
      const running = actions.get('run')!
      const gaitShare = strides && running.isRunning() ? running.getEffectiveWeight() : 0
      strides?.update(dt, gaitShare, layer * striding, ground !== undefined ? ground / root.scale.x : 0, heading, sprinting)
      mixer.update(dt)
      feetDown(state.kind === 'air' && state.phase === 'fall', dt)
      sinkHips()
      standOnCast(shown?.legs, layer * striding)
      // running, the chest comes SQUARE of the way back round to the aim; casting on the move, all of it, so the cast aims true
      turnChest(squared(Math.min(1, gaitShare * SQUARE + layer * striding)))
      steadyHead(gaitShare)
      swingLegs()
      gripHands()
      // as much as the shot is on: the cast's layer on the engine's clock, or a whole-body shot's own weight as it plays out
      const shooting = state.kind === 'cast' && state.slot === 'active1' && !state.melee
      if (shooting && cast) firing = cast.clip
      // the shot's layer fades out after the cast is over, and what was done to the arms for it fades with it: cut off
      // with the cast, a pair of guns snapped 30 cm in to the middle for a frame and a long gun dropped off its aim
      if (shooting) shotOn = true
      else if (state.kind === 'cast' || layer <= 0) shotOn = false
      const shotShare = shotOn && layer > 0 ? layer : current && currentName === firing ? current.getEffectiveWeight() : 0
      levelPiece(shotShare)
      // the weapon comes onto the aim as the shot comes to its release, and stays on it through the follow-through
      const drawnIn = state.kind === 'cast' ? Math.min(1, Math.max(0, state.prep ?? 1)) : 1
      const onAim = shotShare * drawnIn * drawnIn * (3 - 2 * drawnIn)
      gaze.point = shotShare > 0 ? () => pointWeapon(onAim) : undefined
      // a long gun, a launcher and a staff are held in both hands through the shot, on the weapon where the aim put it
      gaze.grip = drawn === 'ranged' && (grip === 'rifle' || grip === 'heavy' || grip === 'magic2') ? onAim : 0
      gaze.mode = state.kind === 'cast' ? 'aim' : state.kind === 'dead' || state.kind === 'hit' || state.kind === 'slide' || state.kind === 'roll' || state.kind === 'down' || state.kind === 'get_up' || state.kind === 'regain' || state.kind === 'launched' ? 'off' : 'look'
      fix?.apply(dt, gaze)
      spreadArms(shotShare)
      solveTwists()
      posed = dt
    },
    settle: (dt, far, still) => {
      plantFeet()
      levelFeet()
      if (bent || levelled) solveTwists()
      runMeta(dt, !!far)
      // a whip's thong swings after the hand once the body is where it ends up this frame
      arms?.step(dt, planted ? root.getWorldPosition(floorAt).y : undefined)
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
    tip: tipAt,
  }
}
