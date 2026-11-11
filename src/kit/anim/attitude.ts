/**
 * Attitude sets (GAME.md §4, "Attitude sets: combat and traversal only"): how a hero carries itself while it moves and
 * fights, on the clips it already plays. The library's style walks don't carry their style (the 100STYLE takes slouch
 * and stop whatever their name, 2026-11-11), so an attitude is a layer, not a clip set: turns on the rest pose that
 * every clip plays on top of (like a physique's posture, metarig/posture.ts), a knee bend with the hips lowered to
 * match, the hips' and chest's own swing in the gait loops made bigger, the stride's beat, and how a landing lands.
 * One set covers walk, jog, sprint, every strafe, the guard walk, take-off and landing alike. Clips of its own for a
 * set come with the custom motion pipeline after session 4.
 */
export const ATTITUDES = ['neutral', 'brute', 'swagger', 'low', 'strut'] as const
export type AttitudeId = (typeof ATTITUDES)[number]

export interface Swing {
  pitch?: number
  twist?: number
  drop?: number
}

/** How much of an attitude's extra swing each gait tier takes. */
export const SWING_TIER: Readonly<Record<'walk' | 'jog' | 'run', number>> = { walk: 1, jog: 0.6, run: 0.3 }

export interface Attitude {
  label: string
  /** Each bone tipped forward (its top toward where the body faces), degrees at rest; back is negative. */
  tips: Readonly<Record<string, number>>
  /** The upper arms held out from the sides, degrees at rest. */
  arms: number
  /** The knees bent at rest, degrees: the thighs tip forward by half, the shins back by all, the feet level again. */
  knees: number
  /**
   * How much bigger the gait loops' own swing is, by bone and axis in the bone's frame: `twist` about the spine,
   * `drop` to the side, `pitch` forward and back. 1 leaves it, 2 doubles it; the walk takes all of it, the jog
   * SWING_TIER of it and the run less (the run already swings hard).
   */
  swing: Readonly<Record<string, Swing>>
  /** Steps per stride length against the clip's: above 1 quicker, shorter steps at the same speed. */
  cadence: number
  /** Every landing lands hard (the heavy landing's clip) or as the move says. */
  heavyLanding: boolean
}

export const ATTITUDE: Readonly<Record<AttitudeId, Attitude>> = {
  neutral: { label: 'Neutral', tips: {}, arms: 0, knees: 0, swing: {}, cadence: 1, heavyLanding: false },
  // a heavy roll: hunched over a big chest, arms held off the lats, the shoulders rolling side to side, slow planted
  // steps on soft knees, landings that shake the floor
  brute: { label: 'Brute', tips: { Spine1: 5, Spine2: 10, Neck: 10, Head: -18 }, arms: 14, knees: 12, swing: { Spine2: { drop: 2.2, twist: 1.4 }, Hips: { drop: 1.5 } }, cadence: 0.85, heavyLanding: true },
  // chest up, chin level, the shoulders swinging round with each step
  swagger: { label: 'Swagger', tips: { Spine1: -4, Spine2: -8, Neck: 8, Head: 3 }, arms: 8, knees: 0, swing: { Spine2: { twist: 2.4, drop: 1.6 }, Spine1: { twist: 1.6 }, Hips: { drop: 1.3 } }, cadence: 0.92, heavyLanding: false },
  // an assassin's: low on bent knees, leaning into the run, eyes up, tight and quick
  low: { label: 'Low and quick', tips: { Spine: 10, Spine1: 8, Spine2: 8, Neck: -6, Head: -22 }, arms: 3, knees: 34, swing: { Hips: { drop: 0.7, twist: 0.8 }, Spine2: { twist: 0.8 } }, cadence: 1.18, heavyLanding: false },
  // tall through the back with the hips dropping wide from side to side, the chest kept level over them
  strut: { label: 'Strut', tips: { Spine1: -3, Spine2: -4, Head: 2 }, arms: 0, knees: 0, swing: { Hips: { drop: 2.8, twist: 1.2 }, Spine: { drop: 1.6 } }, cadence: 1.04, heavyLanding: false },
}

export const isAttitude = (v: unknown): v is AttitudeId => typeof v === 'string' && (ATTITUDES as readonly string[]).includes(v)
