import * as THREE from 'three'
import type { Gender } from '../../charter/look.js'
import { ENGINE } from '../engine/calibration.js'
import { animClip, animIndex, setOf } from './anim-library.js'
import { GAIT_CLIPS, type Gait } from './gait.js'
import { WEAPON_GAIT, type Weapon } from '../../kit/anim/weapon-gait.js'
import { ATTITUDE, SWING_TIER, type AttitudeId, type Swing } from '../../kit/anim/attitude.js'
import type { HeadReach } from './feet.js'
import type { RigKind } from './rig.js'
import { derived, sourceTime } from './clip-source.js'

/** What a hero moves and stands in from the motion library, not yet fitted to its body (characters.ts fits it). */
export interface LibraryGait {
  gender: Gender
  rig: RigKind
  /** GAIT_CLIPS by name. */
  clips: Map<string, THREE.AnimationClip>
  gaits: Readonly<Record<string, Gait>>
  /** The rig's bones, in the index's order: a body's rest pose is read off these to fit the clips to it. */
  bones: readonly string[]
  /** The stance the hero stands in: its own, if the library counts it one, else its gender's first. */
  stance?: THREE.AnimationClip
}

const loads = new Map<string, Promise<LibraryGait | undefined>>()

/**
 * The library clip behind each one-shot the engine plays, for a body whose file carries no clips of its own (the
 * Psyblr Human bodies, docs/plans/2026-10-31-canon-psyblr-human.md): Ready Player Me's jumps and fall, and Mixamo's
 * combat set for the rest (src/charter/motions.ts). A name the library hasn't got plays the stance (characters.ts).
 * A skill plays its own motion (recipes/motions.ts); slash, shoot, cast and ultimate are for a skill without one.
 */
export const LIBRARY_MOVES: Readonly<Record<string, string>> = {
  // a jump, a second jump and a roll each have a clip for every way they go (animation.ts, Way; owner 2026-11-04):
  // a running jump tucks, standing it springs straight up, to the side it hops sideways; the second jump is the same
  // jump again, for reach, not a flip (owner, 2026-11-04); a roll turns into its way and comes up running, except back,
  // where the hero hops back still facing the aim. Every jump is empty-handed (clip audit, 2026-11-05): the library's
  // side and back jumps held the hands a rifle's width apart. No empty-handed side jump exists, so to the side the
  // standing spring leans into its way (MOVE_LEANS); the rifle's side jump, turned to the way its source went, faced
  // the body 38 degrees off the aim
  jump: 'standing_jump_running',
  jump_up: 'unarmed_jump',
  jump_left: 'unarmed_jump',
  jump_right: 'unarmed_jump',
  jump_back: 'female_jump_running_backward',
  air_jump: 'standing_jump_running',
  air_jump_up: 'unarmed_jump',
  air_jump_left: 'unarmed_jump',
  air_jump_right: 'unarmed_jump',
  air_jump_back: 'female_jump_running_backward',
  roll_back: 'standing_dodge_backward',
  land: 'ual_jump_land',
  // falling with the arms out for balance (falling held a near T-pose)
  air: 'falling_idle',
  // the drive out of a sprint start, leaning hard ahead (owner, 2026-11-04: the standing dodge swayed out and back,
  // a C, before the run took over)
  dash: 'idle_to_sprint',
  dash_back: 'standing_dodge_backward',
  slide: 'running_slide',
  // Ctrl at a run: the dive of a dive roll, up to the body lying flat, which prone then takes over from
  dive: 'cmu_dive_roll',
  slash: 'jab_cross',
  // the gun raised and fired (shooting_gun pointed the empty hand and left the gun at the hip)
  shoot: 'pistol_fire',
  cast: 'spell_cast',
  ultimate: 'jump_attack',
  hurt: 'hit_to_body',
  stunned: 'big_hit_to_head',
  fall: 'falling_back_death',
  roll: 'quick_roll_to_run',
  block: 'standing_block_idle',
  // a blow caught on the guard: the guard jolted back and held (the full kit's guard hit, GAME.md §4 Defend)
  block_hit: 'standing_block_react_large',
  crouch: 'crouch_idle',
  crouch_move: 'crouch_walk_forward',
  // no still, empty-handed prone exists (prone_idle holds a rifle's grip): the stop out of a crawl, held on its last
  // frame (HELD_LAST)
  prone: 'prone_forward_stop',
  prone_move: 'prone_forward',
  // getting down from a crouch onto the front, for going prone from on the feet (characters.ts plays it first)
  prone_down: 'crouch_to_prone',
  // a shot or a spell from low stays low (owner, 2026-11-04): each fires from its stance's own hips
  crouch_fire: 'crouch_rapid_fire',
  prone_fire: 'rifle_prone_fire',
  launched: 'fall_a_loop',
  charge: 'standing_block_start',
  toggle: 'spell_cast',
  mantle: 'pulling_up_to_a_ledge',
  land_roll: 'falling_to_roll',
  land_heavy: 'mid_air_falling_to_a_hard_landing',
  // hanging from both hands overhead, swaying a little (the old hang held the hands at head height)
  zip: 'hanging_by_hands_gently_swaying',
  // a ledge (§7, owner 2026-11-04): caught from a walk off it or a jump, held hanging straight down from both hands
  // (the braced hang folded the legs into the wall and its hold bobbed, owner 2026-11-04), shimmied along hand over
  // hand, climbed up from
  catch: 'drop_to_freehang',
  hang: 'hanging_from_a_ledge_idle',
  hang_left: 'left_shimmy',
  hang_right: 'right_shimmy',
  climb: 'braced_hang_to_crouch',
  rail: 'crouch_idle',
}

/**
 * One-shots the engine times itself: only the stretch of the clip that does the move plays, sped up to last as long as
 * the engine's move does. Seconds into the clip, from and to, and how long it plays. A Mixamo roll stands, steps and
 * crouches for half a second before it rolls; the engine's roll starts at once.
 */
const MOVE_CUTS: Readonly<Record<string, [from: number, to: number, seconds: number]>> = {
  // take-off to the top of the rise: the push, the tuck, the reach for whatever comes next (the running jump's leap
  // starts at 0.62; before it, its cut played run strides; clip audit 2026-11-05)
  jump: [0.62, 1.08, 0.42],
  jump_up: [0.7, 1.2, 0.42],
  jump_left: [0.7, 1.2, 0.42],
  jump_right: [0.7, 1.2, 0.42],
  jump_back: [0, 0.32, 0.42],
  // the second jump plays the first's push again
  air_jump: [0.62, 1.08, 0.42],
  air_jump_up: [0.7, 1.2, 0.42],
  air_jump_left: [0.7, 1.2, 0.42],
  air_jump_right: [0.7, 1.2, 0.42],
  air_jump_back: [0, 0.32, 0.42],
  // a roll from the dive to running again, turned into its way (match-view); back, a dodge from the push off to the
  // feet back under (the library trims the dodge to start at its push, kit/anim/trims.ts)
  roll: [0.22, 1.25, ENGINE.move.roll.time],
  roll_back: [0, 0.85, ENGINE.move.roll.time],
  land: [0.05, 0.55, 0.3],
  dash: [0.17, 0.62, 0.3],
  dash_back: [0, 0.8, 0.34],
  toggle: [0.15, 1.0, 0.6],
  // the pull-up itself, from the hands taking the weight to the body folded over the top (it ended halfway up)
  mantle: [0.6, 3.3, ENGINE.move.mantle.time],
  land_roll: [0.05, 1.3, 0.55],
  // from the run into the slide to before it gets back up: crouching takes over from there
  slide: [0.17, 0.85, ENGINE.move.slide.time],
  // the body already leaning out off the push to it flat in the air (from upright, it read as a lunge, owner 2026-11-04)
  dive: [0.2, 0.42, ENGINE.move.dive.time],
  land_heavy: [0.55, 1.6, 0.45],
  // the jolt itself, not the settle back to the guard after it
  block_hit: [0, 0.6, 0.3],
  // the drop into the hang, reaching up as it falls, to the arms straight (MOVE_MEETS levels its end with the hang)
  catch: [1.04, 1.73, 0.45],
  climb: [0, 1.13, ENGINE.move.hang.climb],
  // from crouched, the hands going down, to lying flat; quicker than its own pace, as the engine lies down at once
  prone_down: [0.35, 1.2, 0.6],
}

/**
 * Tumbles turned to roll straight along the way the hero goes. A Mixamo roll goes over a shoulder, on its own line:
 * quick_roll_to_run rolls 65 degrees right of the way it faces and falling_to_roll 61 left, so a dodge played along the
 * move dived across the camera's line, head off to the right (owner, 2026-11-04).
 */
const ALIGNED: ReadonlySet<string> = new Set(['roll', 'land_roll'])

const UP = new THREE.Vector3(0, 1, 0)

/**
 * The heading (radians, the yaw convention: 0 along +z, a quarter turn to +x) a tumbling clip rolls along: the axis the
 * hips turn about from the last upright frame to the most upside-down one, less a quarter turn. Undefined for a clip
 * that never tips past level.
 */
export function rollLine(clip: THREE.AnimationClip): number | undefined {
  const track = clip.tracks.find((t) => t.name.endsWith('.quaternion') && clip.tracks.some((p) => p.name === t.name.replace('.quaternion', '.position')))
  if (!track) return undefined
  const q = (i: number) => new THREE.Quaternion().fromArray(track.values, i * 4).normalize()
  const ups = Array.from({ length: track.times.length }, (_, i) => UP.clone().applyQuaternion(q(i)).y)
  const low = ups.indexOf(Math.min(...ups))
  if (ups[low] > 0) return undefined
  let start = 0
  for (let i = 0; i < low; i++) if (ups[i] > 0.85) start = i
  const turn = q(low).multiply(q(start).invert())
  const axis = new THREE.Vector3(turn.x, turn.y, turn.z)
  if (axis.lengthSq() < 1e-9) return undefined
  if (turn.w < 0) axis.negate()
  return Math.atan2(axis.x, axis.z) - Math.PI / 2
}

/** `clip` turned `angle` radians round the vertical: the hips' facing and their path both. */
export function turned(clip: THREE.AnimationClip, angle: number): THREE.AnimationClip {
  const r = new THREE.Quaternion().setFromAxisAngle(UP, angle)
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const hips = clip.tracks.find((t) => t.name.endsWith('.position'))?.name.replace('.position', '')
  const tracks = clip.tracks.map((track) => {
    if (track.name !== `${hips}.quaternion` && track.name !== `${hips}.position`) return track
    const values = new Float32Array(track.values)
    const width = track.getValueSize()
    for (let i = 0; i < values.length; i += width)
      if (width === 4) q.fromArray(values, i).premultiply(r).toArray(values, i)
      else v.fromArray(values, i).applyQuaternion(r).toArray(values, i)
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, Float32Array.from(track.times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
}

/**
 * Moves whose hips the library puts in the wrong place for the engine. `ahead`: metres the hips go forward the whole
 * clip; the ledge hang held the hands half a metre off the edge it hangs from (owner, 2026-11-04: "the ledge hold
 * animation is completely distorted"). `down`: the hips' height the clip comes down to by its end, falling there over
 * its second half; the dive's leap ends a metre up, and prone then dropped it to the floor in a blink. Its cut ends
 * pitched head first, hands reaching down, so the hips come down until the hands meet the floor, not flat on it: at
 * 0.14 m the head and hands went 45-84 cm through the floor on every body (floor sheets 2026-11-13). `flat`: the
 * hips stay at the height they start, as the engine carries the body. `to`, with `flat`: the height the hips sink to by
 * the end instead, evenly. (The mantle and the climb were flattened this way until 2026-11-13; they keep their own way
 * up now, as their travel: CLIMBS.)
 */
const MOVE_SHIFTS: Readonly<Record<string, { ahead?: number; down?: number; flat?: boolean; to?: number }>> = {
  dive: { down: 0.92 },
  catch: { ahead: 0.4 },
  hang: { ahead: 0.4 },
  hang_left: { ahead: 0.4 },
  hang_right: { ahead: 0.4 },
}

/**
 * The moves that go up and over a ledge. Each clip's hips carry its whole way up and ahead (a pull-up rises 1.6 m), which
 * the engine also does: flattened, the body pulled up in place and sank 37 cm into the ledge it was lifted onto. Their
 * hips' rise and reach come out and are kept as the clip's travel (`travelled`), and the body is drawn along it from
 * the top of the real ledge down (characters.ts `travel`), so the hands stay where the clip has them on the ledge.
 * Each one's number is how high over the ledge's top its hips are as it ends, in metres on the body it was made on: the
 * pull-up ends folded over the top, the climb in a crouch on it.
 */
const CLIMBS: Readonly<Record<string, number>> = { mantle: 0.5, climb: 0.5 }

/**
 * `clip` with its hips' rise and reach taken out and kept as its travel (`userData.travel`, in the shape the motion
 * pack's clips keep theirs: where it ends from where it starts, and the way there key by key, in the source's seconds).
 * What is left on the hips is where they end, `over` metres above the top they end on, and their sway across.
 */
export function travelled(clip: THREE.AnimationClip, over: number): THREE.AnimationClip {
  const track = clip.tracks.find((t) => t.name === 'Hips.position')
  if (!track || track.values.length < 6) return clip
  const n = track.values.length / 3
  const [y0, z0] = [track.values[1], track.values[2]]
  const [yEnd, zEnd] = [track.values[(n - 1) * 3 + 1], track.values[(n - 1) * 3 + 2]]
  const way = new Float32Array(n * 3)
  const values = new Float32Array(track.values)
  for (let i = 0; i < n; i++) {
    way[i * 3 + 1] = values[i * 3 + 1] - y0
    way[i * 3 + 2] = values[i * 3 + 2] - z0
    values[i * 3 + 1] = over
    values[i * 3 + 2] = 0
  }
  const tracks = clip.tracks.map((t) => (t === track ? new THREE.VectorKeyframeTrack(t.name, Float32Array.from(t.times), values) : t))
  const out = derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
  out.userData.travel = { end: [0, yEnd - y0, zEnd - z0], turn: 0, path: { times: Float32Array.from(track.times, (t) => sourceTime(clip, t)), values: way } }
  return out
}

/**
 * Side jumps: the standing spring tipped into its way (radians, + toward the hero's left), most at the top of the rise.
 * The engine carries the body sideways; the lean shows which way it goes.
 */
const MOVE_LEANS: Readonly<Record<string, number>> = { jump_left: 0.22, jump_right: -0.22, air_jump_left: 0.22, air_jump_right: -0.22 }

/** Moves that hold one frame of their clip, the last: prone has no still empty-handed clip, so it holds a crawl's stop. */
const HELD_LAST: ReadonlySet<string> = new Set(['prone'])

/**
 * Lying moves turned so the spine points along the aim, at the frame the body holds still (the last). The library
 * baked each by its own chest, so the crawl lay 9 degrees one way and the still prone 28 the other, and stopping
 * swung the body round on the floor.
 */
const SQUARED: ReadonlySet<string> = new Set(['prone', 'prone_move', 'prone_fire', 'prone_down'])

/** A move whose last frame holds its hips where another move's first frame does: the ledge catch drops into the hang. */
const MOVE_MEETS: Readonly<Record<string, string>> = { catch: 'hang' }

/**
 * One-shots that end where the next move's hips start, along the floor as well as in height: the get-down crawls a
 * body length forward on its own, and the engine keeps the hero where it is.
 */
const MOVE_LANDS: Readonly<Record<string, string>> = { prone_down: 'prone' }

/** `clip` tipped `angle` radians sideways round its forward line, easing in and out over the clip. */
export function leaned(clip: THREE.AnimationClip, angle: number): THREE.AnimationClip {
  const ahead = new THREE.Vector3(0, 0, 1)
  const r = new THREE.Quaternion()
  const q = new THREE.Quaternion()
  const tracks = clip.tracks.map((track) => {
    if (track.name !== 'Hips.quaternion') return track
    const values = new Float32Array(track.values)
    track.times.forEach((t, i) => {
      // tipping toward +x turns the up axis toward +x: a turn of minus the angle round +z
      r.setFromAxisAngle(ahead, -angle * Math.sin((Math.PI * t) / clip.duration))
      q.fromArray(values, i * 4).premultiply(r).toArray(values, i * 4)
    })
    return new THREE.QuaternionKeyframeTrack(track.name, Float32Array.from(track.times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
}

/** `clip` standing still on its last frame, for `seconds`. */
export function heldLast(clip: THREE.AnimationClip, seconds = 1): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const width = track.getValueSize()
    const last = track.values.subarray(track.values.length - width)
    const values = new Float32Array(width * 2)
    values.set(last, 0)
    values.set(last, width)
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, Float32Array.from([0, seconds]), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, seconds, tracks), clip.duration, 0)
}

/** The heading (the yaw convention) the spine points along on the clip's last frame: the hips' up axis, flattened. */
export function spineLine(clip: THREE.AnimationClip): number {
  const track = clip.tracks.find((t) => t.name === 'Hips.quaternion')
  if (!track) return 0
  const up = UP.clone().applyQuaternion(new THREE.Quaternion().fromArray(track.values, track.values.length - 4))
  return Math.atan2(up.x, up.z)
}

/**
 * `clip` with its hips brought to `end` by its last frame: along the floor, as far as they have travelled so far (so a
 * crawl forward covers only the way the next move needs, at its own pace); in height, evenly over the clip.
 */
export function landed(clip: THREE.AnimationClip, end: readonly [number, number, number]): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    if (track.name !== 'Hips.position' || track.values.length < 6) return track
    const values = new Float32Array(track.values)
    const n = values.length / 3
    const [x0, z0] = [values[0], values[2]]
    const [xl, yl, zl] = [values[(n - 1) * 3], values[(n - 1) * 3 + 1], values[(n - 1) * 3 + 2]]
    const whole = Math.hypot(xl - x0, zl - z0)
    for (let i = 0; i < n; i++) {
      const along = whole > 1e-6 ? Math.min(1, Math.hypot(values[i * 3] - x0, values[i * 3 + 2] - z0) / whole) : i / (n - 1)
      values[i * 3] += (end[0] - xl) * along
      values[i * 3 + 2] += (end[2] - zl) * along
      values[i * 3 + 1] += ((end[1] - yl) * i) / (n - 1)
    }
    return new THREE.VectorKeyframeTrack(track.name, Float32Array.from(track.times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
}

/** `clip` with its hips raised or lowered `by` metres all through. */
function lifted(clip: THREE.AnimationClip, by: number): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    if (track.name !== 'Hips.position') return track
    const values = new Float32Array(track.values)
    for (let i = 1; i < values.length; i += 3) values[i] += by
    return new THREE.VectorKeyframeTrack(track.name, Float32Array.from(track.times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
}

/**
 * `clip` raised `by` as far as its hips come down from `standing` (their height standing, in the clip's units): not at
 * all where it stands, all of it at its lowest, or once they are `full` of the way down. A pose on the floor, for a body
 * deeper than the one it was made on.
 */
export function liftedLow(clip: THREE.AnimationClip, by: number, standing: number, full = 1): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith('.position')) return track
    const values = new Float32Array(track.values)
    let lowest = Infinity
    for (let i = 1; i < values.length; i += 3) lowest = Math.min(lowest, values[i])
    const span = (standing - lowest) * full
    if (span <= 1e-3) return track
    for (let i = 1; i < values.length; i += 3) values[i] += by * Math.min(1, Math.max(0, (standing - values[i]) / span))
    return new THREE.VectorKeyframeTrack(track.name, Float32Array.from(track.times), values)
  })
  return Object.assign(new THREE.AnimationClip(clip.name, clip.duration, tracks), { userData: clip.userData })
}

/** The moves that lie on the floor, and which side of the torso they lie on: the front, the back, or curled round. */
const FLOOR_SIDE: Readonly<Record<string, 'front' | 'back' | 'both'>> = {
  prone: 'front',
  prone_down: 'front',
  prone_move: 'front',
  prone_fire: 'front',
  dive: 'front',
  slide: 'back',
  fall: 'back',
  roll: 'both',
  land_roll: 'both',
}

type Depth = { front: number; back: number; head?: HeadReach }

/**
 * The engine move `name` fitted to a body whose torso is `depth` against the `reference` body's the clips were made on
 * (feet.ts torsoDepth): a move that lies on the floor lifted by how much further that side reaches, the torso's or the
 * head's (liftedLow, from the body's `standing` hips), so a big chest, a belly, a pack or a big head stays out of the
 * floor (clip audit 2026-11-05, fault 3). A curled roll goes over the top of the head on its way down, so it takes the
 * whole lift by the time the hips are 60% of the way down. Anything else, or a body no deeper, as it is.
 */
export function floorLifted(name: string, clip: THREE.AnimationClip, depth: Depth, reference: Depth, standing: number): THREE.AnimationClip {
  const side = FLOOR_SIDE[name]
  if (!side) return clip
  const torso = side === 'both' ? (depth.front + depth.back - reference.front - reference.back) / 2 : depth[side] - reference[side]
  const head = depth.head && reference.head ? depth.head[side === 'both' ? 'top' : side] - reference.head[side === 'both' ? 'top' : side] : 0
  const deeper = Math.max(torso, head)
  return deeper > 0.005 ? liftedLow(clip, deeper, standing, side === 'both' ? 0.6 : 1) : clip
}

/** The hips' height on a clip's first or last frame. */
function hipsHeight(clip: THREE.AnimationClip, last: boolean): number | undefined {
  const track = clip.tracks.find((t) => t.name === 'Hips.position')
  return track && track.values[last ? track.values.length - 2 : 1]
}

/** `clip` with its hips moved by `shift` (see MOVE_SHIFTS). */
export function shifted(clip: THREE.AnimationClip, shift: { ahead?: number; down?: number; flat?: boolean; to?: number }): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith('.position')) return track
    const values = new Float32Array(track.values)
    const last = values[values.length - 2]
    for (let i = 0; i < track.times.length; i++) {
      values[i * 3 + 2] += shift.ahead ?? 0
      // falling: slow at the top of the arc, quickest as it lands
      const u = Math.max(0, (track.times[i] / clip.duration - 0.5) / 0.5)
      if (shift.down !== undefined) values[i * 3 + 1] -= (last - shift.down) * u * u
      if (shift.flat) values[i * 3 + 1] = values[1] + ((shift.to ?? values[1]) - values[1]) * (track.times[i] / clip.duration)
    }
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, Float32Array.from(track.times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
}

/**
 * `clip` with each named bone's own swing made bigger: every key's turn away from the bone's mean over the loop, as a
 * rotation vector in the bone's frame, its pitch (x), twist (y) and side drop (z) scaled by `by`, each gain's excess
 * over 1 taken `share` of. A loop stays a loop, since its first and last keys scale alike.
 */
export function swung(clip: THREE.AnimationClip, by: Readonly<Record<string, Swing>>, share = 1): THREE.AnimationClip {
  const gain = (k: number | undefined) => 1 + ((k ?? 1) - 1) * share
  const tracks = clip.tracks.map((track) => {
    const swing = by[track.name.replace(/\.quaternion$/, '')]
    if (!track.name.endsWith('.quaternion') || !swing) return track
    const k = new THREE.Vector3(gain(swing.pitch), gain(swing.twist), gain(swing.drop))
    const v = track.values
    const n = v.length / 4
    const sum = new THREE.Vector4()
    const q = new THREE.Quaternion()
    const first = new THREE.Quaternion().fromArray(v, 0)
    for (let i = 0; i < n; i++) {
      q.fromArray(v, i * 4)
      // the same hemisphere as the first key, so the sum means something
      const s = q.dot(first) < 0 ? -1 : 1
      sum.x += q.x * s
      sum.y += q.y * s
      sum.z += q.z * s
      sum.w += q.w * s
    }
    const centre = new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize()
    const back = centre.clone().invert()
    const out = new Float32Array(v.length)
    const turn = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const d = back.clone().multiply(q.fromArray(v, i * 4))
      if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w)
      // the turn as axis times angle, scaled axis by axis, and back
      const angle = 2 * Math.acos(Math.min(1, d.w))
      const s = Math.sqrt(Math.max(0, 1 - d.w * d.w))
      if (s < 1e-6) {
        centre.toArray(out, i * 4)
        continue
      }
      turn.set(d.x / s, d.y / s, d.z / s).multiplyScalar(angle).multiply(k)
      const a = turn.length()
      const scaled = a < 1e-9 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(turn.divideScalar(a), a)
      centre.clone().multiply(scaled).toArray(out, i * 4)
    }
    return new THREE.QuaternionKeyframeTrack(track.name, Float32Array.from(track.times), out)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
}

/** The part of `clip` from `from` to `to` seconds, its keys spaced to play in `seconds`. */
export function cut(clip: THREE.AnimationClip, from: number, to: number, seconds: number): THREE.AnimationClip {
  const k = seconds / (to - from)
  const tracks = clip.tracks.map((track) => {
    const width = track.getValueSize()
    const keep: number[] = []
    track.times.forEach((t, i) => t >= from - 1e-6 && t <= to + 1e-6 && keep.push(i))
    const times = Float32Array.from(keep, (i) => (track.times[i] - from) * k)
    const values = new Float32Array(keep.length * width)
    keep.forEach((i, n) => values.set(track.values.subarray(i * width, (i + 1) * width), n * width))
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, times, values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, seconds, tracks), from, (to - from) / seconds)
}

/**
 * Each F aura's own flourish (recipes/motions AURA_CLIPS) cut to its peak, to play as the toggle: [from, to, seconds]
 * as MOVE_CUTS. Sheets 2026-11-11: the power-up's wind to its roar, the guard coming up whole, the dip into the
 * crouch, the chest thump, the fists pumped, the battlecry's throw back.
 */
const TOGGLE_CUTS: Readonly<Record<string, [number, number, number]>> = {
  ss_sword_and_shield_power_up: [0.3, 1.6, 0.9],
  standing_block_start: [0, 0.5, 0.5],
  standing_idle_to_crouch: [0, 1.0, 0.6],
  axe_standing_taunt_chest_thump: [0.3, 1.9, 1.0],
  male_cheering_with_two_fists_pump: [0, 1.4, 0.9],
  axe_standing_taunt_battlecry: [0.3, 1.9, 1.0],
}

/**
 * How far a skill's or a blow's clip may carry the hips from where it starts, in metres: across, and up. The engine
 * moves the hero itself (a dash, a leap, a lunge), so a clip's own travel would walk the body out of its place and snap
 * it back; within the reach it eases off (tanh) rather than stopping dead. Down stays whole, so a kneel or a slam
 * still gets low.
 */
const ANCHOR = { across: 0.35, up: 0.5 }

/**
 * `clip`, a one-gun shot, fired with a gun in each hand (paired guns): the left arm (shoulder to fingertips) plays the
 * right arm's shot mirrored, `share` of the clip later and wrapping round, so the off hand's gun fires between the main
 * hand's shots; the hips, spine and head are squared to the front (each turn met halfway by its mirror), since a
 * one-gun shot stands side-on. The standard rig's sides mirror a turn as (x, -y, -z, w).
 */
export function akimboed(clip: THREE.AnimationClip, share = 0.5): THREE.AnimationClip {
  const by = clip.duration * share
  const named = new Map(clip.tracks.map((t) => [t.name, t]))
  const mirror = (v: Float32Array, i: number) => {
    v[i + 1] = -v[i + 1]
    v[i + 2] = -v[i + 2]
  }
  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith('.quaternion') || clip.duration <= 0) return track
    const bone = track.name.slice(0, -'.quaternion'.length)
    if (/^Left(Shoulder|Arm|ForeArm|Hand)/.test(bone)) {
      const right = named.get(`Right${bone.slice('Left'.length)}.quaternion`)
      if (!right) return track
      // the right arm's own blend: a turn slerps
      const at = right.InterpolantFactoryMethodLinear(new Float32Array(4)) as THREE.Interpolant
      const values = new Float32Array(right.times.length * 4)
      right.times.forEach((t, i) => {
        values.set(at.evaluate((t + clip.duration - by) % clip.duration) as Float32Array, i * 4)
        mirror(values, i * 4)
      })
      return new THREE.QuaternionKeyframeTrack(track.name, Float32Array.from(right.times), values)
    }
    if (!/^(Hips|Spine\d?|Neck|Head)$/.test(bone)) return track
    const values = new Float32Array(track.values)
    const q = new THREE.Quaternion()
    const m = new THREE.Quaternion()
    for (let i = 0; i < values.length; i += 4) {
      q.fromArray(values, i)
      m.set(q.x, -q.y, -q.z, q.w)
      q.slerp(m, 0.5).toArray(values, i)
    }
    return new THREE.QuaternionKeyframeTrack(track.name, Float32Array.from(track.times), values)
  })
  return Object.assign(new THREE.AnimationClip(clip.name, clip.duration, tracks), { userData: { ...clip.userData } })
}

/** `clip` with its hips held near where they start (ANCHOR). */
export function anchored(clip: THREE.AnimationClip): THREE.AnimationClip {
  const soft = (d: number, reach: number) => reach * Math.tanh(d / reach)
  const tracks = clip.tracks.map((track) => {
    if (!track.name.endsWith('.position') || track.values.length < 3) return track
    const values = new Float32Array(track.values)
    const [x0, y0, z0] = [values[0], values[1], values[2]]
    for (let i = 0; i < track.times.length; i++) {
      const dx = values[i * 3] - x0
      const dz = values[i * 3 + 2] - z0
      const d = Math.hypot(dx, dz)
      const k = d > 1e-6 ? soft(d, ANCHOR.across) / d : 1
      values[i * 3] = x0 + dx * k
      values[i * 3 + 2] = z0 + dz * k
      const dy = values[i * 3 + 1] - y0
      if (dy > 0) values[i * 3 + 1] = y0 + soft(dy, ANCHOR.up)
    }
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, Float32Array.from(track.times), values)
  })
  return Object.assign(new THREE.AnimationClip(clip.name, clip.duration, tracks), { userData: { ...clip.userData } })
}

const moveLoads = new Map<string, Promise<Map<string, THREE.AnimationClip>>>()

/**
 * The moves an attitude stays off (the clip's `userData.plain`, anim-library fitClip): down at the floor, where a lean
 * or a hunch on the crouch puts the hands and head through it (floor sheets 2026-11-11: low's heavy landing 34 cm
 * under, its roll 29, brute's 9 to 14 on landings and prone, every gait and attack within 1.5 cm of neutral), and
 * hanging and climbing, where arms held out miss the ledge.
 */
const PLAIN = new Set(['land', 'land_heavy', 'land_roll', 'roll', 'slide', 'dive', 'fall', 'prone', 'prone_move', 'prone_fire', 'prone_down', 'crouch', 'crouch_move', 'crouch_fire', 'rail', 'ultimate', 'zip', 'catch', 'hang', 'hang_left', 'hang_right', 'climb', 'mantle'])

/**
 * The one-shots a gender's library has (LIBRARY_MOVES) by the engine's names, and `motions` (a hero's skills' clips) by
 * their own, fetched once each. `instead` puts a hero's own clip under an engine name (its guard as the `block`).
 */
export async function libraryMoves(gender: Gender, rig: RigKind, motions: readonly string[] = [], instead: Readonly<Record<string, string>> = {}, attitude: AttitudeId = 'neutral'): Promise<Map<string, THREE.AnimationClip>> {
  const base = await baseMoves(gender, rig)
  const names = [...new Set([...motions, ...Object.values(instead)])]
  const own = await Promise.all(names.map((name) => animClip(gender, name, rig).catch(() => undefined)))
  const out = new Map(base)
  const moving = new Set(motions)
  own.forEach((clip, k) => clip && out.set(names[k], moving.has(names[k]) ? anchored(clip) : clip))
  for (const [ours, name] of Object.entries(instead)) {
    const found = out.get(name)
    const cuts = ours === 'toggle' ? TOGGLE_CUTS[name] : undefined
    const clip = found && cuts ? cut(found, ...cuts) : found
    if (clip) out.set(ours, named(clip, ours))
  }
  const heavy = ATTITUDE[attitude].heavyLanding && out.get('land_heavy')
  if (heavy) out.set('land', derived(heavy, new THREE.AnimationClip('land', heavy.duration, heavy.tracks)))
  return out
}

/** `clip` under the engine's name for the move it plays, still knowing the clip it came from (clip-source.ts). */
export function named(clip: THREE.AnimationClip, ours: string): THREE.AnimationClip {
  const out = derived(clip, new THREE.AnimationClip(ours, clip.duration, clip.tracks))
  out.userData.plain = PLAIN.has(ours)
  return out
}

function baseMoves(gender: Gender, rig: RigKind): Promise<Map<string, THREE.AnimationClip>> {
  const key = `${rig}/${gender}`
  let load = moveLoads.get(key)
  if (!load) {
    load = (async () => {
      const names = Object.entries(LIBRARY_MOVES)
      const clips = await Promise.all(names.map(([, clip]) => animClip(gender, clip, rig).catch(() => undefined)))
      const out = new Map<string, THREE.AnimationClip>()
      names.forEach(([ours], k) => {
        const line = ALIGNED.has(ours) && clips[k] ? rollLine(clips[k]!) : SQUARED.has(ours) && clips[k] ? spineLine(clips[k]!) : undefined
        const clip = line === undefined ? clips[k] : turned(clips[k]!, -line)
        const cuts = MOVE_CUTS[ours]
        const shift = MOVE_SHIFTS[ours]
        const lean = MOVE_LEANS[ours]
        const timed = clip && (HELD_LAST.has(ours) ? heldLast(clip) : cuts ? cut(clip, ...cuts) : clip)
        const tipped = timed && lean ? leaned(timed, lean) : timed
        if (tipped) out.set(ours, named(ours in CLIMBS ? travelled(tipped, CLIMBS[ours]) : shift ? shifted(tipped, shift) : tipped, ours))
      })
      for (const [ours, into] of Object.entries(MOVE_MEETS)) {
        const clip = out.get(ours)
        const end = clip && hipsHeight(clip, true)
        const start = out.has(into) ? hipsHeight(out.get(into)!, false) : undefined
        if (clip && end !== undefined && start !== undefined) out.set(ours, named(lifted(clip, start - end), ours))
      }
      for (const [ours, into] of Object.entries(MOVE_LANDS)) {
        const clip = out.get(ours)
        const next = out.get(into)?.tracks.find((t) => t.name === 'Hips.position')
        if (clip && next) out.set(ours, named(landed(clip, [next.values[0], next.values[1], next.values[2]]), ours))
      }
      return out
    })()
    moveLoads.set(key, load)
  }
  return load
}

/**
 * The sidesteps the unarmed strafes are built on (clip audit, fault 4 and call 1; signed by the owner 2026-11-10). The
 * library's own strafes ran side-on, the hips 83-103 degrees off the aim; these keep the chest within 2 degrees of it
 * and the hips 10-35 open to the step. Each one's numbers are measured off its planted feet on the medium bodies
 * (2026-11-13; the same measure gives the walk and the jog within 3% of the baker's): metres a second at 1x, and the
 * second each foot lands in its one stride. `turn` (degrees, + toward the hero's left) sets its hips and legs going
 * square to its side, the chest kept on the aim (turnedBelow): walking_left drifts 9 degrees back, running_left 7
 * ahead. `arms`: the move ahead whose arms swing over it.
 */
const SIDESTEPS = {
  walking_left: { arms: 'walk', turn: -9, speed: { m: 1.35, f: 1.28 }, lands: { left: 0.25, right: 0.833 } },
  running_left: { arms: 'jog', turn: 7, speed: { m: 3.39, f: 3.24 }, lands: { left: 0.208, right: 0.583 } },
} as const

/**
 * Each unarmed strafe's sidestep: the right ones mirror the left (the library's right sidesteps drift 32-34 degrees
 * back), and the runs are the jog's played quicker, since the library has no running sidestep that faces ahead.
 * `quicker` sets each one's own pace near the ground it covers: the running sidestep goes 3.4 m/s, so a 6.5 m/s jog
 * played it 1.9 times over, past the gait's limit (gait.ts PACE_LIMITS), and the feet slid; a sprint at 8 m/s, 2.4.
 */
const STRAFES: Readonly<Record<string, { from: keyof typeof SIDESTEPS; right?: boolean; quicker?: number }>> = {
  walk_left: { from: 'walking_left' },
  walk_right: { from: 'walking_left', right: true },
  jog_left: { from: 'running_left', quicker: 1.1 },
  jog_right: { from: 'running_left', right: true, quicker: 1.1 },
  run_left: { from: 'running_left', quicker: 1.4 },
  run_right: { from: 'running_left', right: true, quicker: 1.4 },
}

/** The arm bones, shoulder to fingertips, on the standard rig. */
const ARMS = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)/

/**
 * `legs` under the arms of `arms`, swinging in its step: each arm bone read off `arms` at the same point of its own
 * stride, the left foot landing with the left foot landing.
 */
export function spliced(legs: THREE.AnimationClip, legsGait: Gait, arms: THREE.AnimationClip, armsGait: Gait): THREE.AnimationClip {
  const legStride = legs.duration / legsGait.strides
  const armStride = arms.duration / armsGait.strides
  const times = legs.tracks.find((t) => t.name.endsWith('.quaternion'))!.times
  const swing = arms.tracks
    .filter((track) => ARMS.test(track.name))
    .map((track) => {
      const at = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant()
      const width = track.getValueSize()
      const values = new Float32Array(times.length * width)
      times.forEach((t, i) => {
        const phase = ((((t - legsGait.strike) / legStride) % 1) + 1) % 1
        values.set(at.evaluate((armsGait.strike + phase * armStride) % arms.duration), i * width)
      })
      const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
      return new Track(track.name, Float32Array.from(times), values)
    })
  return derived(legs, new THREE.AnimationClip(legs.name, legs.duration, [...legs.tracks.filter((track) => !ARMS.test(track.name)), ...swing]))
}

/**
 * `clip` turned `angle` radians round the vertical below the waist only: the hips and legs go the new way, and `spine`
 * turns back against them, so everything above it faces as it did.
 */
export function turnedBelow(clip: THREE.AnimationClip, angle: number, spine = 'Spine'): THREE.AnimationClip {
  const out = turned(clip, angle)
  const hips = (clip.tracks.find((t) => t.name === 'Hips.quaternion') as unknown as { createInterpolant(): THREE.Interpolant } | undefined)?.createInterpolant()
  const back = new THREE.Quaternion().setFromAxisAngle(UP, -angle)
  const h = new THREE.Quaternion()
  const q = new THREE.Quaternion()
  const tracks = out.tracks.map((track) => {
    if (!hips || track.name !== `${spine}.quaternion`) return track
    const values = new Float32Array(track.values)
    // the spine's new local turn is the old hips' frame turned back: h⁻¹ · back · h, ahead of its own
    track.times.forEach((t, i) => {
      h.fromArray(hips.evaluate(t)).normalize()
      q.copy(h).invert().multiply(back).multiply(h).multiply(new THREE.Quaternion().fromArray(values, i * 4)).toArray(values, i * 4)
    })
    return new THREE.QuaternionKeyframeTrack(track.name, Float32Array.from(track.times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
}

/** `clip` mirrored across the hero's middle, left for right (the standard rig, whose sides mirror bone for bone). */
export function mirrored(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const values = new Float32Array(track.values)
    const width = track.getValueSize()
    const position = track.name.endsWith('.position')
    for (let i = 0; i < values.length; i += width)
      if (width === 4) ((values[i + 1] = -values[i + 1]), (values[i + 2] = -values[i + 2]))
      else if (position) values[i] = -values[i]
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name.replace(/^(Left|Right)/, (side) => (side === 'Left' ? 'Right' : 'Left')), Float32Array.from(track.times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
}

/** `clip` played `by` times as fast. */
export function quickened(clip: THREE.AnimationClip, by: number): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, track.times.map((t) => t / by), Float32Array.from(track.values))
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration / by, tracks), 0, by)
}

/** The unarmed strafes (STRAFES) and their gaits, from the walk and jog loaded; undefined when the library lacks a sidestep. */
async function strafes(gender: Gender, rig: RigKind, own: ReadonlyMap<string, THREE.AnimationClip>, measured: Readonly<Record<string, Gait>>) {
  const names = Object.keys(SIDESTEPS) as (keyof typeof SIDESTEPS)[]
  const loaded = await Promise.all(names.map((name) => animClip(gender, name, rig)))
  if (loaded.some((clip) => !clip)) return undefined
  const steps = new Map(
    names.map((name, k) => {
      const s = SIDESTEPS[name]
      const legs = turnedBelow(loaded[k]!, (s.turn * Math.PI) / 180)
      return [name, spliced(legs, { speed: s.speed[gender], strides: 1, strike: s.lands.left }, own.get(s.arms)!, measured[s.arms])]
    }),
  )
  const clips = new Map<string, THREE.AnimationClip>()
  const gaits: Record<string, Gait> = {}
  for (const [name, { from, right, quicker = 1 }] of Object.entries(STRAFES)) {
    const s = SIDESTEPS[from]
    const step = right ? mirrored(steps.get(from)!) : steps.get(from)!
    clips.set(name, new THREE.AnimationClip(name, step.duration / quicker, quickened(step, quicker).tracks))
    gaits[name] = { speed: Math.round(s.speed[gender] * quicker * 100) / 100, strides: 1, strike: (right ? s.lands.right : s.lands.left) / quicker }
  }
  return { clips, gaits }
}

/**
 * A gender's walks, jogs and runs every way, and a stance, fetched once each; undefined when the library can't load
 * or lacks any of them, and the hero then moves on its body's own clips. A hero carrying a pistol or a rifle moves on
 * that weapon's own set and stands in its stance (GAME.md §12), where the library has the whole set; the clips go by
 * the gait's names, so the gait plays them as it plays the unarmed ones.
 */
export function libraryGait(gender: Gender, stance = 'idle', rig: RigKind = 'legacy', weapon?: Weapon, attitude: AttitudeId = 'neutral'): Promise<LibraryGait | undefined> {
  const key = `${rig}/${gender}/${stance}/${weapon ?? ''}/${attitude}`
  let load = loads.get(key)
  if (!load) {
    load = (async () => {
      const idx = await animIndex(rig)
      const measured = idx?.genders[gender]?.gait
      if (!idx || !measured) return undefined
      const set = weapon && WEAPON_GAIT[weapon]
      const armed = set && GAIT_CLIPS.every((name) => measured[set.clips[name]]) ? set : undefined
      if (weapon && !armed) return libraryGait(gender, stance, rig, undefined, attitude)
      const source = (name: string) => armed?.clips[name] ?? name
      const still = armed && setOf(idx, gender, armed.stance) ? armed.stance : setOf(idx, gender, stance) === 'idle' ? stance : 'idle'
      const [clips, standing] = await Promise.all([Promise.all(GAIT_CLIPS.map((name) => animClip(gender, source(name), rig))), animClip(gender, still, rig)])
      if (clips.some((clip) => !clip || !measured[clip.name])) return undefined
      // an unarmed hero strafes on the spliced sidesteps; the library's own, side-on, only where it lacks them
      const side = armed ? undefined : await strafes(gender, rig, new Map(GAIT_CLIPS.map((name, k) => [name, clips[k]!])), measured)
      const gaits = armed ? { ...measured, ...Object.fromEntries(GAIT_CLIPS.map((name) => [name, measured[source(name)]])) } : { ...measured, ...side?.gaits }
      const named = GAIT_CLIPS.map((name, k) => (armed ? new THREE.AnimationClip(name, clips[k]!.duration, clips[k]!.tracks) : (side?.clips.get(name) ?? clips[k]!)))
      // an attitude swings the hips and chest wider and steps to its own beat (kit/anim/attitude.ts)
      const a = ATTITUDE[attitude]
      const carried = Object.keys(a.swing).length ? named.map((clip, k) => swung(clip, a.swing, SWING_TIER[GAIT_CLIPS[k].split('_')[0] as keyof typeof SWING_TIER] ?? 1)) : named
      const beat = a.cadence === 1 ? gaits : Object.fromEntries(Object.entries(gaits).map(([name, g]) => [name, { ...g, speed: g.speed / a.cadence }]))
      return { gender, rig, clips: new Map(GAIT_CLIPS.map((name, k) => [name, carried[k]])), gaits: beat, bones: idx.bones, ...(standing ? { stance: standing } : {}) }
    })().catch(() => undefined)
    loads.set(key, load)
  }
  return load
}
