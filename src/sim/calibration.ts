/**
 * Every tunable constant of the abstract combat model (KTD6) lives here, so the model can be
 * re-calibrated against the real Arena in one place. Bump the version on any change: stored gate
 * results stamped with an older version are re-checked.
 */
export const CALIBRATION_VERSION = 1

export const CALIBRATION = {
  /** Seconds per simulation step. */
  dt: 0.1,
  /** A fight with no winner by then is a draw. */
  maxTime: { duel: 90, team: 120 },
  /** Starting distance between the two sides, metres. */
  startDistance: 22,
  /** Gap between teammates in the starting line, metres. */
  lineSpacing: 2.5,
  /** Ultimates start this far into their cooldown. */
  ultimateStartCooldown: 25,
  /** Health fraction that fires lowHealth passives. */
  lowHealth: 0.35,
  /** Melee-ish roles fight at basic range; ranged ones hold this fraction of it. */
  rangedHoldFraction: 0.8,
  /** Damage per hit varies by up to this fraction either way. */
  variance: 0.12,
  /** Radius that counts as "near" for allies and peel checks, metres. */
  nearRadius: 6,
  /** After this many seconds, damage ramps up each second so stalemates end (autobattler overtime). */
  overtimeStart: 40,
  /** Extra damage per second of overtime, as a fraction. */
  overtimeRamp: 0.05,
  /** Default radius for an "allies" effect without its own radius, metres. */
  alliesRadius: 8,
} as const
