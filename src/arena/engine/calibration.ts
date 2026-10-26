/**
 * Every tunable constant of the 3D arena engine lives here (KTD1, KTD2, KTD5). Bump the version on any change:
 * stored gate results stamped with an older version are re-checked.
 */
export const ENGINE_CALIBRATION_VERSION = 8

export const ENGINE = {
  /** Fixed ticks per second; every timing in the engine and the AI is a whole number of ticks. */
  tickHz: 60,
  /** The arena: x is across, z runs from one half to the other, y is up. Metres. */
  arena: { halfWidth: 40, halfLength: 30, ceiling: 25 },
  /** Vertical speed when flying up or down, as a fraction of flight speed. */
  climbFraction: 0.7,
  /** Every hero is a vertical capsule this tall and wide at medium size, plus its size class's hitbox. */
  /** Largest radius a hero collides with walls at; hit capsules can be bigger (huge, colossal). */
  bodyRadiusCap: 0.9,
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
  /** An area hit lands in full on up to this many enemies; more share it. */
  areaShare: 3,
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
  /**
   * Flight (R8): slower than running and paid for from a meter, so the air is a tactical burst over the ruins rather
   * than the way to travel. Taking off costs `takeoff`, staying up drains `drain` a second, and standing on the ground
   * refills `refill` a second after `refillDelay` seconds. An empty meter can't climb and glides down.
   */
  flight: { max: 100, takeoff: 10, drain: 18, refill: 30, refillDelay: 1 },
  /** Shreds can't push a resist below this. */
  resistFloor: -20,
  /** No armor or spirit resist takes more than this percentage off a hit. */
  resistCap: 75,
  /** More damage taken (vulnerable, marks) stacks to at most this fraction. */
  vulnerableCap: 0.5,
  /** Healing taken can be cut (wound) by at most this fraction. */
  woundCap: 0.75,
  /** Evasion can make a basic attack miss at most this often. */
  evasionCap: 0.5,
  /** Enemies this close see through stealth, metres. */
  revealRange: 3,
  /** The hit that wakes a sleeping hero deals this much more. */
  wakeBonus: 0.5,
  /** A turret's shots, and anything a field or trap catches, reach heroes this close to the floor. */
  fieldHeight: 2.5,
} as const

export const DT = 1 / ENGINE.tickHz

/** Seconds to whole ticks, rounded up so a 0.1 s stun is never zero ticks. */
export const ticks = (seconds: number) => Math.ceil(seconds * ENGINE.tickHz - 1e-9)
