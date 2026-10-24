import { ENGINE } from '../engine/calibration.js'

/**
 * The client's fixed-step clock (KTD9, KTD15): each frame runs as many 60 Hz engine ticks as wall time allows, then
 * renders between the last two states by the leftover fraction. Long stalls are capped so a hidden tab does not
 * replay minutes of fight in one frame. Nothing ticks while paused.
 */
export interface Clock {
  accumulator: number
  paused: boolean
}

export const MAX_FRAME_SECONDS = 0.25
const TICK = 1 / ENGINE.tickHz

export const createClock = (): Clock => ({ accumulator: 0, paused: false })

/** Advance by one frame of `dtSeconds`; returns how many ticks to run and the interpolation factor in [0, 1). */
export function frame(clock: Clock, dtSeconds: number): { ticks: number; alpha: number } {
  if (clock.paused) return { ticks: 0, alpha: clock.accumulator / TICK }
  clock.accumulator += Math.min(Math.max(0, dtSeconds), MAX_FRAME_SECONDS)
  let ticks = 0
  while (clock.accumulator >= TICK - 1e-9) {
    clock.accumulator -= TICK
    ticks++
  }
  if (clock.accumulator < 0) clock.accumulator = 0
  return { ticks, alpha: clock.accumulator / TICK }
}
