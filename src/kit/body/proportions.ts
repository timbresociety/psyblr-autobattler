/**
 * A hero's proportions beyond its physique (shape.ts), each 0 to 1 with 0.5 the body as made: how long its legs, arms,
 * torso and neck are, how wide its shoulders sit and how big its head is. Together with weight and muscle they span a
 * lanky beanpole (long legs and arms, narrow shoulders, thin) to a towering brute (broad shoulders, short neck, small
 * head on a heavy, muscled frame). The game puts them on the skeleton's rest (src/arena/client/wear/proportions.ts).
 */
export interface Proportions {
  legs: number
  arms: number
  torso: number
  shoulders: number
  neck: number
  head: number
}

export const PROPORTION_KEYS = ['legs', 'arms', 'torso', 'shoulders', 'neck', 'head'] as const satisfies readonly (keyof Proportions)[]

/** How far each runs from the body as made at 0 or 1: a share of the segment's length (or the head's size). */
const RANGE: Record<keyof Proportions, number> = { legs: 0.22, arms: 0.2, torso: 0.16, shoulders: 0.45, neck: 0.6, head: 0.16 }

/** The bones whose segments each proportion lengthens, by the parent bone a child sits along. */
const SEGMENT: Record<string, keyof Proportions> = {}
for (const side of ['Left', 'Right']) {
  for (const b of ['UpLeg', 'UpLegTwist', 'Leg', 'LegTwist']) SEGMENT[side + b] = 'legs'
  for (const b of ['Arm', 'ArmTwist', 'ForeArm', 'ForeArmTwist']) SEGMENT[side + b] = 'arms'
  SEGMENT[side + 'Shoulder'] = 'shoulders'
}
for (const b of ['Spine', 'Spine1', 'Spine2']) SEGMENT[b] = 'torso'
SEGMENT.Neck = 'neck'

export const PROPORTIONS = { hips: 'Hips', head: 'Head', segment: SEGMENT }

const clamp01 = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)

/**
 * Each bone's length factor (as the parent of the bone whose offset it scales) and scale, or undefined when every
 * proportion is the body as made.
 */
export function proportionFactors(p: Partial<Proportions> | undefined): { length: (parent: string) => number; scale: (bone: string) => number } | undefined {
  if (!p) return undefined
  const f = Object.fromEntries(PROPORTION_KEYS.map((k) => [k, 1 + (clamp01(p[k]) - 0.5) * 2 * RANGE[k]])) as Record<keyof Proportions, number>
  if (PROPORTION_KEYS.every((k) => Math.abs(f[k] - 1) < 1e-4)) return undefined
  return {
    length: (parent) => (SEGMENT[parent] ? f[SEGMENT[parent]] : 1),
    scale: (bone) => (bone === PROPORTIONS.head ? f.head : 1),
  }
}
