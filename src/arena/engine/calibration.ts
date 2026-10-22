/**
 * Every tunable constant of the 3D arena engine lives here (KTD1, KTD2, KTD5). Bump the version on any change:
 * stored gate results stamped with an older version are re-checked.
 */
export const ENGINE_CALIBRATION_VERSION = 4

export const ENGINE = {
  /** Fixed ticks per second; every timing in the engine and the AI is a whole number of ticks. */
  tickHz: 60,
  /** The arena: x is across, z runs from one half to the other, y is up. Metres. */
  arena: { halfWidth: 40, halfLength: 30, ceiling: 25 },
  /** Vertical speed when flying up or down, as a fraction of flight speed. */
  climbFraction: 0.7,
  /** Every hero is a vertical capsule this tall and wide at medium size, plus its size class's hitbox. */
  capsule: { height: 1.8, radius: 0.4 },
  /** Where shots leave from and melee measures to, as a fraction of capsule height. */
  chest: 0.6,
  /** Ultimates start this far into their cooldown, seconds. */
  ultimateStartCooldown: 25,
  /** Health fraction that fires lowHealth passives. */
  lowHealth: 0.35,
  /** Damage per hit varies by up to this fraction either way. */
  variance: 0.12,
  /** An area heal, shield or buff delivers at most this many allies' worth in total, shared across everyone it hits. */
  alliesShare: 3,
  /** Burst heals landing on one hero inside this window weaken each other (stacked healers), seconds. */
  healWindow: 3,
  /** Each recent burst heal cuts the next one by this fraction. */
  healFalloff: 0.35,
  /** Default radius for an "allies" effect without its own radius, metres. */
  alliesRadius: 8,
  /** Melee reach beyond the skill's range, metres. */
  meleeSlack: 0.5,
  /** Dashes, blinks and grapples hit the nearest enemy inside this arc, degrees. */
  lungeArc: 40,
  /** A knockback or pull plays out over this long, seconds. */
  knockbackTime: 0.25,
  /** A hit worth this fraction of the target's health counts as heavy (hit-stop and launch on the client). */
  heavyHit: 0.12,
  /** Ground-disc zones reach heroes this close to the floor, metres. */
  groundReach: 1.5,
} as const

export const DT = 1 / ENGINE.tickHz

/** Seconds to whole ticks, rounded up so a 0.1 s stun is never zero ticks. */
export const ticks = (seconds: number) => Math.ceil(seconds * ENGINE.tickHz - 1e-9)
