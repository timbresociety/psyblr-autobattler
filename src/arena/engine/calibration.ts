/**
 * Every tunable constant of the 3D arena engine lives here (KTD1, KTD2, KTD5). Bump the version on any change:
 * stored gate results stamped with an older version are re-checked.
 */
export const ENGINE_CALIBRATION_VERSION = 3

export const ENGINE = {
  /** Fixed ticks per second; every timing in the engine and the AI is a whole number of ticks. */
  tickHz: 60,
  /** The arena: x is across, z runs from one half to the other, y is up. Metres. */
  arena: { halfWidth: 40, halfLength: 30, ceiling: 25 },
  /** Vertical speed when flying up or down, as a fraction of flight speed. */
  climbFraction: 0.7,
  /** Every hero is a vertical capsule this tall and wide at medium size, plus its size class's hitbox. */
  capsule: { height: 1.8, radius: 0.4 },
} as const

export const DT = 1 / ENGINE.tickHz

/** Seconds to whole ticks, rounded up so a 0.1 s stun is never zero ticks. */
export const ticks = (seconds: number) => Math.ceil(seconds * ENGINE.tickHz - 1e-9)
