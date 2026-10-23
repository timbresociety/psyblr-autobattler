/**
 * Every constant of the demo AI (KTD7), tuned by hand in playtests. The balance gate fights with this AI, so bump
 * the version on any change: stored builds stamped with an older version are re-checked (KTD6).
 */
export const AI_CALIBRATION_VERSION = 8

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
  /** Metres ahead the AI looks for a wall in its way. */
  probe: 2.5,
  /** Cover at or under this height is hopped over rather than walked around. */
  hopHeight: 1.6,
  /** Low cover is vaulted only on the way to a target further off than this, metres; nearer, it is walked round. */
  vaultReach: 4,
  /** Furthest cover it will run to when falling back. */
  hideReach: 16,
  /** A melee hero takes off after a target flying more than this many metres above it. */
  chaseUp: 1.5,
  /** Metres each role keeps behind its team's front line (its lead tank, else fighter); tanks lead and are not held. */
  behindFront: { fighter: -1, assassin: 2, mage: 3, marksman: 3.5, support: 3, controller: 2.5, summoner: 3.5 },
  /** The front has met the enemy once its leader is this close to one, metres; fighters and assassins then go in. */
  clashGap: 4,
  /** An assassin hunts the weakest enemy within this many metres, else takes the nearest. */
  huntReach: 22,
  /** It dives only on prey a teammate is within this many metres of, or that is under this health fraction. */
  busyGap: 5,
  preyBelow: 0.5,
  /** Past this gap an assassin bends its approach sideways by this much, to come at its target from the flank. */
  flankGap: 8,
  flankBend: 0.7,
  /** A target with this many other enemies within this many metres is in a crowd, and divers wait for it to come out. */
  crowdSize: 3,
  crowdRadius: 6,
  /** Ranged heroes hold this fraction of their range. */
  rangedHold: 0.8,
} as const
