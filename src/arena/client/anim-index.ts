import type { Gender } from '../../charter/look.js'
import type { ClipTags } from '../../kit/anim/bake.js'
import type { Gait } from './gait.js'
import type { RigKind } from './rig.js'

/**
 * The motion library's index (public/anim/index.json, from scripts/rpm-anim.ts): each gender's clips by set, with
 * their lengths, and what anim-library.ts needs to unpack and fit them. No three.js here, so menus can list the clips.
 */

/**
 * Stances to stand in (they hold still and look ahead), idle moments to play now and then, the rest, and on the Psyblr
 * Human the combat set: Mixamo's strikes, shots, casts, dodges, blocks and reactions (src/charter/motions.ts).
 */
export const ANIM_SETS = ['idle', 'fidget', 'move', 'dance', 'talk', 'combat'] as const
export type AnimSet = (typeof ANIM_SETS)[number]

export interface AnimIndex {
  version: 1
  /** Which rig the clips were fitted to; absent on the first library, which is the legacy rig's. */
  rig?: RigKind
  fps: number
  bones: string[]
  /** What the stored rotations and hips positions were multiplied by. */
  rot: number
  pos: number
  /**
   * Per gender: the medium body's rest rotations and hips, each set's clips with their lengths in seconds, and each
   * looping move's gait (how fast it goes, its strides, where its left foot lands), for blending moves in step.
   */
  genders: Record<
    Gender,
    {
      rest: number[][]
      hips: number[]
      sets: Record<AnimSet, Record<string, number>>
      gait?: Record<string, Gait>
      marks?: Record<string, [release: number, travelled: number]>
      /** Each clip's tags on this gender's body (GAME.md §12): plants, contact and release, root travel, loop. */
      tags?: Record<string, ClipTags>
    }
  >
  /** Each clip's source, a key of `licences`; a mirror takes its original's. */
  sources?: Record<string, string>
  /** The terms each source's clips are used on, with the credit a source asks for. */
  licences?: Record<string, { title: string; licence: string; url: string; credit?: string }>
}

/** A clip's tags on a gender's body, if the library has them. */
export const clipTags = (index: AnimIndex | undefined, gender: Gender, clip: string): ClipTags | undefined => index?.genders[gender]?.tags?.[clip]

/**
 * Seconds into each combat clip where its blow lands, from the index's marks as each index loads: in the clip's own
 * seconds as the library has it, under its own name. A clip that plays cut, retimed or renamed finds its mark through
 * its source (clip-source.ts, characters.ts castSpan).
 */
export const MOTION_RELEASE = new Map<string, number>()

const indexes = new Map<RigKind, Promise<AnimIndex | undefined>>()
const loaded = new Map<RigKind, AnimIndex | undefined>()

/** Where a rig's library lives under public/. */
export const animFolder = (rig: RigKind) => (rig === 'standard' ? '/anim/standard' : '/anim')

/** A rig's index, fetched once; undefined when it can't load (heroes then keep their own clips). */
export function animIndex(rig: RigKind = 'legacy'): Promise<AnimIndex | undefined> {
  let index = indexes.get(rig)
  if (!index) {
    index = fetch(`${animFolder(rig)}/index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<AnimIndex>) : undefined))
      .catch(() => undefined)
      .then((i) => {
        loaded.set(rig, i)
        for (const g of Object.values(i?.genders ?? {})) for (const [clip, [release]] of Object.entries(g.marks ?? {})) MOTION_RELEASE.set(clip, release)
        return i
      })
    indexes.set(rig, index)
  }
  return index
}

/** A rig's index if it has loaded. */
export const animIndexNow = (rig: RigKind = 'legacy') => loaded.get(rig)

/** The set a clip belongs to for a gender, if the library has it. */
export function setOf(index: AnimIndex, gender: Gender, clip: string): AnimSet | undefined {
  return (Object.keys(index.genders[gender].sets) as AnimSet[]).find((s) => clip in index.genders[gender].sets[s])
}
