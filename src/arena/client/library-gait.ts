import * as THREE from 'three'
import type { Gender } from '../../charter/look.js'
import { animClip, animIndex, setOf } from './anim-library.js'
import { GAIT_CLIPS, type Gait } from './gait.js'
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
 * Psyblr Human bodies, docs/plans/2026-10-31-canon-psyblr-human.md). The jumps and the fall are motion capture
 * already in the library; the combat moves arrive with the Mixamo clips, and until then a missing name plays the
 * stance (characters.ts falls back to idle).
 */
export const LIBRARY_MOVES: Readonly<Record<string, string>> = {
  jump: 'run_jump',
  air_jump: 'jog_jump',
  air: 'falling',
  land: 'land',
  dash: 'dash',
  dash_back: 'dash_back',
  slide: 'slide',
  slash: 'slash',
  shoot: 'shoot',
  cast: 'cast',
  ultimate: 'ultimate',
  hurt: 'hurt',
  stunned: 'stunned',
  fall: 'fall',
}

const moveLoads = new Map<string, Promise<Map<string, THREE.AnimationClip>>>()

/** The one-shots a gender's library has (LIBRARY_MOVES), by the engine's names, fetched once. */
export function libraryMoves(gender: Gender, rig: RigKind): Promise<Map<string, THREE.AnimationClip>> {
  const key = `${rig}/${gender}`
  let load = moveLoads.get(key)
  if (!load) {
    load = (async () => {
      const names = Object.entries(LIBRARY_MOVES)
      const clips = await Promise.all(names.map(([, clip]) => animClip(gender, clip, rig).catch(() => undefined)))
      const out = new Map<string, THREE.AnimationClip>()
      names.forEach(([ours], k) => {
        const clip = clips[k]
        if (clip) out.set(ours, new THREE.AnimationClip(ours, clip.duration, clip.tracks))
      })
      return out
    })()
    moveLoads.set(key, load)
  }
  return load
}

/**
 * A gender's walks, jogs and runs every way, and a stance, fetched once each; undefined when the library can't load
 * or lacks any of them, and the hero then moves on its body's own clips.
 */
export function libraryGait(gender: Gender, stance = 'idle', rig: RigKind = 'legacy'): Promise<LibraryGait | undefined> {
  const key = `${rig}/${gender}/${stance}`
  let load = loads.get(key)
  if (!load) {
    load = (async () => {
      const idx = await animIndex(rig)
      const gaits = idx?.genders[gender]?.gait
      if (!idx || !gaits) return undefined
      const still = setOf(idx, gender, stance) === 'idle' ? stance : 'idle'
      const [clips, standing] = await Promise.all([Promise.all(GAIT_CLIPS.map((name) => animClip(gender, name, rig))), animClip(gender, still, rig)])
      if (clips.some((clip) => !clip || !gaits[clip.name])) return undefined
      return { gender, rig, clips: new Map(GAIT_CLIPS.map((name, k) => [name, clips[k]!])), gaits, bones: idx.bones, ...(standing ? { stance: standing } : {}) }
    })().catch(() => undefined)
    loads.set(key, load)
  }
  return load
}
