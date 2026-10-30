import type { Gender } from '../../charter/look.js'
import type { Gait } from './gait.js'

/**
 * The motion library's index (public/anim/index.json, from scripts/rpm-anim.ts): each gender's clips by set, with
 * their lengths, and what anim-library.ts needs to unpack and fit them. No three.js here, so menus can list the clips.
 */

/** Stances to stand in (they hold still and look ahead), idle moments to play now and then, and the rest. */
export const ANIM_SETS = ['idle', 'fidget', 'move', 'dance', 'talk'] as const
export type AnimSet = (typeof ANIM_SETS)[number]

export interface AnimIndex {
  version: 1
  fps: number
  bones: string[]
  /** What the stored rotations and hips positions were multiplied by. */
  rot: number
  pos: number
  /**
   * Per gender: the medium body's rest rotations and hips, each set's clips with their lengths in seconds, and each
   * looping move's gait (how fast it goes, its strides, where its left foot lands), for blending moves in step.
   */
  genders: Record<Gender, { rest: number[][]; hips: number[]; sets: Record<AnimSet, Record<string, number>>; gait?: Record<string, Gait> }>
}

let index: Promise<AnimIndex | undefined> | undefined
let loaded: AnimIndex | undefined

/** The index, fetched once; undefined when it can't load (heroes then keep their own clips). */
export function animIndex(): Promise<AnimIndex | undefined> {
  index ??= fetch('/anim/index.json')
    .then((r) => (r.ok ? (r.json() as Promise<AnimIndex>) : undefined))
    .catch(() => undefined)
    .then((i) => (loaded = i))
  return index
}

/** The index if it has loaded. */
export const animIndexNow = () => loaded

/** The set a clip belongs to for a gender, if the library has it. */
export function setOf(index: AnimIndex, gender: Gender, clip: string): AnimSet | undefined {
  return (Object.keys(index.genders[gender].sets) as AnimSet[]).find((s) => clip in index.genders[gender].sets[s])
}
