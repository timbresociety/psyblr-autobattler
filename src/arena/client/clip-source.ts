import type { AnimationClip } from 'three'

/**
 * Where a clip that plays came from. The library's clips are cut, retimed, held and renamed on their way to the
 * engine's moves (a roll is the middle of `quick_roll_to_run`, played to last as long as the engine's roll), and each
 * clip's marks (where its blow lands, when each foot is down) are written in its own seconds under its own name. So
 * every clip made from another carries its source: the clip it began as, and where in that clip each of its seconds
 * falls. Marks are looked up under the source's name and moved onto the clip that plays; nothing reads a mark by the
 * name a clip plays under, which may be another clip's.
 */
export interface ClipSource {
  /** The clip this began as: a library clip's name in its index, or a pack clip's id. */
  clip: string
  /** Seconds into the source where this clip starts, and how many of the source's seconds pass in one of this clip's. */
  from: number
  rate: number
}

/** A clip's source: its own name from its start at its own pace, unless it was made from another. */
export const sourceOf = (clip: AnimationClip): ClipSource => (clip.userData?.source as ClipSource | undefined) ?? { clip: clip.name, from: 0, rate: 1 }

/**
 * `out`, made from `clip`: it keeps what `clip` carried (its source among it), starting `from` seconds into `clip` and
 * playing `rate` of `clip`'s seconds a second. A rate of 0 holds one moment.
 */
export function derived<T extends AnimationClip>(clip: AnimationClip, out: T, from = 0, rate = 1): T {
  const src = sourceOf(clip)
  out.userData = { ...clip.userData, source: { clip: src.clip, from: src.from + from * src.rate, rate: src.rate * rate } }
  return out
}

/** The source's second that plays at `time` seconds into `clip`. */
export function sourceTime(clip: AnimationClip, time: number): number {
  const src = sourceOf(clip)
  return src.from + time * src.rate
}

/**
 * When `clip` reaches the source's second `at`, or undefined when it never does: the mark falls before the clip starts
 * or after it ends (it was cut away), or the clip holds one moment.
 */
export function clipTime(clip: AnimationClip, at: number): number | undefined {
  const src = sourceOf(clip)
  if (src.rate <= 0) return undefined
  const t = (at - src.from) / src.rate
  return t < -1e-6 || t > clip.duration + 1e-6 ? undefined : Math.min(clip.duration, Math.max(0, t))
}
