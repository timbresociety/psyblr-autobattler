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
  jump: 'run_jump',
  air_jump: 'backflip',
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
  roll: 'sprinting_forward_roll',
  block: 'standing_block_idle',
  crouch: 'crouch_idle',
  crouch_move: 'crouch_walk_forward',
  prone: 'prone_idle',
  prone_move: 'prone_forward',
  launched: 'fall_a_loop',
  charge: 'standing_block_start',
  toggle: 'spell_cast',
}

/**
 * One-shots the engine times itself: only the stretch of the clip that does the move plays, sped up to last as long as
 * the engine's move does. Seconds into the clip, from and to, and how long it plays. A Mixamo roll stands, steps and
 * crouches for half a second before it rolls; the engine's roll starts at once.
 */
const MOVE_CUTS: Readonly<Record<string, [from: number, to: number, seconds: number]>> = {
  roll: [0.45, 1.2, ENGINE.move.roll.time],
  dash: [0.12, 0.75, 0.3],
  dash_back: [0.1, 0.9, 0.34],
  toggle: [0.15, 1.0, 0.6],
}

/** The part of `clip` from `from` to `to` seconds, its keys spaced to play in `seconds`. */
function cut(clip: THREE.AnimationClip, from: number, to: number, seconds: number): THREE.AnimationClip {
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
