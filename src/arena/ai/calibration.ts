/**
 * Every constant of the demo AI (KTD7), tuned by hand in playtests. The balance gate fights with this AI, so bump
 * the version on any change: stored builds stamped with an older version are re-checked (KTD6).
 */
export const AI_CALIBRATION_VERSION = 1

export const AI = {
  /** Ticks between decisions (150 ms at 60 Hz). */
  decisionTicks: 9,
  /** Reaction delay before a new target is taken, ticks (150-250 ms). */
  reaction: { min: 9, max: 15 },
  /** Fraction of the remaining aim error closed each tick. */
  aimTrack: 0.3,
  /** Overshoot on a new target, as a fraction of the turn; it decays each tick by `overshootDecay`. */
  overshoot: 0.18,
  overshootDecay: 0.86,
  /** Random hand jitter each tick, radians. */
  aimJitter: 0.008,
  /** How much of a moving target's travel it leads (1 = perfect lead). */
  lead: 1,
  /** Fires only when the aim is within this many radians of the target. */
  fireTolerance: 0.12,
  /** Sees projectiles this close, metres, and dodges this often. */
  seeDistance: 14,
  dodgeChance: 0.35,
  dodgeTicks: 18,
  /** While dodging, how much it keeps moving toward its target (0 = pure sidestep). */
  dodgeAdvance: 0.8,
  /** Melee swings fire once the target is inside this fraction of the half-arc. */
  arcUse: 0.6,
  /** Chance to switch strafe direction at each decision. */
  strafeFlip: 0.1,
  /** Near enough to count as threatened, metres. */
  nearRadius: 6,
  /** Retreats below this health fraction when an enemy is near. */
  retreatBelow: 0.2,
  /** Focus fire looks this far past its own range for a weaker target, metres. */
  focusReach: 8,
  /** Ranged heroes hold this fraction of their range. */
  rangedHold: 0.8,
} as const
