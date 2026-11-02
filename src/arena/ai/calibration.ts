/**
 * Every constant of the AI (KTD7), tuned by hand in playtests, at three levels (GAME.md §2): Hard is the bots as they
 * were, too strong for most players; Normal reacts slower, aims worse, combos, blocks and dodges less and picks targets
 * worse; Easy is slower again and rarely uses its skills. A level is only these numbers, never health or damage. The
 * balance gate fights at Hard, so bump the version on any change: stored builds with an older one are re-checked (KTD6).
 */
export const AI_CALIBRATION_VERSION = 12

export type AiLevel = 'easy' | 'normal' | 'hard'
export const AI_LEVELS_ORDER: readonly AiLevel[] = ['easy', 'normal', 'hard']
/** What a player gets unless they pick (§2). */
export const DEFAULT_AI_LEVEL: AiLevel = 'normal'

const HARD = {
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
  /**
   * Moving like Deadlock (Forge goal, phase 2). A dodge dashes this often, while it has more than `staminaKeep` pips;
   * a melee hero dashes at a target between `dashGap` metres off, at most every `dashEvery` ticks; a hero falling
   * back dashes away from an enemy this close (`nearRadius`) with any pip; and one with `slideGap` metres to cover
   * slides this often a decision.
   */
  dodgeDash: 0.5,
  /**
   * The canon's melee (combat.ts), pressed as a player presses it: a dodge rolls this often while it has pips to spare;
   * a decision charges the next basic attack into a heavy blow this often, held this many seconds past the heavy hold;
   * and raises its guard against an enemy swing it sees winding up this often, by role.
   */
  dodgeRoll: 0.35,
  heavyChance: 0.25,
  heavyCharge: 0.5,
  guardChance: { tank: 0.6, fighter: 0.45, assassin: 0.2, mage: 0.25, marksman: 0.25, support: 0.3, controller: 0.3, summoner: 0.25 },
  staminaKeep: 1,
  dashGap: { min: 5, max: 12 },
  dashEvery: 120,
  slideGap: 10,
  slideChance: 0.08,
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
  /**
   * The levels' own dials (§2): the chance a decision considers its skills at all, the chance it keeps a melee chain
   * going, the chance it picks the smart target (weakest in reach) rather than the nearest, and the chance it switches
   * its passive on when a fight starts.
   */
  skillUse: 1,
  comboChance: 1,
  targetSmart: 1,
  passiveUse: 0.9,
}

export type AiTuning = Omit<typeof HARD, 'guardChance' | 'reaction'> & { guardChance: Record<keyof typeof HARD.guardChance, number>; reaction: { min: number; max: number } }

const scaleGuard = (f: number) => Object.fromEntries(Object.entries(HARD.guardChance).map(([r, v]) => [r, v * f])) as AiTuning['guardChance']

export const AI_LEVELS: Record<AiLevel, AiTuning> = {
  hard: HARD,
  normal: {
    ...HARD,
    decisionTicks: 12,
    reaction: { min: 16, max: 26 },
    aimTrack: 0.2,
    overshoot: 0.24,
    aimJitter: 0.018,
    lead: 0.7,
    dodgeChance: 0.18,
    dodgeRoll: 0.25,
    heavyChance: 0.15,
    guardChance: scaleGuard(0.5),
    skillUse: 0.7,
    comboChance: 0.6,
    targetSmart: 0.5,
    passiveUse: 0.6,
  },
  easy: {
    ...HARD,
    decisionTicks: 15,
    reaction: { min: 24, max: 40 },
    aimTrack: 0.13,
    overshoot: 0.3,
    aimJitter: 0.03,
    lead: 0.4,
    dodgeChance: 0.06,
    dodgeRoll: 0.15,
    heavyChance: 0.08,
    guardChance: scaleGuard(0.2),
    skillUse: 0.25,
    comboChance: 0.35,
    targetSmart: 0.15,
    passiveUse: 0.3,
  },
}

/**
 * The tuning in force: the brain sets it to each AI hero's level before that hero thinks (useLevel), so every reader
 * of `AI` sees that hero's numbers. Hard when nothing says otherwise, the gate's level.
 */
export let AI: AiTuning = HARD

export function useLevel(level: AiLevel | undefined) {
  AI = AI_LEVELS[level ?? 'hard']
}
