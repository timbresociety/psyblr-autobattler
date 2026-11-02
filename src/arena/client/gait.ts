/**
 * Locomotion from the motion library (Forge goal, phase B): walking, jogging and running each way (scripts/rpm-anim.ts
 * measures every looping move's gait). The hero's hips face its aim while it moves, and its legs carry it the way it
 * goes: forward, a strafe either side, backwards, or between two of them blended, so a strafing hero sidesteps
 * instead of running sideways on twisted legs. How fast it goes picks walking, jogging or running, played quicker or
 * slower to cover the ground it covers. Every clip keeps one shared stride: each starts its loop where its left foot
 * lands, so two clips blended put their feet down together and a change of pace carries on mid-stride. No three.js
 * here: the view applies what this works out.
 */

export const GAIT_TIERS = ['walk', 'jog', 'run'] as const
export type GaitTier = (typeof GAIT_TIERS)[number]

/** The four ways, counter-clockwise from ahead as yaw turns: forward, the hero's left, backwards, its right. */
export const GAIT_WAYS = ['', '_left', '_back', '_right'] as const

/** A looping move's gait as the index keeps it (scripts/rpm-anim.ts): metres a second at 1x, strides in the clip, and the second its left foot first lands. */
export interface Gait {
  speed: number
  strides: number
  strike: number
}

/** The clips a tier blends, in GAIT_WAYS's order. */
export const tierClips = (tier: GaitTier) => GAIT_WAYS.map((way) => `${tier}${way}`)

/** Every clip the gait plays. */
export const GAIT_CLIPS: readonly string[] = GAIT_TIERS.flatMap(tierClips)

const TAU = Math.PI * 2

/**
 * How much each way plays (GAIT_WAYS's order) for a heading relative to the hips, in radians the way yaw turns (a
 * quarter turn is the hero's left): the two ways either side of it, each by how near it is.
 */
export function wayWeights(heading: number): [number, number, number, number] {
  const quarters = ((((heading % TAU) + TAU) % TAU) / TAU) * 4
  const from = Math.floor(quarters) % 4
  const toward = quarters - Math.floor(quarters)
  const out: [number, number, number, number] = [0, 0, 0, 0]
  out[from] += 1 - toward
  out[(from + 1) % 4] += toward
  return out
}

/** A tier's speed at 1x for these way weights, in metres a second on the clips' own body. */
export function tierSpeed(gaits: Readonly<Record<string, Gait>>, tier: GaitTier, ways: readonly number[]): number {
  return tierClips(tier).reduce((sum, clip, k) => sum + ways[k] * (gaits[clip]?.speed ?? 0), 0)
}

/** Played no slower or quicker than this against the clip as made: beyond it the feet slide instead. */
export const PACE_LIMITS = [0.65, 1.8] as const
/** How far past the speed halfway between two tiers a hero has to go before it changes pace, so it doesn't flicker. */
const HOLD = 0.12

/**
 * The tier for covering `speed` metres a second (on the clips' own body) this way: the one whose own speed is
 * nearest, in proportion, holding `last` until the speed is well past halfway (geometric) to the next.
 */
export function pickTier(gaits: Readonly<Record<string, Gait>>, ways: readonly number[], speed: number, last: GaitTier | undefined, top: GaitTier = 'run'): GaitTier {
  const speeds = GAIT_TIERS.map((tier) => tierSpeed(gaits, tier, ways))
  let best = 0
  // `top` is the fastest it may pick: a hero not sprinting jogs however fast it goes, played quicker
  const tiers = GAIT_TIERS.indexOf(top) + 1
  if (last && GAIT_TIERS.indexOf(last) >= tiers) last = top
  for (let k = 1; k < tiers; k++) if (Math.abs(Math.log(speed / speeds[k])) < Math.abs(Math.log(speed / speeds[best]))) best = k
  const held = last ? GAIT_TIERS.indexOf(last) : -1
  if (held < 0 || held === best) return GAIT_TIERS[best]
  // between the held tier and the next one toward the speed: change only once well past their geometric midpoint
  const next = held + Math.sign(best - held)
  const middle = Math.sqrt(speeds[held] * speeds[next])
  const past = next > held ? speed > middle * (1 + HOLD) : speed < middle * (1 - HOLD)
  return GAIT_TIERS[past ? next : held]
}

/** A clip's place in its loop at a shared stride `phase` (0 to 1, from the left foot landing). */
export function strideTime(gait: Gait, duration: number, phase: number): number {
  const stride = duration / gait.strides
  const t = gait.strike + (phase - Math.floor(phase)) * stride
  return t % duration
}

/** How long one stride of the blend takes at 1x, in seconds: each way's own stride, weighted. */
export function strideSeconds(gaits: Readonly<Record<string, Gait>>, durations: Readonly<Record<string, number>>, tier: GaitTier, ways: readonly number[]): number {
  return tierClips(tier).reduce((sum, clip, k) => sum + ways[k] * ((durations[clip] ?? 0) / (gaits[clip]?.strides ?? 1)), 0)
}
