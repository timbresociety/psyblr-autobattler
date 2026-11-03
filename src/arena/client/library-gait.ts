import * as THREE from 'three'
import type { Gender } from '../../charter/look.js'
import { ENGINE } from '../engine/calibration.js'
import { animClip, animIndex, setOf } from './anim-library.js'
import { GAIT_CLIPS, type Gait } from './gait.js'
import { WEAPON_GAIT, type Weapon } from '../../kit/anim/weapon-gait.js'
import type { RigKind } from './rig.js'

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
  // a running jump tucks, standing it springs straight up, to the side it hops sideways; the second jump flips forward,
  // twists going sideways and only flips backwards going back; a roll turns into its way and comes up running, except
  // back, where the hero hops back still facing the aim
  jump: 'standing_jump_running',
  jump_up: 'jump_up',
  jump_left: 'left_strafe_jump',
  jump_right: 'right_strafe_jump',
  jump_back: 'backward_jump',
  air_jump: 'running_forward_flip',
  air_jump_up: 'running_forward_flip',
  air_jump_left: 'front_twist_flip',
  air_jump_right: 'front_twist_flip',
  air_jump_back: 'backflip',
  roll_back: 'standing_dodge_backward',
  land: 'ual_jump_land',
  air: 'falling',
  dash: 'standing_dodge_forward',
  dash_back: 'standing_dodge_backward',
  slide: 'running_slide_pose',
  slash: 'jab_cross',
  shoot: 'shooting_gun',
  cast: 'spell_cast',
  ultimate: 'jump_attack',
  hurt: 'hit_to_body',
  stunned: 'big_hit_to_head',
  fall: 'falling_back_death',
  roll: 'quick_roll_to_run',
  block: 'standing_block_idle',
  crouch: 'crouch_idle',
  crouch_move: 'crouch_walk_forward',
  prone: 'prone_idle',
  prone_move: 'prone_forward',
  launched: 'fall_a_loop',
  charge: 'standing_block_start',
  toggle: 'spell_cast',
  mantle: 'pulling_up_to_a_ledge',
  land_roll: 'falling_to_roll',
  land_heavy: 'mid_air_falling_to_a_hard_landing',
  zip: 'hanging',
  // a ledge (§7, owner 2026-11-04): caught from a walk off it, held with the feet braced on the face, shimmied along,
  // climbed up from
  catch: 'braced_hang',
  hang: 'braced_hang',
  hang_left: 'left_braced_hang_shimmy',
  hang_right: 'right_braced_hang_shimmy',
  climb: 'braced_hang_to_crouch',
  rail: 'crouch_idle',
}

/**
 * One-shots the engine times itself: only the stretch of the clip that does the move plays, sped up to last as long as
 * the engine's move does. Seconds into the clip, from and to, and how long it plays. A Mixamo roll stands, steps and
 * crouches for half a second before it rolls; the engine's roll starts at once.
 */
const MOVE_CUTS: Readonly<Record<string, [from: number, to: number, seconds: number, lift?: number]>> = {
  // take-off to the top of the rise: the push, the tuck, the reach for whatever comes next
  jump: [0.25, 0.75, 0.42],
  jump_up: [0.08, 0.54, 0.42],
  jump_left: [0, 0.5, 0.42],
  jump_right: [0, 0.5, 0.42],
  jump_back: [0.08, 0.7, 0.42],
  // the flip itself, over the second jump's rise
  air_jump: [0.12, 0.95, 0.5],
  air_jump_up: [0.12, 0.95, 0.5],
  air_jump_left: [0.55, 1.35, 0.5],
  air_jump_right: [0.55, 1.35, 0.5],
  air_jump_back: [0.5, 1.4, 0.5],
  // a roll from the dive to running again, turned into its way (match-view); back, a dodge from the push off to the
  // feet back under
  roll: [0.22, 1.25, ENGINE.move.roll.time],
  roll_back: [0.1, 0.95, ENGINE.move.roll.time],
  land: [0.05, 0.55, 0.3],
  dash: [0.12, 0.75, 0.3],
  dash_back: [0.1, 0.9, 0.34],
  toggle: [0.15, 1.0, 0.6],
  // the pull-up itself, from the hands taking the weight to the feet on top
  mantle: [0.6, 2.2, ENGINE.move.mantle.time],
  land_roll: [0.05, 1.3, 0.55],
  land_heavy: [0.55, 1.6, 0.45],
  // the braced hang clip opens with the drop into the brace (the hips fall a metre) and then holds it: the catch is the
  // drop, the hold the rest, so the loop never drops again; both lifted to put the hands on the edge where the shimmies
  // put them
  catch: [0, 0.62, 0.4, 0.5],
  hang: [0.62, 1.29, 0.67, 0.5],
  climb: [0, 1.13, ENGINE.move.hang.climb],
}

/** The part of `clip` from `from` to `to` seconds, its keys spaced to play in `seconds`, the hips raised `lift` metres. */
function cut(clip: THREE.AnimationClip, from: number, to: number, seconds: number, lift = 0): THREE.AnimationClip {
  const k = seconds / (to - from)
  const tracks = clip.tracks.map((track) => {
    const width = track.getValueSize()
    const keep: number[] = []
    track.times.forEach((t, i) => t >= from - 1e-6 && t <= to + 1e-6 && keep.push(i))
    const times = Float32Array.from(keep, (i) => (track.times[i] - from) * k)
    const values = new Float32Array(keep.length * width)
    keep.forEach((i, n) => values.set(track.values.subarray(i * width, (i + 1) * width), n * width))
    // the hips are the only bone that moves
    if (lift && track.name.endsWith('.position')) for (let n = 1; n < values.length; n += 3) values[n] += lift
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, times, values)
  })
  return new THREE.AnimationClip(clip.name, seconds, tracks)
}

const moveLoads = new Map<string, Promise<Map<string, THREE.AnimationClip>>>()

/**
 * The one-shots a gender's library has (LIBRARY_MOVES) by the engine's names, and `motions` (a hero's skills' clips) by
 * their own, fetched once each. `instead` puts a hero's own clip under an engine name (its guard as the `block`).
 */
export async function libraryMoves(gender: Gender, rig: RigKind, motions: readonly string[] = [], instead: Readonly<Record<string, string>> = {}): Promise<Map<string, THREE.AnimationClip>> {
  const base = await baseMoves(gender, rig)
  const names = [...new Set([...motions, ...Object.values(instead)])]
  const own = await Promise.all(names.map((name) => animClip(gender, name, rig).catch(() => undefined)))
  const out = new Map(base)
  own.forEach((clip, k) => clip && out.set(names[k], clip))
  for (const [ours, name] of Object.entries(instead)) {
    const clip = out.get(name)
    if (clip) out.set(ours, new THREE.AnimationClip(ours, clip.duration, clip.tracks))
  }
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
        const clip = clips[k]
        const cuts = MOVE_CUTS[ours]
        if (clip) out.set(ours, cuts ? Object.assign(cut(clip, ...cuts), { name: ours }) : new THREE.AnimationClip(ours, clip.duration, clip.tracks))
      })
      return out
    })()
    moveLoads.set(key, load)
  }
  return load
}

/**
 * A gender's walks, jogs and runs every way, and a stance, fetched once each; undefined when the library can't load
 * or lacks any of them, and the hero then moves on its body's own clips. A hero carrying a pistol or a rifle moves on
 * that weapon's own set and stands in its stance (GAME.md §12), where the library has the whole set; the clips go by
 * the gait's names, so the gait plays them as it plays the unarmed ones.
 */
export function libraryGait(gender: Gender, stance = 'idle', rig: RigKind = 'legacy', weapon?: Weapon): Promise<LibraryGait | undefined> {
  const key = `${rig}/${gender}/${stance}/${weapon ?? ''}`
  let load = loads.get(key)
  if (!load) {
    load = (async () => {
      const idx = await animIndex(rig)
      const measured = idx?.genders[gender]?.gait
      if (!idx || !measured) return undefined
      const set = weapon && WEAPON_GAIT[weapon]
      const armed = set && GAIT_CLIPS.every((name) => measured[set.clips[name]]) ? set : undefined
      if (weapon && !armed) return libraryGait(gender, stance, rig)
      const source = (name: string) => armed?.clips[name] ?? name
      const still = armed && setOf(idx, gender, armed.stance) ? armed.stance : setOf(idx, gender, stance) === 'idle' ? stance : 'idle'
      const [clips, standing] = await Promise.all([Promise.all(GAIT_CLIPS.map((name) => animClip(gender, source(name), rig))), animClip(gender, still, rig)])
      if (clips.some((clip) => !clip || !measured[clip.name])) return undefined
      const gaits = armed ? { ...measured, ...Object.fromEntries(GAIT_CLIPS.map((name) => [name, measured[source(name)]])) } : measured
      const named = GAIT_CLIPS.map((name, k) => (armed ? new THREE.AnimationClip(name, clips[k]!.duration, clips[k]!.tracks) : clips[k]!))
      return { gender, rig, clips: new Map(GAIT_CLIPS.map((name, k) => [name, named[k]])), gaits, bones: idx.bones, ...(standing ? { stance: standing } : {}) }
    })().catch(() => undefined)
    loads.set(key, load)
  }
  return load
}
