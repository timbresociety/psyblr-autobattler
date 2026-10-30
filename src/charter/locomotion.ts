import { ENGINE } from '../arena/engine/calibration.js'

/**
 * Locomotion (R8, R28, KTD2; Forge goal, phase 2). Nobody flies: like Deadlock, every hero runs, jumps, jumps again in
 * the air or dashes on stamina, and slides. One stat, `moveSpeed`, sets the run, and a slide starts faster than it;
 * the jumps, the dash and the stamina are the same for everyone. The engine and the tooltips read the same numbers
 * (ENGINE.move), so they never disagree.
 */
const M = ENGINE.move

/** Metres a dash covers. */
export const DASH_REACH = M.dash.speed * M.dash.time

export function locomotion(moveSpeed: number): { ground: number; slide: number } {
  return { ground: moveSpeed, slide: moveSpeed * M.slide.boost }
}

export const LOCOMOTION_HINT = `Ground speed in m/s; a slide starts at ${M.slide.boost}× it. Everyone jumps ${M.jump} m and has ${M.stamina.max} stamina pips: a ${DASH_REACH.toFixed(1)} m dash or a second jump in the air spends one, and one refills every ${M.stamina.regen} s.`
