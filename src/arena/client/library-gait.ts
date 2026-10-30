import type * as THREE from 'three'
import type { Gender } from '../../charter/look.js'
import { animClip, animIndex, setOf } from './anim-library.js'
import { GAIT_CLIPS, type Gait } from './gait.js'

/** What a hero moves and stands in from the motion library, not yet fitted to its body (characters.ts fits it). */
export interface LibraryGait {
  gender: Gender
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
 * A gender's walks, jogs and runs every way, and a stance, fetched once each; undefined when the library can't load
 * or lacks any of them, and the hero then moves on its body's own clips.
 */
export function libraryGait(gender: Gender, stance = 'idle'): Promise<LibraryGait | undefined> {
  const key = `${gender}/${stance}`
  let load = loads.get(key)
  if (!load) {
    load = (async () => {
      const idx = await animIndex()
      const gaits = idx?.genders[gender].gait
      if (!idx || !gaits) return undefined
      const still = setOf(idx, gender, stance) === 'idle' ? stance : 'idle'
      const [clips, standing] = await Promise.all([Promise.all(GAIT_CLIPS.map((name) => animClip(gender, name))), animClip(gender, still)])
      if (clips.some((clip) => !clip || !gaits[clip.name])) return undefined
      return { gender, clips: new Map(GAIT_CLIPS.map((name, k) => [name, clips[k]!])), gaits, bones: idx.bones, ...(standing ? { stance: standing } : {}) }
    })().catch(() => undefined)
    loads.set(key, load)
  }
  return load
}
