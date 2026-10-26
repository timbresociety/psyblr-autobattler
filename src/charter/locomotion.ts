/**
 * Locomotion (R8, R28, KTD2). Every hero can fly, and one stat, `moveSpeed`, drives running, flying and jumping.
 * The engine and the tooltips both read these multiples, so they never disagree. Flight is slower than running and
 * paid for from a meter (ENGINE.flight), so the ground among the ruins is where fights happen and the air is a burst:
 * over a wall, out of a melee, after a flier.
 */
export const FLIGHT_SPEED_MUL = 0.75
/** Metres of jump or air-dash reach per m/s of move speed. */
export const JUMP_REACH_PER_SPEED = 1.5

export function locomotion(moveSpeed: number): { ground: number; flight: number; jumpReach: number } {
  return { ground: moveSpeed, flight: moveSpeed * FLIGHT_SPEED_MUL, jumpReach: moveSpeed * JUMP_REACH_PER_SPEED }
}

export const LOCOMOTION_HINT = `Ground speed in m/s. Flight runs at ${FLIGHT_SPEED_MUL}× that and drains the flight meter, and jump range is ${JUMP_REACH_PER_SPEED} m per point.`
